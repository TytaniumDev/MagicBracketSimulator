import 'package:flutter/material.dart';

import '../ingestion/ingestion.dart';
import 'deck_repo.dart';

/// Add-deck form: URL or raw text. Mirrors the web frontend's
/// `Home.tsx` flow (deckUrl OR deckText, with an optional manual name
/// for text input).
class AddDeckScreen extends StatefulWidget {
  const AddDeckScreen({super.key, required this.repo});

  final DeckRepo repo;

  @override
  State<AddDeckScreen> createState() => _AddDeckScreenState();
}

class _AddDeckScreenState extends State<AddDeckScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tab;
  final _urlCtrl = TextEditingController();
  final _textCtrl = TextEditingController();
  final _nameCtrl = TextEditingController();
  final _linkCtrl = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _tab = TabController(length: 2, vsync: this);
  }

  @override
  void dispose() {
    _tab.dispose();
    _urlCtrl.dispose();
    _textCtrl.dispose();
    _nameCtrl.dispose();
    _linkCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF1F2937),
      appBar: AppBar(
        title: const Text('Add deck'),
        backgroundColor: const Color(0xFF111827),
        bottom: TabBar(
          controller: _tab,
          labelColor: const Color(0xFF60A5FA),
          unselectedLabelColor: Colors.white70,
          indicatorColor: const Color(0xFF60A5FA),
          tabs: const [
            Tab(text: 'From URL'),
            Tab(text: 'Paste text'),
          ],
        ),
      ),
      body: TabBarView(controller: _tab, children: [_urlForm(), _textForm()]),
    );
  }

  Widget _urlForm() {
    return Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'Moxfield, Archidekt, ManaBox, or ManaPool URL.',
            style: TextStyle(color: Colors.white70),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _urlCtrl,
            enabled: !_busy,
            style: const TextStyle(color: Colors.white),
            decoration: const InputDecoration(
              hintText: 'https://moxfield.com/decks/...',
              filled: true,
              fillColor: Color(0xFF111827),
              border: OutlineInputBorder(borderSide: BorderSide.none),
            ),
          ),
          const SizedBox(height: 16),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Text(
                _error!,
                style: const TextStyle(color: Color(0xFFF87171)),
              ),
            ),
          FilledButton(
            onPressed: _busy ? null : _submitUrl,
            child: _busy
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white,
                    ),
                  )
                : const Text('Add deck'),
          ),
        ],
      ),
    );
  }

  Widget _textForm() {
    return Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(
            controller: _nameCtrl,
            enabled: !_busy,
            style: const TextStyle(color: Colors.white),
            decoration: const InputDecoration(
              labelText: 'Deck name (optional)',
              filled: true,
              fillColor: Color(0xFF111827),
              border: OutlineInputBorder(borderSide: BorderSide.none),
            ),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _linkCtrl,
            enabled: !_busy,
            style: const TextStyle(color: Colors.white),
            decoration: const InputDecoration(
              labelText: 'External link (optional)',
              filled: true,
              fillColor: Color(0xFF111827),
              border: OutlineInputBorder(borderSide: BorderSide.none),
            ),
          ),
          const SizedBox(height: 8),
          Expanded(
            child: TextField(
              controller: _textCtrl,
              enabled: !_busy,
              maxLines: null,
              expands: true,
              keyboardType: TextInputType.multiline,
              style: const TextStyle(
                color: Colors.white,
                fontFamily: 'Menlo',
                fontSize: 12,
              ),
              decoration: const InputDecoration(
                hintText:
                    '1 Sol Ring\n1 Arcane Signet\n...\n\nCommander\n1 Atraxa',
                filled: true,
                fillColor: Color(0xFF111827),
                border: OutlineInputBorder(borderSide: BorderSide.none),
              ),
            ),
          ),
          const SizedBox(height: 12),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(
                _error!,
                style: const TextStyle(color: Color(0xFFF87171)),
              ),
            ),
          FilledButton(
            onPressed: _busy ? null : _submitText,
            child: _busy
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white,
                    ),
                  )
                : const Text('Add deck'),
          ),
        ],
      ),
    );
  }

  Future<void> _submitUrl() async {
    final url = _urlCtrl.text.trim();
    if (url.isEmpty) {
      setState(() => _error = 'Please enter a URL.');
      return;
    }
    if (!isSupportedDeckUrl(url)) {
      setState(
        () => _error = 'Use a Moxfield, Archidekt, ManaBox, or ManaPool URL.',
      );
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.repo.createFromUrl(url);
      if (!mounted) return;
      Navigator.of(context).pop();
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _submitText() async {
    final text = _textCtrl.text.trim();
    if (text.isEmpty) {
      setState(() => _error = 'Paste a deck list first.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.repo.createFromText(
        text,
        name: _nameCtrl.text.trim().isEmpty ? null : _nameCtrl.text.trim(),
        link: _linkCtrl.text.trim().isEmpty ? null : _linkCtrl.text.trim(),
      );
      if (!mounted) return;
      Navigator.of(context).pop();
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }
}
