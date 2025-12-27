package main

import (
	"context"
	"embed"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/JonMunkholm/AltDbMigration/internal/api"
	"github.com/JonMunkholm/AltDbMigration/internal/config"
	"github.com/JonMunkholm/AltDbMigration/internal/schema"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed web/*
var webFS embed.FS

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer pool.Close()

	if err := pool.Ping(ctx); err != nil {
		log.Fatalf("Failed to ping database: %v", err)
	}

	introspector := schema.NewIntrospector(pool, cfg.CurrentDatabase(), cfg.QueryTimeout)
	handler, err := api.NewHandler(introspector, webFS, cfg)
	if err != nil {
		log.Fatalf("Failed to create API handler: %v", err)
	}

	mux := http.NewServeMux()
	handler.RegisterRoutes(mux)

	server := &http.Server{
		Addr:           ":" + cfg.Port,
		Handler:        mux,
		ReadTimeout:    cfg.ReadTimeout,
		WriteTimeout:   cfg.WriteTimeout,
		MaxHeaderBytes: 1 << 20, // 1 MB
	}

	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh

		log.Println("Shutting down...")
		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
		defer shutdownCancel()

		if err := server.Shutdown(shutdownCtx); err != nil {
			log.Printf("Shutdown error: %v", err)
		}
		handler.Stop()
		cancel()
	}()

	fmt.Printf("Schema Visualizer running at http://localhost:%s\n", cfg.Port)
	if err := server.ListenAndServe(); err != http.ErrServerClosed {
		log.Fatalf("Server error: %v", err)
	}
}
