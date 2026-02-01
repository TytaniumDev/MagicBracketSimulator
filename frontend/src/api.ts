const orchestratorBase =
  typeof import.meta.env.VITE_ORCHESTRATOR_URL === 'string' &&
  import.meta.env.VITE_ORCHESTRATOR_URL.length > 0
    ? import.meta.env.VITE_ORCHESTRATOR_URL.replace(/\/$/, '')
    : 'http://localhost:3000';

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
