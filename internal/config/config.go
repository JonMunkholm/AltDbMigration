package config

import (
	"fmt"
	"net/url"
	"os"
	"strconv"
	"time"

	"github.com/joho/godotenv"
)

// Config holds the application configuration.
type Config struct {
	DatabaseURL string
	Port        string
	dbURL       *url.URL // Parsed database URL for building new connections

	// Timeouts
	ReadTimeout     time.Duration
	WriteTimeout    time.Duration
	ShutdownTimeout time.Duration
	QueryTimeout    time.Duration
}

// Load reads configuration from .env file and environment variables.
func Load() (*Config, error) {
	// Load .env file if it exists (silently ignore if missing)
	_ = godotenv.Load()

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		return nil, fmt.Errorf("DATABASE_URL environment variable is required")
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	parsedURL, err := url.Parse(dbURL)
	if err != nil {
		return nil, fmt.Errorf("invalid DATABASE_URL: %w", err)
	}

	return &Config{
		DatabaseURL:     dbURL,
		Port:            port,
		dbURL:           parsedURL,
		ReadTimeout:     getDurationEnv("READ_TIMEOUT", 10*time.Second),
		WriteTimeout:    getDurationEnv("WRITE_TIMEOUT", 10*time.Second),
		ShutdownTimeout: getDurationEnv("SHUTDOWN_TIMEOUT", 5*time.Second),
		QueryTimeout:    getDurationEnv("QUERY_TIMEOUT", 30*time.Second),
	}, nil
}

// getDurationEnv reads a duration from environment variable (in seconds).
// Returns default if not set or invalid.
func getDurationEnv(key string, defaultVal time.Duration) time.Duration {
	val := os.Getenv(key)
	if val == "" {
		return defaultVal
	}
	seconds, err := strconv.Atoi(val)
	if err != nil {
		return defaultVal
	}
	return time.Duration(seconds) * time.Second
}

// BuildDatabaseURL returns a connection URL for the specified database name,
// using the same host, user, password, and options as the original connection.
func (c *Config) BuildDatabaseURL(dbName string) string {
	newURL := *c.dbURL
	newURL.Path = "/" + dbName
	return newURL.String()
}

// CurrentDatabase returns the database name from the current connection URL.
func (c *Config) CurrentDatabase() string {
	if c.dbURL.Path == "" {
		return ""
	}
	return c.dbURL.Path[1:] // Remove leading slash
}
