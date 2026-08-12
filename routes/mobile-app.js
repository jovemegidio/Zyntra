const express = require('express');
const jwt = require('jsonwebtoken');

const MIN_SESSION_MS = 60 * 1000;
const MAX_SESSION_MS = 8 * 60 * 60 * 1000;

// A sessão web do WebView não pode viver mais que o próprio JWT do app, nem
// morrer antes dele: 15 min fixos derrubavam o usuário no meio do trabalho.
function sessionLifetime(token) {
  try {
    const exp = jwt.decode(token)?.exp;
    if (!exp) return MIN_SESSION_MS; // sem exp legível: não vale abrir sessão longa
    const remaining = exp * 1000 - Date.now();
    return Math.min(MAX_SESSION_MS, Math.max(MIN_SESSION_MS, remaining));
  } catch {
    return MIN_SESSION_MS;
  }
}

const ALLOWED_PREFIXES = [
  '/index.html', '/Vendas/', '/Compras/', '/Financeiro/', '/Faturamento/',
  '/Logistica/', '/PCP/', '/Qualidade/', '/RH/', '/modules/', '/admin/',
  '/configuracoes', '/chat', '/integracoes'
];

function safePath(value) {
  const path = String(value || '/index.html');
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || path.includes('\0')) return '/index.html';
  return ALLOWED_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix)) ? path : '/index.html';
}

module.exports = function createMobileAppRoutes(authenticateToken) {
  const router = express.Router();

  // Troca o Bearer token do aplicativo por uma sessão web HttpOnly de curta duração.
  // O token nunca é exposto ao JavaScript das páginas carregadas no WebView.
  router.get('/mobile/web-session', authenticateToken, (req, res) => {
    const authorization = String(req.headers.authorization || '');
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
    if (!token) return res.status(401).json({ success: false, message: 'Token ausente' });

    res.cookie('authToken', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: sessionLifetime(token)
    });
    res.set('Cache-Control', 'no-store');
    return res.redirect(302, safePath(req.query.path));
  });

  return router;
};

module.exports.safePath = safePath;
module.exports.sessionLifetime = sessionLifetime;
