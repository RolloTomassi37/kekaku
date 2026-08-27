package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/RolloTomassi37/kekaku/backend/internal/ai"
	"github.com/RolloTomassi37/kekaku/backend/internal/domain"
	"github.com/RolloTomassi37/kekaku/backend/internal/store"
)

func TestAIPlanRequiresAndReturnsFixedSchema(t *testing.T) {
	deepSeek := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			Messages []struct {
				Role    string `json:"role"`
				Content string `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatal(err)
		}
		if len(request.Messages) != 2 || !bytes.Contains([]byte(request.Messages[0].Content), []byte(`"schemaVersion":"1.0"`)) {
			t.Fatalf("fixed schema missing from system prompt: %+v", request.Messages)
		}
		content := `{"schemaVersion":"1.0","summary":"已拆分","plans":[{"title":"英语课","date":"2026-08-27","startTime":"19:00","endTime":"21:00","category":"study","note":"完成课程"}]}`
		_ = json.NewEncoder(w).Encode(map[string]any{"model": "deepseek-v4-flash", "choices": []any{map[string]any{"finish_reason": "stop", "message": map[string]any{"content": content}}}})
	}))
	defer deepSeek.Close()

	dataStore, err := store.Open(filepath.Join(t.TempDir(), "state.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = dataStore.Close() })
	handler := New(dataStore, &ai.Client{APIKey: "test", BaseURL: deepSeek.URL, HTTP: deepSeek.Client(), RetryDelay: -1}, t.TempDir(), "", nil)
	body := bytes.NewBufferString(`{"prompt":"明晚学习英语","today":"2026-08-26","currentTime":"2026-08-26 17:00","timezone":"Asia/Shanghai","categories":[{"id":"study","label":"学习"}]}`)
	request := httptest.NewRequest(http.MethodPost, "/api/ai-plan", body)
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d body = %s", response.Code, response.Body.String())
	}
	var result struct {
		SchemaVersion string      `json:"schemaVersion"`
		Plans         []planDraft `json:"plans"`
	}
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	if result.SchemaVersion != "1.0" || len(result.Plans) != 1 || result.Plans[0].Category != "study" {
		t.Fatalf("unexpected result: %+v", result)
	}
}

func TestAIPlanRejectsWrongSchemaVersion(t *testing.T) {
	deepSeek := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		content := `{"summary":"旧格式","plans":[{"title":"英语课","date":"2026-08-27","startTime":"19:00","endTime":"20:00","category":"study","note":""}]}`
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"finish_reason": "stop", "message": map[string]any{"content": content}}}})
	}))
	defer deepSeek.Close()

	dataStore, err := store.Open(filepath.Join(t.TempDir(), "state.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = dataStore.Close() })
	handler := New(dataStore, &ai.Client{APIKey: "test", BaseURL: deepSeek.URL, HTTP: deepSeek.Client(), RetryDelay: -1}, t.TempDir(), "", nil)
	body := bytes.NewBufferString(`{"prompt":"明晚学习英语","today":"2026-08-26","categories":[{"id":"study","label":"学习"}]}`)
	request := httptest.NewRequest(http.MethodPost, "/api/ai-plan", body)
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusBadGateway {
		t.Fatalf("status = %d body = %s", response.Code, response.Body.String())
	}
}

func TestStateEndpoint(t *testing.T) {
	dataStore, err := store.Open(filepath.Join(t.TempDir(), "state.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = dataStore.Close() })
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
	dataStore, err := store.Open(filepath.Join(t.TempDir(), "state.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = dataStore.Close() })
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

func TestCalendarEmailRequiresExplicitConfirmationAndAuthorizationCode(t *testing.T) {
	dataStore, err := store.Open(filepath.Join(t.TempDir(), "state.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = dataStore.Close() })
	handler := New(dataStore, &ai.Client{}, t.TempDir(), "", nil)

	tests := []struct {
		name string
		body string
	}{
		{name: "not confirmed", body: `{"smtpPassword":"temporary-code","confirmed":false}`},
		{name: "missing authorization code", body: `{"smtpPassword":"","confirmed":true}`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "/api/calendar/email", bytes.NewBufferString(test.body))
			request.Header.Set("Content-Type", "application/json")
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != http.StatusBadRequest {
				t.Fatalf("status = %d body = %s", response.Code, response.Body.String())
			}
		})
	}
}
