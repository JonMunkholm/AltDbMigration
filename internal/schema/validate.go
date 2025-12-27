package schema

import "strings"

// validIdentifier checks if a name is a valid SQL identifier.
func validIdentifier(name string) bool {
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

// sanitizeType validates and returns a safe type name.
func sanitizeType(t string) string {
	// Whitelist of allowed types
	allowed := map[string]string{
		"text":    "text",
		"date":    "date",
		"numeric": "numeric",
	}
	if safe, ok := allowed[t]; ok {
		return safe
	}
	return "text" // default to text if unknown
}
