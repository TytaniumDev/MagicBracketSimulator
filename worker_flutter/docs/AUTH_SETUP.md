# Google Sign-In setup (cloud mode)

The desktop worker gates cloud mode behind a Google Sign-In step so
Firestore writes carry `request.auth.uid` and security rules can drop
the temporary unauthenticated-write branches.

## What the code does

- `lib/auth/auth_service.dart` wraps `google_sign_in` + `firebase_auth`.
  Sign-in returns an `AuthedUser`; subsequent Firestore calls
  automatically attach the bearer token via the `firebase_auth`
  singleton, no manual plumbing needed.
- `lib/auth/auth_gate_screen.dart` is the pre-engine UI gate. Shown
  whenever cloud mode boots without a current user.
- `main.dart#_WorkerAppState` only starts `WorkerEngine` *after* the
  AuthGate emits an `AuthedUser`. This keeps `FirebaseAuth.instance`
  untouched during cold boot — the path that historically tripped the
  uncaught NSException crash on macOS.

## One-time Google Cloud Console setup

The website's Firebase Auth uses a Web OAuth client. Desktop needs a
separate Desktop OAuth client because its allowed redirect URI is
different.

1. Open https://console.cloud.google.com/apis/credentials for the
   `magic-bracket-simulator` project.
2. **Create Credentials → OAuth client ID**.
3. **Application type: Desktop app**.
4. Name: `Magic Bracket worker (desktop)`.
5. Save. Google returns a Client ID — no client secret because
   Desktop clients use PKCE.
6. Copy the Client ID into `lib/firebase_options.dart`'s `macos`
   block (replacing the existing `iosClientId` if you reuse that
   slot — `google_sign_in` looks at `iosClientId` on macOS too).
7. Also add the Client ID to a Windows-specific config slot once
   `google_sign_in_windows` is published (currently in
   pre-release — until then Windows cloud-mode users see the
   AuthGate disabled with a "platform not yet supported" message).

## Once configured, tighten the rules

`firestore.rules` currently has unauthenticated-write branches that
were added during the Plan 2 MVP. After verifying sign-in works
end-to-end in cloud mode on at least one machine, remove those
branches so writes require `request.auth.uid` to match the worker
config's `workerId` field.

Search marker: `// SOLO-DEV: tighten after auth` in `firestore.rules`.
