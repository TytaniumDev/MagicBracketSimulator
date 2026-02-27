import { NextResponse } from 'next/server';
import type { ApiErrorResponse } from '@shared/types/api';

/**
 * Standard error response. Use for all API error paths.
 */
export function errorResponse(message: string, status: number, details?: unknown): NextResponse<ApiErrorResponse> {
  const body: ApiErrorResponse = { error: message };
  if (details !== undefined) body.details = details;
  return NextResponse.json(body, { status });
}

/**
 * 404 Not Found response.
 */
export function notFoundResponse(resource: string = 'Resource'): NextResponse<ApiErrorResponse> {
  return errorResponse(`${resource} not found`, 404);
}

/**
 * 400 Bad Request response.
 */
export function badRequestResponse(message: string): NextResponse<ApiErrorResponse> {
  return errorResponse(message, 400);
}
