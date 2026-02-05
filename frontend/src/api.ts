import { auth } from './firebase';
import { getRuntimeConfig } from './config';

function getOrchestratorBase(): string {
  const runtime = getRuntimeConfig();
  if (runtime.apiUrl) return runtime.apiUrl;
  if (typeof import.meta.env.VITE_API_URL === 'string' && import.meta.env.VITE_API_URL.length > 0)
    return (import.meta.env.VITE_API_URL as string).replace(/\/$/, '');
  if (typeof import.meta.env.VITE_ORCHESTRATOR_URL === 'string' && import.meta.env.VITE_ORCHESTRATOR_URL.length > 0)
    return (import.meta.env.VITE_ORCHESTRATOR_URL as string).replace(/\/$/, '');
  return 'http://localhost:3000';
}

function getLogAnalyzerBaseUrl(): string {
  const runtime = getRuntimeConfig();
  if (runtime.logAnalyzerUrl) return runtime.logAnalyzerUrl;
  if (typeof import.meta.env.VITE_LOG_ANALYZER_URL === 'string' && import.meta.env.VITE_LOG_ANALYZER_URL.length > 0)
    return (import.meta.env.VITE_LOG_ANALYZER_URL as string).replace(/\/$/, '');
  return 'http://localhost:3001';
}

export function getApiBase(): string {
  return getOrchestratorBase();
}

export function getLogAnalyzerBase(): string {
  return getLogAnalyzerBaseUrl();
}

/**
 * Get the current Firebase ID token for authenticated requests
 */
export async function getFirebaseIdToken(): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) return null;
  try {
    return await user.getIdToken();
  } catch (error) {
    console.error('Error getting Firebase ID token:', error);
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

  return fetch(url, {
    ...options,
    headers,
  });
}
