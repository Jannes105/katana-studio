// Tiny web server for the Katana test page.
// Start:  node serve.js
// PC:     http://localhost:8080
// Phone:  http://<PC-IP>:8080  (plain http on the LAN is not a secure context, so Web MIDI needs a Chrome flag there)
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 8080;
const FILE = path.join(__dirname, 'katana-test.html');

http.createServer((req, res) => {
  fs.readFile(FILE, (err, data) => {
    if (err) { res.writeHead(500); res.end('Error: ' + err.message); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(data);
  });
}).listen(PORT, '0.0.0.0', () => {
  console.log(`PC:    http://localhost:${PORT}`);
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const n of nets) {
      if (n.family === 'IPv4' && !n.internal) console.log(`Phone: http://${n.address}:${PORT}`);
    }
  }
  console.log('Stop with Ctrl+C');
});
