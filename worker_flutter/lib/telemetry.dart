import 'package:sentry_flutter/sentry_flutter.dart';

/// Stable tag values are written as snake_case so they're easy to filter
/// on in Sentry alert rules (e.g. `category:sign_in`).
enum TelemetryCategory {
  boot,
  firebaseInit,
  signIn,
  installer,
  engineStart,
  engineRuntime,
  autoUpdater,
  tray,
}

extension TelemetryCategoryTag on TelemetryCategory {
  String get tagValue {
    switch (this) {
      case TelemetryCategory.boot:
        return 'boot';
      case TelemetryCategory.firebaseInit:
        return 'firebase_init';
      case TelemetryCategory.signIn:
        return 'sign_in';
      case TelemetryCategory.installer:
        return 'installer';
      case TelemetryCategory.engineStart:
        return 'engine_start';
      case TelemetryCategory.engineRuntime:
        return 'engine_runtime';
      case TelemetryCategory.autoUpdater:
        return 'auto_updater';
      case TelemetryCategory.tray:
        return 'tray';
    }
  }
}

/// Thin wrapper around `Sentry.addBreadcrumb` and `Sentry.captureException`
/// so call sites stay readable and the `category` tag is impossible to
/// forget on a capture.
class Telemetry {
  Telemetry._();

  static void breadcrumb(
    TelemetryCategory category,
    String message, {
    Map<String, dynamic>? data,
  }) {
    Sentry.addBreadcrumb(
      Breadcrumb(
        category: category.tagValue,
        message: message,
        data: data,
        level: SentryLevel.info,
      ),
    );
  }

  static Future<void> captureError(
    Object error,
    StackTrace? stack, {
    required TelemetryCategory category,
    Map<String, String>? tags,
    Map<String, dynamic>? extra,
  }) async {
    await Sentry.captureException(
      error,
      stackTrace: stack,
      withScope: (scope) {
        scope.setTag('category', category.tagValue);
        if (tags != null) {
          tags.forEach(scope.setTag);
        }
        if (extra != null) {
          // ignore: deprecated_member_use — `setExtra` is the documented
          // 8.x API. Sentry's 9.x release moves to structured contexts.
          extra.forEach(scope.setExtra);
        }
      },
    );
  }
}

/// Matches typical email addresses. We err on the side of redacting
/// too eagerly rather than ever leaking PII into Sentry.
final _emailRegex = RegExp(r'[\w._%+-]+@[\w.-]+\.[a-zA-Z]{2,}');

const _piiKeys = <String>{
  'email',
  'mail',
  'displayName',
  'display_name',
  'uid',
  'userId',
  'user_id',
};

/// `beforeSend` hook for the Sentry SDK. Replaces any user identifiers
/// with `[redacted]` and redacts known PII in extras / breadcrumb data.
/// Synchronous.
///
/// We rebuild the user rather than null it because `SentryEvent.user`
/// is `final` and `copyWith(user: null)` is interpreted as "leave
/// alone" by sentry-dart. The replacement keeps `[redacted]` in `id`
/// only — SentryUser's constructor asserts at least one identifier is
/// present.
SentryEvent? scrubPii(SentryEvent event, {Hint? hint}) {
  final originalUser = event.user;
  final cleaned = originalUser == null
      ? event
      : event.copyWith(user: SentryUser(id: '[redacted]'));

  // ignore: deprecated_member_use — see comment in Telemetry.captureError.
  final extra = cleaned.extra;
  if (extra != null) {
    for (final key in extra.keys.toList()) {
      if (_piiKeys.contains(key)) {
        extra[key] = '[redacted]';
        continue;
      }
      final value = extra[key];
      if (value is String && _emailRegex.hasMatch(value)) {
        extra[key] = value.replaceAll(_emailRegex, '[redacted-email]');
      }
    }
  }

  final breadcrumbs = cleaned.breadcrumbs;
  if (breadcrumbs != null) {
    for (final crumb in breadcrumbs) {
      final data = crumb.data;
      if (data == null) continue;
      for (final key in data.keys.toList()) {
        if (_piiKeys.contains(key)) {
          data[key] = '[redacted]';
          continue;
        }
        final value = data[key];
        if (value is String && _emailRegex.hasMatch(value)) {
          data[key] = value.replaceAll(_emailRegex, '[redacted-email]');
        }
      }
    }
  }

  return cleaned;
}
