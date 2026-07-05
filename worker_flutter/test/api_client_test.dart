import 'dart:convert';

import 'package:firebase_auth_mocks/firebase_auth_mocks.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:worker_flutter/api_client.dart';

void main() {
  late MockFirebaseAuth mockAuth;

  setUp(() {
    mockAuth = MockFirebaseAuth(
      signedIn: true,
      mockUser: MockUser(uid: 'test-uid', email: 'test@example.com'),
    );
  });

  // ── App Check token handling ────────────────────────────────────

  group('App Check token', () {
    test('attaches X-Firebase-AppCheck header when provider returns a token',
        () async {
      Map<String, String>? capturedHeaders;
      final httpClient = MockClient((req) async {
        capturedHeaders = req.headers;
        return http.Response('{"ok": true}', 200);
      });

      final api = ApiClient(
        baseUrl: 'http://localhost',
        client: httpClient,
        auth: mockAuth,
        appCheckTokenProvider: ({bool forceRefresh = false}) async =>
            'app-check-token-123',
      );

      await api.getJson('/api/test');

      expect(capturedHeaders, isNotNull);
      expect(capturedHeaders!['X-Firebase-AppCheck'], 'app-check-token-123');
    });

    test('omits X-Firebase-AppCheck header when provider always returns null',
        () async {
      Map<String, String>? capturedHeaders;
      final httpClient = MockClient((req) async {
        capturedHeaders = req.headers;
        return http.Response('{"ok": true}', 200);
      });

      final api = ApiClient(
        baseUrl: 'http://localhost',
        client: httpClient,
        auth: mockAuth,
        appCheckTokenProvider: ({bool forceRefresh = false}) async => null,
      );

      await api.getJson('/api/test');

      expect(capturedHeaders, isNotNull);
      expect(capturedHeaders!.containsKey('X-Firebase-AppCheck'), isFalse);
    });

    test('calls token provider with forceRefresh: false', () async {
      int callCount = 0;
      bool? passedForceRefresh;
      final httpClient = MockClient((req) async {
        return http.Response('{"ok": true}', 200);
      });

      final api = ApiClient(
        baseUrl: 'http://localhost',
        client: httpClient,
        auth: mockAuth,
        appCheckTokenProvider: ({bool forceRefresh = false}) async {
          callCount++;
          passedForceRefresh = forceRefresh;
          return 'token-xyz';
        },
      );

      await api.getJson('/api/test');

      expect(callCount, 1);
      expect(passedForceRefresh, isFalse);
    });

    test('App Check token is sent on delete requests too', () async {
      Map<String, String>? capturedHeaders;
      final httpClient = MockClient((req) async {
        capturedHeaders = req.headers;
        return http.Response('', 204);
      });

      final api = ApiClient(
        baseUrl: 'http://localhost',
        client: httpClient,
        auth: mockAuth,
        appCheckTokenProvider: ({bool forceRefresh = false}) async =>
            'delete-check-token',
      );

      await api.delete('/api/decks/123');

      expect(capturedHeaders!['X-Firebase-AppCheck'], 'delete-check-token');
    });

    test('App Check token is sent on post requests too', () async {
      Map<String, String>? capturedHeaders;
      final httpClient = MockClient((req) async {
        capturedHeaders = req.headers;
        return http.Response('{"id": "1"}', 200);
      });

      final api = ApiClient(
        baseUrl: 'http://localhost',
        client: httpClient,
        auth: mockAuth,
        appCheckTokenProvider: ({bool forceRefresh = false}) async =>
            'post-check-token',
      );

      await api.postJson('/api/decks', {'name': 'Test'});

      expect(capturedHeaders!['X-Firebase-AppCheck'], 'post-check-token');
    });
  });

  // ── Auth header ─────────────────────────────────────────────────

  group('Auth header', () {
    test('attaches Authorization Bearer header with Firebase ID token',
        () async {
      Map<String, String>? capturedHeaders;
      final httpClient = MockClient((req) async {
        capturedHeaders = req.headers;
        return http.Response('{"ok": true}', 200);
      });

      final api = ApiClient(
        baseUrl: 'http://localhost',
        client: httpClient,
        auth: mockAuth,
        appCheckTokenProvider: ({bool forceRefresh = false}) async => null,
      );

      await api.getJson('/api/test');

      expect(capturedHeaders, isNotNull);
      expect(
        capturedHeaders!['Authorization'],
        startsWith('Bearer '),
        reason: 'should contain a Bearer token from FirebaseAuth',
      );
    });

    test('throws ApiAuthException when not signed in', () async {
      final noUserAuth = MockFirebaseAuth(signedIn: false);
      final httpClient = MockClient((req) async {
        return http.Response('{}', 200);
      });

      final api = ApiClient(
        baseUrl: 'http://localhost',
        client: httpClient,
        auth: noUserAuth,
        appCheckTokenProvider: ({bool forceRefresh = false}) async =>
            'token',
      );

      expect(
        () => api.getJson('/api/test'),
        throwsA(
          isA<ApiAuthException>().having(
            (e) => e.message,
            'message',
            'Not signed in',
          ),
        ),
      );
    });
  });

  // ── HTTP method routing ─────────────────────────────────────────

  group('HTTP methods', () {
    test('postJson sends POST with JSON body and returns decoded response',
        () async {
      String? capturedMethod;
      String? capturedBody;
      final httpClient = MockClient((req) async {
        capturedMethod = req.method;
        capturedBody = req.body;
        return http.Response('{"id": "deck-1"}', 200);
      });

      final api = ApiClient(
        baseUrl: 'http://localhost',
        client: httpClient,
        auth: mockAuth,
        appCheckTokenProvider: ({bool forceRefresh = false}) async =>
            'token',
      );

      final result = await api.postJson('/api/decks', {'name': 'Test'});

      expect(capturedMethod, 'POST');
      expect(json.decode(capturedBody!), {'name': 'Test'});
      expect(result, {'id': 'deck-1'});
    });

    test('getJson sends GET and returns decoded response', () async {
      String? capturedMethod;
      final httpClient = MockClient((req) async {
        capturedMethod = req.method;
        return http.Response('{"decks": []}', 200);
      });

      final api = ApiClient(
        baseUrl: 'http://localhost',
        client: httpClient,
        auth: mockAuth,
        appCheckTokenProvider: ({bool forceRefresh = false}) async =>
            'token',
      );

      final result = await api.getJson('/api/decks');

      expect(capturedMethod, 'GET');
      expect(result, {'decks': []});
    });

    test('delete sends DELETE and succeeds on 204', () async {
      String? capturedMethod;
      final httpClient = MockClient((req) async {
        capturedMethod = req.method;
        return http.Response('', 204);
      });

      final api = ApiClient(
        baseUrl: 'http://localhost',
        client: httpClient,
        auth: mockAuth,
        appCheckTokenProvider: ({bool forceRefresh = false}) async =>
            'token',
      );

      await api.delete('/api/decks/123');

      expect(capturedMethod, 'DELETE');
    });
  });

  // ── Error handling ──────────────────────────────────────────────

  group('error handling', () {
    test('throws ApiAuthException with auth-rejected message on 401', () async {
      final httpClient = MockClient((req) async {
        return http.Response(
          '{"error": "Missing App Check token"}',
          401,
        );
      });

      final api = ApiClient(
        baseUrl: 'http://localhost',
        client: httpClient,
        auth: mockAuth,
        appCheckTokenProvider: ({bool forceRefresh = false}) async => null,
      );

      expect(
        () => api.getJson('/api/decks'),
        throwsA(
          isA<ApiAuthException>().having(
            (e) => e.message,
            'message',
            'Auth token rejected; please sign in again',
          ),
        ),
      );
    });

    test('throws ApiException with server error field on non-2xx', () async {
      final httpClient = MockClient((req) async {
        return http.Response('{"error": "Deck not found"}', 404);
      });

      final api = ApiClient(
        baseUrl: 'http://localhost',
        client: httpClient,
        auth: mockAuth,
        appCheckTokenProvider: ({bool forceRefresh = false}) async =>
            'token',
      );

      expect(
        () => api.getJson('/api/decks/missing'),
        throwsA(
          isA<ApiException>()
              .having((e) => e.message, 'message', 'Deck not found')
              .having((e) => e.status, 'status', 404),
        ),
      );
    });

    test('throws ApiException with status fallback when body is not JSON',
        () async {
      final httpClient = MockClient((req) async {
        return http.Response('Internal Server Error', 500);
      });

      final api = ApiClient(
        baseUrl: 'http://localhost',
        client: httpClient,
        auth: mockAuth,
        appCheckTokenProvider: ({bool forceRefresh = false}) async =>
            'token',
      );

      expect(
        () => api.getJson('/api/boom'),
        throwsA(
          isA<ApiException>().having(
            (e) => e.message,
            'message',
            'HTTP 500 on /api/boom',
          ),
        ),
      );
    });

    test('delete throws ApiAuthException on 401', () async {
      final httpClient = MockClient((req) async {
        return http.Response('{"error": "Unauthorized"}', 401);
      });

      final api = ApiClient(
        baseUrl: 'http://localhost',
        client: httpClient,
        auth: mockAuth,
        appCheckTokenProvider: ({bool forceRefresh = false}) async => null,
      );

      expect(
        () => api.delete('/api/decks/123'),
        throwsA(isA<ApiAuthException>()),
      );
    });
  });
}
