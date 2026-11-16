import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.github.jannes105.katanastudio',
  appName: 'Katana Studio',
  webDir: 'dist',
  android: {
    // The app works offline; no remote content.
    allowMixedContent: false,
  },
};

export default config;
