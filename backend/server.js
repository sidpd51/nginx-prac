// Tiny backend with no dependencies. Each container runs one copy with a different NAME.
const http = require('http');
const os = require('os');

const NAME = process.env.NAME || 'app';
const PORT = process.env.PORT || 3000;
let count = 0;

http.createServer((req, res) => {
  count++;
  const log = (s) => console.log(`[${NAME}] ${req.method} ${req.url} -> ${s}`);

  if (req.url === '/health') { log(200); res.end('ok\n'); return; }
  if (req.url === '/fail') { log(500); res.writeHead(500); res.end(`${NAME} failing\n`); return; }
  if (req.url === '/slow') {            // simulates a slow request (useful for least_conn)
    setTimeout(() => { log(200); res.end(`${NAME} slow response\n`); }, 3000);
    return;
  }

  log(200);
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({
    served_by: NAME,
    container_hostname: os.hostname(),
    requests_handled: count,
    path: req.url,
    // These show what nginx added/forwarded to the backend:
    seen_remote_addr: req.socket.remoteAddress,
    x_real_ip: req.headers['x-real-ip'],
    x_forwarded_for: req.headers['x-forwarded-for'],
    x_forwarded_proto: req.headers['x-forwarded-proto'],
    host_header: req.headers['host'],
  }, null, 2) + '\n');
}).listen(PORT, () => console.log(`[${NAME}] listening on ${PORT}`));
