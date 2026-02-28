// Integração das APIs importar-xml e manifestacao-destinatario no módulo NFe
const express = require('express');
const router = express.Router();

const importarXmlApi = require('./api/importar-xml');
const manifestacaoDestinatarioApi = require('./api/manifestacao-destinatario');

// Middleware para parsing de JSON nas rotas NFe
router.use(express.json());

// Registrar as rotas das APIs sob o namespace /api/nfe
router.use('/importar-xml', importarXmlApi);
router.use('/manifestacao-destinatario', manifestacaoDestinatarioApi);

module.exports = router;
