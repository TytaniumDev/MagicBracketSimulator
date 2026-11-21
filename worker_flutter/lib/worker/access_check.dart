import 'dart:async';

import '../api_client.dart';
import '../app_log.dart';
import '../telemetry.dart';

/// What [AccessCheck.run] found out about the signed-in account.
enum AccessStatus {
  /// The API lets this account in, and has copied it to `approved/{uid}`.
  allowed,

  /// The account is signed in but not approved yet.
  notApproved,

  /// The API could not be reached; the failure went to Sentry.
  unknown,
}

/// Asks the API whether the signed-in account is approved, before the worker
/// writes its presence entry.
///
/// `database.rules.json` lets only accounts listed at `approved/{uid}` write
/// presence, and the API writes that entry the first time it lets an account
/// in. A freshly started worker would otherwise write presence before its
/// first API call and get permission denied. `GET /api/me` answers any
/// signed-in user and writes the entry for an approved one.
class AccessCheck {
  AccessCheck({required ApiClient api}) : _api = api;

  final ApiClient _api;

  static const _timeout = Duration(seconds: 30);

  /// Never throws: a failed call is logged, sent to Sentry, and reported as
  /// [AccessStatus.unknown].
  Future<AccessStatus> run() async {
    try {
      final body = await _api.getJson('/api/me').timeout(_timeout);
      final allowed = body['isAllowed'] == true;
      AppLog.event(
        TelemetryCategory.engineStart,
        'access: ${allowed ? 'allowed' : 'not approved'}',
      );
      return allowed ? AccessStatus.allowed : AccessStatus.notApproved;
    } catch (e, st) {
      AppLog.event(TelemetryCategory.engineStart, 'access: check failed: $e');
      await Telemetry.captureError(
        e,
        st,
        category: TelemetryCategory.engineStart,
        extra: {'phase': 'access_check'},
      );
      return AccessStatus.unknown;
    }
  }
}
