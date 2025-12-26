package schema

import (
	"context"
	"sync"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Introspector queries PostgreSQL to extract schema information.
type Introspector struct {
	pool   *pgxpool.Pool
	dbName string
	mu     sync.RWMutex
}

// NewIntrospector creates a new schema introspector.
func NewIntrospector(pool *pgxpool.Pool, dbName string) *Introspector {
	return &Introspector{pool: pool, dbName: dbName}
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

// ListDatabases returns all user databases (excluding system databases).
func (i *Introspector) ListDatabases(ctx context.Context) ([]string, error) {
	query := `
		SELECT datname FROM pg_database
		WHERE datistemplate = false
		  AND datname NOT IN ('postgres', 'template0', 'template1')
		ORDER BY datname
	`
	pool := i.getPool()
	rows, err := pool.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var databases []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		databases = append(databases, name)
	}
	return databases, rows.Err()
}

// GetSchema returns the complete database schema for the public schema.
func (i *Introspector) GetSchema(ctx context.Context) (*Schema, error) {
	tables, err := i.getTables(ctx)
	if err != nil {
		return nil, err
	}

	for idx := range tables {
		columns, err := i.getColumns(ctx, tables[idx].Name)
		if err != nil {
			return nil, err
		}
		tables[idx].Columns = columns

		fks, err := i.getForeignKeys(ctx, tables[idx].Name)
		if err != nil {
			return nil, err
		}
		tables[idx].ForeignKeys = fks
	}

	return &Schema{Tables: tables}, nil
}

func (i *Introspector) getTables(ctx context.Context) ([]Table, error) {
	query := `
		SELECT table_name
		FROM information_schema.tables
		WHERE table_schema = 'public'
		  AND table_type = 'BASE TABLE'
		ORDER BY table_name
	`

	pool := i.getPool()
	rows, err := pool.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tables := []Table{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		tables = append(tables, Table{Name: name})
	}

	return tables, rows.Err()
}

func (i *Introspector) getColumns(ctx context.Context, tableName string) ([]Column, error) {
	query := `
		SELECT
			c.column_name,
			c.data_type,
			c.is_nullable = 'YES' as is_nullable,
			c.column_default,
			COALESCE(
				(SELECT true FROM information_schema.table_constraints tc
				 JOIN information_schema.key_column_usage kcu
				   ON tc.constraint_name = kcu.constraint_name
				  AND tc.table_schema = kcu.table_schema
				 WHERE tc.constraint_type = 'PRIMARY KEY'
				   AND tc.table_name = c.table_name
				   AND kcu.column_name = c.column_name
				   AND tc.table_schema = 'public'
				 LIMIT 1),
				false
			) as is_primary
		FROM information_schema.columns c
		WHERE c.table_schema = 'public'
		  AND c.table_name = $1
		ORDER BY c.ordinal_position
	`

	pool := i.getPool()
	rows, err := pool.Query(ctx, query, tableName)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	columns := []Column{}
	for rows.Next() {
		var col Column
		if err := rows.Scan(&col.Name, &col.DataType, &col.IsNullable, &col.Default, &col.IsPrimary); err != nil {
			return nil, err
		}
		columns = append(columns, col)
	}

	return columns, rows.Err()
}

func (i *Introspector) getForeignKeys(ctx context.Context, tableName string) ([]ForeignKey, error) {
	query := `
		SELECT
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
		  AND tc.table_name = $1
		  AND tc.table_schema = 'public'
		ORDER BY kcu.column_name
	`

	pool := i.getPool()
	rows, err := pool.Query(ctx, query, tableName)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	fks := []ForeignKey{}
	for rows.Next() {
		var fk ForeignKey
		if err := rows.Scan(&fk.ColumnName, &fk.ReferencesTable, &fk.ReferencesColumn); err != nil {
			return nil, err
		}
		fks = append(fks, fk)
	}

	return fks, rows.Err()
}
