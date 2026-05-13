import 'package:flutter/material.dart';

import '../launch/mode_picker_screen.dart';

/// Placeholder shell for offline mode. The real implementation lands in
/// Phase 2 of the desktop-app-evolution spec (drift schema + deck picker
/// + job runner + history). For now this screen explains the state and
/// gives the user a way back to the mode picker.
class OfflineApp extends StatelessWidget {
  const OfflineApp({super.key, required this.onSwitchMode});

  final VoidCallback onSwitchMode;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Magic Bracket — Offline',
      debugShowCheckedModeBanner: false,
      theme: ThemeData.dark().copyWith(
        scaffoldBackgroundColor: const Color(0xFF1F2937),
        colorScheme: const ColorScheme.dark(
          primary: Color(0xFF60A5FA),
          surface: Color(0xFF111827),
        ),
      ),
      home: Scaffold(
        body: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 480),
            child: Padding(
              padding: const EdgeInsets.all(32),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Icon(
                    Icons.construction_outlined,
                    color: Color(0xFF60A5FA),
                    size: 48,
                  ),
                  const SizedBox(height: 16),
                  const Text(
                    'Offline mode is coming soon',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 22,
                      fontWeight: FontWeight.w700,
                    ),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 12),
                  const Text(
                    'A fully local deck picker, simulation runner, and '
                    'results view are in active development. For now, '
                    'switch to Cloud Sync to use the worker.',
                    style: TextStyle(color: Colors.white70),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 32),
                  FilledButton(
                    onPressed: () async {
                      await clearRememberedLaunchMode();
                      onSwitchMode();
                    },
                    child: const Text('Switch to Cloud Sync'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
