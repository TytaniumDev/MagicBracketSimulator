// Package gcs provides Cloud Storage upload functionality
package gcs

import (
	"context"
	"fmt"
	"io"
	"strings"

	"cloud.google.com/go/storage"
)

// Client wraps a GCS storage client
type Client struct {
	bucket *storage.BucketHandle
	bucketName string
}

// NewClient creates a new GCS client for the specified bucket
func NewClient(ctx context.Context, bucketName string) (*Client, error) {
	client, err := storage.NewClient(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to create storage client: %w", err)
	}

	return &Client{
		bucket: client.Bucket(bucketName),
		bucketName: bucketName,
	}, nil
}

// UploadJobArtifact uploads an artifact for a job
func (c *Client) UploadJobArtifact(ctx context.Context, jobID, filename string, data []byte) (string, error) {
	objectPath := fmt.Sprintf("jobs/%s/%s", jobID, filename)
	obj := c.bucket.Object(objectPath)
	
	// Determine content type
	contentType := "application/octet-stream"
	if strings.HasSuffix(filename, ".json") {
		contentType = "application/json"
	} else if strings.HasSuffix(filename, ".txt") {
		contentType = "text/plain"
	}

	writer := obj.NewWriter(ctx)
	writer.ContentType = contentType
	writer.Metadata = map[string]string{
		"jobId": jobID,
	}

	if _, err := writer.Write(data); err != nil {
		return "", fmt.Errorf("failed to write to GCS: %w", err)
	}

	if err := writer.Close(); err != nil {
		return "", fmt.Errorf("failed to close GCS writer: %w", err)
	}

	return fmt.Sprintf("gs://%s/%s", c.bucketName, objectPath), nil
}

// UploadJSON uploads JSON data for a job
func (c *Client) UploadJSON(ctx context.Context, jobID, filename string, jsonData []byte) (string, error) {
	return c.UploadJobArtifact(ctx, jobID, filename, jsonData)
}

// UploadRawLogs uploads raw game logs for a job
func (c *Client) UploadRawLogs(ctx context.Context, jobID string, logs []string) ([]string, error) {
	var uris []string
	for i, log := range logs {
		filename := fmt.Sprintf("raw/game_%03d.txt", i+1)
		uri, err := c.UploadJobArtifact(ctx, jobID, filename, []byte(log))
		if err != nil {
			return nil, fmt.Errorf("failed to upload game %d: %w", i+1, err)
		}
		uris = append(uris, uri)
	}
	return uris, nil
}

// GetJobArtifact downloads an artifact for a job
func (c *Client) GetJobArtifact(ctx context.Context, jobID, filename string) ([]byte, error) {
	objectPath := fmt.Sprintf("jobs/%s/%s", jobID, filename)
	obj := c.bucket.Object(objectPath)

	reader, err := obj.NewReader(ctx)
	if err != nil {
		if err == storage.ErrObjectNotExist {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to open object: %w", err)
	}
	defer reader.Close()

	data, err := io.ReadAll(reader)
	if err != nil {
		return nil, fmt.Errorf("failed to read object: %w", err)
	}

	return data, nil
}
