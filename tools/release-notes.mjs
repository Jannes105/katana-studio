// Prints the GitHub Release text for one version: its section of CHANGELOG.md plus a short install note.
// Used by the release workflow; fails when CHANGELOG.md has no section for the version.
//   node tools/release-notes.mjs <version> [versionCode]
import { readFileSync } from 'node:fs';

const [version, versionCode] = process.argv.slice(2);
if (!version) {
  console.error('usage: node tools/release-notes.mjs <version> [versionCode]');
  process.exit(2);
}

const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const lines = changelog.split('\n');
const start = lines.findIndex((l) => l === `## ${version}` || l.startsWith(`## ${version} `));
if (start < 0) {
  console.error(`CHANGELOG.md has no section "## ${version}". Add one in the version bump.`);
  process.exit(1);
}
let end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
if (end < 0) end = lines.length;
const body = lines
  .slice(start + 1, end)
  .join('\n')
  .trim()
  .replace(/^### /gm, '#### ')
  // GitHub shows line breaks in release texts, so a wrapped list item goes back onto one line.
  .replace(/\n {2}(?=\S)/g, ' ');
if (!body) {
  console.error(`The section "## ${version}" in CHANGELOG.md is empty.`);
  process.exit(1);
}

const signed = versionCode ? `Signed APK, versionCode ${versionCode}. ` : 'Signed APK. ';
console.log(`${body}

---

**Install:** download \`katana-studio-${version}.apk\` below and open it on the phone (Android 10 or newer). Updates install over the previous version.

${signed}Unofficial hobby project, not affiliated with BOSS/Roland.`);
