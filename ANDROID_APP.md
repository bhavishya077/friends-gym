# Friends Gym Android test app

This repository now contains a Capacitor Android application with package ID
`com.friendsgym.app`. It bundles the frontend inside the APK and connects to the
live Friends Gym API and Supabase backend.

The test APK uses the hosted HTTPS app inside its native full-screen shell. Web
content, styling, text, Supabase queries, and ordinary JavaScript feature changes
therefore update automatically after deployment without reinstalling the APK.
Changes to native plugins, Android permissions, app icons, or the Capacitor
configuration still require a new APK.

## Download the test APK

Every Android-related push to `main` runs the `Build Android APK` GitHub Action.
After it succeeds, download `Friends-Gym-test.apk` from the `android-latest`
prerelease on GitHub.

Android may ask you to allow installation from your browser or file manager.
This is expected for a directly distributed debug APK.

## Required Supabase setting for native Google sign-in

In Supabase Dashboard > Authentication > URL Configuration, add this exact
redirect URL:

`com.friendsgym.app://auth`

Keep the existing web URL as well:

`https://friends-gym.onrender.com`

Email/password login works inside the app. Google OAuth opens in the secure
system browser and returns to the installed app through the custom URL scheme.

## Production Play Store build

The debug APK is for testing. A Play Store release still needs a private signing
keystore, a signed release AAB, privacy/data-safety declarations, screenshots,
and Play Console testing.
