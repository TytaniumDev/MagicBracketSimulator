import 'package:flutter/material.dart';

import '../decks/deck_record.dart';
import '../decks/deck_repo.dart';
import 'deck_ingest_form.dart';
import 'deck_picker_section.dart';
import 'deck_row.dart';
import 'simulation_controls.dart';

/// Returns the new job's id once the start action succeeds. Cloud
/// mode returns the Firestore doc id when `runLocally` is false, and
/// the local AppDb row id (stringified) when true; offline mode always
/// returns the AppDb row id stringified.
typedef StartJob =
    Future<String> Function(
      List<DeckRecord> decks,
      int simCount, {
      required bool runLocally,
    });

/// Combined deck-management + simulation-picker screen. Replaces the
/// old `DecksScreen` + `NewSimScreen` + `AddDeckScreen` trio.
///
/// Layout: inline add-deck card → search field → Custom section
/// (open by default) → Precons section (closed by default) → sticky
/// bottom panel with picked-deck chips, sim count slider, and Start.
class SimulateScreen extends StatefulWidget {
  const SimulateScreen({
    super.key,
    required this.repo,
    required this.onStart,
    required this.onJobCreated,
    this.showRunLocally = false,
  });

  final DeckRepo repo;
  final StartJob onStart;

  /// Navigate to the new job's detail screen. Cloud and offline modes
  /// push different routes; the screen doesn't care which.
  final void Function(BuildContext context, String jobId) onJobCreated;

  /// Show the "Run locally" checkbox in the bottom panel. Cloud mode
  /// sets this so the user can bypass the cloud job queue and run on
  /// this machine. Offline mode leaves it off — every run is local.
  final bool showRunLocally;

  @override
  State<SimulateScreen> createState() => _SimulateScreenState();
}

class _SimulateScreenState extends State<SimulateScreen> {
  final _searchCtrl = TextEditingController();
  String _search = '';
  final List<String> _picked = []; // deck ids, insertion order
  int _sims = 10;

  // User-controlled section state, honored only when search is empty.
  bool _customOpen = true;
  bool _preconOpen = false;

  bool _busy = false;
  bool _runLocally = false;
  String? _error;

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  bool _matches(DeckRecord d, String q) {
    if (d.name.toLowerCase().contains(q)) return true;
    if (d.primaryCommander?.toLowerCase().contains(q) ?? false) return true;
    return false;
  }

  void _toggle(String id) {
    setState(() {
      if (_picked.contains(id)) {
        _picked.remove(id);
      } else if (_picked.length < 4) {
        _picked.add(id);
      }
    });
  }

