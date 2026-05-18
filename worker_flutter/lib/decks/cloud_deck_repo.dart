import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:rxdart/rxdart.dart';

import '../api_client.dart';
import 'deck_record.dart';
import 'deck_repo.dart';

/// Cloud-mode deck repo: streams decks from Firestore, delegates
/// writes to the MBS Next.js API. Server is the source of truth —
/// `createFromUrl`/`createFromText` resolve the new record by reading
/// the API's response document directly rather than waiting for the
/// Firestore snapshot to catch up.
class CloudDeckRepo implements DeckRepo {
  CloudDeckRepo({
    required this.api,
    FirebaseFirestore? firestore,
    FirebaseAuth? auth,
  }) : _firestore = firestore ?? FirebaseFirestore.instance,
       _auth = auth ?? FirebaseAuth.instance;

  final ApiClient api;
  final FirebaseFirestore _firestore;
  final FirebaseAuth _auth;

  @override
  Stream<List<DeckRecord>> watchDecks() {
    final uid = _auth.currentUser?.uid;
    if (uid == null) return Stream.value(const []);
    // Firestore's `where(... isEqualTo:)` only takes a single value, so
    // we run the precon and owner queries in parallel and merge — the
    // alternative `whereIn` needs a composite index per project.
    final precons = _firestore
        .collection('decks')
        .where('isPrecon', isEqualTo: true)
        .snapshots();
    final owned = _firestore
        .collection('decks')
        .where('ownerId', isEqualTo: uid)
        .snapshots();
    return Rx.combineLatest2<
      QuerySnapshot<Map<String, dynamic>>,
      QuerySnapshot<Map<String, dynamic>>,
      List<DeckRecord>
    >(precons, owned, (a, b) {
      final seen = <String>{};
      final out = <DeckRecord>[];
      for (final doc in [...a.docs, ...b.docs]) {
        if (!seen.add(doc.id)) continue;
        out.add(_fromDoc(doc));
      }
      // Precons first, then user decks alphabetical — mirrors the web
      // frontend's default order.
      out.sort((x, y) {
        if (x.isPrecon != y.isPrecon) return x.isPrecon ? -1 : 1;
        return x.name.toLowerCase().compareTo(y.name.toLowerCase());
      });
      return out;
    });
  }

  @override
  Future<DeckRecord> createFromUrl(String url) async {
    final resp = await api.postJson('/api/decks/create', {'deckUrl': url});
    return _fromCreateResponse(resp);
  }

  @override
  Future<DeckRecord> createFromText(
    String text, {
    String? name,
    String? link,
  }) async {
    final body = <String, dynamic>{'deckText': text};
    if (name != null && name.trim().isNotEmpty) body['deckName'] = name.trim();
    if (link != null && link.trim().isNotEmpty) body['deckLink'] = link.trim();
    final resp = await api.postJson('/api/decks/create', body);
    return _fromCreateResponse(resp);
  }

  @override
  Future<void> deleteDeck(DeckRecord deck) async {
    if (deck.isPrecon) {
      throw StateError('Cannot delete bundled precons.');
    }
    await api.delete('/api/decks/${deck.id}');
  }

  DeckRecord _fromDoc(QueryDocumentSnapshot<Map<String, dynamic>> doc) {
    final data = doc.data();
    return DeckRecord(
      id: doc.id,
      name: (data['name'] as String?) ?? '(unnamed)',
      filename: (data['filename'] as String?) ?? '${doc.id}.dck',
      isPrecon: data['isPrecon'] == true,
      colorIdentity: (data['colorIdentity'] as List?)
          ?.whereType<String>()
          .toList(growable: false),
      link: data['link'] as String?,
      primaryCommander: data['primaryCommander'] as String?,
      ownerEmail: data['ownerEmail'] as String?,
    );
  }

  DeckRecord _fromCreateResponse(Map<String, dynamic> resp) {
    // POST /api/decks/create returns `{ deck: DeckListItem }` or just
    // `DeckListItem` depending on shape — handle both defensively.
    final deck = (resp['deck'] is Map) ? resp['deck'] as Map : resp;
    final m = deck.cast<String, dynamic>();
    return DeckRecord(
      id: (m['id'] ?? '').toString(),
      name: (m['name'] as String?) ?? '(unnamed)',
      filename: (m['filename'] as String?) ?? '${m['id']}.dck',
      isPrecon: m['isPrecon'] == true,
      colorIdentity: (m['colorIdentity'] as List?)?.whereType<String>().toList(
        growable: false,
      ),
      link: m['link'] as String?,
      primaryCommander: m['primaryCommander'] as String?,
      ownerEmail: m['ownerEmail'] as String?,
    );
  }
}
