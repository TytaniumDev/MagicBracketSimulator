import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:worker_flutter/offline/deck_source.dart';

void main() {
  group('loadBundledPrecons', () {
    late Directory tempForge;

    setUp(() async {
      tempForge = await Directory.systemTemp.createTemp('deck_source_test_');
    });

    tearDown(() async {
      if (tempForge.existsSync()) tempForge.deleteSync(recursive: true);
    });

    test('returns empty when the Commander dir is missing', () async {
      // No `res/Decks/Commander` subtree — represents a fresh install
      // before the user has run the first-launch installer.
      final precons = await loadBundledPrecons(tempForge.path);
      expect(precons, isEmpty);
    });

    test('reads .dck files, humanizes names, sorts alphabetically', () async {
      final commander = Directory(
        p.join(tempForge.path, 'res', 'Decks', 'Commander'),
      );
      commander.createSync(recursive: true);
      File(
        p.join(commander.path, 'marchesa-control-upgraded.dck'),
      ).writeAsStringSync('[Main]\n');
      File(
        p.join(commander.path, 'Alpha_Two_Words.dck'),
      ).writeAsStringSync('[Main]\n');
      // Also drop a non-.dck file to verify we skip it.
      File(p.join(commander.path, 'README.txt')).writeAsStringSync('ignore me');

      final precons = await loadBundledPrecons(tempForge.path);

      expect(precons.length, 2);
      // Alphabetical case-insensitive ordering.
      expect(precons[0].displayName, 'Alpha Two Words');
      expect(precons[1].displayName, 'Marchesa Control Upgraded');
      // Filenames preserved unchanged for SimRunner's `-d` arg.
      expect(precons[0].filename, 'Alpha_Two_Words.dck');
      expect(precons[1].filename, 'marchesa-control-upgraded.dck');
    });

    test('recurses into subdirs (Forge groups precons by set/year)', () async {
      // Forge bundles precons in nested subdirs like
      // `res/Decks/Commander/2023/Eldritch.dck`. The picker should
      // surface them flatly.
      final nested = Directory(
        p.join(tempForge.path, 'res', 'Decks', 'Commander', '2023'),
      );
      nested.createSync(recursive: true);
      File(p.join(nested.path, 'Eldritch.dck')).writeAsStringSync('[Main]\n');

      final precons = await loadBundledPrecons(tempForge.path);
      expect(precons.length, 1);
      expect(precons.first.displayName, 'Eldritch');
    });

    test('humanizes hyphens, underscores, and mixed-case filenames', () async {
      final commander = Directory(
        p.join(tempForge.path, 'res', 'Decks', 'Commander'),
      )..createSync(recursive: true);
      final cases = {
        'doran-big-butts': 'Doran Big Butts',
        'temur_roar_upgraded': 'Temur Roar Upgraded',
        'BANT-Spirits': 'BANT Spirits',
        'single': 'Single',
      };
      for (final filename in cases.keys) {
        File(
          p.join(commander.path, '$filename.dck'),
        ).writeAsStringSync('[Main]\n');
      }
      final precons = await loadBundledPrecons(tempForge.path);
      for (final entry in cases.entries) {
        expect(
          precons.any((d) => d.displayName == entry.value),
          isTrue,
          reason: '${entry.key} should humanize to "${entry.value}"',
        );
      }
    });
  });
}
