package domain

import (
	"testing"
	"time"
)

func TestDefaultStateNormalizes(t *testing.T) {
	state := DefaultState(time.Date(2026, 8, 26, 10, 0, 0, 0, time.Local))
	normalized, err := Normalize(state)
	if err != nil {
		t.Fatalf("Normalize() error = %v", err)
	}
	if len(normalized.Categories) != 3 {
		t.Fatalf("categories = %d, want 3", len(normalized.Categories))
	}
	if normalized.Categories[0].ID != "personal" {
		t.Fatalf("first category = %q", normalized.Categories[0].ID)
	}
	if len(normalized.Plans) == 0 {
		t.Fatal("default state should contain representative plans")
	}
}

func TestNormalizeMovesUnknownCategoryToPersonal(t *testing.T) {
	state := DefaultState(time.Now())
	state.Plans[0].Category = "removed"
	normalized, err := Normalize(state)
	if err != nil {
		t.Fatalf("Normalize() error = %v", err)
	}
	if normalized.Plans[0].Category != "personal" {
		t.Fatalf("category = %q, want personal", normalized.Plans[0].Category)
	}
}

func TestNormalizeRejectsInvalidPlan(t *testing.T) {
	state := DefaultState(time.Now())
	state.Plans[0].Date = "not-a-date"
	if _, err := Normalize(state); err == nil {
		t.Fatal("Normalize() should reject invalid date")
	}
}
