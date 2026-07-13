import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api_client.dart';
import '../cloud/cloud_job_detail_screen.dart';
import '../cloud/cloud_jobs_screen.dart';
import '../cloud/cloud_leaderboard_screen.dart';
import '../config.dart';
import '../decks/cloud_deck_repo.dart';
import '../decks/deck_record.dart';
import '../decks/deck_repo.dart';
import '../launch/auto_start_service.dart';
import '../models/sim.dart';
import '../offline/db/app_db.dart';
import '../offline/local_job_screen.dart';
import '../offline/offline_runner.dart';
import '../sims/simulate_screen.dart';
import '../worker/worker_engine.dart';

/// Single dashboard window for the worker.
///
/// Designed to be shown on tray-icon click and hidden when the user closes
/// it. The engine keeps running in the background regardless of window
/// visibility (the macOS app has `LSUIElement=true`, so no Dock icon and
/// no main window unless the user opens one).
class Dashboard extends StatefulWidget {
  const Dashboard({super.key, required this.engine, required this.config});

  final WorkerEngine engine;
  final WorkerConfig config;

  @override
  State<Dashboard> createState() => _DashboardState();
}

class _DashboardState extends State<Dashboard> {
  late int _capacity;
  late final ApiClient _api;
  late final DeckRepo _deckRepo;
  late final AppDb _localDb;
  late final OfflineRunner _localRunner;



  /// Set by `_startCloud`/`_startLocal` before they return so the
  /// follow-up `onJobCreated` callback knows which detail screen to
  /// push. Local job ids and Firestore doc ids are both opaque strings
  /// from the typedef's perspective; this flag is the unambiguous
  /// signal.
  bool _lastRunLocal = false;

  static const String _sentryRelease = String.fromEnvironment(
    'SENTRY_RELEASE',
    defaultValue: 'worker_flutter@dev',
  );
  static const String _gitSha = String.fromEnvironment(
    'GIT_SHA',
    defaultValue: 'local',
  );

  String _getVersionText() {
    final parts = _sentryRelease.split('@');
    if (parts.length > 1) {
      final ver = parts[1];
      if (ver != 'dev') {
        return 'v$ver';
      }
    }
    if (_gitSha != 'local') {
      return _gitSha.substring(0, 7);
    }
    return 'dev';
  }

  Uri _getGitHubUri() {
    final parts = _sentryRelease.split('@');
    if (parts.length > 1) {
      final ver = parts[1];
      if (ver != 'dev') {
        return Uri.parse(
          'https://github.com/TytaniumDev/MagicBracketSimulator/releases/tag/worker-v$ver',
        );
      }
    }
    if (_gitSha != 'local') {
      return Uri.parse(
        'https://github.com/TytaniumDev/MagicBracketSimulator/commit/$_gitSha',
      );
    }
    return Uri.parse('https://github.com/TytaniumDev/MagicBracketSimulator');
  }

  Future<void> _openGitHubPage() async {
    final url = _getGitHubUri();
    try {
      await launchUrl(url, mode: LaunchMode.externalApplication);
    } catch (e) {
      debugPrint('Could not launch $url: $e');
    }
  }

  @override
  void initState() {
    super.initState();
    _capacity = widget.config.maxCapacity;
    // Single ApiClient (and its underlying http.Client) for the
    // dashboard's lifetime — allocating per-submission leaks socket
    // resources in a long-running tray app.
    _api = ApiClient(baseUrl: widget.config.apiUrl);
    _deckRepo = CloudDeckRepo(api: _api);
    // Local-run infrastructure. AppDb is also instantiated by
    // OfflineApp, but cloud-mode dashboard and offline-mode app are
    // never alive at the same time (LaunchMode routes one or the
    // other), so the SQLite file is owned single-writer here.
    _localDb = AppDb();
    _localRunner = OfflineRunner(db: _localDb, config: widget.config);
    // Pick up any local job left mid-run from a previous session so
    // closing the app mid-simulation doesn't permanently strand it.
    unawaited(_localRunner.resumeInFlightJobs());
  }

  @override
  void dispose() {
    _localDb.close();
    super.dispose();
  }

