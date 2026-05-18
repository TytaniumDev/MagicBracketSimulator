import 'package:flutter/material.dart';

import '../api_client.dart';
import '../cloud/cloud_job_detail_screen.dart';
import '../cloud/cloud_jobs_screen.dart';
import '../cloud/cloud_leaderboard_screen.dart';
import '../config.dart';
import '../decks/cloud_deck_repo.dart';
import '../decks/deck_repo.dart';
import '../decks/decks_screen.dart';
import '../launch/auto_start_service.dart';
import '../models/sim.dart';
import '../sims/new_sim_screen.dart';
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

  @override
  void initState() {
    super.initState();
    _capacity = widget.config.maxCapacity;
    // Single ApiClient (and its underlying http.Client) for the
    // dashboard's lifetime — allocating per-submission leaks socket
    // resources in a long-running tray app.
    _api = ApiClient(baseUrl: widget.config.apiUrl);
    _deckRepo = CloudDeckRepo(api: _api);
  }

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 5,
      child: Scaffold(
        backgroundColor: const Color(0xFF1F2937),
        appBar: AppBar(
          backgroundColor: const Color(0xFF111827),
          foregroundColor: Colors.white,
          title: const Text('Magic Bracket Worker'),
          centerTitle: false,
          elevation: 0,
          bottom: const TabBar(
            isScrollable: true,
            tabs: [
              Tab(icon: Icon(Icons.memory), text: 'Worker'),
              Tab(icon: Icon(Icons.cloud_queue), text: 'Jobs'),
              Tab(icon: Icon(Icons.leaderboard_outlined), text: 'Leaderboard'),
              Tab(icon: Icon(Icons.style_outlined), text: 'Decks'),
              Tab(icon: Icon(Icons.play_arrow), text: 'New'),
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
            // Decks tab — user's saved decks plus precons, live from
            // Firestore. Add/delete go through the MBS API.
            DecksScreen(repo: _deckRepo),
            // New simulation tab — pick 4 decks and submit via
            // POST /api/jobs.
            NewSimScreen(
              repo: _deckRepo,
              onStart: (decks, simCount) async {
                final resp = await _api.postJson('/api/jobs', {
                  'deckIds': decks.map((d) => d.id).toList(),
                  'simulations': simCount,
                });
                final job = resp['job'];
                if (job is Map && job['id'] != null) {
                  return job['id'].toString();
                }
                final id = resp['id']?.toString();
                if (id == null || id.isEmpty) {
                  throw StateError(
                    'POST /api/jobs returned no job id; '
                    'the API response shape may have changed.',
                  );
                }
                return id;
              },
              onJobCreated: (ctx, jobId) {
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
