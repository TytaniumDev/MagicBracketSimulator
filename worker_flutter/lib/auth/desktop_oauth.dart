import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:url_launcher/url_launcher.dart';

import 'auth_service.dart' show AuthCancelledException;

/// Driver for the OAuth2 Authorization Code + PKCE flow against
/// Google's identity endpoints.
///
/// firebase_auth's `signInWithProvider` only works on mobile + macOS.
/// On Windows / Linux the desktop port throws "Operation is not
/// supported on non-mobile systems", so we run the OAuth handshake
/// ourselves:
///
///   1. Generate a PKCE verifier + S256 challenge.
///   2. Bind a one-shot HttpServer to `127.0.0.1:<random>` for the
///      `redirect_uri` Google will bounce the user back to.
///   3. Open the user's default browser to Google's authorization
///      endpoint via `url_launcher`.
///   4. Wait for the redirect, pull the `code` query param off it.
///   5. POST `code + verifier` to Google's token endpoint, parse the
///      `id_token` + `access_token` out of the response.
///
/// The caller then hands the resulting `id_token`/`access_token` to
/// `FirebaseAuth.instance.signInWithCredential(GoogleAuthProvider.credential(...))`.
class DesktopOAuth {
  DesktopOAuth({
    required this.clientId,
    this.clientSecret = '',
    this.scopes = const ['openid', 'email', 'profile'],
    http.Client? httpClient,
  }) : _http = httpClient ?? http.Client();

  /// Google OAuth client ID of type "Desktop app". Different from the
  /// iOS-type client `signInWithProvider` consumes on macOS — desktop
  /// clients accept loopback redirects but Google's token endpoint
  /// also requires the matching client_secret even with PKCE in play.
  final String clientId;

  /// Google's "Desktop app" client secret. Despite the name it isn't
  /// a security boundary — Google's own docs note it's
  /// code-distributable. Required because Google's token endpoint
  /// returns "client_secret is missing" without it (PKCE alone
  /// doesn't satisfy them for the Desktop client type).
  final String clientSecret;

  final List<String> scopes;
  final http.Client _http;

  static const _authEndpoint = 'https://accounts.google.com/o/oauth2/v2/auth';
  static const _tokenEndpoint = 'https://oauth2.googleapis.com/token';

  /// Drive the entire flow. Returns the Google `id_token` +
  /// `access_token` for use with `GoogleAuthProvider.credential`.
  /// Throws [AuthCancelledException] if the user closes the browser
  /// without completing the consent screen.
  Future<DesktopOAuthResult> signIn() async {
    final verifier = _randomVerifier();
    final challenge = _s256(verifier);
    final state = _randomState();

    // Bind early so we have a port to put in the redirect_uri before
    // launching the browser. Loopback binding is what Google requires
    // for Desktop OAuth clients (no DNS, no firewall surprises).
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final port = server.port;
    final redirectUri = 'http://127.0.0.1:$port';

    final authUrl = Uri.parse(_authEndpoint).replace(
      queryParameters: {
        'client_id': clientId,
        'redirect_uri': redirectUri,
        'response_type': 'code',
        'scope': scopes.join(' '),
        'code_challenge': challenge,
        'code_challenge_method': 'S256',
        'state': state,
        'access_type': 'online',
        'prompt': 'select_account',
      },
    );

    try {
      if (!await launchUrl(authUrl, mode: LaunchMode.externalApplication)) {
        throw StateError('Could not launch the OAuth browser window');
      }

      // Wait for the redirect. The browser will hit our localhost
      // server with the `code` query param attached. Bounded to 5min
      // so a forgotten browser tab doesn't pin the app indefinitely.
      final code = await _waitForCallback(
        server,
        state,
      ).timeout(const Duration(minutes: 5));

      // Exchange the auth code for tokens. Google requires the
      // client_secret on Desktop clients even with PKCE in play —
      // see the field doc on `clientSecret`.
      final resp = await _http.post(
        Uri.parse(_tokenEndpoint),
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: {
          'client_id': clientId,
          if (clientSecret.isNotEmpty) 'client_secret': clientSecret,
          'code': code,
          'code_verifier': verifier,
          'grant_type': 'authorization_code',
          'redirect_uri': redirectUri,
        },
      );
      if (resp.statusCode != 200) {
        throw StateError(
          'Google token endpoint returned ${resp.statusCode}: ${resp.body}',
        );
      }
      final tokens = jsonDecode(resp.body) as Map<String, dynamic>;
      final idToken = tokens['id_token'] as String?;
      final accessToken = tokens['access_token'] as String?;
      if (idToken == null || accessToken == null) {
        throw StateError(
          'Token response missing id_token/access_token: ${resp.body}',
        );
      }
      return DesktopOAuthResult(idToken: idToken, accessToken: accessToken);
    } finally {
      // Always close the listener — leaving it bound on a random port
      // would leak file descriptors and could collide on a future run.
      await server.close(force: true);
    }
  }

