// =================================================================
// ROTAS API CONTÁBIL-FISCAL - ALUFORCE v2.0
// SPED EFD ICMS/IPI, EFD Contribuições, Sintegra, Apurações
// =================================================================
'use strict';

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { SpedFiscalService, SpedContribuicoesService, SintegraService } = require(
    path.join(__dirname, '..', 'modules', 'Faturamento', 'services', 'sped-fiscal.service.js')
);

function createContabilFiscalRouter(pool, authenticateToken) {

    // ============================================================
    // APURAÇÃO ICMS
    // ============================================================

    /**
     * GET /api/contabil/apuracao-icms
     * Busca ou calcula apuração ICMS do período
     */
    router.get('/apuracao-icms', authenticateToken, async (req, res) => {
        try {
            const mes = parseInt(req.query.mes) || (new Date().getMonth() + 1);
            const ano = parseInt(req.query.ano) || new Date().getFullYear();

            // Verificar se já existe
            const [existing] = await pool.query(
                'SELECT * FROM apuracao_icms WHERE competencia_mes = ? AND competencia_ano = ?',
                [mes, ano]
            );

            if (existing.length > 0) {
                return res.json(existing[0]);
            }

            // Calcular automaticamente
            const apuracao = await SpedFiscalService._calcularApuracao(pool, mes, ano);
            res.json({ competencia_mes: mes, competencia_ano: ano, status: 'calculada', ...apuracao });
        } catch (error) {
            console.error('❌ Erro apuração ICMS:', error);
            res.status(500).json({ error: 'Erro ao calcular apuração ICMS' });
        }
    });

    /**
     * POST /api/contabil/apuracao-icms/fechar
     * Fecha a apuração do período (impede alterações)
     */
    router.post('/apuracao-icms/fechar', authenticateToken, async (req, res) => {
        try {
            const { mes, ano } = req.body;
            if (!mes || !ano) return res.status(400).json({ error: 'Mês e ano obrigatórios' });

            const apuracao = await SpedFiscalService._calcularApuracao(pool, mes, ano);

            await pool.query(`
                INSERT INTO apuracao_icms (
                    competencia_mes, competencia_ano,
                    total_debitos_saidas, total_debitos, 
                    total_creditos_entradas, total_creditos,
                    saldo_credor_anterior, saldo_devedor, saldo_credor,
                    estorno_creditos, estorno_debitos, outros_debitos, outros_creditos,
                    status, data_calculo, data_fechamento
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, 'fechada', NOW(), NOW())
                ON DUPLICATE KEY UPDATE
                    total_debitos_saidas = VALUES(total_debitos_saidas),
                    total_debitos = VALUES(total_debitos),
                    total_creditos_entradas = VALUES(total_creditos_entradas),
                    total_creditos = VALUES(total_creditos),
                    saldo_credor_anterior = VALUES(saldo_credor_anterior),
                    saldo_devedor = VALUES(saldo_devedor),
                    saldo_credor = VALUES(saldo_credor),
                    status = 'fechada', data_fechamento = NOW()
            `, [
                mes, ano,
                apuracao.total_debitos, apuracao.total_debitos,
                apuracao.total_creditos, apuracao.total_creditos,
                apuracao.saldo_credor_anterior, apuracao.saldo_devedor, apuracao.saldo_credor,
                apuracao.outros_debitos, apuracao.outros_creditos
            ]);

            res.json({ success: true, message: `Apuração ICMS ${mes}/${ano} fechada`, apuracao });
        } catch (error) {
            console.error('❌ Erro ao fechar apuração:', error);
            res.status(500).json({ error: 'Erro ao fechar apuração' });
        }
    });

    // ============================================================
    // APURAÇÃO PIS/COFINS
    // ============================================================

    /**
     * GET /api/contabil/apuracao-pis-cofins
     */
    router.get('/apuracao-pis-cofins', authenticateToken, async (req, res) => {
        try {
            const mes = parseInt(req.query.mes) || (new Date().getMonth() + 1);
            const ano = parseInt(req.query.ano) || new Date().getFullYear();

            const [existing] = await pool.query(
                'SELECT * FROM apuracao_pis_cofins WHERE competencia_mes = ? AND competencia_ano = ?',
                [mes, ano]
            );

            if (existing.length > 0) {
                return res.json(existing[0]);
            }

            const apuracao = await SpedContribuicoesService._calcularApuracao(pool, mes, ano);
            res.json({ competencia_mes: mes, competencia_ano: ano, status: 'calculada', ...apuracao });
        } catch (error) {
            console.error('❌ Erro apuração PIS/COFINS:', error);
            res.status(500).json({ error: 'Erro ao calcular apuração PIS/COFINS' });
        }
    });

    // ============================================================
    // GERAÇÃO DE ARQUIVOS SPED
    // ============================================================

    /**
     * POST /api/contabil/gerar-efd-icms-ipi
     * Gera arquivo SPED Fiscal (EFD ICMS/IPI)
     */
    router.post('/gerar-efd-icms-ipi', authenticateToken, async (req, res) => {
        try {
            const { mes, ano, finalidade } = req.body;
            if (!mes || !ano) return res.status(400).json({ error: 'Mês e ano obrigatórios' });

            const resultado = await SpedFiscalService.gerarEFDICMSIPI(pool, mes, ano, finalidade || '0');

            const nomeArquivo = `EFD_ICMS_IPI_${ano}${String(mes).padStart(2, '0')}.txt`;
            const caminhoDir = path.join(__dirname, '..', 'uploads', 'sped');
            if (!fs.existsSync(caminhoDir)) fs.mkdirSync(caminhoDir, { recursive: true });

            const caminhoArquivo = path.join(caminhoDir, nomeArquivo);
            fs.writeFileSync(caminhoArquivo, resultado.conteudo, 'utf8');

            // Registrar no banco
            await pool.query(`
                INSERT INTO sped_arquivos (tipo, competencia_mes, competencia_ano, finalidade,
                    nome_arquivo, caminho_arquivo, hash_arquivo, total_registros, tamanho_bytes,
                    status, gerado_por)
                VALUES ('efd_icms_ipi', ?, ?, ?, ?, ?, ?, ?, ?, 'gerado', ?)
            `, [mes, ano, finalidade || '0', nomeArquivo, caminhoArquivo,
                resultado.hash, resultado.registros, Buffer.byteLength(resultado.conteudo),
                req.user.id]);

            res.json({
                success: true,
                arquivo: nomeArquivo,
                registros: resultado.registros,
                hash: resultado.hash,
                tamanho: Buffer.byteLength(resultado.conteudo)
            });
        } catch (error) {
            console.error('❌ Erro ao gerar EFD ICMS/IPI:', error);
            res.status(500).json({ error: 'Erro ao gerar SPED: ' + error.message });
        }
    });

    /**
     * POST /api/contabil/gerar-efd-contribuicoes
     * Gera arquivo EFD Contribuições (PIS/COFINS)
     */
    router.post('/gerar-efd-contribuicoes', authenticateToken, async (req, res) => {
        try {
            const { mes, ano, finalidade } = req.body;
            if (!mes || !ano) return res.status(400).json({ error: 'Mês e ano obrigatórios' });

            const resultado = await SpedContribuicoesService.gerarEFDContribuicoes(pool, mes, ano, finalidade || '0');

            const nomeArquivo = `EFD_CONTRIB_${ano}${String(mes).padStart(2, '0')}.txt`;
            const caminhoDir = path.join(__dirname, '..', 'uploads', 'sped');
            if (!fs.existsSync(caminhoDir)) fs.mkdirSync(caminhoDir, { recursive: true });

            const caminhoArquivo = path.join(caminhoDir, nomeArquivo);
            fs.writeFileSync(caminhoArquivo, resultado.conteudo, 'utf8');

            await pool.query(`
                INSERT INTO sped_arquivos (tipo, competencia_mes, competencia_ano, finalidade,
                    nome_arquivo, caminho_arquivo, hash_arquivo, total_registros, tamanho_bytes,
                    status, gerado_por)
                VALUES ('efd_contribuicoes', ?, ?, ?, ?, ?, ?, ?, ?, 'gerado', ?)
            `, [mes, ano, finalidade || '0', nomeArquivo, caminhoArquivo,
                resultado.hash, resultado.registros, Buffer.byteLength(resultado.conteudo),
                req.user.id]);

            res.json({
                success: true,
                arquivo: nomeArquivo,
                registros: resultado.registros,
                hash: resultado.hash,
                tamanho: Buffer.byteLength(resultado.conteudo)
            });
        } catch (error) {
            console.error('❌ Erro ao gerar EFD Contribuições:', error);
            res.status(500).json({ error: 'Erro ao gerar EFD Contribuições: ' + error.message });
        }
    });

    /**
     * POST /api/contabil/gerar-sintegra
     * Gera arquivo Sintegra
     */
    router.post('/gerar-sintegra', authenticateToken, async (req, res) => {
        try {
            const { mes, ano } = req.body;
            if (!mes || !ano) return res.status(400).json({ error: 'Mês e ano obrigatórios' });

            const resultado = await SintegraService.gerarSintegra(pool, mes, ano);

            const nomeArquivo = `SINTEGRA_${ano}${String(mes).padStart(2, '0')}.txt`;
            const caminhoDir = path.join(__dirname, '..', 'uploads', 'sped');
            if (!fs.existsSync(caminhoDir)) fs.mkdirSync(caminhoDir, { recursive: true });

            const caminhoArquivo = path.join(caminhoDir, nomeArquivo);
            fs.writeFileSync(caminhoArquivo, resultado.conteudo, 'utf8');

            await pool.query(`
                INSERT INTO sped_arquivos (tipo, competencia_mes, competencia_ano,
                    nome_arquivo, caminho_arquivo, hash_arquivo, total_registros, tamanho_bytes,
                    status, gerado_por)
                VALUES ('sintegra', ?, ?, ?, ?, ?, ?, ?, 'gerado', ?)
            `, [mes, ano, nomeArquivo, caminhoArquivo,
                resultado.hash, resultado.registros, Buffer.byteLength(resultado.conteudo),
                req.user.id]);

            res.json({
                success: true,
                arquivo: nomeArquivo,
                registros: resultado.registros,
                hash: resultado.hash
            });
        } catch (error) {
            console.error('❌ Erro ao gerar Sintegra:', error);
            res.status(500).json({ error: 'Erro ao gerar Sintegra: ' + error.message });
        }
    });

    // ============================================================
    // HISTÓRICO DE ARQUIVOS GERADOS
    // ============================================================

    /**
     * GET /api/contabil/arquivos
     * Lista arquivos SPED/Sintegra gerados
     */
    router.get('/arquivos', authenticateToken, async (req, res) => {
        try {
            const { tipo, ano } = req.query;
            let query = 'SELECT * FROM sped_arquivos WHERE 1=1';
            const params = [];

            if (tipo) { query += ' AND tipo = ?'; params.push(tipo); }
            if (ano) { query += ' AND competencia_ano = ?'; params.push(parseInt(ano)); }

            query += ' ORDER BY competencia_ano DESC, competencia_mes DESC, created_at DESC';

            const [rows] = await pool.query(query, params);
            res.json(rows);
        } catch (error) {
            console.error('❌ Erro ao listar arquivos:', error);
            res.status(500).json({ error: 'Erro ao listar arquivos' });
        }
    });

    /**
     * GET /api/contabil/arquivos/:id/download
     * Download de arquivo SPED
     */
    router.get('/arquivos/:id/download', authenticateToken, async (req, res) => {
        try {
            const [rows] = await pool.query('SELECT * FROM sped_arquivos WHERE id = ?', [req.params.id]);
            if (rows.length === 0) return res.status(404).json({ error: 'Arquivo não encontrado' });

            const arquivo = rows[0];
            if (arquivo.caminho_arquivo && fs.existsSync(arquivo.caminho_arquivo)) {
                res.download(arquivo.caminho_arquivo, arquivo.nome_arquivo);
            } else {
                res.status(404).json({ error: 'Arquivo físico não encontrado' });
            }
        } catch (error) {
            console.error('❌ Erro download:', error);
            res.status(500).json({ error: 'Erro no download' });
        }
    });

    // ============================================================
    // CFOP REFERÊNCIA
    // ============================================================

    /**
     * GET /api/contabil/cfop
     * Lista CFOPs disponíveis
     */
    router.get('/cfop', authenticateToken, async (req, res) => {
        try {
            const { tipo, grupo } = req.query;
            let query = 'SELECT * FROM cfop_referencia WHERE ativo = 1';
            const params = [];

            if (tipo) { query += ' AND tipo = ?'; params.push(tipo); }
            if (grupo) { query += ' AND grupo = ?'; params.push(grupo); }

            query += ' ORDER BY cfop';
            const [rows] = await pool.query(query, params);
            res.json(rows);
        } catch (error) {
            console.error('❌ Erro ao listar CFOP:', error);
            res.status(500).json({ error: 'Erro ao listar CFOPs' });
        }
    });

    // ============================================================
    // DASHBOARD CONTÁBIL-FISCAL
    // ============================================================

    /**
     * GET /api/contabil/dashboard
     * Resumo geral do período para o módulo contábil-fiscal
     */
    router.get('/dashboard', authenticateToken, async (req, res) => {
        try {
            const mes = parseInt(req.query.mes) || (new Date().getMonth() + 1);
            const ano = parseInt(req.query.ano) || new Date().getFullYear();

            // NFs emitidas no período
            let nfSaidas = { total: 0, valor: 0 };
            try {
                const [rows] = await pool.query(`
                    SELECT COUNT(*) as total, COALESCE(SUM(valor_total), 0) as valor
                    FROM nfe_emitidas WHERE MONTH(data_emissao) = ? AND YEAR(data_emissao) = ?
                    AND status IN ('autorizada', 'emitida')
                `, [mes, ano]);
                nfSaidas = rows[0];
            } catch (e) { /* tabela pode não existir */ }

            // NFs de entrada no período
            let nfEntradas = { total: 0, valor: 0, escrituradas: 0, pendentes: 0 };
            try {
                const [rows] = await pool.query(`
                    SELECT COUNT(*) as total, COALESCE(SUM(valor_total), 0) as valor,
                        COUNT(CASE WHEN status = 'escriturada' THEN 1 END) as escrituradas,
                        COUNT(CASE WHEN status = 'importada' THEN 1 END) as pendentes
                    FROM nf_entrada WHERE MONTH(data_emissao) = ? AND YEAR(data_emissao) = ?
                    AND status != 'cancelada'
                `, [mes, ano]);
                nfEntradas = rows[0];
            } catch (e) { /* tabela pode não existir */ }

            // Apuração ICMS
            let apuracaoICMS = null;
            try {
                apuracaoICMS = await SpedFiscalService._calcularApuracao(pool, mes, ano);
            } catch (e) { /* ignorar */ }

            // Apuração PIS/COFINS
            let apuracaoPISCOFINS = null;
            try {
                apuracaoPISCOFINS = await SpedContribuicoesService._calcularApuracao(pool, mes, ano);
            } catch (e) { /* ignorar */ }

            // Últimos arquivos gerados
            let ultimosArquivos = [];
            try {
                const [rows] = await pool.query(
                    'SELECT tipo, nome_arquivo, status, created_at FROM sped_arquivos ORDER BY created_at DESC LIMIT 5'
                );
                ultimosArquivos = rows;
            } catch (e) { /* tabela pode não existir */ }

            res.json({
                periodo: { mes, ano },
                nf_saidas: nfSaidas,
                nf_entradas: nfEntradas,
                apuracao_icms: apuracaoICMS,
                apuracao_pis_cofins: apuracaoPISCOFINS,
                ultimos_arquivos: ultimosArquivos
            });
        } catch (error) {
            console.error('❌ Erro dashboard contábil:', error);
            res.status(500).json({ error: 'Erro ao gerar dashboard' });
        }
    });

    return router;
}

module.exports = createContabilFiscalRouter;
