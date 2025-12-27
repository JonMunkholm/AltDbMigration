package schema

import (
	"context"
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
	query, err := BuildCreateTableDDL(tableName)
	if err != nil {
		return err
	}

	pool := i.getPool()
	ctx, cancel := i.withTimeout(ctx)
	defer cancel()

	_, err = pool.Exec(ctx, query)
	return err
}

// AddColumn adds a new column to an existing table.
func (i *Introspector) AddColumn(ctx context.Context, tableName string, req AddColumnRequest) error {
	col := ColumnDef{
		Name:       req.Name,
		Type:       req.Type,
		NotNull:    !req.Nullable,
		PrimaryKey: req.PrimaryKey,
		Unique:     req.Unique,
	}

	if req.ForeignKey != nil {
		col.ReferencesTable = req.ForeignKey.ReferencesTable
		col.ReferencesColumn = req.ForeignKey.ReferencesColumn
	}

	query, err := BuildAddColumnDDL(tableName, col)
	if err != nil {
		return err
	}

	pool := i.getPool()
	ctx, cancel := i.withTimeout(ctx)
	defer cancel()

	_, err = pool.Exec(ctx, query)
	return err
}
