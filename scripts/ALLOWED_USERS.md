# Allowed users (Firestore allowlist)

Only users in the Firestore `allowedUsers` collection can use the app. You manage the list with the `add-allowed-user` script.

## One-time setup: service account key

1. Open [Firebase Console](https://console.firebase.google.com) → your project → **Project settings** (gear) → **Service accounts**.
2. Click **Generate new private key** and save the JSON file somewhere safe (e.g. project root as `firebase-admin-key.json`).
3. **Do not commit this file** (it’s in `.gitignore`).

## Add yourself (first allowed user)

1. Sign in to the app once with your Google account (you’ll see “Access denied” until you’re on the list).
2. From the project root, run:

   ```bash
   npm install
   GOOGLE_APPLICATION_CREDENTIALS=./firebase-admin-key.json node scripts/add-allowed-user.js YOUR_EMAIL@gmail.com
   ```

   Replace `YOUR_EMAIL@gmail.com` with the Gmail address you use to sign in.

3. Refresh the app; you should have access.

## Allow new users (by Gmail)

**Yes, their Gmail address is enough.**

1. They sign in to the app once with that Google account (they’ll see “Access denied”).
2. You run the same script with their email:

   ```bash
   GOOGLE_APPLICATION_CREDENTIALS=./firebase-admin-key.json node scripts/add-allowed-user.js their.name@gmail.com
   ```

3. They refresh the app and can use it.

You can run the script as many times as you like; adding an email that’s already allowed just updates the `addedAt` field.

## Remove access

Remove the user’s document from the `allowedUsers` collection in [Firestore](https://console.firebase.google.com) → **Firestore** → **allowedUsers** → delete the document whose ID is that user’s UID (you can look up UID under **Authentication** → **Users**).

## Deploy Firestore rules (one-time / after rule changes)

If you haven’t deployed the allowlist rules yet, or after editing `firestore.rules`:

```bash
firebase deploy --only firestore:rules
```

You may need to run `firebase login` first.
