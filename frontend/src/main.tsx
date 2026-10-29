import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import * as Sentry from "@sentry/react";
import { loadRuntimeConfig, getRuntimeConfig } from './config';
import { queryClient } from './queryClient';
import { AuthProvider } from './contexts/AuthContext';
import App from './App';
import './index.css';

// Load runtime config (e.g. /config.json) so API URLs come from there instead of .env
loadRuntimeConfig().then(() => {
  const config = getRuntimeConfig();
  const dsn = config.sentryDsn || import.meta.env.VITE_SENTRY_DSN;

  if (dsn) {
    Sentry.init({
      dsn,
      integrations: [
        Sentry.browserTracingIntegration(),
        Sentry.replayIntegration(),
      ],
      environment: import.meta.env.MODE,
      tracesSampleRate: 1.0,
      // The free plan includes few replays, so only record sessions with an error.
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 1.0,
      // Tells frontend events apart if they share a project with the API.
      initialScope: { tags: { app: 'frontend' } },
    });
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>
  );
});
