// Misc Runner: Condenses game logs and uploads artifacts to GCS
// This container runs after forge-sim completes and:
// 1. Reads raw game logs from mounted volume
// 2. Condenses logs for AI analysis
// 3. Builds structured output for frontend
// 4. Uploads all artifacts to GCS
// 5. Updates job status via API

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/magic-bracket/misc-runner/api"
	"github.com/magic-bracket/misc-runner/condenser"
	"github.com/magic-bracket/misc-runner/gcs"
)

func main() {
	// Required environment variables
	jobID := os.Getenv("JOB_ID")
	apiURL := os.Getenv("API_URL")
	logsDir := os.Getenv("LOGS_DIR")
	gcsBucket := os.Getenv("GCS_BUCKET")
	authToken := os.Getenv("AUTH_TOKEN")       // Optional
	workerSecret := os.Getenv("WORKER_SECRET") // Optional - for X-Worker-Secret header

	// Validate required env vars
	if jobID == "" {
		log.Fatal("JOB_ID environment variable is required")
	}
	if logsDir == "" {
		logsDir = "/app/logs"
	}
	if gcsBucket == "" {
		log.Fatal("GCS_BUCKET environment variable is required")
	}

	log.Printf("Starting misc-runner for job %s", jobID)
	log.Printf("Logs directory: %s", logsDir)
	log.Printf("GCS bucket: %s", gcsBucket)

	ctx := context.Background()

	// Initialize API client (optional - for status updates)
	var apiClient *api.Client
	if apiURL != "" {
		apiClient = api.NewClient(apiURL, authToken, workerSecret)
	}

	// Initialize GCS client
	gcsClient, err := gcs.NewClient(ctx, gcsBucket)
	if err != nil {
		handleError(apiClient, jobID, fmt.Sprintf("Failed to create GCS client: %v", err))
		return
	}

	// Step 1: Read raw game logs
	log.Println("Step 1: Reading raw game logs...")
	rawLogs, deckNames, deckLists, err := readGameLogs(logsDir, jobID)
	if err != nil {
		handleError(apiClient, jobID, fmt.Sprintf("Failed to read game logs: %v", err))
		return
	}
	log.Printf("Found %d game logs", len(rawLogs))

	if len(rawLogs) == 0 {
		handleError(apiClient, jobID, "No game logs found")
		return
	}

	// Step 2: Condense logs
	log.Println("Step 2: Condensing game logs...")
	condensed := condenser.CondenseGames(rawLogs)
	log.Printf("Condensed %d games", len(condensed))

	// Step 3: Build analyze payload
	log.Println("Step 3: Building analyze payload...")
	analyzePayload := condenser.BuildAnalyzePayload(condensed, deckNames, deckLists)

	// Step 4: Upload to GCS
	log.Println("Step 4: Uploading artifacts to GCS...")

	// Upload raw logs
	if _, err := gcsClient.UploadRawLogs(ctx, jobID, rawLogs); err != nil {
		log.Printf("Warning: Failed to upload raw logs: %v", err)
		// Continue - raw logs are optional
	}

	// Upload condensed logs
	condensedJSON, _ := json.MarshalIndent(condensed, "", "  ")
	if _, err := gcsClient.UploadJSON(ctx, jobID, "condensed.json", condensedJSON); err != nil {
		handleError(apiClient, jobID, fmt.Sprintf("Failed to upload condensed.json: %v", err))
		return
	}
	log.Println("Uploaded condensed.json")

	// Upload analyze payload
	payloadJSON, _ := json.MarshalIndent(analyzePayload, "", "  ")
	if _, err := gcsClient.UploadJSON(ctx, jobID, "analyze-payload.json", payloadJSON); err != nil {
		handleError(apiClient, jobID, fmt.Sprintf("Failed to upload analyze-payload.json: %v", err))
		return
	}
	log.Println("Uploaded analyze-payload.json")

	// Step 5: Update job status
	if apiClient != nil {
		log.Println("Step 5: Updating job status to COMPLETED...")
		if err := apiClient.PatchJobCompleted(jobID, nil); err != nil {
			log.Printf("Warning: Failed to update job status: %v", err)
			// Don't fail - artifacts are uploaded
		} else {
			log.Println("Job status updated to COMPLETED")
		}
	}

	log.Printf("Misc-runner completed successfully for job %s", jobID)
}

// readGameLogs reads all game log files from the logs directory
func readGameLogs(logsDir, jobID string) ([]string, []string, []string, error) {
	// Find all game log files matching the job ID pattern
	pattern := filepath.Join(logsDir, fmt.Sprintf("*%s*.txt", jobID))
	if jobID == "" {
		pattern = filepath.Join(logsDir, "*.txt")
	}

	files, err := filepath.Glob(pattern)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("failed to glob log files: %w", err)
	}

	// If no files match with job ID, try to find any .txt files
	if len(files) == 0 {
		pattern = filepath.Join(logsDir, "*.txt")
		files, err = filepath.Glob(pattern)
		if err != nil {
			return nil, nil, nil, fmt.Errorf("failed to glob log files: %w", err)
		}
	}

	// Sort files to ensure consistent ordering
	sort.Strings(files)

	var rawLogs []string
	for _, file := range files {
		content, err := os.ReadFile(file)
		if err != nil {
			log.Printf("Warning: Failed to read %s: %v", file, err)
			continue
		}

		// Check if this file contains multiple concatenated games
		logContent := string(content)
		games := condenser.SplitConcatenatedGames(logContent)
		rawLogs = append(rawLogs, games...)
	}

	// Try to extract deck names from job data or file names
	deckNames := extractDeckNames(files, logsDir)
	deckLists := []string{} // Would need to be passed separately

	return rawLogs, deckNames, deckLists, nil
}

// extractDeckNames attempts to extract deck names from log files
func extractDeckNames(files []string, logsDir string) []string {
	// Try to read deck names from a metadata file if it exists
	metaPath := filepath.Join(logsDir, "deck_names.txt")
	if content, err := os.ReadFile(metaPath); err == nil {
		lines := strings.Split(string(content), "\n")
		var names []string
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if line != "" {
				names = append(names, line)
			}
		}
		if len(names) >= 4 {
			return names[:4]
		}
	}

	// Default deck names if we can't extract them
	return []string{"Deck 1", "Deck 2", "Deck 3", "Deck 4"}
}

// handleError logs an error and optionally updates job status
func handleError(apiClient *api.Client, jobID string, message string) {
	log.Printf("ERROR: %s", message)
	if apiClient != nil {
		if err := apiClient.PatchJobFailed(jobID, message); err != nil {
			log.Printf("Failed to update job status: %v", err)
		}
	}
}
