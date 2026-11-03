import 'dart:io';

import 'package:flutter/foundation.dart';

import 'system_stats.dart';

/// [SystemStats] for macOS, read from `sysctl`, `vm_stat` and `ps`. Each
/// is a small command that returns at once, so sampling every few seconds
/// is cheap.
class MacSystemStats implements SystemStats {
  @override
  Future<int?> totalMemoryMb() async {
    final out = await _run('sysctl', ['-n', 'hw.memsize']);
    final bytes = int.tryParse(out.trim());
    if (bytes == null || bytes <= 0) {
      throw FormatException('Unexpected sysctl hw.memsize output', out);
    }
    return bytes ~/ (1024 * 1024);
  }

  @override
  Future<SystemLoad?> sample() async {
    final outputs = await Future.wait([
      _run('vm_stat', const []),
      _run('ps', ['-A', '-o', '%cpu=']),
    ]);
    return SystemLoad(
      availableMemoryMb: parseVmStatAvailableMb(outputs[0]),
      cpuBusy: parsePsCpuBusy(outputs[1], Platform.numberOfProcessors),
    );
  }

  static Future<String> _run(String command, List<String> args) async {
    final result = await Process.run(command, args);
    if (result.exitCode != 0) {
      throw ProcessException(
        command,
        args,
        '${result.stderr}',
        result.exitCode,
      );
    }
    return '${result.stdout}';
  }

  /// Available RAM from `vm_stat`: free, inactive and speculative pages,
  /// which macOS hands out without paging, times the page size its header
  /// names ("page size of 16384 bytes").
  @visibleForTesting
  static int parseVmStatAvailableMb(String output) {
    final pageSize = int.tryParse(
      RegExp(r'page size of (\d+) bytes').firstMatch(output)?.group(1) ?? '',
    );
    if (pageSize == null) {
      throw FormatException('vm_stat output has no page size', output);
    }
    int pages(String label) {
      final match = RegExp(
        '^$label:\\s+(\\d+)',
        multiLine: true,
      ).firstMatch(output);
      if (match == null) {
        throw FormatException('vm_stat output has no "$label"', output);
      }
      return int.parse(match.group(1)!);
    }

    final available =
        pages('Pages free') +
        pages('Pages inactive') +
        pages('Pages speculative');
    return available * pageSize ~/ (1024 * 1024);
  }

  /// CPU in use from `ps -A -o %cpu=`: every process's share of one core
  /// (a decaying average over the last minute), summed and divided by the
  /// [logicalCores]. Clamped to 0–1.
  @visibleForTesting
  static double parsePsCpuBusy(String output, int logicalCores) {
    var percentOfOneCore = 0.0;
    for (final line in output.split('\n')) {
      percentOfOneCore += double.tryParse(line.trim()) ?? 0;
    }
    final cores = logicalCores > 0 ? logicalCores : 1;
    return (percentOfOneCore / (cores * 100)).clamp(0.0, 1.0);
  }
}
