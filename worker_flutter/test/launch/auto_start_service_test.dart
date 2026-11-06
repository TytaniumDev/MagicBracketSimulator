import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:worker_flutter/launch/auto_start_service.dart';
import 'package:worker_flutter/launch/launch_origin.dart';

/// The login entry is what the OS runs at boot. On Windows it is one
/// registry string, so the path has to be quoted (the install folder has
/// spaces) and must carry the flag that makes the worker start hidden.
void main() {
  const exe =
      r'C:\Users\me\AppData\Local\Magic Bracket Worker\MagicBracketWorker.exe';

  test('Windows quotes the path and passes the login flag', () {
    final entry = loginEntryFor(
      platform: TargetPlatform.windows,
      executable: exe,
    );
    expect(entry.appPath, '"$exe"');
    expect(entry.args, const [launchedAtLoginArg]);
  });

  test('macOS registers the bare app with no arguments', () {
    const app = '/Applications/MagicBracketWorker.app/Contents/MacOS/x';
    final entry = loginEntryFor(
      platform: TargetPlatform.macOS,
      executable: app,
    );
    expect(entry.appPath, app);
    expect(entry.args, isEmpty);
  });
}
