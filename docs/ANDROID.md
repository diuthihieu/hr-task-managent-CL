# woli Android app

The Android app (`mobile/android`) is a **Trusted Web Activity**: an installable APK that opens the live
woli site full screen in Chrome. That means:

- every web deploy reaches the app immediately (no new APK needed for features or fixes);
- Google / Microsoft sign-in work (Chrome, not a web view);
- phones without Chrome fall back to a built-in web view.

A new APK is only needed when the shell itself changes (name, icon, start address, Android settings).
When one is published, users inside the app see "A new woli Android app is available - Download".

## One-time setup

1. **Signing key** (keep it forever - Android only accepts updates signed with the same key).
   Create one, or use the key handed over with the PR that added the app:

   ```bash
   keytool -genkeypair -keystore woli-android-release.jks -storetype PKCS12 -alias woli \
     -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=woli, O=woli, C=VN"
   base64 -w0 woli-android-release.jks > woli-android-release.jks.base64
   keytool -list -v -keystore woli-android-release.jks -alias woli | grep SHA256
   ```

2. **GitHub secrets** (repo > Settings > Secrets and variables > Actions):

   | Secret | Value |
   | --- | --- |
   | `ANDROID_KEYSTORE_BASE64` | contents of `woli-android-release.jks.base64` |
   | `ANDROID_KEYSTORE_PASSWORD` | keystore password |
   | `ANDROID_KEY_ALIAS` | `woli` |
   | `ANDROID_KEY_PASSWORD` | key password |
   | `DESKTOP_RELEASE_TOKEN` | already used by desktop releases; registers the APK with the server |

   Optional repository variable `ANDROID_APP_HOST` (default `woli-work.vercel.app`) - the site the app opens.

3. **Digital Asset Links**: `/.well-known/assetlinks.json` lists the signing certificate's SHA-256
   fingerprint (`src/app/.well-known/assetlinks.json/route.ts`). If you use a different key, set
   `ANDROID_CERT_SHA256` in Vercel (comma list) - otherwise Chrome shows an address bar in the app.

## Releasing

Push a tag (or run the **Android app** workflow manually with a version):

```bash
git tag android-v1.0.0 && git push origin android-v1.0.0
```

The workflow builds the signed APK, attaches it to the GitHub Release `android-v1.0.0` and registers it
as platform `android`. The "Get woli on your phone" dialog then offers **Download woli for Android**
(`/api/desktop/download/latest?platform=android`).

Pull requests that touch `mobile/android` build a debug APK (workflow artifact) to check the code.

## iPhone / iPad

Apple only distributes apps through the App Store / TestFlight (Apple Developer account, review). iPhone
users install woli from Safari (Share > Add to Home Screen): same full-screen app with bottom tabs and
automatic updates.
