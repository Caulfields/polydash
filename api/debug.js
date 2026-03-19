module.exports = function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ url: req.url, query: req.query, method: req.method }, null, 2));
};
