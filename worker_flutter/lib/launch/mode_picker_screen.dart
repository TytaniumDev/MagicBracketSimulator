import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// The two boot modes the desktop app supports.
enum LaunchMode { cloud, offline }

extension LaunchModeName on LaunchMode {
  /// Stable string for SharedPreferences serialization.
  String get prefsValue => switch (this) {
    LaunchMode.cloud => 'cloud',
    LaunchMode.offline => 'offline',
  };

  static LaunchMode? fromPrefs(String? raw) => switch (raw) {
    'cloud' => LaunchMode.cloud,
    'offline' => LaunchMode.offline,
    _ => null,
  };
}

/// Persistence key for the user's remembered mode. Read it BEFORE
/// constructing `ModePickerScreen` — if non-null, skip the picker and
/// boot the chosen mode directly.
const kLaunchModePrefsKey = 'launch.mode';

/// First-launch (and every-launch unless "Remember" is checked) screen
/// that lets the user choose between cloud-sync worker mode and a fully
/// local offline mode.
class ModePickerScreen extends StatefulWidget {
  const ModePickerScreen({super.key, required this.onChosen});

  /// Called after the user picks a mode. The picker has already persisted
  /// the choice (if "Remember" was on) before this fires.
  final ValueChanged<LaunchMode> onChosen;

  @override
  State<ModePickerScreen> createState() => _ModePickerScreenState();
}

class _ModePickerScreenState extends State<ModePickerScreen> {
  bool _remember = false;

  Future<void> _pick(LaunchMode mode) async {
    if (_remember) {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(kLaunchModePrefsKey, mode.prefsValue);
    }
    widget.onChosen(mode);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF1F2937),
      body: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              'Magic Bracket',
              style: TextStyle(
                fontSize: 28,
                color: Colors.white,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 4),
            const Text(
              'How would you like to use the desktop app?',
              style: TextStyle(color: Colors.white70),
            ),
            const SizedBox(height: 24),
            Expanded(
              child: Row(
                children: [
                  Expanded(
                    child: _ModeCard(
                      icon: Icons.cloud_sync_outlined,
                      title: 'Cloud Sync',
                      bullets: const [
                        'Sign in with Google',
                        'Pick up jobs queued from the web app',
                        'Results shared with everyone in the project',
                      ],
                      cta: 'Continue with Cloud Sync',
                      onTap: () => _pick(LaunchMode.cloud),
                    ),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: _ModeCard(
                      icon: Icons.cloud_off_outlined,
                      title: 'Offline Mode',
                      bullets: const [
                        'No account, no network',
                        'Pick a bracket from bundled precons',
                        'Everything stored locally on this machine',
                      ],
                      cta: 'Continue offline',
                      onTap: () => _pick(LaunchMode.offline),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            CheckboxListTile(
              value: _remember,
              onChanged: (v) => setState(() => _remember = v ?? false),
              title: const Text(
                'Remember my choice',
                style: TextStyle(color: Colors.white),
              ),
              subtitle: const Text(
                'Skip this screen next time. You can change modes from Settings.',
                style: TextStyle(color: Colors.white54, fontSize: 12),
              ),
              controlAffinity: ListTileControlAffinity.leading,
              activeColor: const Color(0xFF60A5FA),
            ),
          ],
        ),
      ),
    );
  }
}

class _ModeCard extends StatelessWidget {
  const _ModeCard({
    required this.icon,
    required this.title,
    required this.bullets,
    required this.cta,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final List<String> bullets;
  final String cta;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(12),
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: const Color(0xFF111827),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: const Color(0xFF374151)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, color: const Color(0xFF60A5FA), size: 36),
            const SizedBox(height: 12),
            Text(
              title,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 18,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 12),
            ...bullets.map(
              (b) => Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('• ', style: TextStyle(color: Colors.white54)),
                    Expanded(
                      child: Text(
                        b,
                        style: const TextStyle(
                          color: Colors.white70,
                          fontSize: 13,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const Spacer(),
            SizedBox(
              width: double.infinity,
              child: FilledButton(onPressed: onTap, child: Text(cta)),
            ),
          ],
        ),
      ),
    );
  }
}

/// Clear the remembered choice so the next launch goes back to the picker.
Future<void> clearRememberedLaunchMode() async {
  final prefs = await SharedPreferences.getInstance();
  await prefs.remove(kLaunchModePrefsKey);
}

/// Read the remembered choice (or null if unset).
Future<LaunchMode?> readRememberedLaunchMode() async {
  final prefs = await SharedPreferences.getInstance();
  return LaunchModeName.fromPrefs(prefs.getString(kLaunchModePrefsKey));
}
