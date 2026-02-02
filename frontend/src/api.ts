import { auth } from './firebase';

const orchestratorBase =
  typeof import.meta.env.VITE_API_URL === 'string' &&
  import.meta.env.VITE_API_URL.length > 0
    ? import.meta.env.VITE_API_URL.replace(/\/$/, '')
    : typeof import.meta.env.VITE_ORCHESTRATOR_URL === 'string' &&
      import.meta.env.VITE_ORCHESTRATOR_URL.length > 0
      ? import.meta.env.VITE_ORCHESTRATOR_URL.replace(/\/$/, '')
      : 'http://localhost:3000';

// Legacy: log analyzer base for backwards compatibility during migration
const logAnalyzerBase =
  typeof import.meta.env.VITE_LOG_ANALYZER_URL === 'string' &&
  import.meta.env.VITE_LOG_ANALYZER_URL.length > 0
    ? import.meta.env.VITE_LOG_ANALYZER_URL.replace(/\/$/, '')
    : 'http://localhost:3001';

export function getApiBase(): string {
  return orchestratorBase;
}

export function getLogAnalyzerBase(): string {
  return logAnalyzerBase;
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
