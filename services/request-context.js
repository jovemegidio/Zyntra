'use strict';

/**
 * Guarda a requisição HTTP em curso para serviços profundos (ex.: o emitter de NF-e)
 * saberem QUEM disparou a ação sem que cada chamador precise repassar `req`.
 * Serve ao log de não repúdio: identidade, IP e navegador vêm sempre do servidor.
 */
const { AsyncLocalStorage } = require('node:async_hooks');

const storage = new AsyncLocalStorage();

function middleware(req, res, next) {
    storage.run({ req }, next);
}

function currentRequest() {
    return storage.getStore()?.req || null;
}

module.exports = { middleware, currentRequest };
