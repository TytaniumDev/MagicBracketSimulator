import { getToken } from 'firebase/app-check';
import { auth, appCheck } from './firebase';
import { getRuntimeConfig } from './config';

function resolveApiBase(): string {
  // Build-time env vars take precedence (local dev overrides)
  if (typeof import.meta.env.VITE_API_URL === 'string' && import.meta.env.VITE_API_URL.length > 0)
    return (import.meta.env.VITE_API_URL as string).replace(/\/$/, '');
  // Runtime config.json (production default)
  const runtime = getRuntimeConfig();
  if (runtime.apiUrl) return runtime.apiUrl;
  // Legacy env var
  if (typeof import.meta.env.VITE_ORCHESTRATOR_URL === 'string' && import.meta.env.VITE_ORCHESTRATOR_URL.length > 0)
    return (import.meta.env.VITE_ORCHESTRATOR_URL as string).replace(/\/$/, '');
  return 'http://localhost:3000';
}

export function getApiBase(): string {
  return resolveApiBase();
}

/**
 * Get the current Firebase ID token for authenticated requests.
 * @param forceRefresh - When true, forces a token refresh from Firebase servers
 *   (useful for retrying after a 401 caused by a stale cached token).
 */
export async function getFirebaseIdToken(forceRefresh = false): Promise<string | null> {
  if (!auth) return 'local-mock-token';
  const user = auth.currentUser;
  if (!user) return null;
  try {
    return await user.getIdToken(forceRefresh);
  } catch (error) {
    console.error('Error getting Firebase ID token:', error);
    return null;
  }
}

/**
 * Single-attempt fetch with Firebase auth + App Check headers.
 * Internal helper — callers should use fetchWithAuth() which adds retry.
 */
async function _fetchWithAuth(
  url: string,
  options: RequestInit = {},
  forceRefresh = false
): Promise<Response> {
  const token = await getFirebaseIdToken(forceRefresh);

  const headers: HeadersInit = {
    ...options.headers,
    'Content-Type': 'application/json',
  };

  if (token) {
    (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
  }

  // Attach App Check token (skip in local mode when appCheck is null)
  if (appCheck) {
    try {
      const appCheckToken = await getToken(appCheck, /* forceRefresh */ false);
      (headers as Record<string, string>)['X-Firebase-AppCheck'] = appCheckToken.token;
    } catch {
      // Don't block the request — API will reject if enforcement is on
    }
  }

  return fetch(url, {
    ...options,
    headers,
  });
}

/**
 * Fetch with Firebase authentication token and App Check.
 * Automatically adds Authorization + X-Firebase-AppCheck headers.
 * Retries exactly once on 401 with a force-refreshed token to handle staleness.
 */
export async function fetchWithAuth(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const response = await _fetchWithAuth(url, options);

  if (response.status === 401) {
    return _fetchWithAuth(url, options, /* forceRefresh */ true);
  }

  return response;
}

/**
 * Update a worker's max concurrent override.
 * Pass null to clear the override and revert to hardware auto-detection.
 */
export async function updateWorkerOverride(
  workerId: string,
  maxConcurrentOverride: number | null
): Promise<{ ok: boolean }> {
  const apiBase = resolveApiBase();
  const res = await fetchWithAuth(`${apiBase}/api/workers/${encodeURIComponent(workerId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ maxConcurrentOverride }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Delete a single job (admin only)
 */
export async function deleteJob(jobId: string): Promise<void> {
  const apiBase = resolveApiBase();
  const res = await fetchWithAuth(`${apiBase}/api/jobs/${encodeURIComponent(jobId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
}

/**
 * Bulk delete jobs (admin only, max 50 per request)
 */
export async function deleteJobs(
  jobIds: string[]
): Promise<{ deletedCount: number; results: { id: string; deleted: boolean; error?: string }[] }> {
  const apiBase = resolveApiBase();
  const res = await fetchWithAuth(`${apiBase}/api/jobs/bulk-delete`, {
    method: 'POST',
    body: JSON.stringify({ jobIds }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res.json();
}

