package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type Client struct {
	APIKey      string
	BaseURL     string
	Model       string
	HTTP        *http.Client
	MaxAttempts int
	RetryDelay  time.Duration
}

type message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type completionResponse struct {
	Model   string `json:"model"`
	Choices []struct {
		FinishReason string `json:"finish_reason"`
		Message      struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
}

func (c *Client) Available() bool { return strings.TrimSpace(c.APIKey) != "" }

func (c *Client) CompleteJSON(ctx context.Context, system, user string, maxTokens int) ([]byte, error) {
	if !c.Available() {
		return nil, errors.New("DeepSeek API key is not configured")
	}
	attempts := c.MaxAttempts
	if attempts <= 0 {
		attempts = 3
	}
	var lastError error
	attempted := 0
	for attempt := 1; attempt <= attempts; attempt++ {
		attempted = attempt
		content, retry, err := c.completeJSONAttempt(ctx, system, retryPrompt(user, attempt), maxTokens)
		if err == nil {
			return content, nil
		}
		lastError = err
		if !retry || attempt == attempts {
			break
		}
		if err := c.waitForRetry(ctx, attempt); err != nil {
			return nil, err
		}
	}
	return nil, fmt.Errorf("DeepSeek JSON completion failed after %d attempt(s): %w", attempted, lastError)
}

func (c *Client) completeJSONAttempt(ctx context.Context, system, user string, maxTokens int) ([]byte, bool, error) {
	baseURL := strings.TrimRight(c.BaseURL, "/")
	if baseURL == "" {
		baseURL = "https://api.deepseek.com"
	}
	model := strings.TrimSpace(c.Model)
	if model == "" {
		model = "deepseek-v4-flash"
	}
	payload := map[string]any{
		"model":           model,
		"thinking":        map[string]string{"type": "disabled"},
		"response_format": map[string]string{"type": "json_object"},
		"max_tokens":      maxTokens,
		"messages":        []message{{Role: "system", Content: system}, {Role: "user", Content: user}},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, false, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return nil, false, err
	}
	req.Header.Set("Authorization", "Bearer "+c.APIKey)
	req.Header.Set("Content-Type", "application/json")
	httpClient := c.HTTP
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 90 * time.Second}
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, ctx.Err() == nil, err
	}
	defer resp.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return nil, resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500, fmt.Errorf("DeepSeek returned HTTP %d%s", resp.StatusCode, apiErrorSuffix(responseBody))
	}
	var result completionResponse
	if err := json.Unmarshal(responseBody, &result); err != nil {
		return nil, true, fmt.Errorf("invalid DeepSeek response envelope: %w", err)
	}
	if len(result.Choices) == 0 {
		return nil, true, fmt.Errorf("empty choices (model=%s)", fallbackLabel(result.Model, model))
	}
	choice := result.Choices[0]
	content := strings.TrimSpace(choice.Message.Content)
	if content == "" {
		return nil, true, fmt.Errorf("empty content (finish_reason=%s, model=%s)", fallbackLabel(choice.FinishReason, "unknown"), fallbackLabel(result.Model, model))
	}
	if !json.Valid([]byte(content)) {
		return nil, true, fmt.Errorf("invalid JSON content (finish_reason=%s, model=%s)", fallbackLabel(choice.FinishReason, "unknown"), fallbackLabel(result.Model, model))
	}
	return []byte(content), false, nil
}

func retryPrompt(user string, attempt int) string {
	if attempt <= 1 {
		return user
	}
	return user + "\n\n上一次 JSON 输出为空或不完整。请重新生成，只返回一个非空、语法完整的 JSON 对象；不要输出 Markdown、代码围栏或解释。"
}

func (c *Client) waitForRetry(ctx context.Context, attempt int) error {
	delay := c.RetryDelay
	if delay == 0 {
		delay = 250 * time.Millisecond
	}
	if delay < 0 {
		return nil
	}
	timer := time.NewTimer(delay * time.Duration(attempt))
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func apiErrorSuffix(body []byte) string {
	var parsed struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if json.Unmarshal(body, &parsed) != nil {
		return ""
	}
	message := strings.TrimSpace(parsed.Error.Message)
	if message == "" {
		return ""
	}
	return ": " + truncate(message, 240)
}

func fallbackLabel(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

func truncate(value string, max int) string {
	runes := []rune(value)
	if len(runes) <= max {
		return value
	}
	return string(runes[:max])
}
