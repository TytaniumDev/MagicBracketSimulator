/// Reads the seats and per-seat results off a Firestore job doc.
///
/// A job doc lists its 4 decks as `seats: [{deckId, name, link,
/// colorIdentity}]`, and once aggregated holds `results: {gamesPlayed,
/// seats: [{wins, avgWinTurn}]}` in the same order.
library;

/// One seat's aggregated results.
typedef SeatResult = ({int wins, double? avgWinTurn});

/// The job's deck names, in seat order.
List<String> jobSeatNames(Map<String, dynamic> data) {
  final raw = data['seats'];
  if (raw is! List) return const [];
  return raw
      .whereType<Map>()
      .map((s) => s['name'])
      .whereType<String>()
      .toList(growable: false);
}

/// Each seat's results, in seat order, or null before aggregation.
List<SeatResult>? jobSeatResults(Map<String, dynamic> data) {
  final results = data['results'];
  if (results is! Map) return null;
  final seats = results['seats'];
  if (seats is! List) return null;
  return seats
      .map<SeatResult>((s) {
        final wins = s is Map ? s['wins'] : null;
        final turn = s is Map ? s['avgWinTurn'] : null;
        return (
          wins: wins is num ? wins.toInt() : 0,
          avgWinTurn: turn is num ? turn.toDouble() : null,
        );
      })
      .toList(growable: false);
}
