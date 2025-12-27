package schema

import (
	"fmt"
	"strings"
)

// TypeInfo represents a PostgreSQL data type with metadata.
type TypeInfo struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Category    string `json:"category"`
}

// AllowedTypes is the canonical list of supported PostgreSQL types.
// Frontend should fetch this via API to stay in sync.
var AllowedTypes = []TypeInfo{
	// String types
	{Name: "text", Description: "Variable length string", Category: "String"},
	{Name: "varchar", Description: "Variable length (limited)", Category: "String"},
	{Name: "char", Description: "Fixed length", Category: "String"},

	// Numeric types
	{Name: "smallint", Description: "16-bit integer", Category: "Numeric"},
	{Name: "integer", Description: "32-bit integer", Category: "Numeric"},
	{Name: "bigint", Description: "64-bit integer", Category: "Numeric"},
	{Name: "numeric", Description: "Decimal number", Category: "Numeric"},
	{Name: "real", Description: "32-bit floating point", Category: "Numeric"},
	{Name: "double precision", Description: "64-bit floating point", Category: "Numeric"},

	// Serial types
	{Name: "serial", Description: "Auto-increment 32-bit", Category: "Serial"},
	{Name: "bigserial", Description: "Auto-increment 64-bit", Category: "Serial"},

	// Boolean
	{Name: "boolean", Description: "true/false", Category: "Boolean"},

	// Date/Time types
	{Name: "date", Description: "Date only", Category: "Date/Time"},
	{Name: "time", Description: "Time only", Category: "Date/Time"},
	{Name: "timestamp", Description: "Date and time", Category: "Date/Time"},
	{Name: "timestamptz", Description: "Timestamp with timezone", Category: "Date/Time"},

	// UUID
	{Name: "uuid", Description: "UUID", Category: "UUID"},

	// JSON types
	{Name: "json", Description: "JSON data", Category: "JSON"},
	{Name: "jsonb", Description: "Binary JSON data", Category: "JSON"},

	// Binary
	{Name: "bytea", Description: "Binary data", Category: "Binary"},
}

// allowedTypesMap is built from AllowedTypes for O(1) lookup
var allowedTypesMap = buildAllowedTypesMap()

func buildAllowedTypesMap() map[string]bool {
	m := make(map[string]bool)
	for _, t := range AllowedTypes {
		m[t.Name] = true
	}
	return m
}

// ValidIdentifier checks if a name is a valid SQL identifier.
// Exported for use in API handlers for path parameter validation.
func ValidIdentifier(name string) bool {
	if name == "" || len(name) > 63 {
		return false
	}
	for i, r := range name {
		if i == 0 {
			if !((r >= 'a' && r <= 'z') || r == '_') {
				return false
			}
		} else {
			if !((r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_') {
				return false
			}
		}
	}
	return true
}

// sanitizeIdentifier ensures the identifier is safe for SQL.
// Escapes double quotes and wraps in quotes to prevent injection.
func sanitizeIdentifier(name string) string {
	// Escape any double quotes by doubling them (SQL standard)
	escaped := strings.ReplaceAll(name, `"`, `""`)
	return `"` + escaped + `"`
}

// IsValidType checks if the given type name is in the allowed types list.
func IsValidType(t string) bool {
	return allowedTypesMap[t]
}

// sanitizeType validates and returns a safe type name.
// Returns error if type is not in allowed list.
func sanitizeType(t string) (string, error) {
	if allowedTypesMap[t] {
		return t, nil
	}
	return "", fmt.Errorf("unsupported column type %q", t)
}

// ColumnDef holds validated column definition parts for DDL building.
type ColumnDef struct {
	Name             string
	Type             string
	NotNull          bool
	PrimaryKey       bool
	Unique           bool
	ReferencesTable  string
	ReferencesColumn string
}

// BuildCreateTableDDL constructs a CREATE TABLE statement safely.
// Returns error if tableName is invalid.
func BuildCreateTableDDL(tableName string) (string, error) {
	if !ValidIdentifier(tableName) {
		return "", fmt.Errorf("invalid table name: must be lowercase letters, numbers, underscores, and start with letter or underscore")
	}
	return fmt.Sprintf("CREATE TABLE %s (id SERIAL PRIMARY KEY)", sanitizeIdentifier(tableName)), nil
}

// BuildAddColumnDDL constructs an ALTER TABLE ADD COLUMN statement safely.
// Returns error if tableName or column definition is invalid.
func BuildAddColumnDDL(tableName string, col ColumnDef) (string, error) {
	if !ValidIdentifier(tableName) {
		return "", fmt.Errorf("invalid table name")
	}
	if !ValidIdentifier(col.Name) {
		return "", fmt.Errorf("invalid column name: must be lowercase letters, numbers, underscores, and start with letter or underscore")
	}

	// Build column definition
	var parts []string
	parts = append(parts, sanitizeIdentifier(col.Name))

	safeType, err := sanitizeType(col.Type)
	if err != nil {
		return "", err
	}
	parts = append(parts, safeType)

	if col.NotNull {
		parts = append(parts, "NOT NULL")
	}

	if col.PrimaryKey {
		parts = append(parts, "PRIMARY KEY")
	}

	if col.Unique && !col.PrimaryKey {
		parts = append(parts, "UNIQUE")
	}

	if col.ReferencesTable != "" && col.ReferencesColumn != "" {
		if !ValidIdentifier(col.ReferencesTable) {
			return "", fmt.Errorf("invalid foreign key table name")
		}
		if !ValidIdentifier(col.ReferencesColumn) {
			return "", fmt.Errorf("invalid foreign key column name")
		}
		parts = append(parts, fmt.Sprintf("REFERENCES %s(%s)",
			sanitizeIdentifier(col.ReferencesTable),
			sanitizeIdentifier(col.ReferencesColumn)))
	}

	return fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s",
		sanitizeIdentifier(tableName),
		strings.Join(parts, " ")), nil
}
