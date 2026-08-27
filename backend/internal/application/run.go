package application

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/RolloTomassi37/kekaku/backend/internal/ai"
	"github.com/RolloTomassi37/kekaku/backend/internal/httpapi"
	"github.com/RolloTomassi37/kekaku/backend/internal/store"
)

type Options struct {
	DefaultPort string
	OpenBrowser bool
}

func Run(options Options) error {
	loadEnvFile(".env.local")
	loadEnvFile(".env")
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	databasePath := env("DATABASE_PATH", "./data/kekaku.db")
	legacyDataFile := env("LEGACY_DATA_FILE", env("DATA_FILE", "./data/kekaku.json"))
	dataStore, err := store.Open(databasePath, legacyDataFile)
	if err != nil {
		logger.Error("failed to open data store", "error", err)
		return err
	}
	defer dataStore.Close()

	aiClient := &ai.Client{
		APIKey:  os.Getenv("DEEPSEEK_API_KEY"),
		BaseURL: env("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
		Model:   env("DEEPSEEK_MODEL", "deepseek-v4-flash"),
	}
	port := env("PORT", fallback(options.DefaultPort, "8080"))
	handler := httpapi.New(dataStore, aiClient, env("STATIC_DIR", "./dist"), os.Getenv("CORS_ORIGIN"), logger)
	server := &http.Server{
		Addr:              ":" + port,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      120 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	serverErrors := make(chan error, 1)
	go func() {
		logger.Info("Kekaku server started", "address", server.Addr, "database", databasePath, "deepseek", aiClient.Available())
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErrors <- err
		}
	}()

	if options.OpenBrowser && env("KEKAKU_OPEN_BROWSER", "1") != "0" {
		go openBrowserWhenReady("http://127.0.0.1:"+port, logger)
	}
	stop, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	select {
	case <-stop.Done():
	case err := <-serverErrors:
		logger.Error("server stopped", "error", err)
		return err
	}
	ctx, shutdown := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdown()
	if err := server.Shutdown(ctx); err != nil {
		logger.Error("graceful shutdown failed", "error", err)
		return err
	}
	return nil
}

func openBrowserWhenReady(url string, logger *slog.Logger) {
	client := &http.Client{Timeout: time.Second, Transport: &http.Transport{Proxy: nil}}
	for attempt := 0; attempt < 40; attempt++ {
		response, err := client.Get(url + "/api/health")
		if err == nil {
			_ = response.Body.Close()
			if response.StatusCode >= 200 && response.StatusCode < 300 {
				if err := openURL(url); err != nil {
					logger.Warn("failed to open browser", "error", err, "url", url)
				}
				return
			}
		}
		time.Sleep(250 * time.Millisecond)
	}
	logger.Warn("browser was not opened because the server did not become ready", "url", url)
}

func openURL(url string) error {
	var command *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		command = exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", url)
	case "darwin":
		command = exec.Command("open", url)
	default:
		command = exec.Command("xdg-open", url)
	}
	if err := command.Start(); err != nil {
		return fmt.Errorf("open %s: %w", url, err)
	}
	return nil
}

func env(key, fallbackValue string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallbackValue
}

func fallback(value, fallbackValue string) string {
	if strings.TrimSpace(value) == "" {
		return fallbackValue
	}
	return value
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
