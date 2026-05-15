import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:worker_flutter/worker/lease_writer.dart';

/// Tests for the LeaseWriter: verifies the heartbeat doc contents match what
/// the backend lease-sweep expects (see api/lib/lease-sweep.ts in Plan 1).
void main() {
  group('LeaseWriter', () {
    late FakeFirebaseFirestore firestore;
    late LeaseWriter writer;

    setUp(() {
      firestore = FakeFirebaseFirestore();
      writer = LeaseWriter(
        firestore: firestore,
        workerId: 'w1',
        workerName: 'macbook',
        capacity: 4,
        tickInterval: const Duration(milliseconds: 100), // fast for tests
        leaseTtl: const Duration(seconds: 15),
      );
    });

    tearDown(() async {
      await writer.stop();
    });

    test('start() writes initial lease and worker fields', () async {
      await writer.start();
      // Wait briefly for the initial write to complete.
      await Future<void>.delayed(const Duration(milliseconds: 50));

      final doc = await firestore.collection('workers').doc('w1').get();
      expect(doc.exists, true);
      final data = doc.data()!;
      expect(data['workerName'], 'macbook');
      expect(data['workerType'], 'flutter');
      expect(data['status'], 'idle');
      expect(data['capacity'], 4);
      expect(data['activeSimulations'], 0);
      expect(data['lease'], isA<Map<String, dynamic>>());
      final lease = data['lease'] as Map<String, dynamic>;
      expect(lease.containsKey('expiresAt'), true);
      expect(lease['activeSimIds'], isEmpty);
    });

    test('setActive updates the activeSimIds on next tick', () async {
      await writer.start();
      await Future<void>.delayed(const Duration(milliseconds: 50));

      writer.setActive(['job1:sim1', 'job1:sim2']);
      // Wait for at least one tick.
      await Future<void>.delayed(const Duration(milliseconds: 150));

      final doc = await firestore.collection('workers').doc('w1').get();
      final data = doc.data()!;
      final lease = data['lease'] as Map<String, dynamic>;
      final ids = (lease['activeSimIds'] as List).cast<String>();
      expect(ids, containsAll(['job1:sim1', 'job1:sim2']));
      expect(data['status'], 'busy');
      expect(data['activeSimulations'], 2);
    });

    test('stop() clears the lease so sweep wont touch us', () async {
      await writer.start();
      writer.setActive(['job1:sim1']);
      await Future<void>.delayed(const Duration(milliseconds: 150));
      await writer.stop();

      final doc = await firestore.collection('workers').doc('w1').get();
      final data = doc.data()!;
      // The lease field is deleted via FieldValue.delete(); fake firestore
      // represents this as the field being absent from the resulting doc.
      expect(data.containsKey('lease'), false);
      expect(data['status'], 'idle');
      expect(data['activeSimulations'], 0);
    });

    test('lease.expiresAt is in the future relative to write time', () async {
      await writer.start();
      await Future<void>.delayed(const Duration(milliseconds: 50));

      final doc = await firestore.collection('workers').doc('w1').get();
      final lease = doc.data()!['lease'] as Map<String, dynamic>;
      final expiresAt = DateTime.parse(lease['expiresAt'] as String);
      expect(expiresAt.isAfter(DateTime.now().toUtc()), true,
          reason: 'lease should not be already-expired immediately after write');
    });
  });
}
