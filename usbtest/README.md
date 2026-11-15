# Katana USB Test (throw-away test app)

A minimal Android app that answers one question: can a phone talk to the BOSS Katana 100 Gen 3 over USB?
The amp is a vendor-specific USB device (VID `0x0582`, PID `0x02F0`, class `FF`), not a standard USB-MIDI
device, so Android does not offer it as a MIDI port. This app opens it through the Android USB host API
and takes the interface with `force`, which a web page in Chrome cannot do.

- App ID: `io.github.jannes105.katanastudio.usbtest` (separate from the real app that comes later)
- Web layer: the static pages from `../testpages`, copied into `www/` by `scripts/copy-web.mjs`.
  Start page is `usb/index.html`.
- Native layer: `android/app/src/main/java/.../KatanaUsbPlugin.kt`, a Capacitor plugin named `KatanaUsb`
  (`listDevices`, `open`, `close`, `send`, events `data`, `attached`, `detached`, `error`, `log`).
  The page reaches it without a bundler through `window.Capacitor.Plugins.KatanaUsb`.

## How CI builds it

`.github/workflows/usbtest-apk.yml` runs on every push that touches `usbtest/`, `testpages/` or the workflow
itself, and can be started by hand (Actions → "USB test APK" → "Run workflow"). It runs the page tests,
copies the pages, runs `npx cap sync android` and `./gradlew assembleDebug`. The result is the artifact
**`katana-usb-test-apk`** on the run's summary page (a zip with `app-debug.apk`, signed with a debug key).

## Install on the phone

1. Download the artifact (on the phone you need to be signed in to GitHub), unzip it.
2. Open `app-debug.apk` and allow the browser or file manager to install unknown apps when asked.
3. Plug in the amp with a USB-C (OTG) cable. Android offers to open "Katana USB Test"; tick "always".

Each CI run signs with a fresh debug key. If an update refuses to install, uninstall the old app first.

## Build locally

Needs JDK 21 and the Android command-line tools (platform `android-36` and matching build-tools; Gradle
downloads itself). Set `ANDROID_HOME`, or write `sdk.dir=...` into `android/local.properties`.

```
npm ci
npm run sync                 # copies ../testpages into www and runs cap sync
cd android
./gradlew assembleDebug      # Windows: gradlew.bat assembleDebug
```

The APK lands in `android/app/build/outputs/apk/debug/app-debug.apk`.
Install it with `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`.

## Logs over Wi-Fi

The USB port is taken by the amp, so use adb over Wi-Fi (Android 11+):

1. Phone: Developer options → Wireless debugging → on → "Pair device with pairing code".
2. PC: `adb pair <ip>:<pairing-port>` and type the code, then `adb connect <ip>:<port>` (the port shown on the
   Wireless debugging screen, not the pairing port).
3. `adb logcat -s KatanaUsb` shows everything the plugin does. Add `Capacitor:V` for the bridge itself:
   `adb logcat -s KatanaUsb Capacitor:V`.

The same messages appear in the on-screen log of the app (event `log`), so adb is optional.
The page can also be inspected from desktop Chrome at `chrome://inspect` while adb is connected.
