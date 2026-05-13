import 'dart:async';
import 'dart:io';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:google_sign_in/google_sign_in.dart';

/// Stable identifier for the currently-signed-in user, plus a small
/// shim to make the rest of the worker tolerant to either being
/// signed in (Firestore rules will recognize `request.auth.uid`) or
/// running anonymously during the v0.1.0 transition window.
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
/// This wraps two concerns the worker needs to keep separate:
///   1. The OAuth handshake with Google to get an idToken/accessToken.
///   2. Exchanging that token for a Firebase Auth session so Firestore
///      sees `request.auth.uid` on subsequent writes.
///
/// firebase_auth_macos's native plugin historically crashed at boot
/// for several Firebase configs (uncaught NSExceptions that bypass
/// Dart try/catch). The fix has been merged upstream as of 5.x — this
/// service still defers `Firebase.initializeApp()`'s auth side-effects
/// by only touching `FirebaseAuth.instance` AFTER the user has clicked
/// Sign In, so a broken Firebase config can't kill the app on boot.
class AuthService {
  AuthService({GoogleSignIn? googleSignIn, FirebaseAuth? firebaseAuth})
    : _googleSignIn =
          googleSignIn ??
          GoogleSignIn(
            // scopes intentionally minimal — we only need to identify
            // the user, not read their drive/calendar/etc.
            scopes: const ['email'],
          ),
      _firebaseAuth = firebaseAuth ?? FirebaseAuth.instance;

  final GoogleSignIn _googleSignIn;
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

  /// Trigger the Google Sign-In flow and exchange the result for a
  /// Firebase session. Returns the signed-in user on success.
  ///
  /// Throws on platform-not-supported or user cancellation.
  Future<AuthedUser> signIn() async {
    if (kDebugMode) {
      debugPrint('AuthService.signIn() — starting Google Sign-In');
    }

    // google_sign_in v6 supports macOS natively; on Windows it falls
    // back to the system browser via url_launcher. Either path returns
    // a GoogleSignInAccount carrying an idToken + accessToken.
    final account = await _googleSignIn.signIn();
    if (account == null) {
      throw const AuthCancelledException();
    }
    final auth = await account.authentication;
    final credential = GoogleAuthProvider.credential(
      idToken: auth.idToken,
      accessToken: auth.accessToken,
    );

    final fbUser = (await _firebaseAuth.signInWithCredential(credential)).user;
    if (fbUser == null) {
      throw StateError('Firebase returned a null user after sign-in');
    }
    return AuthedUser(
      uid: fbUser.uid,
      email: fbUser.email ?? account.email,
      displayName: fbUser.displayName ?? account.displayName,
    );
  }

  Future<void> signOut() async {
    await _googleSignIn.signOut();
    await _firebaseAuth.signOut();
  }

  /// True if google_sign_in supports this platform out of the box.
  /// Windows currently doesn't — sign_in_button reflects that.
  static bool get isSupported {
    if (kIsWeb) return true;
    return Platform.isMacOS || Platform.isIOS || Platform.isAndroid;
  }
}

class AuthCancelledException implements Exception {
  const AuthCancelledException();
  @override
  String toString() => 'Sign-in cancelled by user';
}
