/**
 * Firebase Admin SDK middleware for verifying ID tokens with custom claims.
 *
 * Setup:
 *   1. npm install firebase-admin express
 *   2. Place serviceAccountKey.json in scripts/ folder
 *   3. Import this middleware into your Express app
 *
 * Usage:
 *   const { verifyIdToken, requireRole, requireDepartment } = require('./verify-token-middleware');
 *   app.use(verifyIdToken);
 *   app.get('/admin-only', requireRole(['admin', 'chairman']), (req, res) => { ... });
 *   app.get('/condo-data', requireDepartment('condo'), (req, res) => { ... });
 */

const admin = require('firebase-admin');

// Initialize if not already initialized
if (!admin.apps.length) {
  const serviceAccountPath = require('path').join(__dirname, 'serviceAccountKey.json');
  if (!require('fs').existsSync(serviceAccountPath)) {
    throw new Error('Missing serviceAccountKey.json');
  }
  admin.initializeApp({
    credential: admin.credential.cert(require(serviceAccountPath)),
  });
}

/**
 * Verify Firebase ID token from Authorization header.
 * Attaches req.user = { uid, role, department, email }
 */
async function verifyIdToken(req, res, next) {
  const idToken = req.headers.authorization && req.headers.authorization.split('Bearer ')[1];
  if (!idToken) {
    return res.status(401).send('No token');
  }

  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.user = { uid: decoded.uid, role: decoded.role, department: decoded.department };
    next();
  } catch (e) {
    res.status(401).send('Invalid token');
  }
}

/**
 * Middleware factory: require specific roles.
 * @param {string[]} allowedRoles
 */
function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'Forbidden',
        detail: `Required role: ${allowedRoles.join(' or ')}, your role: ${req.user.role}`,
      });
    }
    next();
  };
}

/**
 * Middleware factory: require specific department.
 * @param {string} department
 */
function requireDepartment(department) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (req.user.department !== department && req.user.role !== 'admin' && req.user.role !== 'chairman') {
      return res.status(403).json({
        error: 'Forbidden',
        detail: `Required department: ${department}, your department: ${req.user.department}`,
      });
    }
    next();
  };
}

/**
 * Middleware factory: require admin or chairman.
 */
function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (req.user.role !== 'admin' && req.user.role !== 'chairman') {
    return res.status(403).json({ error: 'Forbidden', detail: 'Admin access required' });
  }
  next();
}

/**
 * Middleware factory: require management (admin, chairman, any manager, any supervisor).
 */
function requireManagement(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const role = req.user.role || '';
  const isAdmin = role === 'admin' || role === 'chairman';
  const isManager = role.includes('manager');
  const isSupervisor = role.includes('supervisor');
  if (!isAdmin && !isManager && !isSupervisor) {
    return res.status(403).json({ error: 'Forbidden', detail: 'Management access required' });
  }
  next();
}

module.exports = {
  verifyIdToken,
  requireRole,
  requireDepartment,
  requireAdmin,
  requireManagement,
};
