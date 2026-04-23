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
// Primary: aviationweather.gov, Fallback: Open-Meteo
const metarCache = {};

const stationCoords = {
  'ZBAA': { lat: 40.0799, lon: 116.6031 }, // Beijing Capital International
  'EGLC': { lat: 51.505, lon: 0.055 },   // London City
  'LFPG': { lat: 48.949675, lon: 2.432356 }, // Legacy Paris code fallback
  'EGLL': { lat: 51.4700, lon: -0.4543 }, // London Heathrow
  'LFPB': { lat: 48.949675, lon: 2.432356 },  // Paris Le Bourget
  'KLGA': { lat: 40.774722, lon: -73.871944 }, // LaGuardia
  'KDAL': { lat: 32.847222, lon: -96.851667 }, // Dallas Love Field
};

function fetchOpenMeteo(station, hours) {
  return new Promise((resolve, reject) => {
    const coords = stationCoords[station];
    if (!coords) return reject(new Error('No coordinates for station'));

    const now = Math.floor(Date.now() / 1000);
    const startTime = now - (hours * 3600);
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&hourly=temperature_2m&start=${startTime}&end=${now}&timezone=auto`;

    https.get(url, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (!json.hourly) return reject(new Error('No hourly data'));
          const temps = json.hourly.temperature_2m;
          const times = json.hourly.time;
          const result = temps.map((temp, i) => ({
            obsTime: times[i],
            temp: Math.round(temp * 10) / 10,
            rawOb: temps[i] + 'C'
          }));
          resolve(result);
        } catch(e) { reject(e); }
      });
    }).on('error', reject);
  });
}

app.get('/api/metar', (req, res) => {
  const raw     = (req.query.station || 'EGLC') + '';
  const station = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  if (!/^[A-Z0-9]{3,4}$/.test(station)) return res.status(400).json({ error: 'Invalid station' });

  const hoursRaw = parseInt(req.query.hours) || 48;
  const hours    = Math.min(Math.max(hoursRaw, 1), 168);
  const cacheKey = `${station}_${hours}`;
  const cache = metarCache[cacheKey] || { data: null, ts: 0 };
  const now   = Date.now();
  if (cache.data && now - cache.ts < 60_000) return res.json(cache.data);

  // Try primary API first
  const url = `https://aviationweather.gov/api/data/metar?ids=${station}&format=json&taf=false&hours=${hours}`;
  https.get(url, { headers: { 'User-Agent': 'polydash/1.0' } }, (upstream) => {
    let body = '';
    upstream.on('data', chunk => body += chunk);
    upstream.on('end', () => {
      try {
        const json = JSON.parse(body);
        // Check if we got valid data (not an error response)
        if (!Array.isArray(json) && !json.data) {
          throw new Error('Invalid response');
        }
        metarCache[cacheKey] = { data: json, ts: Date.now() };
        res.json(json);
      } catch(e) {
        // Fallback to Open-Meteo
        console.log(`[metar] Primary failed, trying Open-Meteo for ${station}`);
        fetchOpenMeteo(station, hours).then((data) => {
          metarCache[cacheKey] = { data, ts: Date.now() };
          res.json(data);
        }).catch(() => {
          if (cache.data) return res.json(cache.data);
          res.status(502).json({ error: 'METAR fetch failed' });
        });
      }
    });
  }).on('error', (e) => {
    // Fallback to Open-Meteo on network error
    console.log(`[metar] Network error, trying Open-Meteo for ${station}`);
    fetchOpenMeteo(station, hours).then((data) => {
      metarCache[cacheKey] = { data, ts: Date.now() };
      res.json(data);
    }).catch(() => {
      if (cache.data) return res.json(cache.data);
      res.status(502).json({ error: e.message });
    });
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  Polydash running at  http://localhost:${PORT}\n`);
  if (!process.env.USER_ADDRESS) {
    console.warn('  [warn] USER_ADDRESS env var not set — user positions panel will be empty\n');
  }
});
