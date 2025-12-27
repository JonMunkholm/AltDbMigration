package schema

// Column represents a single column in a database table.
type Column struct {
	Name       string  `json:"name"`
	DataType   string  `json:"dataType"`
	IsNullable bool    `json:"isNullable"`
	IsPrimary  bool    `json:"isPrimary"`
	IsUnique   bool    `json:"isUnique"`
	Default    *string `json:"default,omitempty"`
}

// ForeignKey represents a foreign key constraint.
type ForeignKey struct {
	ColumnName       string `json:"columnName"`
	ReferencesTable  string `json:"referencesTable"`
	ReferencesColumn string `json:"referencesColumn"`
}

// Table represents a database table with its columns and relationships.
type Table struct {
	Name        string       `json:"name"`
	Columns     []Column     `json:"columns"`
	ForeignKeys []ForeignKey `json:"foreignKeys"`
}

// Schema represents the complete database schema.
type Schema struct {
	Tables []Table `json:"tables"`
}
