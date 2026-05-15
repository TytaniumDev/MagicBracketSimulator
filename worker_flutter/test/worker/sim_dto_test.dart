import 'package:flutter_test/flutter_test.dart';
import 'package:worker_flutter/models/sim.dart';

void main() {
  group('SimDoc.compositeId', () {
    test('joins jobId and simId with a colon', () {
      final sim = SimDoc(
        simId: 'sim_001',
        jobId: 'job_abc',
        index: 0,
        state: 'RUNNING',
      );
      expect(sim.compositeId, 'job_abc:sim_001');
    });

    test('round-trips through Plan 1 sweep parsing (jobId:simId split)', () {
      final sim = SimDoc(
        simId: 'sim_001',
        jobId: 'job_abc',
        index: 0,
        state: 'RUNNING',
      );
      final composite = sim.compositeId;
      final parts = composite.split(':');
      expect(parts.length, 2);
      expect(parts[0], sim.jobId);
      expect(parts[1], sim.simId);
    });
  });
}
