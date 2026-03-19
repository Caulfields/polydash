// Local development server.
// On Vercel, api/* serverless functions handle proxying instead.
// WebSocket connects directly from the browser to Polymarket's WSS endpoint.

const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const https = require('https');
const path  = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Static files ──────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname)));

// ── /api/me — serve USER_ADDRESS from env var ─────────────────────────────────
app.get('/api/me', (req, res) => {
  res.json({ address: process.env.USER_ADDRESS || '' });
});

// ── REST proxy helpers ────────────────────────────────────────────────────────
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
  const raw     = (req.query.station || 'EGLC') + '';
  const station = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  if (!/^[A-Z0-9]{3,4}$/.test(station)) return res.status(400).json({ error: 'Invalid station' });

  const cache = metarCache[station] || { data: null, ts: 0 };
  const now   = Date.now();
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
        if (cache.data) return res.json(cache.data);
        res.status(502).json({ error: 'METAR parse error' });
      }
    });
  }).on('error', e => {
    if (cache.data) return res.json(cache.data);
    res.status(502).json({ error: e.message });
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  Polydash running at  http://localhost:${PORT}\n`);
  if (!process.env.USER_ADDRESS) {
    console.warn('  [warn] USER_ADDRESS env var not set — user positions panel will be empty\n');
  }
});
