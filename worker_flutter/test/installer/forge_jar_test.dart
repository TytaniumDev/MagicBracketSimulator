import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:worker_flutter/installer/forge_jar.dart';

String jar(String version) =>
    'forge-gui-desktop-$version-jar-with-dependencies.jar';

void main() {
  group('newestForgeJarName', () {
    test('picks the newest version, not the first listed', () {
      expect(newestForgeJarName([jar('2.0.10'), jar('2.0.15')]), jar('2.0.15'));
      expect(newestForgeJarName([jar('2.0.15'), jar('2.0.10')]), jar('2.0.15'));
    });

    test('compares versions numerically', () {
      expect(newestForgeJarName([jar('2.0.9'), jar('2.0.10')]), jar('2.0.10'));
      expect(newestForgeJarName([jar('2.1.0'), jar('2.0.99')]), jar('2.1.0'));
    });

    test('ignores files that are not Forge JARs', () {
      expect(
        newestForgeJarName(['forge.sh', 'res', jar('2.0.15')]),
        jar('2.0.15'),
      );
      expect(newestForgeJarName(['forge.sh', 'forge-gui-mobile.jar']), isNull);
    });
  });

  group('findNewestForgeJar', () {
    test('returns the full path of the newest JAR in the folder', () {
      final dir = Directory.systemTemp.createTempSync('forge_jar_test');
      addTearDown(() => dir.deleteSync(recursive: true));
      for (final name in [jar('2.0.10'), jar('2.0.15'), 'forge.sh']) {
        File('${dir.path}${Platform.pathSeparator}$name').writeAsStringSync('');
      }
      expect(
        findNewestForgeJar(dir.path),
        '${dir.path}${Platform.pathSeparator}${jar('2.0.15')}',
      );
    });

    test('returns null for a missing folder', () {
      expect(
        findNewestForgeJar('${Directory.systemTemp.path}/does-not-exist-forge'),
        isNull,
      );
    });
  });
}
