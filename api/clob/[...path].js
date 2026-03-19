// Proxy to https://clob.polymarket.com
const ALLOWED_PREFIXES = ['/midpoints', '/last-trade-prices', '/orderbook', '/prices'];

function isSafeOrigin(req) {
  const origin = req.headers.origin || '';
  const host   = req.headers.host   || '';
  return !origin || origin.includes(host) || origin.includes('localhost');
}

function isSafePath(segments) {
  if (!segments || !segments.length) return false;
  const joined = '/' + segments.join('/').replace(/\.\.+/g, '').replace(/\/\/+/g, '/');
  return ALLOWED_PREFIXES.some(p => joined.startsWith(p));
}

async function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); } catch { resolve(null); }
    });
  });
}

module.exports = async function handler(req, res) {
  if (!isSafeOrigin(req)) {
    res.status(403).end(JSON.stringify({ error: 'Forbidden' }));
    return;
  }

  const { path = [] } = req.query;
  const segments = Array.isArray(path) ? path : [path];

  if (!isSafePath(segments)) {
    res.status(400).end(JSON.stringify({ error: 'Invalid path' }));
    return;
  }

  const safePath = segments.join('/');
  const url = new URL('https://clob.polymarket.com/' + safePath);
  const searchParams = new URLSearchParams(req.query);
  searchParams.delete('path');
  url.search = searchParams.toString();

  const body = ['GET', 'HEAD'].includes(req.method) ? undefined
    : JSON.stringify(await readBody(req));

  const upstream = await fetch(url.toString(), {
    method:  req.method,
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'polydash/1.0' },
    body,
  });

  const data = await upstream.text();
  res.status(upstream.status);
  res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Vary', 'Origin');
  res.end(data);
};
