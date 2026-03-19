const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { createServer } = require('http');
const https = require('https');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const PORT = 3000;

// ── Static files (serve index.html) ──────────────────────────────────────────
app.use(express.static(path.join(__dirname)));

// ── REST proxy routes ─────────────────────────────────────────────────────────
const proxyOpts = (target) => ({
  target,
  changeOrigin: true,
  on: {
    error: (err, req, res) => {
      console.error('[proxy error]', err.message);
      res.status(502).json({ error: 'Proxy error: ' + err.message });
    },
  },
});

// Gamma API  →  /api/gamma/*
app.use('/api/gamma', createProxyMiddleware({
  ...proxyOpts('https://gamma-api.polymarket.com'),
  pathRewrite: { '^/api/gamma': '' },
}));

// CLOB API   →  /api/clob/*
app.use('/api/clob', createProxyMiddleware({
  ...proxyOpts('https://clob.polymarket.com'),
  pathRewrite: { '^/api/clob': '' },
}));

// Data API   →  /api/data/*
app.use('/api/data', createProxyMiddleware({
  ...proxyOpts('https://data-api.polymarket.com'),
  pathRewrite: { '^/api/data': '' },
}));

// METAR — fetched server-side to avoid CORS, per-station cache
const metarCache = {};
app.get('/api/metar', (req, res) => {
  const station = (req.query.station || 'EGLC').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const cache   = metarCache[station] || { data: null, ts: 0 };
  const now     = Date.now();
  if (cache.data && now - cache.ts < 60_000) return res.json(cache.data);

  const url = `https://aviationweather.gov/api/data/metar?ids=${station}&format=json&taf=false&hours=48`;
  https.get(url, { headers: { 'User-Agent': 'polydash/1.0' } }, (upstream) => {
    let body = '';
    upstream.on('data', chunk => body += chunk);
    upstream.on('end', () => {
      try {
        const json = JSON.parse(body);
        metarCache[station] = { data: json, ts: Date.now() };
        res.json(json);
      } catch(e) {
        console.error('[metar] parse error', e.message, body.slice(0, 200));
        if (cache.data) return res.json(cache.data);
        res.status(502).json({ error: 'METAR parse error' });
      }
    });
  }).on('error', e => {
    console.error('[metar] fetch error', e.message);
    if (cache.data) return res.json(cache.data);
    res.status(502).json({ error: e.message });
  });
});

// ── WebSocket proxy  (ws://localhost:3000/ws/market → wss://ws-subscriptions-clob.polymarket.com/ws/market) ──
const httpServer = createServer(app);
const wssLocal   = new WebSocket.Server({ noServer: true });

httpServer.on('upgrade', (req, socket, head) => {
  if (req.url === '/ws/market') {
    wssLocal.handleUpgrade(req, socket, head, (clientWs) => {
      wssLocal.emit('connection', clientWs, req);
    });
  } else {
    socket.destroy();
  }
});

wssLocal.on('connection', (clientWs) => {
  const upstream = new WebSocket('wss://ws-subscriptions-clob.polymarket.com/ws/market');

  upstream.on('open',    ()    => console.log('[ws] upstream connected'));
  upstream.on('message', (data) => {
    if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data);
  });
  upstream.on('close',   ()    => clientWs.close());
  upstream.on('error',   (e)   => { console.error('[ws upstream error]', e.message); clientWs.close(); });

  clientWs.on('message', (data) => {
    if (upstream.readyState === WebSocket.OPEN) upstream.send(data);
  });
  clientWs.on('close',   ()    => upstream.close());
  clientWs.on('error',   (e)   => console.error('[ws client error]', e.message));
});

// ── Start ─────────────────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`\n  Polydash running at  http://localhost:${PORT}\n`);
});
