import 'package:flutter_test/flutter_test.dart';
import 'package:worker_flutter/worker/worker_presence.dart';

import 'fake_sim_api.dart';

/// Tests for WorkerPresence: when it writes the `presence/{workerId}` entry
/// the web UI lists online workers from, and what the entry says.
void main() {
  late FakePresenceSink sink;
  late WorkerPresence presence;

  setUp(() {
    sink = FakePresenceSink();
    presence = WorkerPresence(
      sink: sink,
      workerName: 'macbook',
      capacity: 4,
      tickInterval: const Duration(milliseconds: 100), // fast for tests
    );
  });

  tearDown(() async {
    await presence.stop();
  });

  Future<void> settle() =>
      Future<void>.delayed(const Duration(milliseconds: 20));

  test(
    'on connect, arms the server-side delete and writes the entry',
    () async {
      await presence.start();
      expect(sink.writes, isEmpty, reason: 'nothing until connected');

      sink.connectedController.add(true);
      await settle();

      expect(sink.disconnectArms, 1);
      expect(sink.writes.single, {
        'workerName': 'macbook',
        'workerType': 'flutter',
        'status': 'idle',
        'capacity': 4,
        'activeSimulations': 0,
        'uptimeMs': isA<int>(),
      });
    },
  );

  test('a reconnect re-arms the delete and rewrites the entry', () async {
    await presence.start();
    sink.connectedController
      ..add(true)
      ..add(false)
      ..add(true);
    await settle();

    expect(sink.disconnectArms, 2);
    expect(sink.writes, hasLength(2));
  });

  test('ticks advertise running sims and capacity changes', () async {
    await presence.start();
    presence
      ..activeSimulations = 2
      ..capacity = 6;
    await Future<void>.delayed(const Duration(milliseconds: 150));

    final last = sink.writes.last;
    expect(last['status'], 'busy');
    expect(last['activeSimulations'], 2);
    expect(last['capacity'], 6);
  });

  test('stop() removes the entry and stops writing', () async {
    await presence.start();
    await presence.stop();
    final writes = sink.writes.length;
    await Future<void>.delayed(const Duration(milliseconds: 150));

    expect(sink.removes, 1);
    expect(sink.writes.length, writes);
  });

  test('a failed write is retried on the next tick', () async {
    final failing = _FailOnceSink();
    final p = WorkerPresence(
      sink: failing,
      workerName: 'pc',
      capacity: 1,
      tickInterval: const Duration(milliseconds: 50),
    );
    await p.start();
    await Future<void>.delayed(const Duration(milliseconds: 130));
    await p.stop();

    expect(failing.attempts, greaterThanOrEqualTo(2));
    expect(failing.writes, isNotEmpty);
  });
}

class _FailOnceSink extends FakePresenceSink {
  int attempts = 0;

  @override
  Future<void> write(Map<String, Object?> fields) async {
    attempts++;
    if (attempts == 1) throw StateError('offline');
    await super.write(fields);
  }
}
