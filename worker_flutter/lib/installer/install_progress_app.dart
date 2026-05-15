import 'package:flutter/material.dart';

import 'installer.dart';

/// First-run installer screen. Shown while the JRE and Forge are being
/// downloaded. The user can sit and watch progress; the engine starts
/// automatically once everything is in place.
class InstallProgressApp extends StatelessWidget {
  const InstallProgressApp({
    super.key,
    required this.installer,
    required this.onComplete,
  });

  final Installer installer;
  final VoidCallback onComplete;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Magic Bracket Worker — Setup',
      debugShowCheckedModeBanner: false,
      theme: ThemeData.dark().copyWith(
        scaffoldBackgroundColor: const Color(0xFF1F2937),
      ),
      home: _InstallScreen(installer: installer, onComplete: onComplete),
    );
  }
}

class _InstallScreen extends StatefulWidget {
  const _InstallScreen({required this.installer, required this.onComplete});

  final Installer installer;
  final VoidCallback onComplete;

  @override
  State<_InstallScreen> createState() => _InstallScreenState();
}

class _InstallScreenState extends State<_InstallScreen> {
  InstallProgress _last = InstallProgress(
    stage: 'starting',
    message: 'Preparing first-run setup…',
    progress: 0,
  );
  Object? _error;

  @override
  void initState() {
    super.initState();
    widget.installer.progressStream.listen((p) {
      if (!mounted) return;
      setState(() => _last = p);
      if (p.stage == 'done') {
        widget.onComplete();
      }
    });
    _run();
  }

  Future<void> _run() async {
    try {
      await widget.installer.install();
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Text(
              'Setting up your worker',
              style: TextStyle(
                fontSize: 22,
                color: Colors.white,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 8),
            const Text(
              'Downloading the Java runtime and Forge engine. This is a '
              'one-time download — about 320 MB total. It runs in the background '
              'on subsequent launches.',
              style: TextStyle(color: Colors.white70),
            ),
            const SizedBox(height: 24),
            _StagePanel(stage: 'jre', label: 'Java 17 runtime', last: _last),
            const SizedBox(height: 16),
            _StagePanel(stage: 'forge', label: 'Forge 2.0.10', last: _last),
            const SizedBox(height: 24),
            if (_error != null)
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Colors.red.shade900,
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  'Setup failed: $_error\n\nCheck your network connection and relaunch.',
                  style: const TextStyle(color: Colors.white, fontSize: 12),
                ),
              ),
            const Spacer(),
            Text(
              _last.message,
              style: const TextStyle(color: Colors.white54, fontSize: 11),
            ),
          ],
        ),
      ),
    );
  }
}

class _StagePanel extends StatelessWidget {
  const _StagePanel({
    required this.stage,
    required this.label,
    required this.last,
  });

  final String stage;
  final String label;
  final InstallProgress last;

  @override
  Widget build(BuildContext context) {
    final isThisStage = last.stage == stage;
    final isDone = !isThisStage &&
        (stage == 'jre' && (last.stage == 'forge' || last.stage == 'done') ||
            stage == 'forge' && last.stage == 'done');
    final progress = isThisStage ? last.progress : (isDone ? 1.0 : 0.0);

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFF111827),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                isDone ? Icons.check_circle : Icons.cloud_download,
                color: isDone ? Colors.greenAccent : Colors.white54,
                size: 18,
              ),
              const SizedBox(width: 8),
              Text(
                label,
                style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600),
              ),
            ],
          ),
          const SizedBox(height: 8),
          ClipRRect(
            borderRadius: BorderRadius.circular(2),
            child: LinearProgressIndicator(
              value: isThisStage && progress > 0 ? progress : (isDone ? 1.0 : null),
              minHeight: 4,
              backgroundColor: Colors.white12,
            ),
          ),
        ],
      ),
    );
  }
}
