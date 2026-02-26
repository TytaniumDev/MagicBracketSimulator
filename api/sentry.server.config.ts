import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: !!process.env.SENTRY_DSN,
  environment: process.env.GOOGLE_CLOUD_PROJECT ? 'production' : 'local',
  tracesSampleRate: 0.1,
});
