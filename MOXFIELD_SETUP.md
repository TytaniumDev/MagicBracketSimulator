# Moxfield API Setup

The application supports direct ingestion of Moxfield decks via their API. This requires a User Agent to be configured to identify your application.

## Local Development

1.  Add `MOXFIELD_USER_AGENT` to your `.env` file (or `.env.local`) in `orchestrator-service/`:
    ```bash
    MOXFIELD_USER_AGENT="YourAppName/1.0"
    ```
2.  Restart the development server.

## Firebase Hosting / Cloud Run

To securely store the User Agent in Firebase:

1.  **Set the secret:**
    Using the Firebase CLI, set the secret in your project:
    ```bash
    firebase functions:secrets:set MOXFIELD_USER_AGENT
    ```
    Enter your User Agent string when prompted.

2.  **Grant access to the secret:**
    Update your `firebase.json` or function configuration to allow the function to access this secret.

    *If using Next.js on App Hosting:*
    Ensure your `apphosting.yaml` references the secret (if supported) or use the Google Cloud Console to expose the secret as an environment variable to the underlying Cloud Run service.

    *If using Cloud Functions:*
    Add the secret to your function definition:
    ```typescript
    export const myFunc = onRequest({ secrets: ["MOXFIELD_USER_AGENT"] }, ...);
    ```

    *If using Cloud Run directly:*
    Deploy with the secret exposed as an environment variable:
    ```bash
    gcloud run services update SERVICE_NAME \
      --set-secrets=MOXFIELD_USER_AGENT=MOXFIELD_USER_AGENT:latest
    ```

## Rate Limiting

The application enforces a **global rate limit of 1 request per second** for Moxfield API calls. This is implemented using a Firestore document (`system/moxfield_rate_limit`) to coordinate across multiple server instances.

## Fallback Behavior

If `MOXFIELD_USER_AGENT` is not configured:
- The frontend will detect this and force the user to manually paste the deck list (using the "MTGO Export" format).
- The backend will reject direct URL ingestion for Moxfield links.
