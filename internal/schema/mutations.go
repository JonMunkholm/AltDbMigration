package schema

import (
	"context"
	"fmt"
	"time"
)

// AddColumnRequest represents a request to add a column to a table.
type AddColumnRequest struct {
	Name       string      `json:"name"`
	Type       string      `json:"type"`
	Nullable   bool        `json:"nullable"`
	PrimaryKey bool        `json:"primaryKey"`
	Unique     bool        `json:"unique"`
	ForeignKey *ForeignKey `json:"foreignKey,omitempty"`
}

// CreateTable creates a new table with an auto-incrementing id primary key.
func (i *Introspector) CreateTable(ctx context.Context, tableName string) error {
	if !validIdentifier(tableName) {
		return fmt.Errorf("invalid table name: must be lowercase letters, numbers, underscores, and start with letter or underscore")
	}
	query := `CREATE TABLE ` + sanitizeIdentifier(tableName) + ` (id SERIAL PRIMARY KEY)`
	pool := i.getPool()

	// Add timeout to prevent stalled connections
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	_, err := pool.Exec(ctx, query)
	return err
}

// AddColumn adds a new column to an existing table.
func (i *Introspector) AddColumn(ctx context.Context, tableName string, req AddColumnRequest) error {
	if !validIdentifier(tableName) {
		return fmt.Errorf("invalid table name")
	}
	if !validIdentifier(req.Name) {
		return fmt.Errorf("invalid column name: must be lowercase letters, numbers, underscores, and start with letter or underscore")
	}

	// Build the column definition
	colDef := sanitizeIdentifier(req.Name) + " " + sanitizeType(req.Type)

	if !req.Nullable {
		colDef += " NOT NULL"
	}

	if req.PrimaryKey {
		colDef += " PRIMARY KEY"
	}

	if req.Unique && !req.PrimaryKey { // PK is already unique
		colDef += " UNIQUE"
	}

	if req.ForeignKey != nil && req.ForeignKey.ReferencesTable != "" && req.ForeignKey.ReferencesColumn != "" {
		colDef += " REFERENCES " + sanitizeIdentifier(req.ForeignKey.ReferencesTable) +
			"(" + sanitizeIdentifier(req.ForeignKey.ReferencesColumn) + ")"
	}

	query := `ALTER TABLE ` + sanitizeIdentifier(tableName) + ` ADD COLUMN ` + colDef
	pool := i.getPool()

	// Add timeout to prevent stalled connections
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	_, err := pool.Exec(ctx, query)
	return err
}
