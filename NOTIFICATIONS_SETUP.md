# Omegaplus Pro AI notifications setup

The notification implementation uses Firebase Cloud Messaging (FCM), PostgreSQL for device registrations and preferences, and a scheduled call to `POST /api/notifications/dispatch`.

## Required configuration

1. In Firebase Console, create or select a project and add an Android app with package ID `com.omegaplus.proai`.
2. Download `google-services.json`, base64-encode the complete file, and add it as the GitHub Actions repository secret `GOOGLE_SERVICES_JSON_BASE64`. The Android workflow does not publish a release until this is configured.
3. Enable Firebase Cloud Messaging HTTP v1. Create a service account permitted to send FCM messages and store its complete JSON key as the server environment variable `FCM_SERVICE_ACCOUNT_JSON`. Keep this private key server-side.
4. Ensure the backend has `DATABASE_URL` and a strong `CRON_SECRET`.
5. Add GitHub repository secrets `OMEGAPLUS_BASE_URL=https://omegaplus-pro-ai.vercel.app` and `CRON_SECRET` (the same value as the backend secret). The dispatcher workflow runs every five minutes once merged into the default branch.
6. Deploy the backend and Settings changes to the intended hosting environment. The current production website is unchanged until that deployment.

## Notification categories

- **Daily Best available** — once per Nigeria-local day, only if the existing quality rules produce qualifying picks.
- **Premium predictions** — daily, only for eligible Pro/Premium users.
- **Match starting soon** — football and basketball fixtures starting within 20 minutes, with duplicate alerts suppressed.
- **Prediction results** — archived predictions settled as Won, Lost, or Void by the verified-results flow.

Users must sign in, enable notifications in Settings, choose categories, and allow notifications in Android. Categories default to off.

## Security and rollout

- Device tokens are associated with the signed-in account.
- The dispatch endpoint requires `Authorization: Bearer <CRON_SECRET>`.
- Delivery is deduplicated per event and device token.
- Android can compile without Firebase configuration for development, but push is inactive until Firebase is configured; the release workflow skips publishing in that state.
- CI syntax checks and the Android release build passed. Firebase setup, deployment, and a real-device push test remain required.
