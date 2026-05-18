import 'deck_record.dart';

/// Mode-agnostic deck storage abstraction. Two implementations:
/// [CloudDeckRepo] (Firestore + MBS API) and [OfflineDeckRepo]
/// (local Drift + Dart ingestion).
abstract class DeckRepo {
  /// Live stream of decks visible to the current user. Cloud mode:
  /// the user's own decks plus all precons. Offline mode: bundled
  /// precons followed by user-added decks.
  Stream<List<DeckRecord>> watchDecks();

  /// Fetch the deck from the provider URL, save it, return the new
  /// record. Throws `FormatException` if the URL is not a supported
  /// provider; `StateError` for HTTP failures the user should see.
  Future<DeckRecord> createFromUrl(String url);

  /// Parse pasted deck text. [name] overrides the auto-detected name;
  /// [link] is an optional external URL stored alongside the deck.
  Future<DeckRecord> createFromText(String text, {String? name, String? link});

  /// Delete a deck. Implementations refuse to delete precons.
  Future<void> deleteDeck(DeckRecord deck);
}
