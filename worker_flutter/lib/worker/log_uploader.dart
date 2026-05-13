import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

/// Posts a single simulation's raw stdout log to the cloud API.
///
/// Mirrors `worker/src/worker.ts` `uploadSingleSimulationLog`. Filename
/// shape is the same so the frontend's per-sim log links work identically
/// for cloud-mode Flutter workers as they do for the Docker worker.
///
/// Failures are non-fatal: the sim's terminal state has already been
/// written via `SimClaimer.reportTerminal` by the time this runs, so a
/// missed log is a cosmetic loss, not a correctness one.
class LogUploader {
  LogUploader({
    required this.apiUrl,
    required this.workerSecret,
    http.Client? client,
  }) : _client = client ?? http.Client();

  final String apiUrl;
  final String? workerSecret;
  final http.Client _client;

  /// Whether this uploader will actually post. False when the worker
  /// secret is unset — callers should still call `upload()`; it no-ops.
  bool get isConfigured => workerSecret != null && workerSecret!.isNotEmpty;

  /// Upload the log for one sim. `simIndex` is 0-based and matches the
  /// `Sims.index` field in Firestore.
  Future<void> upload({
    required String jobId,
    required int simIndex,
    required String logText,
  }) async {
    if (!isConfigured) return;

    final filename =
        'raw/game_${(simIndex + 1).toString().padLeft(3, '0')}.txt';
    final uri = Uri.parse('$apiUrl/api/jobs/$jobId/logs/simulation');

    try {
      final resp = await _client
          .post(
            uri,
            headers: {
              'Content-Type': 'application/json',
              'X-Worker-Secret': workerSecret!,
            },
            body: jsonEncode({'filename': filename, 'logText': logText}),
          )
          .timeout(const Duration(seconds: 30));
      if (resp.statusCode >= 200 && resp.statusCode < 300) {
        debugPrint(
          'LogUploader: sim_$simIndex log uploaded '
          '(${(logText.length / 1024).toStringAsFixed(1)} KB)',
        );
      } else {
        debugPrint(
          'LogUploader: HTTP ${resp.statusCode} for sim_$simIndex: ${resp.body}',
        );
      }
    } catch (e) {
      debugPrint('LogUploader: sim_$simIndex upload failed: $e');
    }
  }

  void close() => _client.close();
}
