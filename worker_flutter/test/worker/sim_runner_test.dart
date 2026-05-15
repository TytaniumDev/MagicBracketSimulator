import 'package:flutter_test/flutter_test.dart';
import 'package:worker_flutter/worker/sim_runner.dart';

/// Tests for the pure parser inside sim_runner.dart.
///
/// The full SimRunner runs a Java child process and is not unit-testable
/// without a real Forge install; we exercise that path in integration
/// tests on a real Mac (see `test/integration/forge_runner_test.dart`,
/// which the user runs manually).
void main() {
  group('parseGameLog', () {
    test('extracts winner and turn from a single-game log', () {
      const log = '''
Some preamble
Game outcome: Turn 23
Game outcome: Ai(4)-Doran has won because all opponents have lost

Game Result: Game 1 ended in 16984 ms. Ai(4)-Doran has won!
''';
      final parsed = parseGameLog(log);
      expect(parsed.winners, ['Ai(4)-Doran']);
      expect(parsed.winningTurns, [23]);
    });

    test('returns empty for log with no winner line', () {
      const log = '''
Game outcome: Turn 5
Some other noise
''';
      final parsed = parseGameLog(log);
      expect(parsed.winners, isEmpty);
      expect(parsed.winningTurns, isEmpty);
    });

    test('handles multiple games in one log', () {
      const log = '''
Game outcome: Turn 12
Game Result: Game 1 ended in 5000 ms. Ai(1)-Alpha has won!
Some text between games
Game outcome: Turn 18
Game Result: Game 2 ended in 7000 ms. Ai(2)-Beta has won!
''';
      final parsed = parseGameLog(log);
      expect(parsed.winners, ['Ai(1)-Alpha', 'Ai(2)-Beta']);
      expect(parsed.winningTurns, [12, 18]);
    });

    test('skips winner line that has no preceding turn marker', () {
      const log = '''
Game Result: Game 1 ended in 1000 ms. Ai(1)-Alpha has won!
''';
      final parsed = parseGameLog(log);
      expect(parsed.winners, ['Ai(1)-Alpha']);
      // Turn marker missing → no turn recorded for this game.
      expect(parsed.winningTurns, isEmpty);
    });

    test('uses the most recent turn marker before a winner line', () {
      const log = '''
Game outcome: Turn 5
Some noise
Game outcome: Turn 10
Game Result: Game 1 ended in 1000 ms. Ai(1)-Alpha has won!
''';
      final parsed = parseGameLog(log);
      expect(parsed.winningTurns, [10]);
    });

    test('parses real-world Forge output format', () {
      // Pulled from the May 2026 spike: Forge 2.0.10 headless on macOS.
      const log = '''
Phase: Ai(4)-Doran Big Butts' Beginning of Combat Step
Combat: Ai(4)-Doran Big Butts assigned Betor, Kin to All (472) to attack Ai(1)-Marchesa.
Game outcome: Turn 23
Game outcome: Ai(1)-Marchesa has lost because life total reached 0
Game outcome: Ai(2)-Cavalry Charge Upgraded has lost because life total reached 0
Game outcome: Ai(3)-Temur Roar Upgraded has lost because life total reached 0
Game outcome: Ai(4)-Doran Big Butts has won because all opponents have lost
Match result: Ai(1)-Marchesa: 0 Ai(2)-Cavalry Charge Upgraded: 0 Ai(3)-Temur Roar Upgraded: 0 Ai(4)-Doran Big Butts: 1

Game Result: Game 1 ended in 16984 ms. Ai(4)-Doran Big Butts has won!
''';
      final parsed = parseGameLog(log);
      expect(parsed.winners, ['Ai(4)-Doran Big Butts']);
      expect(parsed.winningTurns, [23]);
    });

    test('turn count is NOT multiplied by 4 — single game with turn 12', () {
      // Regression guard: a previous bug had us multiplying the turn
      // count by the player count (4) when aggregating. For one game
      // ending on turn 12, winningTurns must be [12], never [48].
      const log = '''
Game outcome: Turn 12
Game Result: Game 1 ended in 5000 ms. Ai(2)-Beta has won!
''';
      final parsed = parseGameLog(log);
      expect(parsed.winningTurns, [12]);
      expect(parsed.winningTurns.first, lessThan(48));
    });

    test('multi-game logs keep per-game turns independent', () {
      // Each "has won" line should consume the most recent preceding
      // turn marker and reset — without that reset, game 2 below
      // would inherit game 1's turn.
      const log = '''
Game outcome: Turn 5
Game Result: Game 1 ended in 1000 ms. Ai(1)-Alpha has won!
Game outcome: Turn 11
Game Result: Game 2 ended in 2000 ms. Ai(2)-Beta has won!
Game outcome: Turn 19
Game Result: Game 3 ended in 3000 ms. Ai(3)-Charlie has won!
''';
      final parsed = parseGameLog(log);
      expect(parsed.winners, ['Ai(1)-Alpha', 'Ai(2)-Beta', 'Ai(3)-Charlie']);
      expect(parsed.winningTurns, [5, 11, 19]);
    });

    test('winning turns from realistic Commander logs land in turn 4–24', () {
      // Commander games regularly resolve between turns 4 and 24 in
      // 4-player random AI play. This test mirrors that band and
      // doubles as a sanity check that the parser doesn't truncate
      // single-digit turns or drop the leading "Turn ".
      final realTurns = [4, 7, 12, 15, 19, 22, 24];
      for (final t in realTurns) {
        final log =
            '''
Game outcome: Turn $t
Game Result: Game 1 ended in 1000 ms. Ai(1)-Test has won!
''';
        final parsed = parseGameLog(log);
        expect(parsed.winningTurns, [t], reason: 'expected turn=$t to parse');
        expect(
          parsed.winningTurns.first,
          inInclusiveRange(1, 100),
          reason:
              'a 4× multiplication bug would push turn=$t into the hundreds',
        );
      }
    });
  });
}
