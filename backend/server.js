// Tiny Express backend. Each container runs one copy with a different NAME.
const express = require('express');
const os = require('os');

const NAME = process.env.NAME || 'app';
const PORT = process.env.PORT || 3000;
let count = 0;

const app = express();

app.use((req, res, next) => {
  count++;
  res.on('finish', () => console.log(`[${NAME}] ${req.method} ${req.originalUrl} -> ${res.statusCode}`));
  next();
});

app.get('/health', (req, res) => res.send('ok\n'));

app.get('/fail', (req, res) => res.status(500).send(`${NAME} failing\n`));

// simulates a slow request (useful for least_conn)
app.get('/slow', (req, res) => {
  setTimeout(() => res.send(`${NAME} slow response\n`), 3000);
});

app.use((req, res) => {
  res.type('json').send(JSON.stringify({
    served_by: NAME,
    container_hostname: os.hostname(),
    requests_handled: count,
    path: req.originalUrl,
    // These show what nginx added/forwarded to the backend:
    seen_remote_addr: req.socket.remoteAddress,
    x_real_ip: req.headers['x-real-ip'],
    x_forwarded_for: req.headers['x-forwarded-for'],
    x_forwarded_proto: req.headers['x-forwarded-proto'],
    host_header: req.headers['host'],
  }, null, 2) + '\n');
});

app.listen(PORT, () => console.log(`[${NAME}] listening on ${PORT}`));
