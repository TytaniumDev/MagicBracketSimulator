// Package api provides HTTP client for the orchestrator API
package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/magic-bracket/misc-runner/types"
)

// Client wraps HTTP client for API calls
type Client struct {
	baseURL    string
	httpClient *http.Client
	authToken  string
}

// NewClient creates a new API client
func NewClient(baseURL string, authToken string) *Client {
	return &Client{
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
		authToken: authToken,
	}
}

// GetJob fetches job details from the API
func (c *Client) GetJob(jobID string) (*types.JobData, error) {
	url := fmt.Sprintf("%s/api/jobs/%s", c.baseURL, jobID)

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	if c.authToken != "" {
		req.Header.Set("Authorization", "Bearer "+c.authToken)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to make request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	var job types.JobData
	if err := json.NewDecoder(resp.Body).Decode(&job); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &job, nil
}

// PatchJobStatus updates the job status
func (c *Client) PatchJobStatus(jobID string, status string, errorMessage string) error {
	url := fmt.Sprintf("%s/api/jobs/%s", c.baseURL, jobID)

	payload := map[string]interface{}{
		"status": status,
	}
	if errorMessage != "" {
		payload["errorMessage"] = errorMessage
	}

	jsonData, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal payload: %w", err)
	}

	req, err := http.NewRequest("PATCH", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	if c.authToken != "" {
		req.Header.Set("Authorization", "Bearer "+c.authToken)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to make request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	return nil
}

// PatchJobCompleted marks the job as completed
func (c *Client) PatchJobCompleted(jobID string, durationsMs []int64) error {
	url := fmt.Sprintf("%s/api/jobs/%s", c.baseURL, jobID)

	payload := map[string]interface{}{
		"status": "COMPLETED",
	}
	if len(durationsMs) > 0 {
		payload["dockerRunDurationsMs"] = durationsMs
	}

	jsonData, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal payload: %w", err)
	}

	req, err := http.NewRequest("PATCH", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	if c.authToken != "" {
		req.Header.Set("Authorization", "Bearer "+c.authToken)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to make request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	return nil
}

// PatchJobFailed marks the job as failed
func (c *Client) PatchJobFailed(jobID string, errorMessage string) error {
	return c.PatchJobStatus(jobID, "FAILED", errorMessage)
}

// PatchJobProgress updates the job progress
func (c *Client) PatchJobProgress(jobID string, gamesCompleted int) error {
	url := fmt.Sprintf("%s/api/jobs/%s", c.baseURL, jobID)

	payload := map[string]interface{}{
		"gamesCompleted": gamesCompleted,
	}

	jsonData, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal payload: %w", err)
	}

	req, err := http.NewRequest("PATCH", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	if c.authToken != "" {
		req.Header.Set("Authorization", "Bearer "+c.authToken)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to make request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	return nil
}
