import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:worker_flutter/worker/heartbeat_writer.dart';

/// Tests for the HeartbeatWriter: the `workers/{id}` doc the web UI reads
/// to list online workers.
void main() {
  group('HeartbeatWriter', () {
    late FakeFirebaseFirestore firestore;
    late HeartbeatWriter writer;

    setUp(() {
      firestore = FakeFirebaseFirestore();
      writer = HeartbeatWriter(
        firestore: firestore,
        workerId: 'w1',
        workerName: 'macbook',
        capacity: 4,
        tickInterval: const Duration(milliseconds: 100), // fast for tests
      );
    });

    tearDown(() async {
      await writer.stop();
    });

    test('start() writes the worker fields and no lease', () async {
      await firestore.collection('workers').doc('w1').set({
        'lease': {'expiresAt': '2020-01-01T00:00:00.000Z'},
      });

      await writer.start();

      final data = (await firestore.collection('workers').doc('w1').get())
          .data()!;
      expect(data['workerName'], 'macbook');
      expect(data['workerType'], 'flutter');
      expect(data['status'], 'idle');
      expect(data['capacity'], 4);
      expect(data['activeSimulations'], 0);
      expect(DateTime.parse(data['lastHeartbeat'] as String), isNotNull);
      expect(
        data.containsKey('lease'),
        false,
        reason: 'a lease left by an older build is cleared',
      );
    });

    test('activeSimulations shows up as busy on the next tick', () async {
      await writer.start();

      writer.activeSimulations = 2;
      await Future<void>.delayed(const Duration(milliseconds: 150));

      final data = (await firestore.collection('workers').doc('w1').get())
          .data()!;
      expect(data['status'], 'busy');
      expect(data['activeSimulations'], 2);
    });

    test('stop() marks the worker idle', () async {
      await writer.start();
      writer.activeSimulations = 1;
      await Future<void>.delayed(const Duration(milliseconds: 150));
      await writer.stop();

      final data = (await firestore.collection('workers').doc('w1').get())
          .data()!;
      expect(data['status'], 'idle');
      expect(data['activeSimulations'], 0);
    });
  });
}
