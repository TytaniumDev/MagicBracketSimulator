import 'dart:convert';

import 'package:firebase_auth_mocks/firebase_auth_mocks.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:worker_flutter/auth/auth_service.dart';
import 'package:worker_flutter/auth/refresh_token_store.dart';

/// Unit tests for `AuthService.trySilentSignIn` — the path that keeps
/// Windows users from re-doing the OAuth consent flow on every restart.
///
/// Failure-mode behavior is load-bearing here: a 4xx from Google means
/// the refresh token is permanently dead and must be cleared (otherwise
/// every cold launch grinds against a guaranteed-to-fail endpoint);
/// transient network / 5xx must NOT clear the token (otherwise a brief
/// outage signs the user out for good).
void main() {
  final tokenEndpoint = Uri.parse('https://oauth2.googleapis.com/token');

  group('AuthService.trySilentSignIn', () {
    test(
      'returns null without hitting HTTP when no token is persisted',
      () async {
        final auth = AuthService(
          firebaseAuth: MockFirebaseAuth(),
          refreshTokenStore: InMemoryRefreshTokenStore(),
          httpClient: MockClient((req) async {
            fail('HTTP must not be called when no refresh token is stored');
          }),
          clientId: 'c',
          clientSecret: 's',
          tokenEndpoint: tokenEndpoint,
        );

        expect(await auth.trySilentSignIn(), isNull);
      },
    );

    test(
      'exchanges the persisted token and signs in via firebase_auth',
      () async {
        final store = InMemoryRefreshTokenStore('refresh-abc');
        late http.Request capturedRequest;
        final auth = AuthService(
          firebaseAuth: MockFirebaseAuth(
            mockUser: MockUser(
              uid: 'user-silent',
              email: 'silent@example.com',
              displayName: 'Silent Player',
            ),
          ),
          refreshTokenStore: store,
          clientId: 'fake-client',
          clientSecret: 'fake-secret',
          tokenEndpoint: tokenEndpoint,
          httpClient: MockClient((req) async {
            capturedRequest = req;
            return http.Response(
              jsonEncode({
                'id_token': 'id-1',
                'access_token': 'ac-1',
                'expires_in': 3600,
                'token_type': 'Bearer',
              }),
              200,
              headers: {'content-type': 'application/json'},
            );
          }),
        );

        final user = await auth.trySilentSignIn();

        expect(user, isNotNull, reason: 'mock token endpoint returned 200');
        expect(user!.uid, 'user-silent');
        expect(user.email, 'silent@example.com');

        expect(capturedRequest.url, tokenEndpoint);
        expect(capturedRequest.method, 'POST');
        expect(capturedRequest.bodyFields['grant_type'], 'refresh_token');
        expect(capturedRequest.bodyFields['refresh_token'], 'refresh-abc');
        expect(capturedRequest.bodyFields['client_id'], 'fake-client');
        expect(capturedRequest.bodyFields['client_secret'], 'fake-secret');

        expect(
          await store.read(),
          'refresh-abc',
          reason: 'success path must not touch the stored token',
        );
      },
    );

    test(
      'omits client_secret from the form body when configured empty',
      () async {
        // Empty client_secret means the build skipped the Doppler
        // dart-define and the upstream sign-in would have errored
        // separately — but if a refresh token somehow already exists, we
        // shouldn't send `client_secret=` and trigger Google's "missing"
        // error path. Just leave the field off.
        late http.Request captured;
        final auth = AuthService(
          firebaseAuth: MockFirebaseAuth(
            mockUser: MockUser(uid: 'u', email: 'e@example.com'),
          ),
          refreshTokenStore: InMemoryRefreshTokenStore('refresh-no-secret'),
          clientId: 'cid',
          clientSecret: '',
          tokenEndpoint: tokenEndpoint,
          httpClient: MockClient((req) async {
            captured = req;
            return http.Response(
              jsonEncode({'id_token': 'i', 'access_token': 'a'}),
              200,
            );
          }),
        );

        await auth.trySilentSignIn();
        expect(captured.bodyFields.containsKey('client_secret'), isFalse);
      },
    );

    test('deletes the stored token on HTTP 4xx (invalid_grant)', () async {
      final store = InMemoryRefreshTokenStore('revoked-token');
      final auth = AuthService(
        firebaseAuth: MockFirebaseAuth(),
        refreshTokenStore: store,
        clientId: 'c',
        clientSecret: 's',
        tokenEndpoint: tokenEndpoint,
        httpClient: MockClient((req) async {
          return http.Response(
            jsonEncode({'error': 'invalid_grant'}),
            400,
            headers: {'content-type': 'application/json'},
          );
        }),
      );

      expect(await auth.trySilentSignIn(), isNull);
      expect(
        await store.read(),
        isNull,
        reason:
            '4xx means the token is permanently dead; clear it so '
            'we stop hammering the endpoint on every launch',
      );
    });

    test('keeps the stored token on network failure', () async {
      final store = InMemoryRefreshTokenStore('refresh-net');
      final auth = AuthService(
        firebaseAuth: MockFirebaseAuth(),
        refreshTokenStore: store,
        clientId: 'c',
        clientSecret: 's',
        tokenEndpoint: tokenEndpoint,
        httpClient: MockClient((req) async {
          throw http.ClientException('connection refused');
        }),
      );

      expect(await auth.trySilentSignIn(), isNull);
      expect(
        await store.read(),
        'refresh-net',
        reason: 'transient network errors are not evidence of token revocation',
      );
    });

    test('keeps the stored token on HTTP 5xx', () async {
      final store = InMemoryRefreshTokenStore('refresh-5xx');
      final auth = AuthService(
        firebaseAuth: MockFirebaseAuth(),
        refreshTokenStore: store,
        clientId: 'c',
        clientSecret: 's',
        tokenEndpoint: tokenEndpoint,
        httpClient: MockClient((req) async {
          return http.Response('upstream is having a bad day', 503);
        }),
      );

      expect(await auth.trySilentSignIn(), isNull);
      expect(await store.read(), 'refresh-5xx');
    });

    test(
      'returns null and keeps the token when response body is malformed',
      () async {
        // A 200 with a body Google would never send (bug or middlebox-
        // injected HTML). Don't crash the boot sequence; just fall
        // through to the AuthGate. Token stays — the next launch can
        // retry in case it was a transient middlebox issue.
        final store = InMemoryRefreshTokenStore('refresh-bad-body');
        final auth = AuthService(
          firebaseAuth: MockFirebaseAuth(),
          refreshTokenStore: store,
          clientId: 'c',
          clientSecret: 's',
          tokenEndpoint: tokenEndpoint,
          httpClient: MockClient((req) async {
            return http.Response('<html>not json</html>', 200);
          }),
        );

        expect(await auth.trySilentSignIn(), isNull);
        expect(await store.read(), 'refresh-bad-body');
      },
    );
  });

  group('AuthService.signOut', () {
    test(
      'deletes the stored refresh token alongside the firebase signOut',
      () async {
        // If we leave the refresh token in place, the next launch's
        // trySilentSignIn would silently sign the user back in — which
        // is the opposite of what "Sign out" means.
        final store = InMemoryRefreshTokenStore('refresh-signout');
        final auth = AuthService(
          firebaseAuth: MockFirebaseAuth(
            signedIn: true,
            mockUser: MockUser(uid: 'u', email: 'e@example.com'),
          ),
          refreshTokenStore: store,
        );

        await auth.signOut();
        expect(await store.read(), isNull);
      },
    );
  });
}
