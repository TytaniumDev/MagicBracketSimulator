import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:worker_flutter/launch/launch_origin.dart';

/// A launch at login must start hidden in the tray; every other launch
/// shows the dashboard. Getting this wrong either pops the window up on
/// every boot or hides it when the user opened the app on purpose.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  tearDown(() {
    debugDefaultTargetPlatformOverride = null;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(LaunchOriginDetector.channel, null);
  });

  group('launchOriginFromArgs', () {
    test('is a login launch only when the login flag is passed', () {
      expect(launchOriginFromArgs(const []), LaunchOrigin.user);
      expect(launchOriginFromArgs(const ['--other']), LaunchOrigin.user);
      expect(
        launchOriginFromArgs(const ['--other', launchedAtLoginArg]),
        LaunchOrigin.login,
      );
    });
  });

  test('only a login launch starts hidden', () {
    expect(LaunchOrigin.login.startsHidden, isTrue);
    expect(LaunchOrigin.user.startsHidden, isFalse);
  });

  group('LaunchOriginDetector.detect', () {
    test('Windows reads the login flag from the arguments', () async {
      debugDefaultTargetPlatformOverride = TargetPlatform.windows;
      expect(
        await LaunchOriginDetector.detect(const [launchedAtLoginArg]),
        LaunchOrigin.login,
      );
      expect(await LaunchOriginDetector.detect(const []), LaunchOrigin.user);
    });

    void answerMac(Object? answer) {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(LaunchOriginDetector.channel, (call) async {
            expect(call.method, 'launchedAtLogin');
            return answer;
          });
    }

    test('macOS asks the native bridge', () async {
      debugDefaultTargetPlatformOverride = TargetPlatform.macOS;
      answerMac(true);
      expect(await LaunchOriginDetector.detect(const []), LaunchOrigin.login);
      answerMac(false);
      expect(await LaunchOriginDetector.detect(const []), LaunchOrigin.user);
    });

    test('macOS ignores the Windows login flag', () async {
      debugDefaultTargetPlatformOverride = TargetPlatform.macOS;
      answerMac(false);
      expect(
        await LaunchOriginDetector.detect(const [launchedAtLoginArg]),
        LaunchOrigin.user,
      );
    });

    test('macOS bridge errors reach the caller', () async {
      debugDefaultTargetPlatformOverride = TargetPlatform.macOS;
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(LaunchOriginDetector.channel, (call) async {
            throw PlatformException(code: 'boom');
          });
      expect(
        LaunchOriginDetector.detect(const []),
        throwsA(isA<PlatformException>()),
      );
    });

    test('other platforms are always a user launch', () async {
      debugDefaultTargetPlatformOverride = TargetPlatform.linux;
      expect(
        await LaunchOriginDetector.detect(const [launchedAtLoginArg]),
        LaunchOrigin.user,
      );
    });
  });
}
