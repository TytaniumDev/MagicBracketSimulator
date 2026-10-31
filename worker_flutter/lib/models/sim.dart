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

  /// Key for a running sim inside the worker engine.
  /// Format: `${jobId}:${simId}`.
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
    required this.gamesPerSim,
  });

  final String jobId;
  final List<String> deckFilenames; // 4 .dck filenames

  /// Games one sim plays in a single Forge run (`-n`). The API sizes a
  /// job's sims by this, so running fewer leaves the job short of games.
  final int gamesPerSim;
}
