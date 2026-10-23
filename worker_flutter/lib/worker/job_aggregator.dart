import 'dart:async';

import '../api_client.dart';
import '../app_log.dart';
import '../telemetry.dart';

/// Calls `POST /api/jobs/:id/aggregate-if-done` after a sim's
/// terminal write so the API runs `aggregateJobResults` immediately
/// instead of waiting for the 15-min stale-sweeper.
///
/// Auth rides on [ApiClient], same as `LogUploader`.
///
/// Failures are non-fatal: the terminal sim state is already in
/// Firestore by the time this fires, and the stale-sweeper picks up
/// any jobs whose fast-path call missed.
class JobAggregator {
  JobAggregator({required ApiClient api}) : _api = api;

  final ApiClient _api;

  Future<void> triggerIfDone(String jobId) async {
    try {
      await _api
          .postJson('/api/jobs/$jobId/aggregate-if-done', const {})
          .timeout(const Duration(seconds: 15));
      AppLog.event(
        TelemetryCategory.engineRuntime,
        'JobAggregator: triggered for $jobId',
      );
    } catch (e) {
      AppLog.event(
        TelemetryCategory.engineRuntime,
        'JobAggregator: trigger failed for $jobId: $e',
      );
    }
  }
}
