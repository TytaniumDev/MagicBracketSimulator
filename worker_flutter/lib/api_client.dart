import 'dart:convert';
import 'dart:io';

import 'package:firebase_app_check/firebase_app_check.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

/// Callback that returns a Firebase App Check token string, or `null`
/// if no token is available. Injected into [ApiClient] so tests can
/// supply a fake without depending on `FirebaseAppCheck`.
typedef AppCheckTokenProvider = Future<String?> Function({bool forceRefresh});

/// Default [AppCheckTokenProvider] that delegates to the real
/// `FirebaseAppCheck` SDK. Returns `null` on non-macOS platforms
/// (Windows desktop has no `firebase_app_check` support) or when the
/// underlying fetch fails.
Future<String?> defaultAppCheckTokenProvider({
  bool forceRefresh = false,
}) async {
  if (!Platform.isMacOS) return null;
  try {
    return await FirebaseAppCheck.instance.getToken(forceRefresh);
  } catch (e) {
    debugPrint('AppCheck: getToken failed: $e');
    return null;
  }
}

/// Thin auth'd HTTP client for the MBS Next.js API.
///
/// Every request attaches `Authorization: Bearer <Firebase ID token>`
/// (refreshed by `firebase_auth` if expired). Non-2xx responses
/// surface the API's `error` field as the thrown message when
/// available — the API standardizes on `{ error: string }` for failures.
class ApiClient {
  ApiClient({
    required this.baseUrl,
    http.Client? client,
    FirebaseAuth? auth,
    AppCheckTokenProvider? appCheckTokenProvider,
  }) : _http = client ?? http.Client(),
       _auth = auth ?? FirebaseAuth.instance,
       _appCheckTokenProvider =
           appCheckTokenProvider ?? defaultAppCheckTokenProvider;

  final String baseUrl;
  final http.Client _http;
  final FirebaseAuth _auth;
  final AppCheckTokenProvider _appCheckTokenProvider;

  Future<Map<String, dynamic>> postJson(
    String path,
    Map<String, dynamic> body,
  ) async {
    final resp = await _http.post(
      Uri.parse('$baseUrl$path'),
      headers: await _headers(),
      body: json.encode(body),
    );
    return _decode(resp, path);
  }

  Future<Map<String, dynamic>> getJson(String path) async {
    final resp = await _http.get(
      Uri.parse('$baseUrl$path'),
      headers: await _headers(),
    );
    return _decode(resp, path);
  }

  Future<void> delete(String path) async {
    final resp = await _http.delete(
      Uri.parse('$baseUrl$path'),
      headers: await _headers(),
    );
    if (resp.statusCode < 200 || resp.statusCode >= 300) {
      _decode(resp, path);
    }
  }

  Future<Map<String, String>> _headers() async {
    final user = _auth.currentUser;
    if (user == null) {
      throw const ApiAuthException('Not signed in');
    }
    final token = await user.getIdToken();
    final headers = <String, String>{
      'Authorization': 'Bearer $token',
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    final appCheckToken = await _appCheckToken();
    if (appCheckToken != null) headers['X-Firebase-AppCheck'] = appCheckToken;
    return headers;
  }

  /// Fetch a Firebase App Check token to attest this request comes from
  /// the legitimate app rather than a script with a stolen ID token.
  /// Returns `null` on platforms where App Check isn't wired up (Windows
  /// desktop has no `firebase_app_check` support) or when the underlying
  /// fetch fails.
  Future<String?> _appCheckToken() => _appCheckTokenProvider(forceRefresh: false);

  Map<String, dynamic> _decode(http.Response resp, String path) {
    Map<String, dynamic>? body;
    if (resp.body.isNotEmpty) {
      try {
        final decoded = json.decode(resp.body);
        if (decoded is Map<String, dynamic>) body = decoded;
      } catch (_) {
        // non-JSON; fall through to status-code message
      }
    }
    if (resp.statusCode == 401) {
      final msg =
          body?['error']?.toString() ??
          'Auth token rejected; please sign in again';
      throw ApiAuthException(msg);
    }
    if (resp.statusCode < 200 || resp.statusCode >= 300) {
      final msg =
          body?['error']?.toString() ?? 'HTTP ${resp.statusCode} on $path';
      throw ApiException(msg, status: resp.statusCode);
    }
    return body ?? const {};
  }
}

class ApiException implements Exception {
  const ApiException(this.message, {this.status});
  final String message;
  final int? status;
  @override
  String toString() => message;
}

class ApiAuthException extends ApiException {
  const ApiAuthException(super.message) : super(status: 401);
}
