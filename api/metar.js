// METAR proxy with per-station in-memory cache (resets on cold start).
const metarCache = {};

function isSafeOrigin(req) {
  const origin = req.headers.origin || '';
  const host   = req.headers.host   || '';
  return !origin || origin.includes(host) || origin.includes('localhost');
}

module.exports = async function handler(req, res) {
  if (!isSafeOrigin(req)) {
    res.status(403).end(JSON.stringify({ error: 'Forbidden' }));
    return;
  }

  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Vary', 'Origin');

  const raw     = (req.query.station || 'EGLC') + '';
  const station = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  if (!/^[A-Z0-9]{3,4}$/.test(station)) {
    res.status(400).end(JSON.stringify({ error: 'Invalid station code' }));
    return;
  }

  const hoursRaw = parseInt(req.query.hours) || 48;
  const hours    = Math.min(Math.max(hoursRaw, 1), 168);
  const cacheKey = `${station}_${hours}`;

  const cache = metarCache[cacheKey] || { data: null, ts: 0 };
  if (cache.data && Date.now() - cache.ts < 60_000) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(cache.data));
    return;
  }

  const url = `https://aviationweather.gov/api/data/metar?ids=${station}&format=json&taf=false&hours=${hours}`;

  try {
    const upstream = await fetch(url, { headers: { 'User-Agent': 'polydash/1.0' } });
    if (!upstream.ok) throw new Error('HTTP ' + upstream.status);
    const json = await upstream.json();
    metarCache[cacheKey] = { data: json, ts: Date.now() };
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(json));
  } catch (e) {
    console.error('[metar]', e.message);
    if (cache.data) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(cache.data));
      return;
    }
    res.status(502).end(JSON.stringify({ error: e.message }));
  }
};
