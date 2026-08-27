package store

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/RolloTomassi37/kekaku/backend/internal/domain"
)

func TestStorePersistsStateInSQLite(t *testing.T) {
	path := filepath.Join(t.TempDir(), "kekaku.db")
	first, err := Open(path)
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	state := first.Get()
	state.Settings.Theme = "dark"
	state.Plans[0].Completed = true
	state.Timer = domain.CountdownTimer{PlanID: state.Plans[0].ID, Label: state.Plans[0].Title, DurationSeconds: 1500, RemainingSeconds: 1490, EndsAt: time.Now().Add(1490 * time.Second).UTC().Format(time.RFC3339), Status: "running"}
	if err := first.Replace(state); err != nil {
		t.Fatalf("Replace() error = %v", err)
	}
	if err := first.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}
	if !bytes.HasPrefix(data, []byte("SQLite format 3\x00")) {
		t.Fatal("database does not have a SQLite file header")
	}

	second, err := Open(path)
	if err != nil {
		t.Fatalf("reopen error = %v", err)
	}
	t.Cleanup(func() { _ = second.Close() })
	persisted := second.Get()
	if persisted.Settings.Theme != "dark" || !persisted.Plans[0].Completed {
		t.Fatal("state was not persisted in SQLite")
	}
	if persisted.Timer.Status != "running" || persisted.Timer.PlanID != persisted.Plans[0].ID || persisted.Timer.DurationSeconds != 1500 {
		t.Fatalf("timer was not persisted in SQLite: %+v", persisted.Timer)
	}
	var planCount int
	if err := second.db.QueryRow("SELECT COUNT(*) FROM plans").Scan(&planCount); err != nil {
		t.Fatalf("query plans error = %v", err)
	}
	if planCount != len(persisted.Plans) {
		t.Fatalf("plan rows = %d, want %d", planCount, len(persisted.Plans))
	}
}

func TestOpenMigratesExistingDatabaseWithCountdownTimer(t *testing.T) {
	path := filepath.Join(t.TempDir(), "kekaku.db")
	dataStore, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := dataStore.db.Exec(`DELETE FROM countdown_timer`); err != nil {
		t.Fatal(err)
	}
	if err := dataStore.Close(); err != nil {
		t.Fatal(err)
	}

	reopened, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = reopened.Close() })
	if reopened.Get().Timer.DurationSeconds != 300 || reopened.Get().Timer.Status != "idle" {
		t.Fatalf("default timer was not restored: %+v", reopened.Get().Timer)
	}
}

func TestStoreImportsLegacyJSONOnce(t *testing.T) {
	directory := t.TempDir()
	databasePath := filepath.Join(directory, "kekaku.db")
	legacyPath := filepath.Join(directory, "kekaku.json")
	legacy := domain.DefaultState(time.Date(2026, time.August, 26, 12, 0, 0, 0, time.Local))
	legacy.Settings.Theme = "dark"
	legacy.Plans[0].Title = "从 JSON 迁移的计划"
	data, err := json.Marshal(legacy)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(legacyPath, data, 0o600); err != nil {
		t.Fatal(err)
	}

	dataStore, err := Open(databasePath, legacyPath)
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	if dataStore.Get().Plans[0].Title != "从 JSON 迁移的计划" {
		t.Fatal("legacy JSON was not imported")
	}
	if err := dataStore.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(legacyPath); err != nil {
		t.Fatalf("legacy JSON should remain as a backup: %v", err)
	}

	legacy.Plans[0].Title = "不应重复导入"
	data, _ = json.Marshal(legacy)
	if err := os.WriteFile(legacyPath, data, 0o600); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(databasePath, legacyPath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = reopened.Close() })
	if reopened.Get().Plans[0].Title != "从 JSON 迁移的计划" {
		t.Fatal("legacy JSON was imported more than once")
	}
}

func TestInvalidReplaceDoesNotChangeDatabase(t *testing.T) {
	dataStore, err := Open(filepath.Join(t.TempDir(), "kekaku.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = dataStore.Close() })
	original := dataStore.Get()
	invalid := dataStore.Get()
	invalid.Plans[0].Date = "not-a-date"
	if err := dataStore.Replace(invalid); err == nil {
		t.Fatal("Replace() accepted invalid state")
	}
	if dataStore.Get().Plans[0].Date != original.Plans[0].Date {
		t.Fatal("invalid replacement changed the cached state")
	}
}
