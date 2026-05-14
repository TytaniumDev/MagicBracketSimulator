import 'dart:async';

import 'package:firebase_auth_mocks/firebase_auth_mocks.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:worker_flutter/auth/auth_gate_screen.dart';
import 'package:worker_flutter/auth/auth_service.dart';

/// Widget tests for `AuthGateScreen`. The screen is the only thing
/// between a cloud-mode user and their dashboard, so its error-
/// surfacing has to be visible (rather than crashing or stalling) and
/// the "Switch to offline" escape hatch must always work.
void main() {
  testWidgets('shows the Google sign-in button on supported platforms', (
    tester,
  ) async {
    final stub = _StubAuthService();
    var receivedUser = false;
    await tester.pumpWidget(
      MaterialApp(
        home: AuthGateScreen(
          authService: stub,
          onAuthed: (_) => receivedUser = true,
          onSwitchToOffline: () {},
        ),
      ),
    );
    expect(find.text('Sign in with Google'), findsOneWidget);
    expect(receivedUser, isFalse);
  });

  testWidgets('successful sign-in fires onAuthed with the user', (
    tester,
  ) async {
    final stub = _StubAuthService(
      result: AuthedUser(uid: 'u-1', email: 'p@example.com', displayName: 'P'),
    );
    AuthedUser? received;
    await tester.pumpWidget(
      MaterialApp(
        home: AuthGateScreen(
          authService: stub,
          onAuthed: (u) => received = u,
          onSwitchToOffline: () {},
        ),
      ),
    );

    await tester.tap(find.text('Sign in with Google'));
    // Spinner appears while the future is pending.
    await tester.pump();
    expect(find.text('Signing in…'), findsOneWidget);

    stub.complete();
    await tester.pump();
    await tester.pump();

    expect(received, isNotNull);
    expect(received!.uid, 'u-1');
  });

  testWidgets('AuthCancelledException renders the cancellation message', (
    tester,
  ) async {
    final stub = _StubAuthService(error: const AuthCancelledException());
    await tester.pumpWidget(
      MaterialApp(
        home: AuthGateScreen(
          authService: stub,
          onAuthed: (_) {},
          onSwitchToOffline: () {},
        ),
      ),
    );

    await tester.tap(find.text('Sign in with Google'));
    await tester.pump();
    stub.complete();
    await tester.pump();
    await tester.pump();

    expect(find.text('Sign-in cancelled.'), findsOneWidget);
    // Button re-enables so the user can retry from the same screen.
    expect(find.text('Sign in with Google'), findsOneWidget);
    expect(find.text('Signing in…'), findsNothing);
  });

  testWidgets('generic exceptions render with the failure prefix', (
    tester,
  ) async {
    final stub = _StubAuthService(error: StateError('network down'));
    await tester.pumpWidget(
      MaterialApp(
        home: AuthGateScreen(
          authService: stub,
          onAuthed: (_) {},
          onSwitchToOffline: () {},
        ),
      ),
    );

    await tester.tap(find.text('Sign in with Google'));
    await tester.pump();
    stub.complete();
    await tester.pump();
    await tester.pump();

    // The error string is whatever the exception's toString() emits,
    // prefixed with "Sign-in failed: ". The prefix is the contract.
    expect(
      find.textContaining('Sign-in failed:'),
      findsOneWidget,
      reason: 'unexpected errors must surface with the failure prefix',
    );
  });

  testWidgets('Switch to offline button fires the callback', (tester) async {
    var switched = false;
    await tester.pumpWidget(
      MaterialApp(
        home: AuthGateScreen(
          authService: _StubAuthService(),
          onAuthed: (_) {},
          onSwitchToOffline: () => switched = true,
        ),
      ),
    );
    await tester.tap(find.text('Switch to offline mode instead'));
    await tester.pump();
    expect(switched, isTrue);
  });

  testWidgets('retry after error clears the prior message', (tester) async {
    // First attempt fails; second succeeds. The prior error text must
    // disappear on retry — otherwise it lingers next to a spinner.
    final stub = _StubAuthService(error: const AuthCancelledException());
    await tester.pumpWidget(
      MaterialApp(
        home: AuthGateScreen(
          authService: stub,
          onAuthed: (_) {},
          onSwitchToOffline: () {},
        ),
      ),
    );

    await tester.tap(find.text('Sign in with Google'));
    await tester.pump();
    stub.complete();
    await tester.pump();
    await tester.pump();
    expect(find.text('Sign-in cancelled.'), findsOneWidget);

    stub.armNext(
      result: AuthedUser(uid: 'u', email: 'e', displayName: 'd'),
    );
    await tester.tap(find.text('Sign in with Google'));
    await tester.pump();
    expect(
      find.text('Sign-in cancelled.'),
      findsNothing,
      reason: 'the error from the previous attempt must clear immediately',
    );
  });
}

/// Subclass-based stub. AuthService has no abstract interface so we
/// extend it and override `signIn()`. The upstream services are real
/// mocks but never get called.
class _StubAuthService extends AuthService {
  _StubAuthService({this.result, this.error})
    : super(googleSignIn: GoogleSignIn(), firebaseAuth: MockFirebaseAuth());

  AuthedUser? result;
  Object? error;
  Completer<AuthedUser>? _pending;

  /// Replace the next-call response without rebuilding the widget.
  void armNext({AuthedUser? result, Object? error}) {
    this.result = result;
    this.error = error;
    _pending = null;
  }

  @override
  Future<AuthedUser> signIn() {
    _pending = Completer<AuthedUser>();
    return _pending!.future;
  }

  /// Release the in-flight `signIn` future so the widget moves past
  /// the spinner state.
  void complete() {
    final p = _pending!;
    if (error != null) {
      p.completeError(error!);
    } else if (result != null) {
      p.complete(result!);
    } else {
      p.completeError(StateError('test stub not armed'));
    }
  }
}
