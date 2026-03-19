// Proxy to https://gamma-api.polymarket.com
export default async function handler(req, res) {
  const { path = [] } = req.query;
  const target = 'https://gamma-api.polymarket.com/' + path.join('/');

  const url = new URL(target);
  // Forward query params (except 'path' which is our catch-all)
  const searchParams = new URLSearchParams(req.query);
  searchParams.delete('path');
  url.search = searchParams.toString();

  const upstream = await fetch(url.toString(), {
    method: req.method,
    headers: {
      'Content-Type': req.headers['content-type'] || 'application/json',
      'User-Agent': 'polydash/1.0',
    },
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(await readBody(req)),
  });

  const data = await upstream.text();
  res.status(upstream.status);
  res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(data);
}

async function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); } catch { resolve(body); }
    });
  });
}
