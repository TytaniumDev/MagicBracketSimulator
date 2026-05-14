import 'package:firebase_auth_mocks/firebase_auth_mocks.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:worker_flutter/auth/auth_service.dart';

/// Unit tests for `AuthService`. The `currentUserSnapshot` accessor is
/// load-bearing for the "skip the AuthGate on cold launch if a session
/// is already persisted" code path in `_WorkerAppState.initState` — if
/// this regresses, every returning user hits the OAuth flow again.
void main() {
  group('AuthService.currentUserSnapshot', () {
    test('returns null when firebase_auth has no signed-in user', () {
      final auth = AuthService(
        firebaseAuth: MockFirebaseAuth(),
        googleSignIn: GoogleSignIn(),
      );
      expect(auth.currentUserSnapshot, isNull);
    });

    test('maps a signed-in Firebase user into AuthedUser shape', () {
      // Pre-populate the mock with a signed-in user so the snapshot
      // accessor sees a non-null currentUser — that's the cold-boot
      // resumption path that gates whether the AuthGate is shown.
      final auth = AuthService(
        firebaseAuth: MockFirebaseAuth(
          signedIn: true,
          mockUser: MockUser(
            uid: 'user-abc',
            email: 'sigh@example.com',
            displayName: 'Test Player',
          ),
        ),
        googleSignIn: GoogleSignIn(),
      );

      final snap = auth.currentUserSnapshot;
      expect(snap, isNotNull);
      expect(snap!.uid, 'user-abc');
      expect(snap.email, 'sigh@example.com');
      expect(snap.displayName, 'Test Player');
    });

    test('substitutes "<no email>" when Firebase returns a null email', () {
      // Plenty of Google accounts sign in without surfacing an email
      // (youth accounts, certain workspace configurations). The
      // dashboard greeting renders this string verbatim, so the
      // fallback must be stable.
      final auth = AuthService(
        firebaseAuth: MockFirebaseAuth(
          signedIn: true,
          mockUser: MockUser(uid: 'u'),
        ),
        googleSignIn: GoogleSignIn(),
      );
      expect(auth.currentUserSnapshot!.email, '<no email>');
    });
  });

  group('AuthService.currentUser stream', () {
    test(
      'emits the persisted user on subscription when already signed in',
      () async {
        // The auth-state-changes stream emits the current user immediately
        // on subscribe. That first emission is what `_WorkerAppState`
        // depends on for a stable post-boot signed-in render.
        final auth = AuthService(
          firebaseAuth: MockFirebaseAuth(
            signedIn: true,
            mockUser: MockUser(uid: 'u-stream', email: 'stream@example.com'),
          ),
          googleSignIn: GoogleSignIn(),
        );

        final first = await auth.currentUser.first;
        expect(first, isNotNull);
        expect(first!.uid, 'u-stream');
        expect(first.email, 'stream@example.com');
      },
    );
  });
}
