// Firebase configuration for the Magic Bracket worker.
//
// This file is intentionally a stub. Before running the app for real, run:
//
//   $ dart pub global activate flutterfire_cli
//   $ flutterfire configure --project=<your-firebase-project-id>
//
// That command will regenerate this file with the correct values pulled from
// your Firebase project. Until then, Firebase.initializeApp() will throw
// FirebaseException unless you fill in the constants below by hand.

import 'package:firebase_core/firebase_core.dart' show FirebaseOptions;
import 'package:flutter/foundation.dart'
    show defaultTargetPlatform, TargetPlatform;

class DefaultFirebaseOptions {
  static FirebaseOptions get currentPlatform {
    if (defaultTargetPlatform == TargetPlatform.macOS) {
      return macos;
    }
    throw UnsupportedError(
      'DefaultFirebaseOptions only configured for macOS in this MVP. '
      'Run `flutterfire configure` to add other platforms.',
    );
  }

  // Replace these with values from your Firebase project's macOS app config.

  static const FirebaseOptions macos = FirebaseOptions(
    apiKey: 'AIzaSyDevBZ3RfwNtrqW7L2ICgmV8QkvoDDvNbc',
    appId: '1:14286370379:ios:eb91598352257eef6d7fce',
    messagingSenderId: '14286370379',
    projectId: 'magic-bracket-simulator',
    databaseURL: 'https://magic-bracket-simulator-default-rtdb.firebaseio.com',
    storageBucket: 'magic-bracket-simulator.firebasestorage.app',
    iosClientId: '14286370379-lfs99gcgmrv03rhpbijdev0bfd2r5u6s.apps.googleusercontent.com',
    iosBundleId: 'com.tytaniumdev.workerFlutter',
  );

  // The `flutterfire configure` CLI will overwrite this whole file.
}