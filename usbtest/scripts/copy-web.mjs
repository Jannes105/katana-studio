// Copies ../testpages into ./www (the Capacitor webDir).
// Leaves out everything that is only needed for development on the PC.
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, '..', 'testpages');
const dest = join(root, 'www');

const skipNames = new Set(['node_modules', 'package.json', 'package-lock.json', 'serve.js']);

if (!existsSync(src)) {
  console.error(`copy-web: source folder not found: ${src}`);
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });

cpSync(src, dest, {
  recursive: true,
  filter: (path) => {
    const name = basename(path);
    return !skipNames.has(name) && !name.endsWith('.test.js');
  },
});

// Capacitor needs an index.html in the webDir root. The real start page is usb/index.html.
// Relative URLs inside that page only resolve correctly if the page is loaded from /usb/,
// so the root page just forwards to it.
writeFileSync(
  join(dest, 'index.html'),
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Katana USB Test</title>
<script>location.replace('usb/index.html');</script>
</head>
<body>
<p><a href="usb/index.html">Open the USB test page</a></p>
</body>
</html>
`,
);

if (!existsSync(join(dest, 'usb', 'index.html'))) {
  console.warn('copy-web: WARNING: testpages/usb/index.html does not exist yet, the app will show a broken start page.');
}
console.log(`copy-web: copied ${src} -> ${dest}`);
