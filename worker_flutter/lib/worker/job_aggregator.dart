import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

/// Calls `POST /api/jobs/:id/aggregate-if-done` after a sim's
/// terminal write so the API runs `aggregateJobResults` immediately
/// instead of waiting for the 15-min stale-sweeper.
///
/// Failures are non-fatal: the terminal sim state is already in
/// Firestore by the time this fires, and the stale-sweeper picks up
/// any jobs whose fast-path call missed.
class JobAggregator {
  JobAggregator({
    required this.apiUrl,
    required this.workerSecret,
    http.Client? client,
  }) : _client = client ?? http.Client();

  final String apiUrl;
  final String? workerSecret;
  final http.Client _client;

  bool get isConfigured => workerSecret != null && workerSecret!.isNotEmpty;

  Future<void> triggerIfDone(String jobId) async {
    if (!isConfigured) return;
    final uri = Uri.parse('$apiUrl/api/jobs/$jobId/aggregate-if-done');
    try {
      final resp = await _client
          .post(uri, headers: {'X-Worker-Secret': workerSecret!})
          .timeout(const Duration(seconds: 15));
      if (resp.statusCode >= 200 && resp.statusCode < 300) {
        debugPrint('JobAggregator: triggered for $jobId');
      } else {
        debugPrint(
          'JobAggregator: HTTP ${resp.statusCode} for $jobId: ${resp.body}',
        );
      }
    } catch (e) {
      debugPrint('JobAggregator: trigger failed for $jobId: $e');
    }
  }

  void close() => _client.close();
}
