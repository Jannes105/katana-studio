// Wiring: picks the device (USB on the phone, the mock amp in the browser) and puts the capture recorder
// between device and queue, so the log screen can export a capture of the session (PLAN 4.7).

import { Capacitor } from '@capacitor/core';
import { APP_VERSION } from '../app-info';
import { AndroidUsbTransport } from '../midi/android-usb';
import type { DeviceTransport } from '../midi/transport';
import { CaptureRecorder, captureToJson } from '../mock/capture';
import { MockDevice } from '../mock/mock-device';
import { AmpConnection } from '../state/connection';

export interface App {
  readonly connection: AmpConnection;
  readonly device: DeviceTransport;
  /** The mock device when running in the browser, for its plug/unplug buttons. */
  readonly mock: MockDevice | null;
  /** The capture of this session as JSON (probe file format). */
  captureJson(): string;
  marker(text: string): void;
}

export function createApp(): App {
  const native = Capacitor.isNativePlatform();
  const mock = native ? null : new MockDevice();
  const device: DeviceTransport = mock ?? new AndroidUsbTransport();
  let recorder: CaptureRecorder | undefined;
  const connection = new AmpConnection(device, {
    wrapTransport: (t) => (recorder = new CaptureRecorder(t, { appVersion: APP_VERSION })),
  });
  // PLAN 4.5 rule 5: read again when the app comes back to the foreground (the Android WebView reports this as a
  // visibility change, no extra plugin needed).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') connection.onForeground();
  });
  return {
    connection,
    device,
    mock,
    captureJson: () => (recorder ? captureToJson(recorder.snapshot()) : '{}'),
    marker: (text) => {
      recorder?.marker(text);
      connection.addLog('info', `Marker: ${text}`);
    },
  };
}
