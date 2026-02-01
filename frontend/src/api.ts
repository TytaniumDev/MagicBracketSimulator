const base =
  typeof import.meta.env.VITE_ORCHESTRATOR_URL === 'string' &&
  import.meta.env.VITE_ORCHESTRATOR_URL.length > 0
    ? import.meta.env.VITE_ORCHESTRATOR_URL.replace(/\/$/, '')
    : 'http://localhost:3000';

export function getApiBase(): string {
  return base;
}
