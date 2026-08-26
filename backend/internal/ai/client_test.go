package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestCompleteJSONRetriesEmptyContent(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		call := calls.Add(1)
		var payload struct {
			Thinking struct {
				Type string `json:"type"`
			} `json:"thinking"`
			Messages []message `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		if payload.Thinking.Type != "disabled" {
			t.Fatalf("thinking type = %q", payload.Thinking.Type)
		}
		if call == 2 && !strings.Contains(payload.Messages[1].Content, "上一次 JSON 输出为空") {
			t.Fatal("retry prompt was not reinforced")
		}
		w.Header().Set("Content-Type", "application/json")
		if call == 1 {
			_, _ = w.Write([]byte(`{"model":"deepseek-v4-flash","choices":[{"finish_reason":"stop","message":{"content":""}}]}`))
			return
		}
		_, _ = w.Write([]byte(`{"model":"deepseek-v4-flash","choices":[{"finish_reason":"stop","message":{"content":"{\"plans\":[]}"}}]}`))
	}))
	defer server.Close()

	client := &Client{APIKey: "test", BaseURL: server.URL, HTTP: server.Client(), RetryDelay: -1}
	content, err := client.CompleteJSON(context.Background(), "system json", "user", 500)
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != `{"plans":[]}` || calls.Load() != 2 {
		t.Fatalf("content=%s calls=%d", content, calls.Load())
	}
}

func TestCompleteJSONDoesNotRetryUnauthorized(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":{"message":"invalid api key"}}`))
	}))
	defer server.Close()

	client := &Client{APIKey: "test", BaseURL: server.URL, HTTP: server.Client(), RetryDelay: -1}
	_, err := client.CompleteJSON(context.Background(), "system json", "user", 500)
	if err == nil || !strings.Contains(err.Error(), "HTTP 401") || calls.Load() != 1 {
		t.Fatalf("err=%v calls=%d", err, calls.Load())
	}
}

func TestCompleteJSONReportsFinishReasonAfterRetries(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		_, _ = w.Write([]byte(`{"model":"deepseek-v4-flash","choices":[{"finish_reason":"insufficient_system_resource","message":{"content":null}}]}`))
	}))
	defer server.Close()

	client := &Client{APIKey: "test", BaseURL: server.URL, HTTP: server.Client(), MaxAttempts: 2, RetryDelay: -1}
	_, err := client.CompleteJSON(context.Background(), "system json", "user", 500)
	if err == nil || !strings.Contains(err.Error(), "after 2 attempt") || !strings.Contains(err.Error(), "insufficient_system_resource") || calls.Load() != 2 {
		t.Fatalf("err=%v calls=%d", err, calls.Load())
	}
}
