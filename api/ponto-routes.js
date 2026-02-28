/**
 * PONTO ROUTES - Gestão de Ponto Eletrônico
 * Módulo stub - será implementado futuramente
 * @module api/ponto-routes
 */
const express = require('express');

module.exports = function createPontoRoutes(pool) {
    const router = express.Router();

    // Stub: retornar mensagem de "em desenvolvimento"
    router.all('*', (req, res) => {
        res.status(501).json({ 
            message: 'Módulo de Ponto Eletrônico em desenvolvimento',
            status: 'not_implemented'
        });
    });

    return router;
};
