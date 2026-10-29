import 'dart:async';

import '../api_client.dart';
import '../models/sim.dart';

/// Result of a claim attempt.
sealed class ClaimResult {}

class ClaimSucceeded extends ClaimResult {
  ClaimSucceeded(this.sim);
  final SimDoc sim;
}

class ClaimNoneAvailable extends ClaimResult {}

/// What the API reports when a running sim's lease is extended. Mirrors
/// `SimLeaseStatus` in `api/lib/sim-lease.ts`.
enum SimLeaseStatus {
  /// The lease was pushed back; keep running.
  extended,

  /// The sim's job was cancelled; stop the sim.
  cancelled,

  /// The sim is no longer ours (another worker took it over after our lease
  /// ran out); stop without reporting a result.
  lost,
}

/// The desktop worker's side of the sim lifecycle, all through the API
/// (the same endpoints the Docker worker uses in `worker/src/worker.ts`):
///
///   - [claim]: `GET /api/jobs/claim-sim?lease=1` flips the next PENDING sim
///     to RUNNING for this worker and reserves it with a 3-minute lease.
///   - [extendLease]: `POST /api/jobs/:id/simulations/:simId/lease`, about
///     once a minute while the sim runs (see `SimLeaseKeeper`). If the
///     worker dies, the lease runs out and another worker takes the sim.
///   - [reportResult] / [reportCancelled]: `PATCH
///     /api/jobs/:id/simulations/:simId`. The API counts finished sims and
///     aggregates the job when the last one lands.
///
/// Every request carries [workerId], so the API drops a report for a sim
/// that another worker has since taken over.
class SimApi {
  SimApi({
    required ApiClient api,
    required this.workerId,
    required this.workerName,
  }) : _api = api;

  final ApiClient _api;
  final String workerId;
  final String workerName;

  static const _timeout = Duration(seconds: 30);

  /// Claim the next PENDING sim. Throws [ApiException] when the request
  /// fails; the caller retries on the next trigger.
  Future<ClaimResult> claim() async {
    final query = Uri(
      queryParameters: {
        'workerId': workerId,
        'workerName': workerName,
        'lease': '1',
      },
    ).query;
    final body = await _api
        .getJson('/api/jobs/claim-sim?$query')
        .timeout(_timeout);
    // 204 (no work) decodes to an empty map.
    final jobId = body['jobId'];
    final simId = body['simId'];
    if (jobId is! String || simId is! String) return ClaimNoneAvailable();
    return ClaimSucceeded(
      SimDoc(
        simId: simId,
        jobId: jobId,
        index: (body['simIndex'] as num?)?.toInt() ?? 0,
        state: 'RUNNING',
        workerId: workerId,
        workerName: workerName,
      ),
    );
  }

  /// Extend [sim]'s lease. Throws when the request fails; the caller
  /// retries on its next tick.
  Future<SimLeaseStatus> extendLease(SimDoc sim) async {
    final body = await _api
        .postJson('/api/jobs/${sim.jobId}/simulations/${sim.simId}/lease', {
          'workerId': workerId,
        })
        .timeout(_timeout);
    return switch (body['status']) {
      'extended' => SimLeaseStatus.extended,
      'cancelled' => SimLeaseStatus.cancelled,
      _ => SimLeaseStatus.lost,
    };
  }

  /// Report a finished run: COMPLETED with its winners, or FAILED with its
  /// error. A FAILED sim is retried by the API's stale-job recovery.
  Future<void> reportResult(SimDoc sim, SimResult result) {
    return _patch(sim, {
      'state': result.success ? 'COMPLETED' : 'FAILED',
      'durationMs': result.durationMs,
      if (result.winners.isNotEmpty) 'winners': result.winners,
      if (result.winningTurns.isNotEmpty) 'winningTurns': result.winningTurns,
      'errorMessage': ?result.errorMessage,
    });
  }

  /// Report that [sim] stopped because its job was cancelled.
  Future<void> reportCancelled(SimDoc sim, {int? durationMs}) {
    return _patch(sim, {'state': 'CANCELLED', 'durationMs': ?durationMs});
  }

  Future<void> _patch(SimDoc sim, Map<String, dynamic> update) async {
    await _api
        .patchJson('/api/jobs/${sim.jobId}/simulations/${sim.simId}', {
          'workerId': workerId,
          ...update,
        })
        .timeout(_timeout);
  }
}
