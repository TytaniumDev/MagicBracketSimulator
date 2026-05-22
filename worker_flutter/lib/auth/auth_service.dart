import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../firebase_options.dart';
import '../telemetry.dart';
import 'desktop_oauth.dart';
import 'refresh_token_store.dart';

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
///   - **iOS / Android / Web**: use
///     `FirebaseAuth.signInWithProvider(GoogleAuthProvider())`. The
///     native SDKs drive the OAuth UI (system popup on web, native
///     OAuth on mobile).
///   - **macOS / Windows / Linux**: `signInWithProvider` is mobile-
///     only on every desktop port of firebase_auth — macOS throws
///     "signInWithProvider is not supported on the MacOS platform"
///     and Windows throws "Operation is not supported on non-mobile
///     systems". We drive an OAuth2 PKCE flow ourselves via
///     `DesktopOAuth`, then hand the resulting Google `idToken` /
///     `accessToken` to `signInWithCredential`. The session that
///     lands in firebase_auth is identical to the native flow's.
///
/// firebase_auth's `signInWithCredential` IS supported on every
/// desktop target (unlike the all-in-one `signInWithProvider`), so
/// cloud_firestore reads `request.auth.uid` on subsequent writes
/// either way.
class AuthService {
  AuthService({
    FirebaseAuth? firebaseAuth,
    DesktopOAuth? desktopOAuth,
    RefreshTokenStore? refreshTokenStore,
    http.Client? httpClient,
    String? clientId,
    String? clientSecret,
    Uri? tokenEndpoint,
  }) : _firebaseAuth = firebaseAuth ?? FirebaseAuth.instance,
       _desktopOAuth = desktopOAuth,
       _refreshTokenStore = refreshTokenStore ?? SecureRefreshTokenStore(),
       _http = httpClient ?? http.Client(),
       _clientId = clientId ?? DefaultFirebaseOptions.desktopOAuthClientId,
       _clientSecret =
           clientSecret ?? DefaultFirebaseOptions.desktopOAuthClientSecret,
       _tokenEndpoint = tokenEndpoint ?? _defaultTokenEndpoint;

  static final Uri _defaultTokenEndpoint = Uri.parse(
    'https://oauth2.googleapis.com/token',
  );

