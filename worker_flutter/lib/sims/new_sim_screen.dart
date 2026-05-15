import 'package:flutter/material.dart';

import '../decks/deck_record.dart';
import '../decks/deck_repo.dart';

/// Returns the new job's id once the start action succeeds. Cloud
/// mode returns the Firestore doc id; offline mode returns the
/// auto-increment row id stringified.
typedef StartJob =
    Future<String> Function(List<DeckRecord> decks, int simCount);

/// Pick four decks + a sim count, then call [onStart]. Tap-to-toggle
/// selection with up to 4 picks; a search filter handles the case
/// where the user has dozens of decks.
class NewSimScreen extends StatefulWidget {
  const NewSimScreen({
    super.key,
    required this.repo,
    required this.onStart,
    required this.onJobCreated,
  });

  final DeckRepo repo;
  final StartJob onStart;

  /// Navigate to the new job's detail screen. Kept as a callback so
  /// cloud mode can push `CloudJobDetailScreen(jobId: ...)` while
  /// offline mode pushes its `_JobScreen(jobId: int)`.
  final void Function(BuildContext context, String jobId) onJobCreated;

  @override
  State<NewSimScreen> createState() => _NewSimScreenState();
}

class _NewSimScreenState extends State<NewSimScreen> {
  final _picked = <String>[]; // deck ids, ordered
  String _search = '';
  int _sims = 10;
  bool _busy = false;
  String? _error;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF1F2937),
      body: StreamBuilder<List<DeckRecord>>(
        stream: widget.repo.watchDecks(),
        initialData: const [],
        builder: (context, snap) {
          final all = snap.data ?? const [];
          final filtered = _search.isEmpty
              ? all
              : all
                    .where(
                      (d) =>
                          d.name.toLowerCase().contains(_search.toLowerCase()),
                    )
                    .toList(growable: false);
          final picked = [
            for (final id in _picked)
              all.firstWhere(
                (d) => d.id == id,
                orElse: () => DeckRecord(
                  id: id,
                  name: '?',
                  filename: '',
                  isPrecon: false,
                ),
              ),
          ];
          return Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                child: TextField(
                  decoration: const InputDecoration(
                    hintText: 'Search decks',
                    prefixIcon: Icon(Icons.search),
                    isDense: true,
                    filled: true,
                    fillColor: Color(0xFF111827),
                    border: OutlineInputBorder(borderSide: BorderSide.none),
                  ),
                  style: const TextStyle(color: Colors.white),
                  onChanged: (v) => setState(() => _search = v),
                ),
              ),
              Expanded(
                child: filtered.isEmpty
                    ? const Center(
                        child: Text(
                          'No matching decks. Add one in the Decks tab first.',
                          style: TextStyle(color: Colors.white54),
                        ),
                      )
                    : ListView.builder(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 8,
                        ),
                        itemCount: filtered.length,
                        itemBuilder: (context, i) {
                          final d = filtered[i];
                          final isPicked = _picked.contains(d.id);
                          final pickIndex = isPicked
                              ? _picked.indexOf(d.id) + 1
                              : null;
                          return ListTile(
                            dense: true,
                            leading: SizedBox(
                              width: 28,
                              child: pickIndex != null
                                  ? CircleAvatar(
                                      radius: 10,
                                      backgroundColor: const Color(0xFF60A5FA),
                                      child: Text(
                                        '$pickIndex',
                                        style: const TextStyle(
                                          fontSize: 11,
                                          color: Colors.white,
                                        ),
                                      ),
                                    )
                                  : const Icon(
                                      Icons.radio_button_unchecked,
                                      size: 18,
                                      color: Colors.white54,
                                    ),
                            ),
                            title: Text(
                              d.name,
                              style: const TextStyle(color: Colors.white),
                            ),
                            subtitle: d.primaryCommander == null
                                ? null
                                : Text(
                                    d.primaryCommander!,
                                    style: const TextStyle(
                                      color: Colors.white54,
                                      fontSize: 11,
                                    ),
                                  ),
                            onTap: _busy ? null : () => _toggle(d.id),
                          );
                        },
                      ),
              ),
              Container(
                color: const Color(0xFF111827),
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      'Picked (${_picked.length}/4)',
                      style: const TextStyle(color: Colors.white70),
                    ),
                    const SizedBox(height: 4),
                    Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      children: [
                        for (final d in picked)
                          Chip(
                            label: Text(d.name),
                            backgroundColor: const Color(0xFF1F2937),
                            labelStyle: const TextStyle(color: Colors.white),
                            deleteIconColor: Colors.white70,
                            onDeleted: _busy ? null : () => _toggle(d.id),
                          ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    Text(
                      'Simulations: $_sims',
                      style: const TextStyle(color: Colors.white70),
                    ),
                    Slider(
                      value: _sims.toDouble(),
                      min: 1,
                      max: 200,
                      divisions: 199,
                      label: '$_sims',
                      onChanged: _busy
                          ? null
                          : (v) => setState(() => _sims = v.round()),
                    ),
                    if (_error != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 4, bottom: 4),
                        child: Text(
                          _error!,
                          style: const TextStyle(color: Color(0xFFF87171)),
                        ),
                      ),
                    FilledButton(
                      onPressed: (_picked.length == 4 && !_busy)
                          ? () => _start(picked)
                          : null,
                      child: _busy
                          ? const SizedBox(
                              height: 16,
                              width: 16,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.white,
                              ),
                            )
                          : const Text('Start simulation'),
                    ),
                  ],
                ),
              ),
            ],
          );
        },
      ),
    );
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

  Future<void> _start(List<DeckRecord> picked) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final jobId = await widget.onStart(picked, _sims);
      if (!mounted) return;
      setState(() {
        _picked.clear();
      });
      widget.onJobCreated(context, jobId);
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }
}
