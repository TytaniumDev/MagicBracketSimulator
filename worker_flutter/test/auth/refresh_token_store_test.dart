import 'package:flutter_test/flutter_test.dart';
import 'package:worker_flutter/auth/refresh_token_store.dart';

/// `InMemoryRefreshTokenStore` is the test double for the secure store
/// — these tests just pin its contract so the silent-sign-in tests can
/// rely on consistent behavior.
void main() {
  group('InMemoryRefreshTokenStore', () {
    test('read returns null when no token has been written', () async {
      final store = InMemoryRefreshTokenStore();
      expect(await store.read(), isNull);
    });

    test('write then read round-trips the token', () async {
      final store = InMemoryRefreshTokenStore();
      await store.write('refresh-abc');
      expect(await store.read(), 'refresh-abc');
    });

    test('write overwrites any previous token', () async {
      final store = InMemoryRefreshTokenStore('old');
      await store.write('new');
      expect(await store.read(), 'new');
    });

    test('delete clears the stored token', () async {
      final store = InMemoryRefreshTokenStore('refresh-abc');
      await store.delete();
      expect(await store.read(), isNull);
    });
  });
}
