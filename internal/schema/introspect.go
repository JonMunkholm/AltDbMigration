package schema

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Introspector queries PostgreSQL to extract schema information.
type Introspector struct {
	pool         *pgxpool.Pool
	dbName       string
	queryTimeout time.Duration
	mu           sync.RWMutex
}

// NewIntrospector creates a new schema introspector.
func NewIntrospector(pool *pgxpool.Pool, dbName string, queryTimeout time.Duration) *Introspector {
	return &Introspector{pool: pool, dbName: dbName, queryTimeout: queryTimeout}
}

// SetPool swaps the connection pool for a new database.
// Returns the old pool so the caller can close it.
func (i *Introspector) SetPool(pool *pgxpool.Pool, dbName string) *pgxpool.Pool {
	i.mu.Lock()
	defer i.mu.Unlock()
	oldPool := i.pool
	i.pool = pool
	i.dbName = dbName
	return oldPool
}

// CurrentDatabase returns the name of the currently connected database.
func (i *Introspector) CurrentDatabase() string {
	i.mu.RLock()
	defer i.mu.RUnlock()
	return i.dbName
}

// getPool returns the current connection pool with read lock.
func (i *Introspector) getPool() *pgxpool.Pool {
	i.mu.RLock()
	defer i.mu.RUnlock()
	return i.pool
}

// withTimeout returns a context with the query timeout applied.
// If the parent context already has a shorter deadline, that deadline is preserved.
// Returns the context and a cancel function that must be called.
func (i *Introspector) withTimeout(parent context.Context) (context.Context, context.CancelFunc) {
	// Check if parent already has a deadline
	if deadline, ok := parent.Deadline(); ok {
		remaining := time.Until(deadline)
		// If parent deadline is sooner than our timeout, use parent as-is
		// but still return a cancel func for consistency
		if remaining <= i.queryTimeout {
			ctx, cancel := context.WithCancel(parent)
			return ctx, cancel
		}
	}
	// Apply our timeout
	return context.WithTimeout(parent, i.queryTimeout)
}

// ListDatabases returns all user databases (excluding system databases).
func (i *Introspector) ListDatabases(ctx context.Context) ([]string, error) {
	ctx, cancel := i.withTimeout(ctx)
	defer cancel()

	query := `
		SELECT datname FROM pg_database
		WHERE datistemplate = false
		  AND datname NOT IN ('postgres', 'template0', 'template1')
		ORDER BY datname
	`
	pool := i.getPool()
	rows, err := pool.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("failed to list databases: %w", err)
	}
	defer rows.Close()

	databases := make([]string, 0, 16) // Pre-allocate for typical server
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, fmt.Errorf("failed to scan database name: %w", err)
		}
		databases = append(databases, name)
	}
	return databases, rows.Err()
}

// GetSchema returns the complete database schema for the public schema.
// Uses batch queries to avoid N+1 query problem (3 queries total).
func (i *Introspector) GetSchema(ctx context.Context) (*Schema, error) {
	ctx, cancel := i.withTimeout(ctx)
	defer cancel()

	pool := i.getPool()

	// Query 1: Get all tables
	tables, err := i.getAllTables(ctx, pool)
	if err != nil {
		return nil, err
	}

	if len(tables) == 0 {
		return &Schema{Tables: []Table{}}, nil
	}

	// Query 2: Get all columns for all tables (batch)
	columnsByTable, err := i.getAllColumns(ctx, pool)
	if err != nil {
		return nil, err
	}

	// Query 3: Get all foreign keys for all tables (batch)
	fksByTable, err := i.getAllForeignKeys(ctx, pool)
	if err != nil {
		return nil, err
	}

	// Assemble the schema
	for idx := range tables {
		tableName := tables[idx].Name
		tables[idx].Columns = columnsByTable[tableName]
		tables[idx].ForeignKeys = fksByTable[tableName]
	}

	return &Schema{Tables: tables}, nil
}

