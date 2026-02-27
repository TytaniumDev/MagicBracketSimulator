/**
 * Standard API error response shape.
 * Used consistently across all API error paths.
 */
export interface ApiErrorResponse {
  error: string;
  details?: unknown;
}

/**
 * Response shape for idempotent update operations.
 * Used by sim PATCH to signal no-ops without error status codes.
 */
export interface ApiUpdateResponse {
  updated: boolean;
  reason?: string;
  from?: string;
  to?: string;
}
