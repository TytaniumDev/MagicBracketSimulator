import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';

/// Stable identifier for the currently-signed-in user, plus a small
/// shim to keep the rest of the worker decoupled from the
/// `firebase_auth.User` API surface.
class AuthedUser {
  AuthedUser({
    required this.uid,
    required this.email,
    required this.displayName,
  });
  final String uid;
  final String email;
  final String? displayName;
}

/// Cloud-mode authentication.
///
/// `signInWithProvider(GoogleAuthProvider())` is the single API that
/// drives Google Sign-In on every platform we ship:
///   - macOS: native `ASWebAuthenticationSession` (system keychain
///     credentials available).
///   - Windows / Linux: system default browser + a one-shot localhost
///     listener for the OAuth callback.
///   - Web: standard popup OAuth dance.
///
/// firebase_auth_macos's native plugin historically crashed at boot
/// for several Firebase configs (uncaught NSExceptions that bypass
/// Dart try/catch). The fix has been merged upstream as of 5.x. The
/// invariant this service preserves regardless: every `FirebaseAuth`
/// access happens inside Flutter's event loop — i.e., AFTER `runApp`
/// has returned and the framework is processing frames — rather than
/// at native cold-boot time. The class is constructed as a field on
/// `_WorkerAppState`, so the `FirebaseAuth.instance` lookup in the
/// constructor fires during `State.initState`, not during
/// `main()`'s top-level setup.
class AuthService {
  AuthService({FirebaseAuth? firebaseAuth})
    : _firebaseAuth = firebaseAuth ?? FirebaseAuth.instance;

  final FirebaseAuth _firebaseAuth;

  /// Stream of the current Firebase user, mapped to our `AuthedUser`
  /// shape. Emits `null` while signed out.
  Stream<AuthedUser?> get currentUser =>
      _firebaseAuth.authStateChanges().map(_mapUser);

  /// Synchronous snapshot of the currently signed-in user, if any.
  /// Used at boot to restore a persisted session — firebase_auth
  /// caches tokens on disk, so a user who signed in last launch
  /// shouldn't have to OAuth again on this one.
  AuthedUser? get currentUserSnapshot => _mapUser(_firebaseAuth.currentUser);

  AuthedUser? _mapUser(User? user) {
    if (user == null) return null;
    return AuthedUser(
      uid: user.uid,
      email: user.email ?? '<no email>',
      displayName: user.displayName,
    );
  }

  /// Trigger the Google Sign-In flow and return the signed-in user.
  ///
  /// Throws [AuthCancelledException] if the user closes the OAuth
  /// browser tab without completing sign-in. Other errors bubble as
  /// the underlying `FirebaseAuthException` so the gate UI can
  /// display the provider's message verbatim.
  Future<AuthedUser> signIn() async {
    if (kDebugMode) {
      debugPrint('AuthService.signIn() — starting signInWithProvider');
    }
    final provider = GoogleAuthProvider()
      // Minimal scope: we only need to identify the user. No drive,
      // calendar, contacts. Keep the consent screen short.
      ..addScope('email');

    final UserCredential credential;
    try {
      credential = await _firebaseAuth.signInWithProvider(provider);
    } on FirebaseAuthException catch (e) {
      // The user-closed-the-tab path comes back as a few different
      // error codes depending on platform; normalize them so the
      // AuthGate UI gets a single cancellation signal to render.
      const cancelCodes = {
        'web-context-canceled',
        'popup-closed-by-user',
        'cancelled-popup-request',
        'user-canceled',
      };
      if (cancelCodes.contains(e.code)) {
        throw const AuthCancelledException();
      }
      rethrow;
    }
    final user = credential.user;
    if (user == null) {
      throw StateError('Firebase returned a null user after sign-in');
    }
    return AuthedUser(
      uid: user.uid,
      email: user.email ?? '<no email>',
      displayName: user.displayName,
    );
  }

  Future<void> signOut() => _firebaseAuth.signOut();

  /// firebase_auth's `signInWithProvider` works on every desktop
  /// platform we target, so unlike the prior `google_sign_in`-backed
  /// implementation, sign-in is universally supported. Kept as a
  /// static getter for API stability — callers can still gate UI on
  /// it if a future platform needs an exception.
  static bool get isSupported => true;
}

class AuthCancelledException implements Exception {
  const AuthCancelledException();
  @override
  String toString() => 'Sign-in cancelled by user';
}
