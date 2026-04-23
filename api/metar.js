// METAR proxy with per-station in-memory cache (resets on cold start).
const metarCache = {};
const stationCoords = {
  ZBAA: { lat: 40.0799, lon: 116.6031 },
  EGLC: { lat: 51.5053, lon: 0.0553 },
  LFPB: { lat: 48.949675, lon: 2.432356 },
  LFPG: { lat: 48.949675, lon: 2.432356 },
  EGLL: { lat: 51.4700, lon: -0.4543 },
};

function isSafeOrigin(req) {
  const origin = req.headers.origin || '';
  const host   = req.headers.host   || '';
  return !origin || origin.includes(host) || origin.includes('localhost');
}

async function fetchOpenMeteo(station, hours) {
  const coords = stationCoords[station];
  if (!coords) throw new Error('No coordinates for station');

  const now = Math.floor(Date.now() / 1000);
  const startTime = now - (hours * 3600);
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&hourly=temperature_2m&start=${startTime}&end=${now}&timezone=auto`;
  const upstream = await fetch(url, { headers: { 'User-Agent': 'polydash/1.0' } });
  if (!upstream.ok) throw new Error('Open-Meteo HTTP ' + upstream.status);
  const json = await upstream.json();
  if (!json.hourly) throw new Error('Open-Meteo missing hourly data');
  return (json.hourly.temperature_2m || []).map((temp, i) => ({
    obsTime: json.hourly.time[i],
    temp: Math.round(Number(temp) * 10) / 10,
    rawOb: `${temp}C`,
  }));
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
    if (!Array.isArray(json) && !json.data) throw new Error('Invalid response');
    metarCache[cacheKey] = { data: json, ts: Date.now() };
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(json));
  } catch (e) {
    console.error('[metar]', e.message);
    try {
      const fallback = await fetchOpenMeteo(station, hours);
      metarCache[cacheKey] = { data: fallback, ts: Date.now() };
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(fallback));
    } catch (fallbackError) {
      if (cache.data) {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(cache.data));
        return;
      }
      res.status(502).end(JSON.stringify({ error: fallbackError.message }));
    }
  }
};
