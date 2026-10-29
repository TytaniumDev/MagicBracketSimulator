import 'dart:async';

import '../api_client.dart';
import '../app_log.dart';
import '../telemetry.dart';

/// Posts a single simulation's raw stdout log to the cloud API.
///
/// Mirrors `worker/src/worker.ts` `uploadSingleSimulationLog`. Filename
/// shape is the same so the frontend's per-sim log links work identically
/// for cloud-mode Flutter workers as they do for the Docker worker.
///
/// Auth rides on [ApiClient]: the signed-in user's Firebase ID token,
/// which the API accepts for users who have been given access.
///
/// Runs before the sim's result is reported, because reporting a job's
/// last sim starts aggregation, which reads the uploaded logs. Failures are
/// non-fatal: the result is still reported, and a missed log only drops
/// that sim's games from the job's log-derived stats.
class LogUploader {
  LogUploader({required ApiClient api}) : _api = api;

  final ApiClient _api;

  /// Upload the log for one sim. `simIndex` is 0-based and matches the
  /// `Sims.index` field in Firestore.
  Future<void> upload({
    required String jobId,
    required int simIndex,
    required String logText,
  }) async {
    final filename =
        'raw/game_${(simIndex + 1).toString().padLeft(3, '0')}.txt';

    try {
      await _api
          .postJson('/api/jobs/$jobId/logs/simulation', {
            'filename': filename,
            'logText': logText,
          })
          .timeout(const Duration(seconds: 30));
      AppLog.event(
        TelemetryCategory.engineRuntime,
        'LogUploader: sim_$simIndex log uploaded '
        '(${(logText.length / 1024).toStringAsFixed(1)} KB)',
      );
    } catch (e) {
      AppLog.event(
        TelemetryCategory.engineRuntime,
        'LogUploader: sim_$simIndex upload failed: $e',
      );
    }
  }
}