  /// Cloud submit: POST /api/jobs and return the Firestore job id.
  Future<String> _startCloud(List<DeckRecord> decks, int simCount) async {
    _lastRunLocal = false;
    final resp = await _api.postJson('/api/jobs', {
      'deckIds': decks.map((d) => d.id).toList(),
      'simulations': simCount,
    });
    final job = resp['job'];
    if (job is Map && job['id'] != null) return job['id'].toString();
    final id = resp['id']?.toString();
    if (id == null || id.isEmpty) {
      throw StateError(
        'POST /api/jobs returned no job id; '
        'the API response shape may have changed.',
      );
    }
    return id;
  }

  /// Local run: stage non-precon deck content into AppDb (precons are
  /// bundled and resolved by name by OfflineRunner) and kick off the
  /// offline runner. Returns the stringified AppDb row id; the matching
  /// `onJobCreated` parses it back to navigate to `LocalJobScreen`.
  Future<String> _startLocal(List<DeckRecord> decks, int simCount) async {
    _lastRunLocal = true;
    await _stageCloudDecksLocally(decks);
    final jobId = await _localDb.createJob(
      deckNames: decks.map((d) => d.name).toList(),
      simCount: simCount,
    );

    unawaited(_localRunner.run(jobId));
    return jobId.toString();
  }

