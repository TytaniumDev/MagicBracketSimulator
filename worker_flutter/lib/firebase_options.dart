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
  // The `flutterfire configure` CLI will overwrite this whole file.
  static const FirebaseOptions macos = FirebaseOptions(
    apiKey: 'STUB_API_KEY',
    appId: 'STUB_APP_ID',
    messagingSenderId: 'STUB_SENDER_ID',
    projectId: 'STUB_PROJECT_ID',
    storageBucket: 'STUB_STORAGE_BUCKET',
    iosBundleId: 'com.tytaniumdev.workerFlutter',
  );
}
