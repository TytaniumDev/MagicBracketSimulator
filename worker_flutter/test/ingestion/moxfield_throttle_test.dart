import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart' as testing;
import 'package:worker_flutter/ingestion/moxfield.dart';

/// Guards the rate-limit reservation fix. Two concurrent fetches must
/// not both fire inside the same 1-second window — the second has to
/// wait at least ~1s past the first.
void main() {
  test(
    'two concurrent fetches honor the 1-req/sec minimum gap',
    () async {
      final fireTimes = <DateTime>[];
      final fake = testing.MockClient((req) async {
        fireTimes.add(DateTime.now());
        return http.Response(
          '{"name":"Test","boards":{}}',
          200,
          headers: {'content-type': 'application/json'},
        );
      });
      final client = MoxfieldClient(client: fake, userAgent: 'test');

      final futures = await Future.wait([
        client.fetchByDeckId('a'),
        client.fetchByDeckId('b'),
      ]);

      expect(futures, hasLength(2));
      expect(fireTimes, hasLength(2));
      final gap = fireTimes[1].difference(fireTimes[0]).inMilliseconds.abs();
      expect(
        gap >= 950, // ~1s, with ~50ms scheduler slack
        isTrue,
        reason: 'expected ~1s between rate-limited fires, got ${gap}ms',
      );
    },
    timeout: const Timeout(Duration(seconds: 5)),
  );
}
