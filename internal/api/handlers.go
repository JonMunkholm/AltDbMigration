package api

import (
	"context"
	"embed"
	"encoding/json"
	"io/fs"
	"log"
	"net/http"

	"github.com/JonMunkholm/AltDbMigration/internal/config"
	"github.com/JonMunkholm/AltDbMigration/internal/schema"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Handler holds dependencies for HTTP handlers.
type Handler struct {
	introspector *schema.Introspector
	webFS        fs.FS
	config       *config.Config
}

// NewHandler creates a new API handler.
func NewHandler(introspector *schema.Introspector, webFS embed.FS, cfg *config.Config) *Handler {
	// Strip the "web" prefix from the embedded filesystem
	subFS, err := fs.Sub(webFS, "web")
	if err != nil {
		log.Fatalf("failed to create sub filesystem: %v", err)
	}

	return &Handler{
		introspector: introspector,
		webFS:        subFS,
		config:       cfg,
	}
}

// RegisterRoutes sets up the HTTP routes.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/schema", h.handleGetSchema)
	mux.HandleFunc("GET /api/databases", h.handleListDatabases)
	mux.HandleFunc("POST /api/database", h.handleSwitchDatabase)
	mux.Handle("GET /", http.FileServer(http.FS(h.webFS)))
}

func (h *Handler) handleGetSchema(w http.ResponseWriter, r *http.Request) {
	schema, err := h.introspector.GetSchema(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(schema); err != nil {
		log.Printf("failed to encode schema: %v", err)
	}
}

type databasesResponse struct {
	Databases []string `json:"databases"`
	Current   string   `json:"current"`
}

func (h *Handler) handleListDatabases(w http.ResponseWriter, r *http.Request) {
	databases, err := h.introspector.ListDatabases(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	resp := databasesResponse{
		Databases: databases,
		Current:   h.introspector.CurrentDatabase(),
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		log.Printf("failed to encode databases: %v", err)
	}
}

type switchDatabaseRequest struct {
	Name string `json:"name"`
}

func (h *Handler) handleSwitchDatabase(w http.ResponseWriter, r *http.Request) {
	var req switchDatabaseRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if req.Name == "" {
		http.Error(w, "database name is required", http.StatusBadRequest)
		return
	}

	// Validate database name against allowed list
	databases, err := h.introspector.ListDatabases(r.Context())
	if err != nil {
		http.Error(w, "failed to list databases", http.StatusInternalServerError)
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
		http.Error(w, "unknown database", http.StatusBadRequest)
		return
	}

	// Build connection URL for the new database
	connURL := h.config.BuildDatabaseURL(req.Name)

	// Create new connection pool
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, connURL)
	if err != nil {
		http.Error(w, "failed to connect to database: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Verify connection
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		http.Error(w, "failed to ping database: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Swap the pool and close the old one
	oldPool := h.introspector.SetPool(pool, req.Name)
	if oldPool != nil {
		oldPool.Close()
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok", "database": req.Name})
}