func (i *Introspector) getAllTables(ctx context.Context, pool *pgxpool.Pool) ([]Table, error) {
	query := `
		SELECT table_name
		FROM information_schema.tables
		WHERE table_schema = 'public'
		  AND table_type = 'BASE TABLE'
		ORDER BY table_name
	`

	rows, err := pool.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("failed to get tables: %w", err)
	}
	defer rows.Close()

	tables := make([]Table, 0, 64) // Pre-allocate for typical schema
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, fmt.Errorf("failed to scan table name: %w", err)
		}
		tables = append(tables, Table{Name: name})
	}

	return tables, rows.Err()
}

func (i *Introspector) getAllColumns(ctx context.Context, pool *pgxpool.Pool) (map[string][]Column, error) {
	query := `
		SELECT
			c.table_name,
			c.column_name,
			c.data_type,
			c.is_nullable = 'YES' as is_nullable,
			c.column_default,
			COALESCE(pk.is_pk, false) as is_primary,
			COALESCE(uq.is_unique, false) as is_unique
		FROM information_schema.columns c
		LEFT JOIN (
			SELECT DISTINCT kcu.table_name, kcu.column_name, true as is_pk
			FROM information_schema.table_constraints tc
			JOIN information_schema.key_column_usage kcu
			  ON tc.constraint_name = kcu.constraint_name
			 AND tc.table_schema = kcu.table_schema
			WHERE tc.constraint_type = 'PRIMARY KEY'
			  AND tc.table_schema = 'public'
		) pk ON c.table_name = pk.table_name AND c.column_name = pk.column_name
		LEFT JOIN (
			SELECT DISTINCT kcu.table_name, kcu.column_name, true as is_unique
			FROM information_schema.table_constraints tc
			JOIN information_schema.key_column_usage kcu
			  ON tc.constraint_name = kcu.constraint_name
			 AND tc.table_schema = kcu.table_schema
			WHERE tc.constraint_type = 'UNIQUE'
			  AND tc.table_schema = 'public'
			  AND (SELECT COUNT(*) FROM information_schema.key_column_usage kcu2
			       WHERE kcu2.constraint_name = tc.constraint_name
			         AND kcu2.table_schema = tc.table_schema) = 1
		) uq ON c.table_name = uq.table_name AND c.column_name = uq.column_name
		WHERE c.table_schema = 'public'
		ORDER BY c.table_name, c.ordinal_position
	`

	rows, err := pool.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("failed to get columns: %w", err)
	}
	defer rows.Close()

	columnsByTable := make(map[string][]Column)
	for rows.Next() {
		var tableName string
		var col Column
		if err := rows.Scan(&tableName, &col.Name, &col.DataType, &col.IsNullable, &col.Default, &col.IsPrimary, &col.IsUnique); err != nil {
			return nil, fmt.Errorf("failed to scan column: %w", err)
		}
		columnsByTable[tableName] = append(columnsByTable[tableName], col)
	}

	return columnsByTable, rows.Err()
}

func (i *Introspector) getAllForeignKeys(ctx context.Context, pool *pgxpool.Pool) (map[string][]ForeignKey, error) {
	query := `
		SELECT
			tc.table_name,
			kcu.column_name,
			ccu.table_name AS references_table,
			ccu.column_name AS references_column
		FROM information_schema.table_constraints tc
		JOIN information_schema.key_column_usage kcu
		  ON tc.constraint_name = kcu.constraint_name
		 AND tc.table_schema = kcu.table_schema
		JOIN information_schema.constraint_column_usage ccu
		  ON ccu.constraint_name = tc.constraint_name
		 AND ccu.table_schema = tc.table_schema
		WHERE tc.constraint_type = 'FOREIGN KEY'
		  AND tc.table_schema = 'public'
		ORDER BY tc.table_name, kcu.column_name
	`

	rows, err := pool.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("failed to get foreign keys: %w", err)
	}
	defer rows.Close()

	fksByTable := make(map[string][]ForeignKey)
	for rows.Next() {
		var tableName string
		var fk ForeignKey
		if err := rows.Scan(&tableName, &fk.ColumnName, &fk.ReferencesTable, &fk.ReferencesColumn); err != nil {
			return nil, fmt.Errorf("failed to scan foreign key: %w", err)
		}
		fksByTable[tableName] = append(fksByTable[tableName], fk)
	}

	return fksByTable, rows.Err()
}
