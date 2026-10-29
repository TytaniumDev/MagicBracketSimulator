import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';

import '../app_log.dart';
import '../telemetry.dart';

/// Writes this worker's status to `workers/{workerId}` every 30s so the web
/// UI can list it as online.
///
/// Only for display: crash recovery no longer reads it. Each running sim
/// holds its own lease through the API (see `SimLeaseKeeper`), so a dead
/// worker's sims are taken over when their leases run out.
class HeartbeatWriter {
  HeartbeatWriter({
    required this.firestore,
    required this.workerId,
    required this.workerName,
    required this.capacity,
    this.tickInterval = const Duration(seconds: 30),
  });

  final FirebaseFirestore firestore;
  final String workerId;
  final String workerName;

  /// Advertised on each tick; mutable so a live capacity change shows up
  /// on the next heartbeat.
  int capacity;
  final Duration tickInterval;

  /// Number of sims running now; written on the next tick.
  int activeSimulations = 0;

  Timer? _timer;
  DateTime? _startTime;

  /// Write an initial heartbeat now, then every [tickInterval] until [stop].
  /// A failed write is logged; the next tick retries.
  Future<void> start() async {
    _startTime = DateTime.now();
    await _writeOnce();
    _timer = Timer.periodic(tickInterval, (_) => _writeOnce());
  }

  Future<void> stop() async {
    _timer?.cancel();
    _timer = null;
    try {
      await firestore.collection('workers').doc(workerId).set({
        'status': 'idle',
        'activeSimulations': 0,
      }, SetOptions(merge: true));
    } catch (e) {
      // Benign during shutdown; logged so a broken connection is visible.
      AppLog.event(
        TelemetryCategory.engineRuntime,
        'HeartbeatWriter.stop() failed: $e',
      );
    }
  }

  Future<void> _writeOnce() async {
    final now = DateTime.now();
    final uptimeMs = _startTime == null
        ? 0
        : now.difference(_startTime!).inMilliseconds;
    try {
      await firestore.collection('workers').doc(workerId).set({
        'workerName': workerName,
        'workerType': 'flutter',
        'status': activeSimulations == 0 ? 'idle' : 'busy',
        'capacity': capacity,
        'activeSimulations': activeSimulations,
        'uptimeMs': uptimeMs,
        'lastHeartbeat': now.toUtc().toIso8601String(),
        // Older builds wrote a `lease` here for the retired lease sweep.
        'lease': FieldValue.delete(),
      }, SetOptions(merge: true));
    } catch (e) {
      // Network errors are expected occasionally; the next tick retries.
      AppLog.event(
        TelemetryCategory.engineRuntime,
        'HeartbeatWriter: write failed: $e',
      );
    }
  }
}
