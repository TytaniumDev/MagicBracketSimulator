import 'package:flutter_test/flutter_test.dart';
import 'package:worker_flutter/worker/sim_api.dart';
import 'package:worker_flutter/worker/sim_lease_keeper.dart';

void main() {
  group('SimLeaseKeeper', () {
    const interval = Duration(milliseconds: 20);

    test('keeps extending while the API says extended', () async {
      var extends_ = 0;
      final ended = <SimLeaseStatus>[];
      final keeper = SimLeaseKeeper(
        extend: () async {
          extends_++;
          return SimLeaseStatus.extended;
        },
        onEnd: ended.add,
        interval: interval,
      )..start();
      await Future<void>.delayed(const Duration(milliseconds: 110));
      keeper.stop();

      expect(extends_, greaterThanOrEqualTo(3));
      expect(ended, isEmpty);
    });

    for (final status in [SimLeaseStatus.cancelled, SimLeaseStatus.lost]) {
      test(
        'stops and calls onEnd once when the lease is ${status.name}',
        () async {
          var extends_ = 0;
          final ended = <SimLeaseStatus>[];
          SimLeaseKeeper(
            extend: () async {
              extends_++;
              return status;
            },
            onEnd: ended.add,
            interval: interval,
          ).start();
          await Future<void>.delayed(const Duration(milliseconds: 110));

          expect(ended, [status]);
          expect(extends_, 1);
        },
      );
    }

    test('a failed extension is retried on the next tick', () async {
      var calls = 0;
      final ended = <SimLeaseStatus>[];
      SimLeaseKeeper(
        extend: () async {
          calls++;
          if (calls == 1) throw StateError('offline');
          return SimLeaseStatus.lost;
        },
        onEnd: ended.add,
        interval: interval,
      ).start();
      await Future<void>.delayed(const Duration(milliseconds: 110));

      expect(calls, 2);
      expect(ended, [SimLeaseStatus.lost]);
    });

    test('stop() before a tick means no extension', () async {
      var calls = 0;
      SimLeaseKeeper(
          extend: () async {
            calls++;
            return SimLeaseStatus.extended;
          },
          onEnd: (_) {},
          interval: interval,
        )
        ..start()
        ..stop();
      await Future<void>.delayed(const Duration(milliseconds: 60));
      expect(calls, 0);
    });
  });
}
