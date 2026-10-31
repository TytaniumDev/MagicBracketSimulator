import 'dart:convert';
import 'dart:io';

import 'package:firebase_auth_mocks/firebase_auth_mocks.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:worker_flutter/api_client.dart';
import 'package:worker_flutter/worker/job_loader.dart';

const _decks = [
  {'name': 'Alpha One', 'dck': '[Main]\n1 Alpha\n'},
  {'name': 'Beta', 'dck': '[Main]\n1 Beta\n'},
  {'name': 'Gamma', 'dck': '[Main]\n1 Gamma\n'},
  {'name': 'Delta', 'dck': '[Main]\n1 Delta\n'},
];

void main() {
  late Directory decksDir;
  late List<String> requests;
  late http.Response Function() respond;

  JobLoader loader({int cacheSize = 8}) => JobLoader(
    api: ApiClient(
      baseUrl: 'https://api.test',
      client: MockClient((req) async {
        requests.add(req.url.toString());
        return respond();
      }),
      auth: MockFirebaseAuth(
        signedIn: true,
        mockUser: MockUser(uid: 'u1', email: 'u1@example.com'),
      ),
      appCheckTokenProvider: ({bool forceRefresh = false}) async => null,
    ),
    decksPath: decksDir.path,
    cacheSize: cacheSize,
  );

  http.Response ok({List<Map<String, String>> decks = _decks}) =>
      http.Response(json.encode({'gamesPerSim': 4, 'decks': decks}), 200);

  setUp(() {
    decksDir = Directory.systemTemp.createTempSync('job_loader_test');
    requests = [];
    respond = ok;
  });

  tearDown(() => decksDir.deleteSync(recursive: true));

  test('asks for the worker view and writes each deck to disk', () async {
    final job = await loader().load('job-1');

    expect(requests, ['https://api.test/api/jobs/job-1?view=worker']);
    expect(job!.jobId, 'job-1');
    expect(job.gamesPerSim, 4);
    expect(job.deckFilenames, [
      'Alpha_One.dck',
      'Beta.dck',
      'Gamma.dck',
      'Delta.dck',
    ]);
    expect(
      File('${decksDir.path}/Alpha_One.dck').readAsStringSync(),
      '[Main]\n1 Alpha\n',
    );
  });

  test('fetches a job once but rewrites its decks on every load', () async {
    final jobs = loader();
    await jobs.load('job-1');
    final deck = File('${decksDir.path}/Beta.dck')
      ..writeAsStringSync('another job wrote this');

    await jobs.load('job-1');

    expect(requests, hasLength(1));
    expect(deck.readAsStringSync(), '[Main]\n1 Beta\n');
  });

  test('forgets the least recently used job past the cache size', () async {
    final jobs = loader(cacheSize: 2);
    await jobs.load('a');
    await jobs.load('b');
    await jobs.load('a'); // a is now the most recent
    await jobs.load('c'); // evicts b
    await jobs.load('a');
    await jobs.load('b');

    expect(requests.map((u) => Uri.parse(u).pathSegments.last), [
      'a',
      'b',
      'c',
      'b',
    ]);
  });

  test('returns null when the job is gone', () async {
    respond = () => http.Response(json.encode({'error': 'Job not found'}), 404);

    expect(await loader().load('job-1'), isNull);
  });

  test('throws on other errors and retries on the next load', () async {
    final jobs = loader();
    respond = () => http.Response(json.encode({'error': 'boom'}), 500);
    await expectLater(jobs.load('job-1'), throwsA(isA<ApiException>()));

    respond = ok;
    final job = await jobs.load('job-1');

    expect(job!.deckFilenames, hasLength(4));
    expect(requests, hasLength(2));
  });

  test('writes no decks when the API could not resolve them', () async {
    respond = () => http.Response(json.encode({'gamesPerSim': 4}), 200);

    final job = await loader().load('job-1');

    expect(job!.deckFilenames, isEmpty);
  });

  test('throws when the worker view has no games per sim', () async {
    respond = () => http.Response(json.encode({'decks': _decks}), 200);

    await expectLater(
      loader().load('job-1'),
      throwsA(isA<FormatException>()),
    );
  });
}