  /// Insert each non-precon cloud deck's .dck content into AppDb so
  /// `OfflineRunner._findUserDeckByName` resolves it. Precons are
  /// resolved against the bundled asset set inside the runner and don't
  /// need staging. Firestore `/decks/{id}` is publicly readable per
  /// `firestore.rules`, so this works without auth — keeping the
  /// "no auth needed" promise of the Run-locally path.
  ///
  /// Re-fetches and overwrites on every call: caching by name silently
  /// served stale `.dck` when a user edited the deck in the cloud
  /// between runs. The cost is one Firestore read per non-precon deck
  /// per Run-locally kickoff (≤4), well below noticeable.
  Future<void> _stageCloudDecksLocally(List<DeckRecord> decks) async {
    final firestore = FirebaseFirestore.instance;
    for (final deck in decks) {
      if (deck.isPrecon) continue;
      final snap = await firestore.collection('decks').doc(deck.id).get();
      final dck = snap.data()?['dck'] as String?;
      if (dck == null || dck.isEmpty) {
        throw StateError(
          'Deck "${deck.name}" is missing .dck content in Firestore '
          '— can\'t run it locally.',
        );
      }
      final existing = await _localDb.deckByName(deck.name);
      if (existing != null) {
        // Delete + reinsert rather than UPDATE: the decks table
        // enforces UNIQUE(name), and AppDb has no in-place updater
        // today. Jobs reference deck names as strings (no FK), so
        // dropping the row doesn't strand historical runs.
        await _localDb.deleteDeckById(existing.id);
      }
      await _localDb.insertDeck(
        name: deck.name,
        filename: deck.filename,
        dckContent: dck,
        colorIdentity: deck.colorIdentity?.join(''),
        link: deck.link,
        primaryCommander: deck.primaryCommander,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 4,
      child: Scaffold(
        backgroundColor: const Color(0xFF1F2937),
        appBar: AppBar(
          backgroundColor: const Color(0xFF111827),
          foregroundColor: Colors.white,
          title: const Text('Magic Bracket Worker'),
          centerTitle: false,
          elevation: 0,
          actions: [
            Padding(
              padding: const EdgeInsets.only(right: 16.0),
              child: Center(
                child: MouseRegion(
                  cursor: SystemMouseCursors.click,
                  child: GestureDetector(
                    onTap: _openGitHubPage,
                    child: Tooltip(
                      message: 'View on GitHub',
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 10,
                          vertical: 4,
                        ),
                        decoration: BoxDecoration(
                          color: const Color(0xFF1F2937),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: const Color(0xFF374151)),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(
                              Icons.code,
                              size: 12,
                              color: Color(0xFF60A5FA),
                            ),
                            const SizedBox(width: 6),
                            Text(
                              _getVersionText(),
                              style: const TextStyle(
                                color: Color(0xFF9CA3AF),
                                fontSize: 12,
                                fontWeight: FontWeight.w500,
                                fontFamily: 'monospace',
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ],
          bottom: const TabBar(
            isScrollable: true,
            tabs: [
              Tab(icon: Icon(Icons.memory), text: 'Worker'),
              Tab(icon: Icon(Icons.cloud_queue), text: 'Jobs'),
              Tab(icon: Icon(Icons.leaderboard_outlined), text: 'Leaderboard'),
              Tab(icon: Icon(Icons.play_arrow), text: 'Simulate'),
            ],
            labelColor: Color(0xFF60A5FA),
            unselectedLabelColor: Colors.white70,
            indicatorColor: Color(0xFF60A5FA),
          ),
        ),
        body: TabBarView(
          children: [
            // Worker tab — engine status / capacity / active sims.
            StreamBuilder<EngineState>(
              stream: widget.engine.stateStream,
              initialData: widget.engine.currentState,
              builder: (context, snapshot) {
                final state = snapshot.data!;
                return Padding(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      _StatusCard(
                        state: state,
                        workerName: widget.config.workerName,
                      ),
                      const SizedBox(height: 16),
                      _CapacityRow(
                        current: _capacity,
                        onChanged: (v) => setState(() => _capacity = v),
                        onChangeEnd: (v) => widget.config.setCapacity(v),
                      ),
                      const SizedBox(height: 8),
                      const _LaunchAtLoginRow(),
                      const SizedBox(height: 16),
                      Expanded(
                        child: _ActiveSimsList(active: state.activeSims),
                      ),
                      const SizedBox(height: 8),
                      _ControlRow(
                        running: state.running,
                        onStart: widget.engine.start,
                        onStop: widget.engine.stop,
                      ),
                    ],
                  ),
                );
              },
            ),
            // Jobs tab — Firestore-backed browser of all jobs (read-only
            // for now; mutations need auth which the worker lacks).
            const CloudJobsScreen(),
            // Leaderboard tab — aggregates win rate per deck across
            // recent completed jobs. Client-side because the
            // /api/leaderboard endpoint requires auth.
            const CloudLeaderboardScreen(),
            // Simulate tab — combined deck management + simulation
            // picker. Streams user's saved decks plus precons from
            // Firestore. By default submits to /api/jobs; when the user
            // ticks "Run locally" the picker dispatches to the local
            // OfflineRunner instead — same Forge engine, no API auth /
            // App Check required.
            SimulateScreen(
              repo: _deckRepo,
              showRunLocally: true,
              onStart: (decks, simCount, {required bool runLocally}) {
                return runLocally
                    ? _startLocal(decks, simCount)
                    : _startCloud(decks, simCount);
              },
              onJobCreated: (ctx, jobId) {
                if (_lastRunLocal) {
                  final id = int.tryParse(jobId);
                  if (id == null) return;
                  Navigator.of(ctx).push(
                    MaterialPageRoute(
                      builder: (_) => LocalJobScreen(
                        db: _localDb,
                        runner: _localRunner,
                        jobId: id,
                      ),
                    ),
                  );
                  return;
                }
                Navigator.of(ctx).push(
                  MaterialPageRoute(
                    builder: (_) => CloudJobDetailScreen(jobId: jobId),
                  ),
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}

class _StatusCard extends StatelessWidget {
  const _StatusCard({required this.state, required this.workerName});

  final EngineState state;
  final String workerName;

  @override
  Widget build(BuildContext context) {
    final color = !state.running
        ? Colors.grey
        : state.activeSims.isEmpty
        ? Colors.green
        : Colors.blue;
    final label = !state.running
        ? 'Stopped'
        : state.activeSims.isEmpty
        ? 'Idle'
        : 'Running ${state.activeSims.length} sim(s)';
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF111827),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        children: [
          Container(
            width: 12,
            height: 12,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  workerName,
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w600,
                    fontSize: 16,
                  ),
                ),
                Text(label, style: const TextStyle(color: Colors.white70)),
              ],
            ),
          ),
          Text(
            '${state.completedCount} done',
            style: const TextStyle(color: Colors.white60),
          ),
        ],
      ),
    );
  }
}

class _CapacityRow extends StatelessWidget {
  const _CapacityRow({
    required this.current,
    required this.onChanged,
    required this.onChangeEnd,
  });

  final int current;
  final ValueChanged<int> onChanged;
  final ValueChanged<int> onChangeEnd;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: const Color(0xFF111827),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        children: [
          const Text(
            'Max parallel sims',
            style: TextStyle(color: Colors.white70),
          ),
          Expanded(
            child: Slider(
              value: current.toDouble(),
              min: 1,
              max: 8,
              divisions: 7,
              label: '$current',
              onChanged: (v) => onChanged(v.round()),
              onChangeEnd: (v) => onChangeEnd(v.round()),
            ),
          ),
          SizedBox(
            width: 24,
            child: Text(
              '$current',
              style: const TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.bold,
              ),
              textAlign: TextAlign.right,
            ),
          ),
        ],
      ),
    );
  }
}

/// Toggle that flips the OS's "launch this app at login" registration.
/// macOS writes a Login Items entry; Windows drops a .lnk shortcut in
/// the user's Startup folder. Both are reversible — flipping back
/// removes the entry.
class _LaunchAtLoginRow extends StatefulWidget {
  const _LaunchAtLoginRow();

  @override
  State<_LaunchAtLoginRow> createState() => _LaunchAtLoginRowState();
}

class _LaunchAtLoginRowState extends State<_LaunchAtLoginRow> {
  bool? _enabled;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    final on = await AutoStartService.isEnabled();
    if (!mounted) return;
    setState(() => _enabled = on);
  }

  Future<void> _toggle(bool next) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      if (next) {
        await AutoStartService.enable();
      } else {
        await AutoStartService.disable();
      }
      if (!mounted) return;
      setState(() => _enabled = next);
    } catch (e, st) {
      // Re-read the actual state — the OS may have rejected the
      // change (sandbox restriction, locked Startup folder, etc.).
      // Log the underlying error so the diagnostic file shows what
      // actually went wrong; without it the user just sees the
      // switch silently flip back to its prior value.
      debugPrint('AutoStart toggle failed: $e\n$st');
      await _refresh();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      decoration: BoxDecoration(
        color: const Color(0xFF111827),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        children: [
          const Expanded(
            child: Text(
              'Launch at login',
              style: TextStyle(color: Colors.white70),
            ),
          ),
          if (_enabled == null)
            const SizedBox.square(
              dimension: 16,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          else
            Switch(value: _enabled!, onChanged: _busy ? null : _toggle),
        ],
      ),
    );
  }
}

