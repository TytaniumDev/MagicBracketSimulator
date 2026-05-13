/// Minimal DTO for a simulation document as stored in Firestore.
///
/// Mirrors the relevant fields from `api/lib/types.ts` SimulationStatus.
/// Only fields the worker reads or writes appear here.
class SimDoc {
  SimDoc({
    required this.simId,
    required this.jobId,
    required this.index,
    required this.state,
    this.workerId,
    this.workerName,
  });

  final String simId;
  final String jobId;
  final int index;
  final String state; // PENDING | RUNNING | COMPLETED | FAILED | CANCELLED
  final String? workerId;
  final String? workerName;

  /// Composite ID used inside the worker's `lease.activeSimIds` array.
  /// Format: `${jobId}:${simId}`. Used by the lease sweep on the backend.
  String get compositeId => '$jobId:$simId';

  Map<String, dynamic> toJson() => {
        'simId': simId,
        'jobId': jobId,
        'index': index,
        'state': state,
        if (workerId != null) 'workerId': workerId,
        if (workerName != null) 'workerName': workerName,
      };
}

/// Result of running a single simulation (output from sim_runner).
class SimResult {
  SimResult({
    required this.success,
    required this.durationMs,
    required this.winners,
    required this.winningTurns,
    required this.logText,
    this.errorMessage,
  });

  final bool success;
  final int durationMs;
  final List<String> winners;
  final List<int> winningTurns;
  final String logText;
  final String? errorMessage;
}

/// Job-level metadata the worker needs in order to run a sim.
class JobInfo {
  JobInfo({
    required this.jobId,
    required this.deckFilenames,
    required this.simulationsPerJob,
  });

  final String jobId;
  final List<String> deckFilenames; // 4 .dck filenames
  final int simulationsPerJob;
}
