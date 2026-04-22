// Returns the configured user address from environment variable.
// Set USER_ADDRESS in Vercel environment variables (never hardcode in client JS).
module.exports = function handler(req, res) {
  const address = process.env.USER_ADDRESS || '';
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  const origin  = req.headers.origin || '';
  const host    = req.headers.host   || '';
  const allowed = !origin || origin.includes(host) || origin.includes('localhost');
  if (!allowed) {
    return res.status(403).end(JSON.stringify({ error: 'Forbidden' }));
  }
  res.end(JSON.stringify({ address }));
};
