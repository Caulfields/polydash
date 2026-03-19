// Proxy to https://data-api.polymarket.com
// Only relays requests originating from the same deployment.

const ALLOWED_PREFIXES = [
  '/positions',
  '/activity',
  '/portfolio',
];

function isSafeOrigin(req) {
  const origin = req.headers.origin || '';
  const host   = req.headers.host || '';
  return !origin || origin.includes(host) || origin.includes('localhost');
}

function isSafePath(segments) {
  if (!segments.length) return false;
  const joined = '/' + segments.join('/').replace(/\.\.+/g, '').replace(/\/\/+/g, '/');
  return ALLOWED_PREFIXES.some(p => joined.startsWith(p));
}

async function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); } catch { resolve(body || null); }
    });
  });
}

export default async function handler(req, res) {
  if (!isSafeOrigin(req)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { path = [] } = req.query;

  if (!isSafePath(path)) {
    return res.status(400).json({ error: 'Invalid path' });
  }

  const safePath = path.map(s => encodeURIComponent(s).replace(/%2F/g, '/')).join('/');
  const url = new URL('https://data-api.polymarket.com/' + safePath);

  const searchParams = new URLSearchParams(req.query);
  searchParams.delete('path');
  url.search = searchParams.toString();

  const body = ['GET', 'HEAD'].includes(req.method) ? undefined
    : JSON.stringify(await readBody(req));

  const upstream = await fetch(url.toString(), {
    method: req.method,
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'polydash/1.0' },
    body,
  });

  const data = await upstream.text();
  res.status(upstream.status);
  res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Vary', 'Origin');
  res.end(data);
}
