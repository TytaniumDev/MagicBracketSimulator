import 'dart:ffi';
import 'dart:io';

import 'package:ffi/ffi.dart';
import 'package:flutter/foundation.dart';

import 'idle_monitor.dart';

/// [IdleMonitor] for Windows: user idle time from user32's
/// `GetLastInputInfo`, the power source from kernel32's
/// `GetSystemPowerStatus`, and the sleep timer from `powercfg`.
class WindowsIdleMonitor implements IdleMonitor {
  @override
  Future<Duration?> userIdle() async {
    final info = calloc<_LastInputInfo>();
    try {
      info.ref.cbSize = sizeOf<_LastInputInfo>();
      if (_getLastInputInfo(info) == 0) {
        throw StateError('GetLastInputInfo failed');
      }
      // Both are milliseconds since boot in 32 bits, so wrap the gap.
      final idleMs = (_getTickCount() - info.ref.dwTime) & 0xFFFFFFFF;
      return Duration(milliseconds: idleMs);
    } finally {
      calloc.free(info);
    }
  }

  @override
  Future<Duration?> sleepAfter() async {
    const args = ['/query', 'SCHEME_CURRENT', 'SUB_SLEEP', 'STANDBYIDLE'];
    final result = await Process.run('powercfg', args);
    if (result.exitCode != 0) {
      throw ProcessException(
        'powercfg',
        args,
        '${result.stderr}',
        result.exitCode,
      );
    }
    final timeouts = parsePowercfgSleep('${result.stdout}');
    return _onBattery() ? timeouts.battery : timeouts.pluggedIn;
  }

  /// The "Sleep after" timeouts from `powercfg /query ... STANDBYIDLE`. The
  /// labels are translated into the system language, so this reads the hex
  /// values: the last two in the output are the plugged-in and battery
  /// settings, in seconds, 0 for never.
  @visibleForTesting
  static ({Duration pluggedIn, Duration battery}) parsePowercfgSleep(
    String output,
  ) {
    final values = RegExp(r':\s*0x([0-9a-fA-F]+)\s*$', multiLine: true)
        .allMatches(output)
        .map((m) => int.parse(m.group(1)!, radix: 16))
        .toList();
    if (values.length < 2) {
      throw FormatException('powercfg output has no sleep timeouts', output);
    }
    return (
      pluggedIn: Duration(seconds: values[values.length - 2]),
      battery: Duration(seconds: values[values.length - 1]),
    );
  }

  static bool _onBattery() {
    final status = calloc<_SystemPowerStatus>();
    try {
      if (_getSystemPowerStatus(status) == 0) {
        throw StateError('GetSystemPowerStatus failed');
      }
      // 0 is battery, 1 is plugged in, 255 is unknown.
      return status.ref.acLineStatus == 0;
    } finally {
      calloc.free(status);
    }
  }

  static final _user32 = DynamicLibrary.open('user32.dll');
  static final _kernel32 = DynamicLibrary.open('kernel32.dll');

  static final _getLastInputInfo = _user32
      .lookupFunction<
        Int32 Function(Pointer<_LastInputInfo>),
        int Function(Pointer<_LastInputInfo>)
      >('GetLastInputInfo');

  static final _getTickCount = _kernel32
      .lookupFunction<Uint32 Function(), int Function()>('GetTickCount');

  static final _getSystemPowerStatus = _kernel32
      .lookupFunction<
        Int32 Function(Pointer<_SystemPowerStatus>),
        int Function(Pointer<_SystemPowerStatus>)
      >('GetSystemPowerStatus');
}

/// LASTINPUTINFO from winuser.h.
final class _LastInputInfo extends Struct {
  @Uint32()
  external int cbSize;

  @Uint32()
  external int dwTime;
}

/// SYSTEM_POWER_STATUS from winbase.h.
final class _SystemPowerStatus extends Struct {
  @Uint8()
  external int acLineStatus;

  @Uint8()
  external int batteryFlag;

  @Uint8()
  external int batteryLifePercent;

  @Uint8()
  external int systemStatusFlag;

  @Uint32()
  external int batteryLifeTime;

  @Uint32()
  external int batteryFullLifeTime;
}
