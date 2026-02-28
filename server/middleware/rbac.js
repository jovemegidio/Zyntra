// Simple RBAC middleware skeleton
// Assumes request has user { id, role } and module/action params

const roles = {
  admin: {
    '*': ['read', 'write', 'delete']
  },
  financeiro: {
    financeiro: ['read', 'write'],
    vendas: ['read']
  },
  vendas: {
    vendas: ['read', 'write'],
    financeiro: ['read']
  },
  rh: {
    rh: ['read', 'write']
  }
};

function can(role, moduleName, action) {
  const policy = roles[role];
  if (!policy) return false;
  if (policy['*']) return policy['*'].includes(action);
  const allowed = policy[moduleName];
  return Array.isArray(allowed) && allowed.includes(action);
}

function rbac(moduleName, action) {
  return function (req, res, next) {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthenticated' });
    if (can(user.role, moduleName, action)) return next();
    return res.status(403).json({ error: 'Forbidden' });
  };
}

module.exports = { rbac, can };