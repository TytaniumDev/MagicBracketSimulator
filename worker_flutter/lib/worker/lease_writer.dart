import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';

/// Writes lease + heartbeat fields to `workers/{workerId}` every 5s.
///
/// The backend lease sweep (api/lib/lease-sweep.ts, Plan 1) queries
/// `where('lease.expiresAt', '<', now)` and reverts any RUNNING sims whose
/// owning worker is past expiry. By refreshing every 5s with a 15s TTL we
/// keep the lease fresh while alive, and let crash detection happen within
/// ~27s of worker disappearance (15s lease + ~12s sweep cadence).
///
/// The `activeSimIds` field is `${jobId}:${simId}` composite strings — the
/// sweep parses these to know exactly which sims to revert. Callers (the
/// worker engine) push updates to this writer whenever the active set
/// changes — the writer holds the latest set and writes it on each tick.
class LeaseWriter {
  LeaseWriter({
    required this.firestore,
    required this.workerId,
    required this.workerName,
    required this.capacity,
    this.tickInterval = const Duration(seconds: 5),
    this.leaseTtl = const Duration(seconds: 15),
  });

  final FirebaseFirestore firestore;
  final String workerId;
  final String workerName;
  final int capacity;
  final Duration tickInterval;
  final Duration leaseTtl;

  Timer? _timer;
  final Set<String> _activeCompositeIds = <String>{};
  int _uptimeMsAtStart = 0;
  DateTime? _startTime;

  /// Update the active sim set. The writer holds the latest set and
  /// publishes it on the next tick — callers don't need to debounce.
  void setActive(Iterable<String> compositeIds) {
    _activeCompositeIds
      ..clear()
      ..addAll(compositeIds);
  }

  /// Start the periodic writer. Writes an initial "I'm alive" doc
  /// immediately, then every `tickInterval` until [stop] is called.
  Future<void> start() async {
    _startTime = DateTime.now();
    _uptimeMsAtStart = 0;
    await _writeOnce(status: 'idle');
    _timer = Timer.periodic(tickInterval, (_) => _writeOnce(status: _activeStatus()));
  }

  Future<void> stop() async {
    _timer?.cancel();
    _timer = null;
    // Best-effort: clear our lease so the sweep won't try to revert anything.
    try {
      await firestore.collection('workers').doc(workerId).set({
        'lease': FieldValue.delete(),
        'status': 'idle',
        'activeSimulations': 0,
      }, SetOptions(merge: true));
    } catch (_) {/* graceful shutdown */}
  }

  String _activeStatus() => _activeCompositeIds.isEmpty ? 'idle' : 'busy';

  Future<void> _writeOnce({required String status}) async {
    final now = DateTime.now();
    final expiresAt = now.add(leaseTtl);
    final uptimeMs = _startTime == null
        ? _uptimeMsAtStart
        : now.difference(_startTime!).inMilliseconds + _uptimeMsAtStart;

    try {
      await firestore.collection('workers').doc(workerId).set({
        'workerName': workerName,
        'workerType': 'flutter',
        'status': status,
        'capacity': capacity,
        'activeSimulations': _activeCompositeIds.length,
        'uptimeMs': uptimeMs,
        'lastHeartbeat': now.toUtc().toIso8601String(),
        'lease': {
          'expiresAt': expiresAt.toUtc().toIso8601String(),
          'activeSimIds': _activeCompositeIds.toList(growable: false),
        },
      }, SetOptions(merge: true));
    } catch (e) {
      // Network errors are expected occasionally — the next tick retries.
      // Don't bubble up; LeaseWriter must keep running.
    }
  }
}