  final FirebaseAuth _firebaseAuth;
  final DesktopOAuth? _desktopOAuth;
  final RefreshTokenStore _refreshTokenStore;
  final http.Client _http;
  final String _clientId;
  final String _clientSecret;
  final Uri _tokenEndpoint;

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
      return _signInDesktop();
    }
    return _signInNative();
  }

  /// Native `signInWithProvider` — iOS, Android, Web.
  Future<AuthedUser> _signInNative() async {
    if (kDebugMode) {
      debugPrint('AuthService.signIn() — using signInWithProvider');
    }
    final provider = GoogleAuthProvider()..addScope('email');
    final UserCredential credential;
    try {
      credential = await _firebaseAuth.signInWithProvider(provider);
    } on FirebaseAuthException catch (e, st) {
      if (_cancelCodes.contains(e.code)) {
        throw const AuthCancelledException();
      }
      await Telemetry.captureError(
        e,
        st,
        category: TelemetryCategory.signIn,
        tags: {
          'platform': Platform.operatingSystem,
          'provider': 'google',
          'error_code': e.code,
          'phase': 'native_provider',
        },
      );
      rethrow;
    }
    return _requireUser(credential);
  }

  /// Desktop (macOS / Windows / Linux): drive OAuth2 PKCE ourselves,
  /// then exchange the resulting Google idToken for a Firebase
  /// session via `signInWithCredential`.
  Future<AuthedUser> _signInDesktop() async {
    if (kDebugMode) {
      debugPrint('AuthService.signIn() — using PKCE + signInWithCredential');
    }
    if (_clientId == 'REPLACE_WITH_DESKTOP_OAUTH_CLIENT_ID') {
      throw StateError(
        'Desktop sign-in needs a Desktop OAuth Client ID. Create one at '
        'https://console.cloud.google.com/apis/credentials (Application '
        'type: Desktop app) and paste it into '
        'DefaultFirebaseOptions.desktopOAuthClientId in firebase_options.dart.',
      );
    }
    if (_clientSecret.isEmpty) {
      throw StateError(
        'Desktop sign-in is missing GOOGLE_DESKTOP_OAUTH_CLIENT_SECRET. '
        'Release builds load it from Doppler (blinkbreak/prd). For local '
        'dev, run: doppler run --project blinkbreak --config prd -- sh -c '
        "'flutter run -d macos --dart-define=GOOGLE_DESKTOP_OAUTH_CLIENT_SECRET=\$GOOGLE_DESKTOP_OAUTH_CLIENT_SECRET'",
      );
    }
    final oauth =
        _desktopOAuth ??
        DesktopOAuth(clientId: _clientId, clientSecret: _clientSecret);
    final tokens = await _runPkce(oauth);
    final cred = GoogleAuthProvider.credential(
      idToken: tokens.idToken,
      accessToken: tokens.accessToken,
    );
    final UserCredential credential;
    try {
      credential = await _firebaseAuth.signInWithCredential(cred);
    } on FirebaseAuthException catch (e, st) {
      if (_cancelCodes.contains(e.code)) {
        throw const AuthCancelledException();
      }
      await Telemetry.captureError(
        e,
        st,
        category: TelemetryCategory.signIn,
        tags: {
          'platform': Platform.operatingSystem,
          'provider': 'google',
          'error_code': e.code,
          'phase': 'firebase_credential',
        },
      );
      rethrow;
    }
    // Persist the Google refresh token so the next launch can silently
    // re-sign-in via `trySilentSignIn`. Absence is non-fatal — the
    // user can still complete sign-in this session; they'll just see
    // the AuthGate again on next launch.
    final refresh = tokens.refreshToken;
    if (refresh != null && refresh.isNotEmpty) {
      try {
        await _refreshTokenStore.write(refresh);
      } catch (e, st) {
        await Telemetry.captureError(
          e,
          st,
          category: TelemetryCategory.signIn,
          tags: {
            'platform': Platform.operatingSystem,
            'phase': 'persist_refresh_token',
          },
        );
      }
    }
    return _requireUser(credential);
  }

  /// Silently re-establishes a Firebase session by exchanging a
  /// persisted Google refresh token for a fresh id_token + access_token
  /// and feeding that into `signInWithCredential`.
  ///
  /// Returns the restored user on success, `null` if there's no stored
  /// token, the token is revoked, or any step fails. Distinguishes
  /// permanent failures (HTTP 4xx → token cleared) from transient ones
  /// (network / 5xx → token preserved) so a brief outage doesn't sign
  /// the user out for good.
  ///
  /// Used by the boot path on every desktop platform (not just Windows)
  /// to land returning users on the dashboard without the AuthGate.
  Future<AuthedUser?> trySilentSignIn() async {
    final stored = await _refreshTokenStore.read();
    if (stored == null || stored.isEmpty) return null;

    final http.Response resp;
    try {
      resp = await _http.post(
        _tokenEndpoint,
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: {
          'client_id': _clientId,
          if (_clientSecret.isNotEmpty) 'client_secret': _clientSecret,
          'grant_type': 'refresh_token',
          'refresh_token': stored,
        },
      );
    } catch (e, st) {
      // Network failure — keep the token; the next launch can retry.
      await Telemetry.captureError(
        e,
        st,
        category: TelemetryCategory.signIn,
        tags: {
          'platform': Platform.operatingSystem,
          'phase': 'silent_refresh_network',
        },
      );
      return null;
    }

    if (resp.statusCode == 400) {
      try {
        final body = jsonDecode(resp.body) as Map<String, dynamic>;
        if (body['error'] == 'invalid_grant') {
          await _refreshTokenStore.delete();
        }
      } catch (_) {}
      return null;
    }
    if (resp.statusCode >= 400 && resp.statusCode < 500) {
      return null;
    }
    if (resp.statusCode != 200) {
      // 5xx — transient. Preserve the token.
      return null;
    }

    final String? idToken;
    final String? accessToken;
    try {
      final tokens = jsonDecode(resp.body) as Map<String, dynamic>;
      idToken = tokens['id_token'] as String?;
      accessToken = tokens['access_token'] as String?;
    } catch (_) {
      // Malformed body (HTML error page from a middlebox, etc.). Keep
      // the token — most likely a transient routing issue.
      return null;
    }
    if (idToken == null || accessToken == null) return null;

    final cred = GoogleAuthProvider.credential(
      idToken: idToken,
      accessToken: accessToken,
    );
    try {
      final result = await _firebaseAuth.signInWithCredential(cred);
      return _mapUser(result.user);
    } catch (e, st) {
      await Telemetry.captureError(
        e,
        st,
        category: TelemetryCategory.signIn,
        tags: {
          'platform': Platform.operatingSystem,
          'phase': 'silent_refresh_firebase',
        },
      );
      return null;
    }
  }

  /// Run the PKCE flow with capture-on-failure. `AuthCancelledException`
  /// is passed through so the gate UI keeps treating cancellation as a
  /// non-error.
  Future<DesktopOAuthResult> _runPkce(DesktopOAuth oauth) async {
    try {
      return await oauth.signIn();
    } on AuthCancelledException {
      rethrow;
    } catch (e, st) {
      await Telemetry.captureError(
        e,
        st,
        category: TelemetryCategory.signIn,
        tags: {
          'platform': Platform.operatingSystem,
          'provider': 'google',
          'phase': 'pkce',
        },
      );
      rethrow;
    }
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

  Future<void> signOut() async {
    await _firebaseAuth.signOut();
    await _refreshTokenStore.delete();
  }

  /// Sign-in is supported on every desktop target via the PKCE flow.
  static bool get isSupported => true;

  /// Whether to take the desktop PKCE path. firebase_auth's
  /// `signInWithProvider` is mobile-only — it throws on macOS
  /// ("signInWithProvider is not supported on the MacOS platform")
  /// AND on Windows ("Operation is not supported on non-mobile
  /// systems"), so every desktop target needs the PKCE fallback.
  bool get _useDesktopFlow {
    if (kIsWeb) return false;
    return Platform.isWindows || Platform.isLinux || Platform.isMacOS;
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
