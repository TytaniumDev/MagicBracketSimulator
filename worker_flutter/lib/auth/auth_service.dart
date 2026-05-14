import 'dart:async';
import 'dart:io';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';

import '../firebase_options.dart';
import 'desktop_oauth.dart';

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
/// Two code paths depending on platform — both produce a Firebase
/// session usable by `cloud_firestore`:
///
///   - **macOS / iOS / Android / Web**: use
///     `FirebaseAuth.signInWithProvider(GoogleAuthProvider())`. The
///     native SDKs drive the OAuth UI (ASWebAuthenticationSession on
///     macOS, system popup on web, etc.).
///   - **Windows / Linux**: `signInWithProvider` throws
///     "Operation is not supported on non-mobile systems" on those
///     ports, so we drive an OAuth2 PKCE flow ourselves via
///     `DesktopOAuth`, then hand the resulting Google `idToken` /
///     `accessToken` to `signInWithCredential`. The session that
///     lands in firebase_auth is identical to the native flow's.
///
/// firebase_auth's `signInWithCredential` IS supported on Windows
/// (unlike the all-in-one `signInWithProvider`), so cloud_firestore
/// reads `request.auth.uid` on subsequent writes either way.
class AuthService {
  AuthService({FirebaseAuth? firebaseAuth, DesktopOAuth? desktopOAuth})
    : _firebaseAuth = firebaseAuth ?? FirebaseAuth.instance,
      _desktopOAuth = desktopOAuth;

  final FirebaseAuth _firebaseAuth;
  final DesktopOAuth? _desktopOAuth;

  /// Stream of the current Firebase user, mapped to our `AuthedUser`
  /// shape. Emits `null` while signed out.
  Stream<AuthedUser?> get currentUser =>
      _firebaseAuth.authStateChanges().map(_mapUser);

  /// Synchronous snapshot of the currently signed-in user, if any.
  /// Used at boot to restore a persisted session.
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
  /// browser/tab without completing sign-in. Other errors bubble.
  Future<AuthedUser> signIn() async {
    if (_useDesktopFlow) {
      return _signInWindows();
    }
    return _signInNative();
  }

  /// Native `signInWithProvider` — macOS, iOS, Android, Web.
  Future<AuthedUser> _signInNative() async {
    if (kDebugMode) {
      debugPrint('AuthService.signIn() — using signInWithProvider');
    }
    final provider = GoogleAuthProvider()..addScope('email');
    final UserCredential credential;
    try {
      credential = await _firebaseAuth.signInWithProvider(provider);
    } on FirebaseAuthException catch (e) {
      if (_cancelCodes.contains(e.code)) {
        throw const AuthCancelledException();
      }
      rethrow;
    }
    return _requireUser(credential);
  }

  /// Windows / Linux: drive OAuth2 PKCE ourselves, then exchange the
  /// resulting Google idToken for a Firebase session.
  Future<AuthedUser> _signInWindows() async {
    if (kDebugMode) {
      debugPrint('AuthService.signIn() — using PKCE + signInWithCredential');
    }
    final clientId = DefaultFirebaseOptions.desktopOAuthClientId;
    if (clientId == 'REPLACE_WITH_DESKTOP_OAUTH_CLIENT_ID') {
      throw StateError(
        'Windows sign-in needs a Desktop OAuth Client ID. Create one at '
        'https://console.cloud.google.com/apis/credentials (Application '
        'type: Desktop app) and paste it into '
        'DefaultFirebaseOptions.desktopOAuthClientId in firebase_options.dart.',
      );
    }
    final oauth = _desktopOAuth ?? DesktopOAuth(clientId: clientId);
    final tokens = await oauth.signIn();
    final cred = GoogleAuthProvider.credential(
      idToken: tokens.idToken,
      accessToken: tokens.accessToken,
    );
    final UserCredential credential;
    try {
      credential = await _firebaseAuth.signInWithCredential(cred);
    } on FirebaseAuthException catch (e) {
      if (_cancelCodes.contains(e.code)) {
        throw const AuthCancelledException();
      }
      rethrow;
    }
    return _requireUser(credential);
  }

  AuthedUser _requireUser(UserCredential credential) {
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

  /// Sign-in is supported on every desktop target — macOS via the
  /// native provider, Windows/Linux via the PKCE fallback.
  static bool get isSupported => true;

  /// Whether to take the desktop PKCE path. We can't ship `Platform.is*`
  /// from a const context, so the check is a runtime read.
  bool get _useDesktopFlow {
    if (kIsWeb) return false;
    return Platform.isWindows || Platform.isLinux;
  }

  /// firebase_auth's "user closed the tab / cancelled" errors come
  /// back as several codes depending on platform; collapse them so
  /// the gate UI gets a single cancellation signal.
  static const _cancelCodes = {
    'web-context-canceled',
    'popup-closed-by-user',
    'cancelled-popup-request',
    'user-canceled',
  };
}

class AuthCancelledException implements Exception {
  const AuthCancelledException();
  @override
  String toString() => 'Sign-in cancelled by user';
}
