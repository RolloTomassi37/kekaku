package main

import (
	"bufio"
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/RolloTomassi37/kekaku/backend/internal/ai"
	"github.com/RolloTomassi37/kekaku/backend/internal/httpapi"
	"github.com/RolloTomassi37/kekaku/backend/internal/store"
)

func main() {
	loadEnvFile(".env")
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	dataFile := env("DATA_FILE", "./data/kekaku.json")
	dataStore, err := store.Open(dataFile)
	if err != nil {
		logger.Error("failed to open data store", "error", err)
		os.Exit(1)
	}
	aiClient := &ai.Client{APIKey: os.Getenv("DEEPSEEK_API_KEY"), BaseURL: env("DEEPSEEK_BASE_URL", "https://api.deepseek.com"), Model: env("DEEPSEEK_MODEL", "deepseek-v4-flash")}
	handler := httpapi.New(dataStore, aiClient, env("STATIC_DIR", "./dist"), os.Getenv("CORS_ORIGIN"), logger)
	server := &http.Server{Addr: ":" + env("PORT", "8080"), Handler: handler, ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 120 * time.Second, IdleTimeout: 120 * time.Second}
	go func() {
		logger.Info("Kekaku server started", "address", server.Addr, "data", dataFile, "deepseek", aiClient.Available())
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("server stopped", "error", err)
			os.Exit(1)
		}
	}()
	stop, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	<-stop.Done()
	ctx, shutdown := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdown()
	if err := server.Shutdown(ctx); err != nil {
		logger.Error("graceful shutdown failed", "error", err)
	}
}

func env(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func loadEnvFile(path string) {
	file, err := os.Open(path)
	if err != nil {
		return
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key, value = strings.TrimSpace(key), strings.Trim(strings.TrimSpace(value), "\"'")
		if key != "" {
			if _, exists := os.LookupEnv(key); !exists {
				_ = os.Setenv(key, value)
			}
		}
	}
}
