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

## One-time Firebase Console setup

1. Open
   https://console.firebase.google.com/project/magic-bracket-simulator/appcheck/apps
2. Find the macOS app entry (bundle ID
   `com.tytaniumdev.magicBracketSimulator`). If it isn't listed yet, the
   parent Firebase app (the iOS-type one registered for `firebase_auth`)
   doesn't have App Check enabled — click **Register** to enable.
3. Under **Apple App Attest**, click **Register** and save. No keys or
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
out of the box once the Firebase Console registration above is done.

## Once registered, monitor before enforcing

App Check ships in "monitor only" mode on the API side by default. Once
the macOS app has been live for a release cycle without surfacing
unexpected 401s in Sentry, you can flip enforcement on in Firebase
Console → App Check → APIs → Cloud Run (or Cloud Functions, depending
on where the API runs) → **Enforce**.
