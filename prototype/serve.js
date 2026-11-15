// Mini-Webserver für die Katana-Testseite.
// Start:  node serve.js
// PC:     http://localhost:8080
// Handy:  http://<PC-IP>:8080  (Chrome-Flag nötig, siehe Anleitung)
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 8080;
const FILE = path.join(__dirname, 'katana-test.html');

http.createServer((req, res) => {
  fs.readFile(FILE, (err, data) => {
    if (err) { res.writeHead(500); res.end('Fehler: ' + err.message); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(data);
  });
}).listen(PORT, '0.0.0.0', () => {
  console.log(`PC:    http://localhost:${PORT}`);
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const n of nets) {
      if (n.family === 'IPv4' && !n.internal) console.log(`Handy: http://${n.address}:${PORT}`);
    }
  }
  console.log('Beenden mit Strg+C');
});
