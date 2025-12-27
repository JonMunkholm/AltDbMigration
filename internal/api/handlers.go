package api

import (
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/JonMunkholm/AltDbMigration/internal/config"
	"github.com/JonMunkholm/AltDbMigration/internal/schema"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Handler holds dependencies for HTTP handlers.
type Handler struct {
	introspector *schema.Introspector
	webFS        fs.FS
	config       *config.Config
	csrf         *CSRFMiddleware
	rateLimiter  *RateLimiter
	poolCloseMu  sync.Mutex // Serializes pool close operations to prevent resource exhaustion
}

// NewHandler creates a new API handler.
func NewHandler(introspector *schema.Introspector, webFS embed.FS, cfg *config.Config) (*Handler, error) {
	// Strip the "web" prefix from the embedded filesystem
	subFS, err := fs.Sub(webFS, "web")
	if err != nil {
		return nil, fmt.Errorf("failed to create sub filesystem: %w", err)
	}

	csrf, err := NewCSRFMiddleware()
	if err != nil {
		return nil, fmt.Errorf("failed to create CSRF middleware: %w", err)
	}

	return &Handler{
		introspector: introspector,
		webFS:        subFS,
		config:       cfg,
		csrf:         csrf,
		rateLimiter:  NewRateLimiter(100, time.Minute), // 100 requests per minute
	}, nil
}

// RegisterRoutes sets up the HTTP routes.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	// CSRF token endpoint (must be outside CSRF middleware)
	mux.HandleFunc("GET /api/csrf-token", h.handleGetCSRFToken)

	// API routes - wrapped with rate limiting and CSRF protection
	apiMux := http.NewServeMux()
	apiMux.HandleFunc("GET /api/schema", h.handleGetSchema)
	apiMux.HandleFunc("GET /api/databases", h.handleListDatabases)
	apiMux.HandleFunc("GET /api/types", h.handleGetTypes)
	apiMux.HandleFunc("POST /api/database", h.handleSwitchDatabase)
	apiMux.HandleFunc("POST /api/tables", h.handleCreateTable)
	apiMux.HandleFunc("POST /api/tables/{tableName}/columns", h.handleAddColumn)

	// Apply middleware chain: body limit -> rate limiting -> CSRF
	// 1MB limit for API request bodies
	protected := LimitBodySize(h.rateLimiter.Wrap(h.csrf.Wrap(apiMux)), 1<<20)
	mux.Handle("/api/", protected)

	// Static files (no CSRF needed for GET)
	mux.Handle("/", http.FileServer(http.FS(h.webFS)))
}

// Stop stops background goroutines. Should be called on graceful shutdown.
func (h *Handler) Stop() {
	h.csrf.Stop()
	h.rateLimiter.Stop()
}

type csrfTokenData struct {
	Token string `json:"token"`
}

func (h *Handler) handleGetCSRFToken(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, csrfTokenData{Token: h.csrf.Token()})
}

// API Response types for consistent format
type apiResponse[T any] struct {
	Success bool      `json:"success"`
	Data    T         `json:"data,omitempty"`
	Error   *apiError `json:"error,omitempty"`
}

type apiError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// Error codes for API responses
const (
	ErrInvalidRequest   = "INVALID_REQUEST"
	ErrMissingField     = "MISSING_FIELD"
	ErrInvalidTableName = "INVALID_TABLE_NAME"
	ErrInvalidColName   = "INVALID_COLUMN_NAME"
	ErrSchemaError      = "SCHEMA_ERROR"
	ErrDatabaseError    = "DATABASE_ERROR"
	ErrConnectionError  = "CONNECTION_ERROR"
	ErrUnknownDatabase  = "UNKNOWN_DATABASE"
	ErrCreateTable      = "CREATE_TABLE_ERROR"
	ErrAddColumn        = "ADD_COLUMN_ERROR"
)

// respondJSON sends a successful JSON response with type-safe data
func respondJSON[T any](w http.ResponseWriter, data T) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	resp := apiResponse[T]{Success: true, Data: data}
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		log.Printf("failed to encode response: %v", err)
	}
}

// errorResponse is the response type for errors (no data field)
type errorResponse struct {
	Success bool      `json:"success"`
	Error   *apiError `json:"error,omitempty"`
}

// respondError sends an error JSON response (logs details server-side, sends safe message to client)
func (h *Handler) respondError(w http.ResponseWriter, code string, clientMessage string, status int, internalErr error) {
	// Log full error details server-side
	if internalErr != nil {
		log.Printf("[%s] %s: %v", code, clientMessage, internalErr)
	} else {
		log.Printf("[%s] %s", code, clientMessage)
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	resp := errorResponse{
		Success: false,
		Error:   &apiError{Code: code, Message: clientMessage},
	}
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		log.Printf("failed to encode error response: %v", err)
	}
}

// decodeJSONBody decodes JSON request body into the provided value.
// Returns false if decoding fails (error response already sent).
func (h *Handler) decodeJSONBody(w http.ResponseWriter, r *http.Request, v any) bool {
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		h.respondError(w, ErrInvalidRequest, "Invalid request body", http.StatusBadRequest, err)
		return false
	}
	return true
}

// validateIdentifier checks if a name is a valid SQL identifier.
// Returns true if valid, false if validation failed (error response already sent).
func (h *Handler) validateIdentifier(w http.ResponseWriter, name, fieldName, errCode string) bool {
	if name == "" {
		h.respondError(w, ErrMissingField, fieldName+" is required", http.StatusBadRequest, nil)
		return false
	}
	if !schema.ValidIdentifier(name) {
		h.respondError(w, errCode, "Invalid "+fieldName+" format", http.StatusBadRequest, nil)
		return false
	}
	return true
}

