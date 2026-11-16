// The one place for the app's name, subtitle and version (PLAN section 2).
// The version itself lives only in package.json; Gradle reads it there too (versionName). Vite bundles only this
// one field of package.json.
import { version } from '../package.json';

export const APP_NAME = 'Katana Studio';
export const APP_SUBTITLE = 'for BOSS Katana Gen 3';
export const APP_ID = 'io.github.jannes105.katanastudio';
export const APP_VERSION: string = version;

export const DISCLAIMER =
  'Unofficial hobby project, not affiliated with BOSS/Roland. BOSS and Katana are trademarks of Roland Corporation.';
