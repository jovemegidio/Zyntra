const crypto = require('crypto');
const HMAC_SECRET = process.env.PII_ENCRYPTION_KEY || process.env.JWT_SECRET || 'fallback-key-change-me';

function blindHash(value) {
  if (!value) return null;
  const normalized = value.replace(/[.\-\/\s]/g, "");
  return crypto.createHmac('sha256', HMAC_SECRET).update(normalized).digest('hex');
}

function buildPIISearchClause(searchTerm, opts) {
  opts = opts || {};
  var hashColumn = opts.hashColumn || 'cnpj_cpf_hash';
  var nameColumn = opts.nameColumn || 'nome';
  var emailColumn = opts.emailColumn || 'email';
  var digits = searchTerm.replace(/\D/g, "");
  if (digits.length >= 8) {
    return { clause: hashColumn + " = ?", params: [blindHash(digits)] };
  }
  var like = '%' + searchTerm + '%';
  return {
    clause: nameColumn + " LIKE ? OR " + emailColumn + " LIKE ?",
    params: [like, like]
  };
}

module.exports = { blindHash, buildPIISearchClause };