class _ActiveSimsList extends StatelessWidget {
  const _ActiveSimsList({required this.active});

  final List<SimDoc> active;

  @override
  Widget build(BuildContext context) {
    if (active.isEmpty) {
      return const Center(
        child: Text(
          'No active simulations.',
          style: TextStyle(color: Colors.white38),
        ),
      );
    }
    return ListView.separated(
      itemCount: active.length,
      separatorBuilder: (_, __) =>
          const Divider(color: Colors.white12, height: 1),
      itemBuilder: (_, i) {
        final sim = active[i];
        return ListTile(
          dense: true,
          leading: const Icon(Icons.bolt, color: Colors.amber, size: 18),
          title: Text(
            sim.simId,
            style: const TextStyle(color: Colors.white, fontSize: 13),
          ),
          subtitle: Text(
            'job ${sim.jobId}',
            style: const TextStyle(color: Colors.white54, fontSize: 11),
          ),
        );
      },
    );
  }
}

class _ControlRow extends StatelessWidget {
  const _ControlRow({
    required this.running,
    required this.onStart,
    required this.onStop,
  });

  final bool running;
  final Future<void> Function() onStart;
  final Future<void> Function() onStop;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        ElevatedButton.icon(
          icon: Icon(running ? Icons.stop : Icons.play_arrow),
          label: Text(running ? 'Stop worker' : 'Start worker'),
          style: ElevatedButton.styleFrom(
            backgroundColor: running
                ? Colors.red.shade700
                : Colors.green.shade700,
            foregroundColor: Colors.white,
          ),
          onPressed: running ? onStop : onStart,
        ),
      ],
    );
  }
}
