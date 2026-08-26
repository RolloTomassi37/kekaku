package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/RolloTomassi37/kekaku/backend/internal/ai"
	"github.com/RolloTomassi37/kekaku/backend/internal/domain"
	"github.com/RolloTomassi37/kekaku/backend/internal/store"
)

func TestStateEndpoint(t *testing.T) {
	dataStore, err := store.Open(filepath.Join(t.TempDir(), "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	handler := New(dataStore, &ai.Client{}, t.TempDir(), "", nil)
	request := httptest.NewRequest(http.MethodGet, "/api/state", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d", response.Code)
	}
	var state domain.State
	if err := json.NewDecoder(response.Body).Decode(&state); err != nil {
		t.Fatal(err)
	}
	if len(state.Categories) != 3 {
		t.Fatalf("categories = %d", len(state.Categories))
	}
}

func TestHealthReportsMissingDeepSeekKey(t *testing.T) {
	dataStore, err := store.Open(filepath.Join(t.TempDir(), "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	handler := New(dataStore, &ai.Client{}, t.TempDir(), "", nil)
	request := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d", response.Code)
	}
	if response.Body.String() != "{\"deepSeekConfigured\":false,\"status\":\"ok\"}\n" {
		t.Fatalf("body = %s", response.Body.String())
	}
}
