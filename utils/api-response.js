'use strict';

/**
 * Envelope de resposta padronizado para todas as APIs.
 * Uso:
 *   const { ok, fail, paginated } = require('../utils/api-response');
 *   res.json(ok({ pedido }));
 *   res.status(400).json(fail('Campo obrigatório'));
 *   res.json(paginated(rows, total, page, limit));
 */

function ok(data, message) {
    const response = { success: true };
    if (message) response.message = message;
    if (data !== undefined) response.data = data;
    return response;
}

function fail(message, errors, code) {
    const response = { success: false, message: message || 'Erro interno' };
    if (errors) response.errors = errors;
    if (code) response.code = code;
    return response;
}

function paginated(rows, total, page, limit) {
    return {
        success: true,
        data: rows,
        pagination: {
            total,
            page: Number(page) || 1,
            limit: Number(limit) || 20,
            pages: Math.ceil(total / (Number(limit) || 20))
        }
    };
}

module.exports = { ok, fail, paginated };
