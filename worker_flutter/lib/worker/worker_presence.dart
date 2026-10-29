import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_database/firebase_database.dart';

import '../app_log.dart';
import '../telemetry.dart';

/// Where [WorkerPresence] writes. Split out so tests can record writes
/// without a Firebase app.
abstract interface class PresenceSink {
  /// Emits true each time the connection to the database is (re)established.
  Stream<bool> get connected;

  /// Ask the server to delete the entry when this client disconnects.
  Future<void> removeOnDisconnect();

  /// Write [fields] into the entry, stamped with the server time.
  Future<void> write(Map<String, Object?> fields);

  /// Delete the entry now.
  Future<void> remove();
}

/// Keeps this worker's entry at `presence/{workerId}` in the Realtime
/// Database, which the web UI and the API read to list online workers
/// (see `shared/types/worker-presence.ts`).
///
/// The entry is written on start, on every reconnect and every
/// [tickInterval]. The server deletes it the moment the connection drops,
/// so a closed or crashed worker leaves the list right away. Realtime
/// Database bills bandwidth, not operations, so the writes cost nothing
/// against the Firestore quota.
class WorkerPresence {
  WorkerPresence({
    required this.sink,
    required this.workerName,
    required this.capacity,
    this.tickInterval = const Duration(seconds: 60),
  });

  final PresenceSink sink;
  final String workerName;

  /// Advertised on the next write; mutable so a live capacity change shows.
  int capacity;

  /// Number of sims running now; advertised on the next write.
  int activeSimulations = 0;

  final Duration tickInterval;

  Timer? _timer;
  StreamSubscription<bool>? _connectedSub;
  DateTime? _startTime;

  Future<void> start() async {
    _startTime = DateTime.now();
    // Re-arm the server-side delete and rewrite the entry after every
    // reconnect: the server dropped the entry when the connection did.
    _connectedSub = sink.connected.where((c) => c).listen((_) async {
      try {
        await sink.removeOnDisconnect();
      } catch (e, st) {
        await _reportFailure('presence onDisconnect failed', e, st);
      }
      await publish();
    });
    _timer = Timer.periodic(tickInterval, (_) => publish());
  }

  /// Write the current status now. A failed write is reported; the next
  /// tick retries.
  Future<void> publish() async {
    final started = _startTime;
    try {
      await sink.write({
        'workerName': workerName,
        'workerType': 'flutter',
        'status': activeSimulations == 0 ? 'idle' : 'busy',
        'capacity': capacity,
        'activeSimulations': activeSimulations,
        'uptimeMs': started == null
            ? 0
            : DateTime.now().difference(started).inMilliseconds,
      });
    } catch (e, st) {
      await _reportFailure('presence write failed', e, st);
    }
  }

  Future<void> stop() async {
    _timer?.cancel();
    _timer = null;
    await _connectedSub?.cancel();
    _connectedSub = null;
    try {
      await sink.remove();
    } catch (e) {
      // Benign during shutdown: the server removes it on disconnect anyway.
      AppLog.event(
        TelemetryCategory.engineRuntime,
        'presence remove failed: $e',
      );
    }
  }

  Future<void> _reportFailure(String message, Object e, StackTrace st) async {
    AppLog.event(TelemetryCategory.engineRuntime, '$message: $e');
    await Telemetry.captureError(
      e,
      st,
      category: TelemetryCategory.engineRuntime,
      extra: {'phase': 'presence'},
    );
  }
}

/// [PresenceSink] backed by the Realtime Database. Every write carries the
/// signed-in user's uid, which `database.rules.json` checks, so one user
/// can't overwrite another's worker.
class RtdbPresenceSink implements PresenceSink {
  RtdbPresenceSink({
    required this.workerId,
    FirebaseDatabase? database,
    FirebaseAuth? auth,
  }) : _databaseOverride = database,
       _authOverride = auth;

  final String workerId;
  final FirebaseDatabase? _databaseOverride;
  final FirebaseAuth? _authOverride;

  // Resolved lazily, like ApiClient: the engine is built before sign-in.
  FirebaseDatabase get _database =>
      _databaseOverride ?? FirebaseDatabase.instance;
  FirebaseAuth get _auth => _authOverride ?? FirebaseAuth.instance;
  DatabaseReference get _ref => _database.ref('presence/$workerId');

  @override
  Stream<bool> get connected => _database
      .ref('.info/connected')
      .onValue
      .map((event) => event.snapshot.value == true);

  @override
  Future<void> removeOnDisconnect() => _ref.onDisconnect().remove();

  @override
  Future<void> write(Map<String, Object?> fields) {
    final uid = _auth.currentUser?.uid;
    if (uid == null) throw StateError('presence: not signed in');
    return _ref.set({...fields, 'uid': uid, 'lastSeen': ServerValue.timestamp});
  }

  @override
  Future<void> remove() => _ref.remove();
}
