import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Persists the Google OAuth refresh token used to silently re-sign-in
/// across launches.
///
/// Abstracted from `flutter_secure_storage` so tests can supply an
/// in-memory implementation without touching the platform keychain.
/// Refresh tokens are bearer credentials — anyone with the value can
/// impersonate the user against the granted scopes until revoked — so
/// the production implementation MUST use the OS keychain
/// (Keychain on macOS, DPAPI on Windows, libsecret on Linux).
abstract class RefreshTokenStore {
  Future<String?> read();
  Future<void> write(String token);
  Future<void> delete();
}

/// Production `RefreshTokenStore` backed by `flutter_secure_storage`.
///
/// All entries live under a single key in a worker-scoped namespace so
/// they don't collide with anything else the app might persist later.
class SecureRefreshTokenStore implements RefreshTokenStore {
  SecureRefreshTokenStore({FlutterSecureStorage? storage})
    : _storage = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _storage;

  static const _key = 'magic_bracket.google_refresh_token';

  @override
  Future<String?> read() => _storage.read(key: _key);

  @override
  Future<void> write(String token) => _storage.write(key: _key, value: token);

  @override
  Future<void> delete() => _storage.delete(key: _key);
}

/// In-memory `RefreshTokenStore` for unit tests. Not thread-safe; that's
/// fine for `flutter_test` which runs single-threaded.
class InMemoryRefreshTokenStore implements RefreshTokenStore {
  InMemoryRefreshTokenStore([this._token]);

  String? _token;

  @override
  Future<String?> read() async => _token;

  @override
  Future<void> write(String token) async => _token = token;

  @override
  Future<void> delete() async => _token = null;
}
