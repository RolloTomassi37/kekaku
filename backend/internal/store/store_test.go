package store

import (
	"path/filepath"
	"testing"
)

func TestStorePersistsState(t *testing.T) {
	path := filepath.Join(t.TempDir(), "kekaku.json")
	first, err := Open(path)
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	state := first.Get()
	state.Settings.Theme = "dark"
	if err := first.Replace(state); err != nil {
		t.Fatalf("Replace() error = %v", err)
	}
	second, err := Open(path)
	if err != nil {
		t.Fatalf("reopen error = %v", err)
	}
	if second.Get().Settings.Theme != "dark" {
		t.Fatal("theme was not persisted")
	}
}
