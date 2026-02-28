/**
 * Controller de Certificado Digital
 * Gerencia requisições HTTP relacionadas a certificados
 * 
 * @module CertificadoController
 */

const express = require('express');
const multer = require('multer');
const CertificadoService = require('../services/CertificadoService');

// Configurar upload de arquivos
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/x-pkcs12' || file.originalname.endsWith('.pfx')) {
            cb(null, true);
        } else {
            cb(new Error('Apenas arquivos .pfx são permitidos'));
        }
    }
});

function createCertificadoController(pool) {
    const router = express.Router();
    const certificadoService = new CertificadoService(pool);

    /**
     * POST /api/nfe/certificado/upload
     * Upload de certificado digital A1
     */
    router.post('/upload', upload.single('certificado'), async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    error: 'Nenhum arquivo enviado'
                });
            }

            const { senha } = req.body;
            if (!senha) {
                return res.status(400).json({
                    success: false,
                    error: 'Senha do certificado é obrigatória'
                });
            }

            const empresaId = req.user?.empresa_id || 1;
            const pfxBuffer = req.file.buffer;

            const result = await certificadoService.uploadCertificado(pfxBuffer, senha, empresaId);

            res.json(result);

        } catch (error) {
            console.error('❌ Erro no upload do certificado:', error);
            res.status(400).json({
                success: false,
                error: error.message
            });
        }
    });

    /**
     * POST /api/nfe/certificado/importar
     * Importar certificado digital A1 via JSON (base64)
     */
    router.post('/importar', async (req, res) => {
        try {
            const { arquivo, nome, senha } = req.body;
            
            if (!arquivo) {
                return res.status(400).json({
                    success: false,
                    message: 'Nenhum arquivo enviado'
                });
            }

            if (!senha) {
                return res.status(400).json({
                    success: false,
                    message: 'Senha do certificado é obrigatória'
                });
            }

            const empresaId = req.user?.empresa_id || 1;
            
            // Converter base64 para buffer
            const pfxBuffer = Buffer.from(arquivo, 'base64');

            const result = await certificadoService.uploadCertificado(pfxBuffer, senha, empresaId);

            if (result.success) {
                res.json({
                    success: true,
                    message: 'Certificado importado com sucesso',
                    certificado: {
                        nome: result.info?.razaoSocial || nome,
                        validade: result.info?.validade,
                        valido: true
                    }
                });
            } else {
                res.status(400).json({
                    success: false,
                    message: result.error || 'Erro ao importar certificado. Verifique a senha.'
                });
            }

        } catch (error) {
            console.error('❌ Erro ao importar certificado:', error);
            res.status(400).json({
                success: false,
                message: error.message || 'Erro ao importar certificado. Verifique a senha.'
            });
        }
    });

    /**
     * GET /api/nfe/certificado/verificar
     * Verificar validade do certificado atual
     */
    router.get('/verificar', async (req, res) => {
        try {
            const empresaId = req.user?.empresa_id || 1;
            const status = await certificadoService.getStatus(empresaId);

            if (status.success && status.configurado) {
                res.json({
                    success: true,
                    certificado: {
                        nome: status.info?.razaoSocial || 'Certificado Configurado',
                        validade: status.info?.validade,
                        cnpj: status.info?.cnpj,
                        diasRestantes: status.info?.diasRestantes,
                        valido: status.info?.diasRestantes > 0
                    }
                });
            } else {
                res.json({
                    success: false,
                    message: 'Nenhum certificado configurado'
                });
            }

        } catch (error) {
            console.error('❌ Erro ao verificar certificado:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    });

    /**
     * GET /api/nfe/certificado/status
     * Obter status do certificado configurado
     */
    router.get('/status', async (req, res) => {
        try {
            const empresaId = req.user?.empresa_id || 1;
            const status = await certificadoService.getStatus(empresaId);

            res.json(status);

        } catch (error) {
            console.error('❌ Erro ao obter status do certificado:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    /**
     * DELETE /api/nfe/certificado
     * Remove certificado configurado
     */
    router.delete('/', async (req, res) => {
        try {
            const empresaId = req.user?.empresa_id || 1;
            const result = await certificadoService.removerCertificado(empresaId);

            res.json(result);

        } catch (error) {
            console.error('❌ Erro ao remover certificado:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    /**
     * POST /api/nfe/certificado/testar
     * Testa certificado sem salvar
     */
    router.post('/testar', upload.single('certificado'), async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    error: 'Nenhum arquivo enviado'
                });
            }

            const { senha } = req.body;
            if (!senha) {
                return res.status(400).json({
                    success: false,
                    error: 'Senha do certificado é obrigatória'
                });
            }

            const pfxBuffer = req.file.buffer;

            // Apenas validar, sem salvar
            const certData = await certificadoService.validarCertificado(pfxBuffer, senha);
            const info = certificadoService.extrairInformacoes(certData);

            const hoje = new Date();
            const diasRestantes = Math.ceil((info.validade - hoje) / (1000 * 60 * 60 * 24));

            res.json({
                success: true,
                message: 'Certificado válido',
                info: {
                    cnpj: info.cnpj,
                    razaoSocial: info.razaoSocial,
                    validade: info.validade,
                    emissao: info.emissao,
                    diasRestantes: diasRestantes,
                    emissor: info.emissor,
                    status: diasRestantes > 30 ? 'valido' : diasRestantes > 0 ? 'expirando' : 'expirado'
                }
            });

        } catch (error) {
            console.error('❌ Erro ao testar certificado:', error);
            res.status(400).json({
                success: false,
                error: error.message
            });
        }
    });

    return router;
}

module.exports = createCertificadoController;
