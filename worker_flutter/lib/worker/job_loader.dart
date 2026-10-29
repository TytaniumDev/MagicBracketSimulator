import 'dart:async';
import 'dart:io';

import '../api_client.dart';
import '../models/sim.dart';

/// Fetches what the worker needs to run a job's sims and writes its decks
/// to disk for Forge.
///
/// Calls `GET /api/jobs/:id?view=worker`, which returns the job's 4 decks
/// with their .dck content (job docs only record deck names and ids). Every
/// sim of a job needs the same decks, so the response is kept for the last
/// [cacheSize] jobs.
class JobLoader {
  JobLoader({
    required ApiClient api,
    required this.decksPath,
    this.cacheSize = 8,
  }) : _api = api;

  final ApiClient _api;
  final String decksPath;
  final int cacheSize;

  /// Worker view of each recent job, oldest first. Null when it 404'd.
  final _cache = <String, Future<Map<String, dynamic>?>>{};

  /// The job's info with its decks written under [decksPath], or null when
  /// the job doesn't exist. Throws on other API errors; a failed fetch isn't
  /// cached, so the next sim retries.
  ///
  /// Decks are written on every call, not once per job: another job may
  /// have since written a different list under the same deck name.
  Future<JobInfo?> load(String jobId) async {
    final data = await _workerView(jobId);
    if (data == null) return null;
    return JobInfo(
      jobId: jobId,
      deckFilenames: _writeDecks(data['decks']),
      simulationsPerJob: (data['simulations'] as num?)?.toInt() ?? 1,
    );
  }

  Future<Map<String, dynamic>?> _workerView(String jobId) {
    final cached = _cache.remove(jobId);
    if (cached != null) {
      _cache[jobId] = cached; // most recently used goes last
      return cached;
    }
    final fetching = _fetch(jobId);
    _cache[jobId] = fetching;
    while (_cache.length > cacheSize) {
      _cache.remove(_cache.keys.first);
    }
    fetching.catchError((Object _) {
      if (identical(_cache[jobId], fetching)) _cache.remove(jobId);
      return null;
    });
    return fetching;
  }

  Future<Map<String, dynamic>?> _fetch(String jobId) async {
    try {
      return await _api
          .getJson('/api/jobs/$jobId?view=worker')
          .timeout(const Duration(seconds: 30));
    } on ApiException catch (e) {
      if (e.status == 404) return null;
      rethrow;
    }
  }

  /// Writes each `{name, dck}` deck as `<name>.dck`, since Forge's CLI loads
  /// decks from files. Returns the filenames written.
  List<String> _writeDecks(Object? rawDecks) {
    final filenames = <String>[];
    if (rawDecks is! List) return filenames;
    for (final slot in rawDecks) {
      if (slot is Map && slot['name'] is String && slot['dck'] is String) {
        final name = (slot['name'] as String).replaceAll(
          RegExp(r'[^A-Za-z0-9._-]'),
          '_',
        );
        final filename = '$name.dck';
        final f = File('$decksPath/$filename');
        f.parent.createSync(recursive: true);
        f.writeAsStringSync(slot['dck'] as String);
        filenames.add(filename);
      }
    }
    return filenames;
  }
}
