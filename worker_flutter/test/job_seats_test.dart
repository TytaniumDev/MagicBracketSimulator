import 'package:flutter_test/flutter_test.dart';
import 'package:worker_flutter/cloud/job_seats.dart';

void main() {
  final job = <String, dynamic>{
    'seats': [
      for (final name in ['Alpha', 'Beta', 'Gamma', 'Delta'])
        {'deckId': name.toLowerCase(), 'name': name, 'link': null},
    ],
    'results': {
      'gamesPlayed': 8,
      'seats': [
        {'wins': 5, 'avgWinTurn': 7.5},
        {'wins': 3, 'avgWinTurn': 9},
        {'wins': 0, 'avgWinTurn': null},
        {'wins': 0, 'avgWinTurn': null},
      ],
    },
  };

  test('jobSeatNames lists the deck names in seat order', () {
    expect(jobSeatNames(job), ['Alpha', 'Beta', 'Gamma', 'Delta']);
    expect(jobSeatNames(<String, dynamic>{}), isEmpty);
  });

  test('jobSeatResults reads each seat, in order', () {
    final results = jobSeatResults(job)!;
    expect(results.map((r) => r.wins), [5, 3, 0, 0]);
    expect(results[1].avgWinTurn, 9.0);
    expect(results[2].avgWinTurn, isNull);
  });

  test('jobSeatResults is null before aggregation', () {
    expect(jobSeatResults(<String, dynamic>{'seats': job['seats']}), isNull);
  });
}