  Future<String> _waitForCallback(HttpServer server, String expectedState) {
    final completer = Completer<String>();
    server.listen((req) async {
      final params = req.uri.queryParameters;
      final code = params['code'];
      final state = params['state'];
      final err = params['error'];
      final res = req.response;

      if (err == 'access_denied') {
        res.statusCode = 200;
        res.headers.contentType = ContentType.html;
        res.write(
          _htmlMessage(
            title: 'Sign-in cancelled',
            body:
                'You can close this tab and return to the Magic Bracket worker.',
          ),
        );
        await res.close();
        if (!completer.isCompleted) {
          completer.completeError(const AuthCancelledException());
        }
        return;
      }

      if (state != expectedState || code == null) {
        res.statusCode = 400;
        res.headers.contentType = ContentType.html;
        res.write(
          _htmlMessage(
            title: 'Sign-in failed',
            body:
                'Bad OAuth state or missing code — close this tab and try again.',
          ),
        );
        await res.close();
        if (!completer.isCompleted) {
          completer.completeError(
            StateError('OAuth callback missing code or state mismatch'),
          );
        }
        return;
      }

      res.statusCode = 200;
      res.headers.contentType = ContentType.html;
      res.write(
        _htmlMessage(
          title: 'Sign-in complete',
          body:
              'You can close this tab and return to the Magic Bracket worker.',
        ),
      );
      await res.close();
      if (!completer.isCompleted) completer.complete(code);
    });
    return completer.future;
  }

  /// 64 random URL-safe characters — well within RFC 7636's
  /// 43-128 verifier length range.
  String _randomVerifier() {
    final rand = Random.secure();
    final bytes = List<int>.generate(48, (_) => rand.nextInt(256));
    return base64Url.encode(bytes).replaceAll('=', '');
  }

  String _randomState() {
    final rand = Random.secure();
    final bytes = List<int>.generate(16, (_) => rand.nextInt(256));
    return base64Url.encode(bytes).replaceAll('=', '');
  }

  String _s256(String verifier) {
    final digest = sha256.convert(utf8.encode(verifier));
    return base64Url.encode(digest.bytes).replaceAll('=', '');
  }

  String _htmlMessage({required String title, required String body}) {
    // Tiny styled page so the post-OAuth tab doesn't look like a
    // server error. Inline CSS only — no external requests fire from
    // the user's browser.
    return '''<!doctype html><html><head><meta charset="utf-8"><title>$title</title>
<style>body{font-family:-apple-system,sans-serif;background:#1F2937;color:#fff;
display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{background:#111827;padding:32px;border-radius:12px;text-align:center;max-width:420px}
h1{font-size:18px;margin:0 0 8px}p{font-size:13px;margin:0;color:#cbd5e1}</style></head>
<body><div class="card"><h1>$title</h1><p>$body</p></div></body></html>''';
  }
}

class DesktopOAuthResult {
  DesktopOAuthResult({required this.idToken, required this.accessToken});
  final String idToken;
  final String accessToken;

  @override
  String toString() {
    if (kDebugMode) {
      return 'DesktopOAuthResult(idToken: ${idToken.substring(0, 16)}…, '
          'accessToken: ${accessToken.substring(0, 16)}…)';
    }
    return 'DesktopOAuthResult';
  }
}
