// Proxy to https://clob.polymarket.com
export default async function handler(req, res) {
  const { path = [] } = req.query;
  const target = 'https://clob.polymarket.com/' + path.join('/');

  const url = new URL(target);
  const searchParams = new URLSearchParams(req.query);
  searchParams.delete('path');
  url.search = searchParams.toString();

  let body = undefined;
  if (!['GET', 'HEAD'].includes(req.method)) {
    body = await readBody(req);
  }

  const upstream = await fetch(url.toString(), {
    method: req.method,
    headers: {
      'Content-Type': req.headers['content-type'] || 'application/json',
      'User-Agent': 'polydash/1.0',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
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
