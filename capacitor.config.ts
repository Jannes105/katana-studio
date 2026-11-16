import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.github.jannes105.katanastudio',
  appName: 'Katana Studio',
  webDir: 'dist',
  // Capacitor would log every plugin call in debug builds; with USB data events that floods logcat and
  // pushes out the plugin's own lines (KatanaUsb), which are the ones needed for troubleshooting.
  loggingBehavior: 'none',
  android: {
    // The app works offline; no remote content.
    allowMixedContent: false,
  },
};

export default config;
