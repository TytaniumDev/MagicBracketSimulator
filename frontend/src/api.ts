import { getToken } from 'firebase/app-check';
import { auth, appCheck } from './firebase';
import { getRuntimeConfig } from './config';
import { reportHandledError } from './errorReporting';
import type { PodRunResponse, PodRunSummary } from '@shared/types/pod-run';
import type { DeckDetailResponse } from '@shared/types/deck';
import type { DeckCardImpactResponse } from '@shared/types/card-impact';

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
 * Get the current Firebase ID token for authenticated requests
 */
export async function getFirebaseIdToken(): Promise<string | null> {
  if (!auth) return 'local-mock-token';
  const user = auth.currentUser;
  if (!user) return null;
  try {
    return await user.getIdToken();
  } catch (error) {
    console.error('Error getting Firebase ID token:', error);
    reportHandledError(error, { action: 'getFirebaseIdToken' });
    return null;
  }
}

/**
 * Fetch with Firebase authentication token
 * Automatically adds Authorization header with Bearer token
 */
export async function fetchWithAuth(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = await getFirebaseIdToken();

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
    } catch (err) {
      // Don't block the request — API will reject if enforcement is on
      reportHandledError(err, { action: 'getAppCheckToken' });
    }
  }

  try {
    return await fetch(url, {
      ...options,
      headers,
    });
  } catch (error) {
    // The request never got a response ("Failed to fetch"): the API is down,
    // restarting, or answered without CORS headers. Many callers handle this
    // themselves, so report it here where every call passes.
    reportHandledError(error, { url, method: options.method ?? 'GET' });
    throw error;
  }
}

/**
 * Create a simulation job for one 4-deck pod. Returns the new job's id.
 */
export async function createJob(body: {
  deckIds: string[];
  simulations: number;
  idempotencyKey?: string;
}): Promise<{ id: string }> {
  const apiBase = resolveApiBase();
  const res = await fetchWithAuth(`${apiBase}/api/jobs`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Failed to create job');
  }
  return data;
}

/**
 * Save a pod run once all of its jobs are queued. Returns the run's id.
 */
export async function createPodRun(body: {
  deckIds: string[];
  jobIds: string[];
  simulations: number;
  idempotencyKey?: string;
}): Promise<{ id: string }> {
  const apiBase = resolveApiBase();
  const res = await fetchWithAuth(`${apiBase}/api/pod-runs`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Failed to save pod run');
  }
  return data;
}

/**
 * Fetch one deck with its decklist and results, for the deck page.
 */
export async function fetchDeck(id: string): Promise<DeckDetailResponse> {
  const apiBase = resolveApiBase();
  const res = await fetchWithAuth(`${apiBase}/api/decks/${encodeURIComponent(id)}`);
  if (!res.ok) {
    throw new Error(res.status === 404 ? 'Deck not found' : 'Failed to load deck');
  }
  return res.json();
}

/** A deck in the library, as the deck list endpoints return it. */
export interface LibraryDeck {
  id: string;
  name: string;
  filename: string;
  colorIdentity?: string[];
  isPrecon: boolean;
  link?: string | null;
  ownerId: string | null;
  ownerEmail?: string | null;
  setName?: string | null;
  /** Precon release date (YYYY-MM-DD); missing for user decks. */
  releasedAt?: string | null;
  primaryCommander?: string | null;
}

export interface DeckLibrary {
  /** Precons first, then community decks. */
  decks: LibraryDeck[];
  /** Decks left out of the simulation picker and auto-coverage. */
  excludedDeckIds: string[];
  /** True when community decks failed to load (precons may still be shown). */
  communityDecksFailed: boolean;
}

