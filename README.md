# Katana Studio

*for BOSS Katana Gen 3*

A custom editor for the BOSS Katana 100 Gen 3 over a USB cable, as an Android app.
Plan and architecture (in German): [docs/PLAN.md](docs/PLAN.md).

## Phase 0 (feasibility)

- `testpages/usb/` – USB test page (WebUSB in Chrome, or the native plugin inside the test APK)
- `testpages/capture/` – Web MIDI capture tool for protocol experiments on the PC
- `usbtest/` – Capacitor test APK with the Kotlin USB plugin ([usbtest/README.md](usbtest/README.md))
- [docs/protocol-notes.md](docs/protocol-notes.md), [docs/testplan/phase-0.md](docs/testplan/phase-0.md)

Run the pages locally: `node testpages/serve.js`, then open http://localhost:8080. Tests: `cd testpages && node --test`.

> Unofficial hobby project, not affiliated with BOSS/Roland. BOSS and Katana are trademarks of Roland Corporation.
