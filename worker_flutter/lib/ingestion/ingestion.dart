import 'package:http/http.dart' as http;

import 'archidekt.dart';
import 'manabox.dart';
import 'manapool.dart';
import 'moxfield.dart';
import 'parsed_deck.dart';

export 'archidekt.dart' show isArchidektUrl, extractArchidektDeckId;
export 'manabox.dart' show isManaboxUrl, extractManaboxDeckId;
export 'manapool.dart' show isManaPoolUrl, extractManaPoolListId;
export 'moxfield.dart' show isMoxfieldUrl, extractMoxfieldDeckId;
export 'parsed_deck.dart';
export 'scryfall.dart';
export 'text_parser.dart'
    show parseTextDeck, parseTextDeckWithAutoName, extractDeckName;

/// One-stop dispatcher: detect provider from URL, fetch the deck.
/// Used by [OfflineDeckRepo] to materialize URL-provided decks
/// locally. Throws `FormatException` for unrecognized URLs.
class DeckIngestion {
  DeckIngestion({http.Client? client, String? moxfieldUserAgent})
    : _moxfield = MoxfieldClient(client: client, userAgent: moxfieldUserAgent),
      _archidekt = ArchidektClient(client: client),
      _manabox = ManaBoxClient(client: client),
      _manapool = ManaPoolClient(client: client);

  final MoxfieldClient _moxfield;
  final ArchidektClient _archidekt;
  final ManaBoxClient _manabox;
  final ManaPoolClient _manapool;

  Future<ParsedDeck> fetchFromUrl(String url) {
    if (isMoxfieldUrl(url)) return _moxfield.fetchByUrl(url);
    if (isArchidektUrl(url)) return _archidekt.fetchByUrl(url);
    if (isManaboxUrl(url)) return _manabox.fetchByUrl(url);
    if (isManaPoolUrl(url)) return _manapool.fetchByUrl(url);
    throw FormatException(
      'Unsupported deck URL. Use a Moxfield, Archidekt, ManaBox, or ManaPool URL.',
    );
  }
}

/// True if any of our providers will accept this URL.
bool isSupportedDeckUrl(String url) =>
    isMoxfieldUrl(url) ||
    isArchidektUrl(url) ||
    isManaboxUrl(url) ||
    isManaPoolUrl(url);
