import 'dart:convert';

import 'package:firebase_auth_mocks/firebase_auth_mocks.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:worker_flutter/api_client.dart';
import 'package:worker_flutter/worker/access_check.dart';

/// `AccessCheck` asks `GET /api/me` whether the account is approved, which
/// also makes the API write `approved/{uid}` before the first presence
/// write. It must never throw into engine start.
void main() {
  late List<http.Request> requests;
  late http.Response Function() respond;

  AccessCheck check() => AccessCheck(
    api: ApiClient(
      baseUrl: 'https://api.example.com',
      client: MockClient((req) async {
        requests.add(req);
        return respond();
      }),
      auth: MockFirebaseAuth(
        signedIn: true,
        mockUser: MockUser(uid: 'u1', email: 'u1@example.com'),
      ),
      appCheckTokenProvider: ({bool forceRefresh = false}) async => null,
    ),
  );

  setUp(() {
    requests = [];
    respond = () => http.Response(json.encode({'isAllowed': true}), 200);
  });

  test('an approved account is allowed', () async {
    expect(await check().run(), AccessStatus.allowed);

    final req = requests.single;
    expect(req.method, 'GET');
    expect(req.url.toString(), 'https://api.example.com/api/me');
    expect(req.headers['Authorization'], startsWith('Bearer '));
  });

  test('an account waiting for approval is not approved', () async {
    respond = () => http.Response(json.encode({'isAllowed': false}), 200);
    expect(await check().run(), AccessStatus.notApproved);
  });

  test('a failed call is unknown and does not throw', () async {
    respond = () => http.Response(json.encode({'error': 'boom'}), 500);
    expect(await check().run(), AccessStatus.unknown);
  });
}
