function notFound(req, res) {
  res.status(404).json({ error: "not_found", path: req.originalUrl });
}

function errorHandler(err, req, res, _next) {
  const status = err.statusCode || 500;
  if (status >= 500) console.error("[error]", err);
  res.status(status).json({ error: err.code || err.message || "server_error" });
}

module.exports = { notFound, errorHandler };
