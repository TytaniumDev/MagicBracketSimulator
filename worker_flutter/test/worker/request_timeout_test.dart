import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:worker_flutter/worker/request_timeout.dart';

void main() {
  const limit = Duration(milliseconds: 20);

  /// A clock that jumps [jump] between the first and second reading, the
  /// way the wall clock does across a sleep.
  DateTime Function() clockJumping(Duration jump) {
    final start = DateTime(2026, 11, 4);
    var reads = 0;
    return () => reads++ == 0 ? start : start.add(jump);
  }

  test('passes the value through when the request is in time', () async {
    expect(await Future.value(7).timeoutAcrossSleep(limit), 7);
  });

  test('a plain timeout stays a TimeoutException', () async {
    final never = Completer<void>().future;
    await expectLater(
      never.timeoutAcrossSleep(limit, now: clockJumping(limit)),
      throwsA(
        isA<TimeoutException>().having(
          (e) => e is SleptDuringRequestException,
          'slept',
          isFalse,
        ),
      ),
    );
  });

  test('a timeout that spanned a sleep says so', () async {
    final never = Completer<void>().future;
    await expectLater(
      never.timeoutAcrossSleep(
        limit,
        now: clockJumping(const Duration(minutes: 17)),
      ),
      throwsA(
        isA<SleptDuringRequestException>().having(
          (e) => e.wallClock,
          'wallClock',
          const Duration(minutes: 17),
        ),
      ),
    );
  });
}
