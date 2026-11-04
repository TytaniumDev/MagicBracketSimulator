import 'dart:async';

/// A [TimeoutException] for a request that ran out of time because the
/// computer slept while it waited.
///
/// Dart's timers count only time the computer is awake, so a request that
/// starts right before a sleep times out a few seconds after the computer
/// wakes, many minutes later by the wall clock. That is expected, not an
/// API or network fault, so `Telemetry.captureError` leaves it out of
/// Sentry; callers still log it and retry as for any failed request.
class SleptDuringRequestException extends TimeoutException {
  SleptDuringRequestException(Duration limit, this.wallClock)
    : super(
        'Request timed out after the computer slept '
        '(${wallClock.inSeconds} s by the wall clock)',
        limit,
      );

  /// How long the request waited by the wall clock, sleep included.
  final Duration wallClock;
}

extension SleepAwareTimeout<T> on Future<T> {
  /// [Future.timeout], except that a timeout spanning a sleep throws
  /// [SleptDuringRequestException]. A sleep is assumed when the wall clock
  /// moved at least twice [limit] before the timer fired.
  Future<T> timeoutAcrossSleep(
    Duration limit, {
    DateTime Function() now = DateTime.now,
  }) async {
    final started = now();
    try {
      return await timeout(limit);
    } on TimeoutException {
      final wallClock = now().difference(started);
      if (wallClock >= limit * 2) {
        throw SleptDuringRequestException(limit, wallClock);
      }
      rethrow;
    }
  }
}
