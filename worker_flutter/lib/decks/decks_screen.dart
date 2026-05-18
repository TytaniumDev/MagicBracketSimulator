import 'package:flutter/material.dart';

import 'add_deck_screen.dart';
import 'deck_record.dart';
import 'deck_repo.dart';

/// List of decks visible to the current user. Tap "+" to add via URL
/// or pasted text; swipe-or-trash a user deck to delete (precons are
/// read-only).
class DecksScreen extends StatelessWidget {
  const DecksScreen({super.key, required this.repo});

  final DeckRepo repo;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF1F2937),
      body: StreamBuilder<List<DeckRecord>>(
        stream: repo.watchDecks(),
        initialData: const [],
        builder: (context, snap) {
          if (snap.hasError) {
            return _CenterMessage(
              icon: Icons.cloud_off,
              text: "Couldn't load decks: ${snap.error}",
            );
          }
          final decks = snap.data ?? const [];
          if (decks.isEmpty) {
            return const _CenterMessage(
              icon: Icons.style_outlined,
              text: 'No decks yet — tap "+" to add one.',
            );
          }
          return ListView.separated(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 80),
            itemCount: decks.length,
            separatorBuilder: (_, _) => const SizedBox(height: 6),
            itemBuilder: (context, i) => _DeckRow(deck: decks[i], repo: repo),
          );
        },
      ),
      floatingActionButton: FloatingActionButton.extended(
        icon: const Icon(Icons.add),
        label: const Text('Add deck'),
        onPressed: () async {
          await Navigator.of(
            context,
          ).push(MaterialPageRoute(builder: (_) => AddDeckScreen(repo: repo)));
        },
      ),
    );
  }
}

class _DeckRow extends StatelessWidget {
  const _DeckRow({required this.deck, required this.repo});

  final DeckRecord deck;
  final DeckRepo repo;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: const Color(0xFF111827),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: const Color(0xFF374151)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    if (deck.isPrecon)
                      const Padding(
                        padding: EdgeInsets.only(right: 6),
                        child: Icon(
                          Icons.inventory_2_outlined,
                          size: 14,
                          color: Color(0xFF9CA3AF),
                        ),
                      ),
                    Expanded(
                      child: Text(
                        deck.name,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 14,
                          fontWeight: FontWeight.w500,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    if (deck.colorIdentity != null &&
                        deck.colorIdentity!.isNotEmpty)
                      _ColorPips(colors: deck.colorIdentity!),
                  ],
                ),
                if (deck.primaryCommander != null ||
                    deck.ownerEmail != null) ...[
                  const SizedBox(height: 2),
                  Text(
                    deck.primaryCommander ?? deck.ownerEmail ?? '',
                    style: const TextStyle(
                      color: Color(0xFF9CA3AF),
                      fontSize: 11,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ],
            ),
          ),
          if (!deck.isPrecon)
            IconButton(
              tooltip: 'Delete',
              icon: const Icon(
                Icons.delete_outline,
                color: Color(0xFFF87171),
                size: 18,
              ),
              onPressed: () => _confirmDelete(context),
            ),
        ],
      ),
    );
  }

  Future<void> _confirmDelete(BuildContext context) async {
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
      await repo.deleteDeck(deck);
    } catch (e) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('Delete failed: $e')));
    }
  }
}

class _ColorPips extends StatelessWidget {
  const _ColorPips({required this.colors});
  final List<String> colors;

  @override
  Widget build(BuildContext context) {
    const map = {
      'W': Color(0xFFFEF3C7),
      'U': Color(0xFF60A5FA),
      'B': Color(0xFF374151),
      'R': Color(0xFFF87171),
      'G': Color(0xFF34D399),
    };
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (final c in colors)
          Padding(
            padding: const EdgeInsets.only(left: 3),
            child: Container(
              width: 10,
              height: 10,
              decoration: BoxDecoration(
                color: map[c] ?? Colors.grey,
                shape: BoxShape.circle,
                border: Border.all(color: const Color(0xFF111827)),
              ),
            ),
          ),
      ],
    );
  }
}

class _CenterMessage extends StatelessWidget {
  const _CenterMessage({required this.icon, required this.text});
  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, color: Colors.white38, size: 40),
            const SizedBox(height: 12),
            Text(
              text,
              style: const TextStyle(color: Colors.white54),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}
