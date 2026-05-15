import 'package:flutter/foundation.dart';
import 'package:sentry_flutter/sentry_flutter.dart';

import 'telemetry.dart';

/// Apply the worker's crash-reporting policy to a [SentryFlutterOptions].
/// Extracted from `main.dart` so it's unit-testable without booting
/// Flutter or sentry_flutter's native side.
///
/// - No performance / profiling (we don't pay for tracing volume).
/// - Auto session tracking on (drives release health).
/// - PII scrubbing via [scrubPii] in `beforeSend`.
/// - Empty DSN is fine: the SDK treats it as disabled, which matches
///   our dev-build behavior (no `--dart-define=SENTRY_DSN=...`).
void configureSentryOptions(
  SentryFlutterOptions options, {
  required String dsn,
  required String release,
  required String gitSha,
}) {
  options.dsn = dsn;
  options.release = release;
  options.dist = gitSha;
  options.environment = kDebugMode ? 'development' : 'production';
  options.tracesSampleRate = 0;
  // `profilesSampleRate` is experimental in sentry_flutter 8.x. We pin
  // it to 0 explicitly so a future default flip doesn't silently start
  // sending profiles before we've decided we want them.
  // ignore: experimental_member_use
  options.profilesSampleRate = 0;
  options.enableAutoSessionTracking = true;
  options.autoSessionTrackingInterval = const Duration(seconds: 30);
  options.sendDefaultPii = false;
  options.beforeSend = (event, hint) => scrubPii(event, hint: hint);
}
