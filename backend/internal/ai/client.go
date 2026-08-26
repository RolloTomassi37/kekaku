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
	APIKey  string
	BaseURL string
	Model   string
	HTTP    *http.Client
}

type message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

func (c *Client) Available() bool { return strings.TrimSpace(c.APIKey) != "" }

func (c *Client) CompleteJSON(ctx context.Context, system, user string, maxTokens int) ([]byte, error) {
	if !c.Available() {
		return nil, errors.New("DeepSeek API key is not configured")
	}
	baseURL := strings.TrimRight(c.BaseURL, "/")
	if baseURL == "" {
		baseURL = "https://api.deepseek.com"
	}
	model := c.Model
	if model == "" {
		model = "deepseek-v4-flash"
	}
	payload := map[string]any{
		"model":           model,
		"response_format": map[string]string{"type": "json_object"},
		"max_tokens":      maxTokens,
		"messages":        []message{{Role: "system", Content: system}, {Role: "user", Content: user}},
	}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.APIKey)
	req.Header.Set("Content-Type", "application/json")
	httpClient := c.HTTP
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 90 * time.Second}
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("DeepSeek returned HTTP %d", resp.StatusCode)
	}
	var result struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(responseBody, &result); err != nil {
		return nil, err
	}
	if len(result.Choices) == 0 || strings.TrimSpace(result.Choices[0].Message.Content) == "" {
		return nil, errors.New("DeepSeek returned an empty response")
	}
	return []byte(result.Choices[0].Message.Content), nil
}
