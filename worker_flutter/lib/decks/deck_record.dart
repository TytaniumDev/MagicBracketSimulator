/// UI-facing deck type used by [DecksScreen] and [NewSimScreen].
///
/// Cloud mode populates this from Firestore `decks` docs; offline
/// mode populates it from the local Drift `decks` table or bundled
/// precon assets. The two modes converge on the same shape so the
/// screens never branch on storage backend.
class DeckRecord {
  DeckRecord({
    required this.id,
    required this.name,
    required this.filename,
    required this.isPrecon,
    this.colorIdentity,
    this.link,
    this.primaryCommander,
    this.ownerEmail,
  });

  /// Cloud: Firestore document id. Offline (user deck): `L<rowId>`.
  /// Offline (precon): `precon:<filename>`. Always unique within the
  /// list a [DeckRepo] emits.
  final String id;
  final String name;

  /// Forge `.dck` filename used both for matching simulation log
  /// "winner=" lines and (in offline mode) for the on-disk path.
  final String filename;

  /// True for bundled precons (read-only, can't be deleted).
  final bool isPrecon;

  /// WUBRG letters (e.g. `['W','U','B']`). Null when ingestion skipped
  /// the Scryfall lookup (offline) or the deck doc lacks it.
  final List<String>? colorIdentity;

  final String? link;
  final String? primaryCommander;

  /// Display-only; cloud mode populates from the deck's owner.
  final String? ownerEmail;
}
