// METAR proxy with per-station cache (in-memory, resets on cold start)
const metarCache = {};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const station = ((req.query.station || 'EGLC') + '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const cache = metarCache[station] || { data: null, ts: 0 };
  const now = Date.now();

  if (cache.data && now - cache.ts < 60_000) {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify(cache.data));
  }

  const url = `https://aviationweather.gov/api/data/metar?ids=${station}&format=json&taf=false&hours=48`;

  try {
    const upstream = await fetch(url, {
      headers: { 'User-Agent': 'polydash/1.0' },
    });
    if (!upstream.ok) throw new Error('HTTP ' + upstream.status);
    const json = await upstream.json();
    metarCache[station] = { data: json, ts: Date.now() };
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(json));
  } catch (e) {
    console.error('[metar]', e.message);
    if (cache.data) {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify(cache.data));
    }
    res.status(502).end(JSON.stringify({ error: e.message }));
  }
}
