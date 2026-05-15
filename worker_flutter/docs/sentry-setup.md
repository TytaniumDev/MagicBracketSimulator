# Sentry setup — worker_flutter desktop

The Flutter worker reports crashes and known failures (sign-in,
installer, engine start, worker runtime) to Sentry. The SDK and CI
wiring are already in code; this doc covers the one-time manual setup
an operator performs in Sentry + Doppler.

Until step 1+2 are done, every Sentry call in the app is a no-op (the
SDK treats an empty DSN as disabled). The shipping app still
functions; this is the same graceful-skip pattern the Next.js API
uses for `SENTRY_DSN`.

## 1. Create the Sentry project

Sentry org `tytaniumdev`:

1. **Projects → Create Project**
   - Platform: **Flutter**
   - Team: existing
   - Name: `magic-bracket-worker`
2. Copy the DSN shown on the next screen.

## 2. Store DSN + auth token in Doppler

Doppler project `blinkbreak`, config `prd`:

1. Add `SENTRY_DSN_WORKER` = the DSN from step 1.
2. In Sentry → **Settings → Auth Tokens → Create new token**:
   - Scopes: `project:releases`, `project:write`
   - Restrict to project: `magic-bracket-worker`
3. Add `SENTRY_AUTH_TOKEN_WORKER` = the new token to Doppler.

`release-worker.yml` already reads both keys from Doppler. The next
release after these are populated will:

- Build with `--dart-define=SENTRY_DSN=...` (events start flowing).
- Run `sentry_dart_plugin` to upload the obfuscation debug-info map
  for the new release (stack traces deobfuscate).

## 3. Wire the GitHub integration

Sentry → **Settings → Integrations → GitHub**:

1. Install / authorize the GitHub integration for
   `TytaniumDev/MagicBracketSimulator` if it isn't already.
2. Enable it for the `magic-bracket-worker` project.

## 4. Create alert rules

For each rule: Sentry → **Alerts → Create Alert → Issues**.

All four rules use the same action: **Create a GitHub issue** in
`TytaniumDev/MagicBracketSimulator` with labels `bug,sentry,worker`.

### Rule 1 — Error Spike (catch-all)

- **When:** An issue is seen more than 10 times in 1 hour.
- **If:** (no filter)

Mirrors the API project's catch-all rule.

### Rule 2 — Sign-in Failures

- **When:** A new issue is created.
- **If:** Event has tag `category` equal to `sign_in`.

Specifically aimed at the `firebase_auth/null-error` class and other
sign-in-path regressions. The capture in `AuthService` tags
`platform`, `provider`, and `error_code` so the GitHub issue body has
enough to debug.

### Rule 3 — Installer Failures

- **When:** A new issue is created.
- **If:** Event has tag `category` equal to `installer`.

First-launch installer breakage means a user can't use the app at
all, so first occurrence pages.

### Rule 4 — Engine Start Failures

- **When:** A new issue is created.
- **If:** Event has tag `category` equal to `engine_start`.

The worker can't process jobs if the engine fails to start.

## 5. Verify

After the next `release-worker` run with the secrets in place:

1. Sentry → **Releases** — confirm a new
   `worker_flutter@<version>+<build>` release appears with `Dart Debug
   Information Files` uploaded.
2. Trigger a controlled error in a dev build:
   ```
   doppler run --project blinkbreak --config prd -- \
     flutter run -d macos \
       --dart-define=SENTRY_DSN=<test-dsn> \
       --dart-define=GOOGLE_DESKTOP_OAUTH_CLIENT_SECRET=$GOOGLE_DESKTOP_OAUTH_CLIENT_SECRET
   ```
   Set `STUB_` apiKey in `firebase_options.dart`, observe the
   firebase_init capture in Sentry within ~30 seconds.

## Categories in code

The full set of `category` tag values, set by `Telemetry.captureError`
and breadcrumbs throughout the app:

| Tag | Source | Severity |
|---|---|---|
| `boot` | `_appMain` start, key boot phases | breadcrumb |
| `firebase_init` | `Firebase.initializeApp` failure | capture |
| `sign_in` | AuthService (native + PKCE + firebase_credential phases) | capture |
| `installer` | First-run installer (download / SHA / extract) | capture |
| `engine_start` | `WorkerEngine.start()` outer failure | capture |
| `engine_runtime` | WorkerEngine lease writer / PENDING listener / sim_run | capture |
| `auto_updater` | Sparkle init failure (offline ≠ error) | breadcrumb |
| `tray` | tray_manager init failure | breadcrumb |

Add new values via `TelemetryCategory` in `lib/telemetry.dart`.

## What's NOT collected

- **PII**: `SentryFlutter.init` uses `sendDefaultPii: false`. The
  `beforeSend` hook (`scrubPii` in `telemetry.dart`) additionally
  redacts known PII keys (`email`, `uid`, `displayName`, …) and
  email-shaped strings in event extras and breadcrumb data.
- **Performance traces**: `tracesSampleRate: 0`.
- **Profiles**: `profilesSampleRate: 0`.

Release health (crash-free sessions/users) is on via
`enableAutoSessionTracking: true`.