func (h *Handler) handleGetSchema(w http.ResponseWriter, r *http.Request) {
	schema, err := h.introspector.GetSchema(r.Context())
	if err != nil {
		h.respondError(w, ErrSchemaError, "Failed to load schema", http.StatusInternalServerError, err)
		return
	}
	respondJSON(w, schema)
}

type databasesData struct {
	Databases []string `json:"databases"`
	Current   string   `json:"current"`
}

func (h *Handler) handleListDatabases(w http.ResponseWriter, r *http.Request) {
	databases, err := h.introspector.ListDatabases(r.Context())
	if err != nil {
		h.respondError(w, ErrDatabaseError, "Failed to list databases", http.StatusInternalServerError, err)
		return
	}

	respondJSON(w, databasesData{
		Databases: databases,
		Current:   h.introspector.CurrentDatabase(),
	})
}

type typesData struct {
	Types []schema.TypeInfo `json:"types"`
}

func (h *Handler) handleGetTypes(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, typesData{Types: schema.AllowedTypes})
}

type switchDatabaseRequest struct {
	Name string `json:"name"`
}

type switchDatabaseData struct {
	Database string `json:"database"`
}

func (h *Handler) handleSwitchDatabase(w http.ResponseWriter, r *http.Request) {
	var req switchDatabaseRequest
	if !h.decodeJSONBody(w, r, &req) {
		return
	}

	if req.Name == "" {
		h.respondError(w, ErrMissingField, "Database name is required", http.StatusBadRequest, nil)
		return
	}

	// Validate database name against allowed list
	databases, err := h.introspector.ListDatabases(r.Context())
	if err != nil {
		h.respondError(w, ErrDatabaseError, "Failed to validate database", http.StatusInternalServerError, err)
		return
	}

	allowed := false
	for _, db := range databases {
		if db == req.Name {
			allowed = true
			break
		}
	}
	if !allowed {
		h.respondError(w, ErrUnknownDatabase, "Database not found", http.StatusBadRequest, nil)
		return
	}

	// Build connection URL for the new database
	connURL := h.config.BuildDatabaseURL(req.Name)

	// Create new connection pool with request context + timeout
	ctx, cancel := context.WithTimeout(r.Context(), h.config.QueryTimeout)
	defer cancel()

	pool, err := pgxpool.New(ctx, connURL)
	if err != nil {
		h.respondError(w, ErrConnectionError, "Failed to connect to database", http.StatusInternalServerError, err)
		return
	}

	// Verify connection
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		h.respondError(w, ErrConnectionError, "Failed to verify database connection", http.StatusInternalServerError, err)
		return
	}

	// Serialize pool close operations to prevent resource exhaustion
	// Use defer to ensure mutex is always released before response
	h.poolCloseMu.Lock()
	defer h.poolCloseMu.Unlock()

	oldPool := h.introspector.SetPool(pool, req.Name)
	if oldPool != nil {
		// Close the old pool synchronously with timeout
		done := make(chan struct{})
		go func() {
			oldPool.Close()
			close(done)
		}()

		// Use 2x QueryTimeout for close operation, minimum 5 seconds
		timeout := h.config.QueryTimeout * 2
		if timeout < 5*time.Second {
			timeout = 5 * time.Second
		}

		select {
		case <-done:
			log.Printf("[INFO] Connection pool closed successfully")
		case <-time.After(timeout):
			log.Printf("[WARN] Connection pool close timed out after %v", timeout)
		}
	}

	respondJSON(w, switchDatabaseData{Database: req.Name})
}

type createTableRequest struct {
	Name string `json:"name"`
}

type createTableData struct {
	Table string `json:"table"`
}

func (h *Handler) handleCreateTable(w http.ResponseWriter, r *http.Request) {
	var req createTableRequest
	if !h.decodeJSONBody(w, r, &req) {
		return
	}

	if !h.validateIdentifier(w, req.Name, "table name", ErrInvalidTableName) {
		return
	}

	if err := h.introspector.CreateTable(r.Context(), req.Name); err != nil {
		h.respondError(w, ErrCreateTable, "Failed to create table", http.StatusInternalServerError, err)
		return
	}

	respondJSON(w, createTableData{Table: req.Name})
}

type addColumnData struct {
	Column string `json:"column"`
}

func (h *Handler) handleAddColumn(w http.ResponseWriter, r *http.Request) {
	tableName := r.PathValue("tableName")
	if !h.validateIdentifier(w, tableName, "table name", ErrInvalidTableName) {
		return
	}

	var req schema.AddColumnRequest
	if !h.decodeJSONBody(w, r, &req) {
		return
	}

	if req.Name == "" {
		h.respondError(w, ErrMissingField, "Column name is required", http.StatusBadRequest, nil)
		return
	}
	if !schema.ValidIdentifier(req.Name) {
		h.respondError(w, ErrInvalidColName, "Invalid column name format", http.StatusBadRequest, nil)
		return
	}

	if req.Type == "" {
		h.respondError(w, ErrMissingField, "Column type is required", http.StatusBadRequest, nil)
		return
	}
	if !schema.IsValidType(req.Type) {
		h.respondError(w, ErrInvalidRequest, "Invalid column type", http.StatusBadRequest, nil)
		return
	}

	if err := h.introspector.AddColumn(r.Context(), tableName, req); err != nil {
		h.respondError(w, ErrAddColumn, "Failed to add column", http.StatusInternalServerError, err)
		return
	}

	respondJSON(w, addColumnData{Column: req.Name})
}
