import 'dart:async';
import 'dart:io';

import '../models/sim.dart';

/// Spawns a Forge `sim` invocation as a child Java process and captures the
/// result. Each call corresponds to one Forge sim invocation (which can run
/// `simsPerInvocation` games — typically 1 for fine-grained progress).
///
/// This is the macOS-native equivalent of `worker/src/worker.ts` Docker
/// container spawning. Verified against Forge 2.0.10 in May 2026:
///   bash forge.sh sim -d d1 d2 d3 d4 -f Commander -n 1 -c 600
/// runs one Commander game headlessly on macOS (no xvfb) and writes the
/// full game log to stdout. Exit 0 on completion.
///
/// Decks are read from `config.decksPath` which on macOS is
/// `~/Library/Application Support/Forge/decks/commander/`. The caller is
/// responsible for ensuring deck files are present BEFORE invoking this.
class SimRunner {
  SimRunner({
    required this.javaPath,
    required this.forgePath,
    this.maxHeapMb = 4096,
    this.timeoutSeconds = 600,
  });

  final String javaPath;
  final String forgePath;
  final int maxHeapMb;
  final int timeoutSeconds;

  /// Run one Forge sim. Returns when the process exits or is cancelled via
  /// [cancelSignal]. The Future never throws — failures are returned as a
  /// [SimResult] with `success: false` and `errorMessage`.
  Future<SimResult> runOne({
    required JobInfo job,
    Future<void>? cancelSignal,
  }) async {
    if (job.deckFilenames.length != 4) {
      return SimResult(
        success: false,
        durationMs: 0,
        winners: const [],
        winningTurns: const [],
        logText: '',
        errorMessage: 'expected 4 decks, got ${job.deckFilenames.length}',
      );
    }

    final forgeJar = '$forgePath/forge-gui-desktop-2.0.10-jar-with-dependencies.jar';
    if (!File(forgeJar).existsSync()) {
      return SimResult(
        success: false,
        durationMs: 0,
        winners: const [],
        winningTurns: const [],
        logText: '',
        errorMessage: 'Forge JAR not found at $forgeJar',
      );
    }
    if (javaPath != 'java' && !File(javaPath).existsSync()) {
      return SimResult(
        success: false,
        durationMs: 0,
        winners: const [],
        winningTurns: const [],
        logText: '',
        errorMessage: 'Java binary not found at $javaPath',
      );
    }

    final args = [
      '-Xmx${maxHeapMb}m',
      '-Dio.netty.tryReflectionSetAccessible=true',
      '-Dfile.encoding=UTF-8',
      // NOTE: do NOT add -Djava.awt.headless=true. Forge initialises an
      // AWT toolkit even in sim mode and that flag causes it to bail
      // silently with exit 1 and no output. forge.sh ships without it.
      '-jar',
      forgeJar,
      'sim',
      '-d',
      ...job.deckFilenames,
      '-f',
      'Commander',
      '-n',
      '1',
      '-c',
      '$timeoutSeconds',
    ];

    final stopwatch = Stopwatch()..start();
    final process = await Process.start(
      javaPath,
      args,
      workingDirectory: forgePath,
      runInShell: false,
    );

    final logBuf = StringBuffer();
    final stdoutSub = process.stdout.listen((data) => logBuf.write(String.fromCharCodes(data)));
    final stderrSub = process.stderr.listen((data) => logBuf.write(String.fromCharCodes(data)));

    var cancelled = false;
    unawaited(cancelSignal?.then((_) {
      cancelled = true;
      process.kill(ProcessSignal.sigterm);
      Future<void>.delayed(const Duration(seconds: 3), () {
        process.kill(ProcessSignal.sigkill);
      });
    }) ?? Future<void>.value());

    final exitCode = await process.exitCode;
    await stdoutSub.cancel();
    await stderrSub.cancel();
    stopwatch.stop();

    final logText = logBuf.toString();
    if (cancelled) {
      return SimResult(
        success: false,
        durationMs: stopwatch.elapsedMilliseconds,
        winners: const [],
        winningTurns: const [],
        logText: logText,
        errorMessage: 'cancelled',
      );
    }

    if (exitCode != 0) {
      return SimResult(
        success: false,
        durationMs: stopwatch.elapsedMilliseconds,
        winners: const [],
        winningTurns: const [],
        logText: logText,
        errorMessage: 'java exited $exitCode',
      );
    }

    final parsed = parseGameLog(logText);
    return SimResult(
      success: parsed.winners.isNotEmpty,
      durationMs: stopwatch.elapsedMilliseconds,
      winners: parsed.winners,
      winningTurns: parsed.winningTurns,
      logText: logText,
      errorMessage: parsed.winners.isEmpty ? 'no winner detected in log' : null,
    );
  }
}

/// Pure log parser. Lives here (not in a separate file) since SimRunner is
/// the only consumer; promoting it to a top-level module would add a barrier
/// without changing the tests we can run on it.
class ParsedGameLog {
  ParsedGameLog({required this.winners, required this.winningTurns});

  final List<String> winners;
  final List<int> winningTurns;
}

/// Extract winners and the turn each game ended on from a Forge sim log.
///
/// Forge writes one or more games per invocation; a winner line looks like:
///   `Game Result: Game N ended in <ms> ms. Ai(X)-<deck-name> has won!`
/// And the most recent `Game outcome: Turn N` line preceding it is the turn
/// the game ended on.
///
/// Mirrors `worker/src/extractWinner.ts` / `extractWinningTurn.ts` so the
/// two implementations stay in sync. See DATA_FLOW.md.
ParsedGameLog parseGameLog(String logText) {
  final winners = <String>[];
  final winningTurns = <int>[];

  final winnerRegex = RegExp(r'Game Result: Game (\d+) ended in \d+ ms\.\s*(.+?) has won!');
  final turnRegex = RegExp(r'Game outcome: Turn (\d+)');

  // For each "has won" line we walk back through the text to find the most
  // recent "Game outcome: Turn N" that precedes it. We do this by tracking
  // turn markers as we scan forward.
  var lastTurn = -1;
  for (final line in logText.split('\n')) {
    final turnMatch = turnRegex.firstMatch(line);
    if (turnMatch != null) {
      lastTurn = int.tryParse(turnMatch.group(1)!) ?? -1;
      continue;
    }
    final winMatch = winnerRegex.firstMatch(line);
    if (winMatch != null) {
      winners.add(winMatch.group(2)!.trim());
      if (lastTurn > 0) {
        winningTurns.add(lastTurn);
        lastTurn = -1; // reset so the next game uses its own turn marker
      }
    }
  }
  return ParsedGameLog(winners: winners, winningTurns: winningTurns);
}
