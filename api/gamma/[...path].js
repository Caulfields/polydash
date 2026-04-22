// Proxy to https://gamma-api.polymarket.com
const ALLOWED_PREFIXES = ['events', 'markets'];

function isSafeOrigin(req) {
  const origin = req.headers.origin || '';
  const host   = req.headers.host   || '';
  return !origin || origin.includes(host) || origin.includes('localhost');
}

// Extract path segments from req.url directly (Vercel catch-all may not populate req.query.path)
function getSegments(req) {
  // req.url = "/api/gamma/events?slug=..." → we want ["events"]
  const urlPath = req.url.split('?')[0]; // e.g. "/api/gamma/events"
  const parts   = urlPath.replace(/^\/api\/gamma\/?/, '').split('/').filter(Boolean);
  return parts;
}

function isSafePath(segments) {
  if (!segments.length) return false;
  return ALLOWED_PREFIXES.includes(segments[0]);
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

  const segments = getSegments(req);

  if (!isSafePath(segments)) {
    res.status(400).end(JSON.stringify({ error: 'Invalid path', got: segments, url: req.url }));
    return;
  }

  const url = new URL('https://gamma-api.polymarket.com/' + segments.join('/'));
  // Forward all query params
  const searchParams = new URLSearchParams(req.url.includes('?') ? req.url.split('?')[1] : '');
  url.search = searchParams.toString();

  const body = ['GET', 'HEAD'].includes(req.method) ? undefined
    : JSON.stringify(await readBody(req));

  try {
    const upstream = await fetch(url.toString(), {
      method:  req.method,
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'polydash/1.0' },
      body,
    });
    const data = await upstream.text();
    res.status(upstream.status);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.end(data);
  } catch (e) {
    res.status(502).end(JSON.stringify({ error: e.message }));
  }
};