  Future<void> _confirmDelete(DeckRecord deck) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete deck?'),
        content: Text('"${deck.name}" will be removed.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            style: TextButton.styleFrom(
              foregroundColor: const Color(0xFFF87171),
            ),
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await widget.repo.deleteDeck(deck);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('Delete failed: $e')));
    }
  }

  Future<void> _start(List<DeckRecord> pickedDecks) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final jobId = await widget.onStart(
        pickedDecks,
        _sims,
        runLocally: _runLocally,
      );
      if (!mounted) return;
      setState(() => _picked.clear());
      widget.onJobCreated(context, jobId);
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF1F2937),
      body: StreamBuilder<List<DeckRecord>>(
        stream: widget.repo.watchDecks(),
        initialData: const [],
        builder: (context, snap) {
          if (snap.hasError) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Text(
                  "Couldn't load decks: ${snap.error}",
                  style: const TextStyle(color: Colors.white54),
                ),
              ),
            );
          }

          final all = snap.data ?? const <DeckRecord>[];
          final q = _search.trim().toLowerCase();
          final customAll = all
              .where((d) => !d.isPrecon)
              .toList(growable: false);
          final preconsAll = all
              .where((d) => d.isPrecon)
              .toList(growable: false);
          final custom = q.isEmpty
              ? customAll
              : customAll.where((d) => _matches(d, q)).toList(growable: false);
          final precons = q.isEmpty
              ? preconsAll
              : preconsAll.where((d) => _matches(d, q)).toList(growable: false);

          // Drop picked ids that no longer resolve (e.g. deck deleted
          // remotely while we held the selection).
          final knownIds = {for (final d in all) d.id};
          final stalePicks = _picked
              .where((id) => !knownIds.contains(id))
              .toList();
          if (stalePicks.isNotEmpty) {
            WidgetsBinding.instance.addPostFrameCallback((_) {
              if (!mounted) return;
              setState(() {
                for (final id in stalePicks) {
                  _picked.remove(id);
                }
              });
            });
          }

          // Skip unresolved ids rather than rendering a "?" placeholder
          // chip — there's a one-frame window between a stream emission
          // that drops the deck and the post-frame callback above that
          // cleans _picked.
          final pickedRecords = <DeckRecord>[
            for (final id in _picked)
              for (final d in all)
                if (d.id == id) d,
          ];

          final searching = q.isNotEmpty;
          final customExpanded = searching ? custom.isNotEmpty : _customOpen;
          final preconExpanded = searching ? precons.isNotEmpty : _preconOpen;

          return Column(
            children: [
              Expanded(
                child: ListView(
                  padding: const EdgeInsets.only(bottom: 12),
                  children: [
                    DeckIngestForm(
                      repo: widget.repo,
                      onAdded: (name) {
                        ScaffoldMessenger.of(
                          context,
                        ).showSnackBar(SnackBar(content: Text('Added: $name')));
                      },
                    ),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
                      child: Text(
                        'Pick 4 decks (${_picked.length}/4)',
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
                      child: TextField(
                        key: const ValueKey('search-field'),
                        controller: _searchCtrl,
                        style: const TextStyle(color: Colors.white),
                        decoration: const InputDecoration(
                          hintText: 'Search by name or commander',
                          prefixIcon: Icon(Icons.search, color: Colors.white54),
                          isDense: true,
                          filled: true,
                          fillColor: Color(0xFF111827),
                          border: OutlineInputBorder(
                            borderSide: BorderSide.none,
                          ),
                        ),
                        onChanged: (v) => setState(() => _search = v),
                      ),
                    ),
                    DeckPickerSection(
                      title: 'Your decks',
                      count: custom.length,
                      expanded: customExpanded,
                      onExpansionChanged: (v) {
                        if (!searching) setState(() => _customOpen = v);
                      },
                      emptyText: searching
                          ? 'No custom decks match.'
                          : 'No custom decks yet — add one above.',
                      children: [
                        for (final d in custom)
                          Padding(
                            padding: const EdgeInsets.only(bottom: 6),
                            child: DeckRow(
                              name: d.name,
                              colorIdentity: d.colorIdentity ?? const [],
                              subtitle: d.primaryCommander ?? d.ownerEmail,
                              isPrecon: false,
                              pickIndex: _picked.contains(d.id)
                                  ? _picked.indexOf(d.id) + 1
                                  : null,
                              canDelete: true,
                              onTap: () => _toggle(d.id),
                              onDelete: () => _confirmDelete(d),
                            ),
                          ),
                      ],
                    ),
                    DeckPickerSection(
                      title: 'Precons',
                      count: precons.length,
                      expanded: preconExpanded,
                      onExpansionChanged: (v) {
                        if (!searching) setState(() => _preconOpen = v);
                      },
                      emptyText: searching
                          ? 'No precons match.'
                          : 'No precons available.',
                      children: [
                        for (final d in precons)
                          Padding(
                            padding: const EdgeInsets.only(bottom: 6),
                            child: DeckRow(
                              name: d.name,
                              colorIdentity: d.colorIdentity ?? const [],
                              subtitle: d.primaryCommander,
                              isPrecon: true,
                              pickIndex: _picked.contains(d.id)
                                  ? _picked.indexOf(d.id) + 1
                                  : null,
                              canDelete: false,
                              onTap: () => _toggle(d.id),
                              onDelete: null,
                            ),
                          ),
                      ],
                    ),
                  ],
                ),
              ),
              SimulationControls(
                picked: pickedRecords,
                sims: _sims,
                onSimsChanged: (v) => setState(() => _sims = v),
                error: _error,
                busy: _busy,
                onUnpick: _toggle,
                onStart: () => _start(pickedRecords),
                showRunLocally: widget.showRunLocally,
                runLocally: _runLocally,
                onRunLocallyChanged: (v) => setState(() => _runLocally = v),
              ),
            ],
          );
        },
      ),
    );
  }
}
