# Firebase App Check setup (cloud mode)

The cloud API requires a Firebase App Check token alongside the Firebase
ID token on every authenticated request. Without it, `POST /api/jobs`
and friends return 401 — which the worker surfaces as "Auth token
rejected; please sign in again."

The web frontend uses reCAPTCHA v3 as the App Check provider. The
desktop worker uses Apple's **App Attest** on macOS. **Windows** has no
`firebase_app_check` Flutter support today; Windows users rely on the
"Run locally" checkbox in the Simulate tab, which bypasses the cloud API
entirely.

## What the code does

- `pubspec.yaml` pulls in `firebase_app_check`.
- `lib/main.dart#_activateAppCheck()` runs right after
  `Firebase.initializeApp` on macOS and activates the provider
  (`AppleProvider.debug` for `flutter run`, `AppleProvider.appAttest`
  for release builds). Failures are non-fatal and logged.
- `lib/api_client.dart#_appCheckToken()` fetches the token on every API
  request and attaches it as `X-Firebase-AppCheck`. Soft-fails on
  platforms or environments where activation didn't succeed.

## Firebase Console state — already configured

App Attest and DeviceCheck are already enabled on the Apple Firebase
app entry (`1:14286370379:ios:eb91598352257eef6d7fce`, shared by the
iOS-type and macOS targets — Firebase treats them as one app). No
further Firebase Console action is required for release builds.

To verify with `gcloud`:

```bash
TOKEN=$(gcloud auth print-access-token)
APP=1:14286370379:ios:eb91598352257eef6d7fce
BASE=https://firebaseappcheck.googleapis.com/v1/projects/magic-bracket-simulator/apps/$APP

# App Attest (macOS 11+ / signed release builds):
curl -s -H "Authorization: Bearer $TOKEN" \
     -H "X-Goog-User-Project: magic-bracket-simulator" \
     "$BASE/appAttestConfig"

# DeviceCheck (macOS <11 fallback):
curl -s -H "Authorization: Bearer $TOKEN" \
     -H "X-Goog-User-Project: magic-bracket-simulator" \
     "$BASE/deviceCheckConfig"
```

Each non-empty response with `tokenTtl` set means that provider is
active.

If you ever need to re-register from scratch (e.g. for a new Firebase
project), the Console flow is:

1. Open
   https://console.firebase.google.com/project/magic-bracket-simulator/appcheck/apps
2. Find the Apple app entry.
3. Under **Apple App Attest**, click **Activate** and save. No keys or
   secrets to paste; Firebase coordinates with Apple's attestation
   service directly.
4. Optionally enable **DeviceCheck** as a fallback for macOS <11 / when
   App Attest is unavailable; the Flutter SDK falls back automatically.

## Debug builds (`flutter run`)

Apple App Attest doesn't run against unsigned development builds. The
SDK prints a debug token to stdout on the first activation:

```
[FirebaseAppCheck] Debug token: 12345678-1234-1234-1234-123456789abc
```

1. Copy the token.
2. In Firebase Console → App Check → Apps → ⋮ → **Manage debug tokens**.
3. Click **Add debug token**, paste, give it a name (e.g. "tyler's
   MacBook"), save.

The token persists for that machine's user data dir; subsequent
`flutter run` sessions reuse it.

## CI / release builds

CI builds run unsigned in GitHub Actions, so they'd hit the same debug
token requirement. Two acceptable options:

- Skip App Check activation on CI by adding a `--dart-define` guard if
  CI test scope grows to include integration tests that touch the API.
- Treat CI failures around App Check as expected; the unit + widget
  tests don't exercise the API path.

Production app bundles (signed + notarized via the
`.github/workflows/release-worker.yml` pipeline) work with App Attest
out of the box — the Firebase Console registration is already in place.

## API enforcement vs. Firebase enforcement

Two different layers control what happens when a request lacks
`X-Firebase-AppCheck`:

- **API-level (the actual gate today):** `api/lib/auth.ts#verifyAppCheck`
  throws as soon as the header is missing. There is no "monitor mode"
  here — the request returns 401 immediately. This is what surfaces as
  the desktop worker's "Auth token rejected" error.
- **Firebase service-level (Firestore + Identity Toolkit):** controlled
  by `enforcementMode` on each service under
  `projects/magic-bracket-simulator/services/*` (Firebase Console →
  App Check → APIs → Cloud Firestore / Identity Toolkit → **Enforce**).
  Currently both are `UNENFORCED`, which means direct Firestore client
  calls (e.g. the run-locally Firestore mirror in
  `lib/offline/cloud_mirror.dart`) work without an App Check token.
  Flip these to `ENFORCED` only after every supported platform —
  including Windows — sends a real token; Windows currently can't, so
  leaving them `UNENFORCED` is correct.