/** Precons from the public GCS list (no auth needed). Empty in local mode or on failure. */
async function fetchPublicPrecons(): Promise<LibraryDeck[]> {
  const { preconsUrl } = getRuntimeConfig();
  if (!preconsUrl) return []; // local mode — precons come from API

  try {
    const res = await fetch(preconsUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.warn('GCS precon fetch failed, will use API fallback:', err);
    reportHandledError(err, { action: 'fetchPrecons' });
    return [];
  }
}

/** Every deck plus the excluded ids, with one auto-retry for cold starts. */
async function fetchDeckList(): Promise<{ decks: LibraryDeck[]; excludedDeckIds: string[] }> {
  const apiBase = resolveApiBase();
  const attempt = async () => {
    const res = await fetchWithAuth(`${apiBase}/api/decks`);
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
    const data = await res.json();
    return { decks: data.decks ?? [], excludedDeckIds: data.excludedDeckIds ?? [] };
  };

  try {
    return await attempt();
  } catch (err) {
    const status = (err as { status?: number }).status;
    // Only retry on server-side transient errors (likely cold start)
    if (typeof status === 'number' && status >= 500) {
      console.error('Deck list fetch failed (5xx), retrying...', err);
      await new Promise((r) => setTimeout(r, 2000));
      return await attempt(); // Let this throw if it also fails
    }
    throw err;
  }
}

/**
 * Load the deck library: precons from GCS (falling back to the API's list)
 * and community decks from the API.
 */
export async function fetchDeckLibrary(): Promise<DeckLibrary> {
  const [gcsPrecons, apiResult] = await Promise.allSettled([fetchPublicPrecons(), fetchDeckList()]);

  const gcsPreconList = gcsPrecons.status === 'fulfilled' ? gcsPrecons.value : [];
  const apiDecks = apiResult.status === 'fulfilled' ? apiResult.value.decks : [];
  if (apiResult.status === 'rejected') {
    console.error('Failed to load community decks:', apiResult.reason);
    reportHandledError(apiResult.reason, { action: 'loadCommunityDecks' });
  }

  // If GCS returned no precons, fall back to precons from the API response
  const precons = gcsPreconList.length > 0 ? gcsPreconList : apiDecks.filter((d) => d.isPrecon);
  return {
    decks: [...precons, ...apiDecks.filter((d) => !d.isPrecon)],
    excludedDeckIds: apiResult.status === 'fulfilled' ? apiResult.value.excludedDeckIds : [],
    communityDecksFailed: apiResult.status === 'rejected',
  };
}

/**
 * Exclude decks from selection, or include them again, in one write (admin
 * only). Returns every excluded deck id.
 */
export async function setDecksExcluded(deckIds: string[], excluded: boolean): Promise<string[]> {
  const apiBase = resolveApiBase();
  const res = await fetchWithAuth(`${apiBase}/api/decks`, {
    method: 'PATCH',
    body: JSON.stringify({ deckIds, excluded }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data.excludedDeckIds ?? [];
}

export interface CardStatsBackfillPage {
  processed: number;
  skipped: number;
  errors: { jobId: string; error: string }[];
  /** Pass back to continue with older jobs; null when every job has been visited. */
  nextCursor: string | null;
}

/**
 * Count one page of completed jobs into card stats (admin only).
 */
export async function backfillCardStats(cursor: string | null): Promise<CardStatsBackfillPage> {
  const apiBase = resolveApiBase();
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  const res = await fetchWithAuth(`${apiBase}/api/admin/backfill-card-stats${query}`, { method: 'POST' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Fetch per-card impact scores for a deck.
 */
export async function fetchDeckCardImpact(id: string): Promise<DeckCardImpactResponse> {
  const apiBase = resolveApiBase();
  const res = await fetchWithAuth(`${apiBase}/api/decks/${encodeURIComponent(id)}/card-impact`);
  if (!res.ok) {
    throw new Error('Failed to load card stats');
  }
  return res.json();
}

/**
 * Fetch one pod run with its job ids.
 */
export async function fetchPodRun(id: string): Promise<PodRunResponse> {
  const apiBase = resolveApiBase();
  const res = await fetchWithAuth(`${apiBase}/api/pod-runs/${encodeURIComponent(id)}`);
  if (!res.ok) {
    throw new Error(res.status === 404 ? 'Pod run not found' : 'Failed to load pod run');
  }
  return res.json();
}

/**
 * List pod runs, most recent first. Pass `jobId` for only the runs that
 * include that job.
 */
export async function fetchPodRuns(options: { limit?: number; jobId?: string } = {}): Promise<PodRunSummary[]> {
  const apiBase = resolveApiBase();
  const params = new URLSearchParams();
  if (options.limit != null) params.set('limit', String(options.limit));
  if (options.jobId) params.set('jobId', options.jobId);
  const res = await fetchWithAuth(`${apiBase}/api/pod-runs?${params}`);
  if (!res.ok) {
    throw new Error('Failed to load pod runs');
  }
  const data = await res.json();
  return Array.isArray(data.podRuns) ? data.podRuns : [];
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

// ---------------------------------------------------------------------------
// Coverage API
// ---------------------------------------------------------------------------

export interface CoverageConfig {
  enabled: boolean;
  targetGamesPerPair: number;
  updatedAt: string;
  updatedBy: string;
}

export interface CoverageStatus {
  totalPairs: number;
  coveredPairs: number;
  underCoveredPairs: number;
  targetGamesPerPair: number;
  percentComplete: number;
}

export async function getCoverageConfig(): Promise<CoverageConfig> {
  const apiBase = resolveApiBase();
  const res = await fetchWithAuth(`${apiBase}/api/coverage/config`);
  if (!res.ok) throw new Error('Failed to fetch coverage config');
  return res.json();
}

export async function updateCoverageConfig(
  update: Partial<Pick<CoverageConfig, 'enabled' | 'targetGamesPerPair'>>
): Promise<CoverageConfig> {
  const apiBase = resolveApiBase();
  const res = await fetchWithAuth(`${apiBase}/api/coverage/config`, {
    method: 'PATCH',
    body: JSON.stringify(update),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function getCoverageStatus(): Promise<CoverageStatus> {
  const apiBase = resolveApiBase();
  const res = await fetchWithAuth(`${apiBase}/api/coverage/status`);
  if (!res.ok) throw new Error('Failed to fetch coverage status');
  return res.json();
}

