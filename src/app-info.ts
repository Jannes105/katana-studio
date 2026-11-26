// The one place for the app's name and version (PLAN section 2). Subtitle and disclaimer are texts in i18n.ts,
// so they follow the language.
// The version itself lives only in package.json; Gradle reads it there too (versionName). Vite bundles only this
// one field of package.json.
import { version } from '../package.json';

export const APP_NAME = 'Katana Studio';
export const APP_ID = 'io.github.jannes105.katanastudio';
export const APP_VERSION: string = version;
