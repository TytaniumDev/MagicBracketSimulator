/**
 * Runtime config loaded from /config.json (no secrets in .env).
 * Used for API URL and optional log analyzer URL. Fallback: build-time env, then localhost.
 */

export interface RuntimeConfig {
  apiUrl?: string;
  sentryDsn?: string;
}

let cached: RuntimeConfig = {};
let loadPromise: Promise<RuntimeConfig> | null = null;

/**
 * Fetch /config.json and cache result. Safe to call multiple times (returns same promise).
 * Call before app render so getApiBase() uses it.
 */
export function loadRuntimeConfig(): Promise<RuntimeConfig> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const base = typeof window !== 'undefined' ? window.location.origin : '';
      const r = await fetch(`${base}/config.json`, { cache: 'no-store' });
      if (r.ok) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const j = (await r.json()) as any;
        if (j && typeof j === 'object') {
          cached = {
            apiUrl: typeof j.apiUrl === 'string' ? j.apiUrl.replace(/\/$/, '') : undefined,
            sentryDsn: typeof j.sentryDsn === 'string' ? j.sentryDsn : undefined,
          };
        }
      }
    } catch {
      // No config.json or network error: use env / localhost
    }
    return cached;
  })();
  return loadPromise;
}

export function getRuntimeConfig(): RuntimeConfig {
  return { ...cached };
}
