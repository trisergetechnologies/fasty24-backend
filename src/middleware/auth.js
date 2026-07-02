const jwt = require("jsonwebtoken");
const env = require("../config/env");

function signToken(payload, options = {}) {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
    ...options,
  });
}

function verifyToken(token) {
  return jwt.verify(token, env.JWT_SECRET);
}

function requireAuth(role) {
  return (req, res, next) => {
    const header = req.headers.authorization || "";
    const [, token] = header.split(" ");
    if (!token) return res.status(401).json({ error: "missing_token" });
    try {
      const decoded = verifyToken(token);
      if (role && decoded.role !== role) {
        return res.status(403).json({ error: "wrong_role" });
      }
      req.auth = decoded;
      return next();
    } catch {
      return res.status(401).json({ error: "invalid_token" });
    }
  };
}

module.exports = { signToken, verifyToken, requireAuth };
