import 'package:flutter/material.dart';

import 'auth_service.dart';

/// Sign-in gate shown to cloud-mode users before the worker engine
/// starts. Stays simple on purpose: one button, one error line, one
/// "switch to offline" escape hatch. The harder logic lives in
/// `AuthService`.
class AuthGateScreen extends StatefulWidget {
  const AuthGateScreen({
    super.key,
    required this.authService,
    required this.onAuthed,
    required this.onSwitchToOffline,
  });

  final AuthService authService;
  final ValueChanged<AuthedUser> onAuthed;
  final VoidCallback onSwitchToOffline;

  @override
  State<AuthGateScreen> createState() => _AuthGateScreenState();
}

class _AuthGateScreenState extends State<AuthGateScreen> {
  bool _signingIn = false;
  String? _errorMessage;

  Future<void> _handleSignIn() async {
    setState(() {
      _signingIn = true;
      _errorMessage = null;
    });
    try {
      final user = await widget.authService.signIn();
      if (!mounted) return;
      widget.onAuthed(user);
    } on AuthCancelledException {
      if (!mounted) return;
      setState(() => _errorMessage = 'Sign-in cancelled.');
    } catch (e) {
      if (!mounted) return;
      setState(() => _errorMessage = 'Sign-in failed: $e');
    } finally {
      if (mounted) setState(() => _signingIn = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              const Icon(
                Icons.cloud_outlined,
                size: 48,
                color: Color(0xFF60A5FA),
              ),
              const SizedBox(height: 16),
              const Text(
                'Sign in to share simulations',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 8),
              const Text(
                'Cloud mode publishes results to the shared Magic Bracket '
                'Firestore so your runs show up in the web leaderboard. '
                'Offline mode keeps everything on this machine.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 13, height: 1.4),
              ),
              const SizedBox(height: 24),
              // `firebase_auth.signInWithProvider` is implemented on
              // every desktop platform we ship, so the button is
              // unconditionally active here. (`AuthService.isSupported`
              // is kept as a static `true` for API stability — if a
              // future platform needs a fallback, this is where it
              // hooks back in.)
              FilledButton.icon(
                onPressed: _signingIn ? null : _handleSignIn,
                icon: _signingIn
                    ? const SizedBox.square(
                        dimension: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.login, size: 18),
                label: Text(_signingIn ? 'Signing in…' : 'Sign in with Google'),
              ),
              if (_errorMessage != null) ...[
                const SizedBox(height: 12),
                Text(
                  _errorMessage!,
                  style: const TextStyle(
                    color: Color(0xFFF87171),
                    fontSize: 12,
                  ),
                  textAlign: TextAlign.center,
                ),
              ],
              const SizedBox(height: 32),
              TextButton(
                onPressed: _signingIn ? null : widget.onSwitchToOffline,
                child: const Text('Switch to offline mode instead'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
