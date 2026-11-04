import 'dart:ffi';

import 'sleep_guard.dart';

/// [SleepGuard] for Windows: `SetThreadExecutionState` from kernel32.
///
/// The state belongs to the calling thread, which for this app is the
/// Flutter UI thread for its whole life, and Windows drops it when the
/// process exits.
class WindowsSleepGuard implements SleepGuard {
  static const _esContinuous = 0x80000000;
  static const _esSystemRequired = 0x00000001;

  static final _setThreadExecutionState = DynamicLibrary.open('kernel32.dll')
      .lookupFunction<Uint32 Function(Uint32), int Function(int)>(
        'SetThreadExecutionState',
      );

  @override
  Future<void> hold() async => _set(_esContinuous | _esSystemRequired);

  @override
  Future<void> release() async => _set(_esContinuous);

  static void _set(int flags) {
    // Returns the previous state, or 0 when the call failed.
    if (_setThreadExecutionState(flags) == 0) {
      throw StateError('SetThreadExecutionState failed');
    }
  }
}
