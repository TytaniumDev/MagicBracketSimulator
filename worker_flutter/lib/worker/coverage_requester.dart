import 'dart:async';

import '../api_client.dart';
import '../app_log.dart';
import '../telemetry.dart';

/// Asks the API for an auto-coverage job when the worker runs out of work.
///
/// `POST /api/coverage/next-job` creates the next pod of decks that still
/// needs games, or answers `{reason}` when there is nothing to do (coverage
/// is disabled, a coverage job is already running, every pair is covered).
/// The API allows one coverage job at a time, so many idle workers asking
/// at once still create only one job.
///
/// Each ask costs the API several Firestore reads, so [maybeRequest] asks at
/// most once per [minInterval]. The only exception is right after an ask
/// that created a job: the next ask goes through at once, so a worker that
/// finishes a coverage job can line up the next one.
class CoverageRequester {
  CoverageRequester({
    required ApiClient api,
    this.minInterval = const Duration(minutes: 5),
    DateTime Function()? now,
  }) : _api = api,
       _now = now ?? DateTime.now;

  final ApiClient _api;
  final Duration minInterval;
  final DateTime Function() _now;

  DateTime? _lastAsk;
  bool _lastAskCreatedJob = false;
  String? _lastReason;

  static const _timeout = Duration(seconds: 30);

  /// Ask for a coverage job unless the last ask was under [minInterval] ago
  /// and created nothing. Returns true when the API created a job, so the
  /// caller can claim its sims right away. Never throws: a failed ask is
  /// logged, sent to Sentry, and retried after [minInterval].
  Future<bool> maybeRequest() async {
    final now = _now();
    final last = _lastAsk;
    if (last != null &&
        !_lastAskCreatedJob &&
        now.difference(last) < minInterval) {
      return false;
    }
    _lastAsk = now;
    _lastAskCreatedJob = false;

    final Map<String, dynamic> body;
    try {
      body = await _api
          .postJson('/api/coverage/next-job', const {})
          .timeout(_timeout);
    } catch (e, st) {
      AppLog.event(
        TelemetryCategory.engineRuntime,
        'coverage: request failed: $e',
      );
      await Telemetry.captureError(
        e,
        st,
        category: TelemetryCategory.engineRuntime,
        extra: {'phase': 'coverage_request'},
      );
      return false;
    }

    final jobId = body['id'];
    if (jobId is String) {
      AppLog.event(
        TelemetryCategory.engineRuntime,
        'coverage: created job',
        data: {'jobId': jobId},
      );
      _lastAskCreatedJob = true;
      _lastReason = null;
      return true;
    }

    // Log the reason only when it changes, so an idle worker doesn't
    // repeat "all-pairs-covered" every few minutes.
    final reason = body['reason']?.toString();
    if (reason != _lastReason) {
      AppLog.event(
        TelemetryCategory.engineRuntime,
        'coverage: no job',
        data: {'reason': reason ?? 'unknown'},
      );
      _lastReason = reason;
    }
    return false;
  }
}
