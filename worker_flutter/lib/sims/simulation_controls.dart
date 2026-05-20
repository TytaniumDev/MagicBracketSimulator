import 'package:flutter/material.dart';

import '../decks/deck_record.dart';

/// Sticky bottom panel for [SimulateScreen]: picked-deck chips,
/// simulation count slider, and the Start button. State lives in the
/// parent — this widget is purely presentational.
class SimulationControls extends StatelessWidget {
  const SimulationControls({
    super.key,
    required this.picked,
    required this.sims,
    required this.onSimsChanged,
    required this.error,
    required this.busy,
    required this.onUnpick,
    required this.onStart,
    this.showRunLocally = false,
    this.runLocally = false,
    this.onRunLocallyChanged,
  });

  /// Currently-picked decks, in the order the user picked them.
  final List<DeckRecord> picked;

  final int sims;
  final ValueChanged<int> onSimsChanged;

  final String? error;
  final bool busy;

  /// Called when the user taps the delete icon on a picked chip.
  final ValueChanged<String> onUnpick;

  /// Called when the user taps Start. Only enabled when picked.length == 4.
  final VoidCallback onStart;

  /// Render the "Run locally" checkbox. Cloud-mode passes true so the
  /// user can opt out of the cloud job queue and run on this machine
  /// instead. Offline-mode leaves this false — every run is local there
  /// by definition.
  final bool showRunLocally;
  final bool runLocally;
  final ValueChanged<bool>? onRunLocallyChanged;

  @override
  Widget build(BuildContext context) {
    final ready = picked.length == 4 && !busy;
    return Container(
      decoration: const BoxDecoration(
        color: Color(0xFF111827),
        border: Border(top: BorderSide(color: Color(0xFF374151))),
      ),
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Picked (${picked.length}/4)',
            style: const TextStyle(color: Colors.white70, fontSize: 12),
          ),
          if (picked.isNotEmpty) ...[
            const SizedBox(height: 6),
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
                    onDeleted: busy ? null : () => onUnpick(d.id),
                  ),
              ],
            ),
          ],
          const SizedBox(height: 8),
          Text(
            'Simulations: $sims',
            style: const TextStyle(color: Colors.white70, fontSize: 12),
          ),
          Slider(
            value: sims.toDouble(),
            min: 1,
            max: 200,
            divisions: 199,
            label: '$sims',
            onChanged: busy ? null : (v) => onSimsChanged(v.round()),
          ),
          if (showRunLocally)
            Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: InkWell(
                onTap: busy
                    ? null
                    : () => onRunLocallyChanged?.call(!runLocally),
                child: Row(
                  children: [
                    Checkbox(
                      value: runLocally,
                      onChanged: busy
                          ? null
                          : (v) => onRunLocallyChanged?.call(v ?? false),
                    ),
                    const Expanded(
                      child: Text(
                        'Run locally on this machine',
                        style: TextStyle(color: Colors.white70, fontSize: 13),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          if (error != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: Text(
                error!,
                style: const TextStyle(color: Color(0xFFF87171), fontSize: 12),
              ),
            ),
          FilledButton(
            onPressed: ready ? onStart : null,
            child: busy
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white,
                    ),
                  )
                : Text(runLocally ? 'Run locally' : 'Start simulation'),
          ),
        ],
      ),
    );
  }
}
