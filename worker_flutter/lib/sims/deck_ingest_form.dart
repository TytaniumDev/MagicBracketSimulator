import 'package:flutter/material.dart';

import '../decks/deck_repo.dart';
import '../ingestion/ingestion.dart';

/// Inline "Add a deck" card. URL form is always visible; a disclosure
/// toggles a paste form below for users who can't share a public URL.
class DeckIngestForm extends StatefulWidget {
  const DeckIngestForm({super.key, required this.repo, required this.onAdded});

  final DeckRepo repo;

  /// Called with the new deck's name after a successful save.
  final ValueChanged<String> onAdded;

  @override
  State<DeckIngestForm> createState() => _DeckIngestFormState();
}

class _DeckIngestFormState extends State<DeckIngestForm> {
  final _urlCtrl = TextEditingController();
  final _nameCtrl = TextEditingController();
  final _linkCtrl = TextEditingController();
  final _textCtrl = TextEditingController();
  bool _pasteOpen = false;
  bool _urlBusy = false;
  bool _pasteBusy = false;
  String? _urlError;
  String? _pasteError;

  @override
  void dispose() {
    _urlCtrl.dispose();
    _nameCtrl.dispose();
    _linkCtrl.dispose();
    _textCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF111827),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'Add a deck',
            style: TextStyle(
              color: Colors.white,
              fontSize: 15,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _urlCtrl,
                  enabled: !_urlBusy,
                  style: const TextStyle(color: Colors.white),
                  decoration: const InputDecoration(
                    hintText: 'https://moxfield.com/decks/...',
                    isDense: true,
                    filled: true,
                    fillColor: Color(0xFF1F2937),
                    border: OutlineInputBorder(borderSide: BorderSide.none),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              FilledButton(
                onPressed: _urlBusy ? null : _submitUrl,
                child: _urlBusy
                    ? const SizedBox(
                        width: 14,
                        height: 14,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Text('Add deck'),
              ),
            ],
          ),
          if (_urlError != null)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(
                _urlError!,
                style: const TextStyle(color: Color(0xFFF87171), fontSize: 12),
              ),
            ),
          const SizedBox(height: 8),
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton.icon(
              onPressed: () => setState(() => _pasteOpen = !_pasteOpen),
              icon: Icon(
                _pasteOpen ? Icons.expand_less : Icons.expand_more,
                color: const Color(0xFF9CA3AF),
                size: 18,
              ),
              label: const Text(
                'Or paste a deck list',
                style: TextStyle(color: Color(0xFF9CA3AF), fontSize: 12),
              ),
              style: TextButton.styleFrom(
                padding: const EdgeInsets.symmetric(horizontal: 4),
                minimumSize: const Size(0, 28),
              ),
            ),
          ),
          if (_pasteOpen) ...[
            const SizedBox(height: 4),
            TextField(
              key: const ValueKey('paste-name'),
              controller: _nameCtrl,
              enabled: !_pasteBusy,
              style: const TextStyle(color: Colors.white),
              decoration: const InputDecoration(
                labelText: 'Deck name (optional)',
                isDense: true,
                filled: true,
                fillColor: Color(0xFF1F2937),
                border: OutlineInputBorder(borderSide: BorderSide.none),
              ),
            ),
            const SizedBox(height: 6),
            TextField(
              key: const ValueKey('paste-link'),
              controller: _linkCtrl,
              enabled: !_pasteBusy,
              style: const TextStyle(color: Colors.white),
              decoration: const InputDecoration(
                labelText: 'External link (optional)',
                isDense: true,
                filled: true,
                fillColor: Color(0xFF1F2937),
                border: OutlineInputBorder(borderSide: BorderSide.none),
              ),
            ),
            const SizedBox(height: 6),
            TextField(
              key: const ValueKey('paste-textarea'),
              controller: _textCtrl,
              enabled: !_pasteBusy,
              minLines: 4,
              maxLines: 10,
              keyboardType: TextInputType.multiline,
              style: const TextStyle(
                color: Colors.white,
                fontFamily: 'Menlo',
                fontSize: 12,
              ),
              decoration: const InputDecoration(
                hintText:
                    '1 Sol Ring\n1 Arcane Signet\n...\n\nCommander\n1 Atraxa',
                isDense: true,
                filled: true,
                fillColor: Color(0xFF1F2937),
                border: OutlineInputBorder(borderSide: BorderSide.none),
              ),
            ),
            if (_pasteError != null)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                  _pasteError!,
                  style: const TextStyle(
                    color: Color(0xFFF87171),
                    fontSize: 12,
                  ),
                ),
              ),
            const SizedBox(height: 8),
            FilledButton(
              onPressed: _pasteBusy ? null : _submitText,
              child: _pasteBusy
                  ? const SizedBox(
                      width: 14,
                      height: 14,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Text('Add deck'),
            ),
          ],
        ],
      ),
    );
  }

  Future<void> _submitUrl() async {
    final url = _urlCtrl.text.trim();
    if (url.isEmpty) {
      setState(() => _urlError = 'Please enter a URL.');
      return;
    }
    if (!isSupportedDeckUrl(url)) {
      setState(
        () =>
            _urlError = 'Use a Moxfield, Archidekt, ManaBox, or ManaPool URL.',
      );
      return;
    }
    setState(() {
      _urlBusy = true;
      _urlError = null;
    });
    try {
      final rec = await widget.repo.createFromUrl(url);
      if (!mounted) return;
      _urlCtrl.clear();
      widget.onAdded(rec.name);
    } catch (e) {
      if (!mounted) return;
      setState(() => _urlError = e.toString());
    } finally {
      if (mounted) setState(() => _urlBusy = false);
    }
  }

  Future<void> _submitText() async {
    final text = _textCtrl.text.trim();
    if (text.isEmpty) {
      setState(() => _pasteError = 'Paste a deck list first.');
      return;
    }
    setState(() {
      _pasteBusy = true;
      _pasteError = null;
    });
    try {
      final rec = await widget.repo.createFromText(
        text,
        name: _nameCtrl.text.trim().isEmpty ? null : _nameCtrl.text.trim(),
        link: _linkCtrl.text.trim().isEmpty ? null : _linkCtrl.text.trim(),
      );
      if (!mounted) return;
      _textCtrl.clear();
      _nameCtrl.clear();
      _linkCtrl.clear();
      widget.onAdded(rec.name);
    } catch (e) {
      if (!mounted) return;
      setState(() => _pasteError = e.toString());
    } finally {
      if (mounted) setState(() => _pasteBusy = false);
    }
  }
}
