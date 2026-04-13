const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'voidclub_fallback_secret';

// Generate JWT for authenticated role
function signToken(role) {
  return jwt.sign({ role }, JWT_SECRET, { expiresIn: '8h' });
}

// Verify JWT and attach to req
function verifyToken(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  try {
    const decoded = jwt.verify(auth.split(' ')[1], JWT_SECRET);
    req.user = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Require specific role
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

module.exports = { signToken, verifyToken, requireRole };
