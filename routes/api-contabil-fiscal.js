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

    // Garante tabela de config fiscal na primeira carga do router
    pool.query(`
        CREATE TABLE IF NOT EXISTS empresa_config_fiscal (
            id INT AUTO_INCREMENT PRIMARY KEY,
            config_chave VARCHAR(100) UNIQUE NOT NULL,
            config_valor TEXT,
            atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
    `).catch(err => console.error('❌ Erro ao criar empresa_config_fiscal:', err.message));

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
            res.status(500).json({ error: 'Erro interno no servidor. Tente novamente.' });
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
            res.status(500).json({ error: 'Erro interno no servidor. Tente novamente.' });
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
            res.status(500).json({ error: 'Erro interno no servidor. Tente novamente.' });
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
                    FROM nfes WHERE MONTH(data_emissao) = ? AND YEAR(data_emissao) = ?
                    AND status IN ('autorizada', 'emitida', 'autorizado')
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

    // ============================================================
    // BLOCO K — CONFIGURAÇÃO E GERAÇÃO
    // ============================================================

    /**
     * GET /api/contabil/bloco-k/config
     * Retorna configuração atual do Bloco K
     */
    router.get('/bloco-k/config', authenticateToken, async (req, res) => {
        try {
            const defaults = {
                habilitado: false,
                perfil: 'A',
                ind_atividade: '0',
                incluir_ordens_producao: true,
                incluir_ajustes: true,
                incluir_perdas: true
            };
            const [rows] = await pool.query(
                "SELECT config_valor FROM empresa_config_fiscal WHERE config_chave = 'bloco_k' LIMIT 1"
            );
            const config = rows.length > 0
                ? { ...defaults, ...JSON.parse(rows[0].config_valor || '{}') }
                : defaults;
            res.json(config);
        } catch (error) {
            console.error('❌ Erro ao buscar config Bloco K:', error);
            res.status(500).json({ error: 'Erro ao buscar configuração do Bloco K' });
        }
    });

    /**
     * POST /api/contabil/bloco-k/config
     * Salva configuração do Bloco K
     */
    router.post('/bloco-k/config', authenticateToken, async (req, res) => {
        try {
            const config = {
                habilitado: !!req.body.habilitado,
                perfil: req.body.perfil || 'A',
                ind_atividade: req.body.ind_atividade || '0',
                incluir_ordens_producao: req.body.incluir_ordens_producao !== false,
                incluir_ajustes: req.body.incluir_ajustes !== false,
                incluir_perdas: req.body.incluir_perdas !== false
            };

            await pool.query(`
                INSERT INTO empresa_config_fiscal (config_chave, config_valor)
                VALUES ('bloco_k', ?)
                ON DUPLICATE KEY UPDATE config_valor = VALUES(config_valor)
            `, [JSON.stringify(config)]);

            res.json({ success: true, config });
        } catch (error) {
            console.error('❌ Erro ao salvar config Bloco K:', error);
            res.status(500).json({ error: 'Erro ao salvar configuração do Bloco K' });
        }
    });

    /**
     * GET /api/contabil/bloco-k/preview
     * Pré-visualização dos dados que serão incluídos no Bloco K
     */
    router.get('/bloco-k/preview', authenticateToken, async (req, res) => {
        try {
            const mes = parseInt(req.query.mes) || (new Date().getMonth() + 1);
            const ano = parseInt(req.query.ano) || new Date().getFullYear();

            const [estoqueResult, ordensResult, movResult] = await Promise.all([
                pool.query(`
                    SELECT COUNT(*) AS total FROM estoque_saldos WHERE quantidade_fisica > 0
                `).catch(() => [[{ total: 0 }]]),
                pool.query(`
                    SELECT COUNT(*) AS total
                    FROM ordens_producao
                    WHERE MONTH(COALESCE(data_conclusao, data_inicio)) = ?
                      AND YEAR(COALESCE(data_conclusao, data_inicio)) = ?
                      AND status = 'concluida'
                `, [mes, ano]).catch(() => [[{ total: 0 }]]),
                pool.query(`
                    SELECT COUNT(*) AS total
                    FROM estoque_movimentos m
                    WHERE m.tipo_movimento IN ('transferencia', 'ajuste', 'perda', 'inventario')
                      AND MONTH(m.data_movimento) = ? AND YEAR(m.data_movimento) = ?
                `, [mes, ano]).catch(() => [[{ total: 0 }]])
            ]);

            res.json({
                periodo: { mes, ano },
                resumo: {
                    total_itens_estoque: estoqueResult[0][0].total,
                    total_ordens_producao: ordensResult[0][0].total,
                    total_movimentacoes: movResult[0][0].total
                }
            });
        } catch (error) {
            console.error('❌ Erro no preview Bloco K:', error);
            res.status(500).json({ error: 'Erro ao gerar preview do Bloco K' });
        }
    });

    // ============================================================
    // MOVIMENTAÇÕES DE ESTOQUE PARA BLOCO K (K220 / K270 / K280)
    // ============================================================

    /**
     * POST /api/contabil/estoque/movimentacao
     * Registra transferência, ajuste ou perda de estoque para alimentar Bloco K
     * Body: { produto_id, tipo_movimento, quantidade, observacoes }
     *   tipo_movimento: 'transferencia' | 'ajuste' | 'inventario' | 'perda'
     */
    router.post('/estoque/movimentacao', authenticateToken, async (req, res) => {
        try {
            const { produto_id, tipo_movimento, quantidade, observacoes } = req.body;
            const tiposValidos = ['transferencia', 'ajuste', 'inventario', 'perda'];

            if (!produto_id || !tipo_movimento || quantidade === undefined) {
                return res.status(400).json({ error: 'produto_id, tipo_movimento e quantidade são obrigatórios' });
            }
            if (!tiposValidos.includes(tipo_movimento)) {
                return res.status(400).json({ error: `tipo_movimento deve ser: ${tiposValidos.join(', ')}` });
            }

            const qtd = parseFloat(quantidade);
            if (isNaN(qtd) || qtd === 0) {
                return res.status(400).json({ error: 'quantidade deve ser um número diferente de zero' });
            }

            await pool.query(
                `INSERT INTO estoque_movimentos
                 (produto_id, tipo_movimento, quantidade, documento_tipo, observacoes, usuario_id, data_movimento)
                 VALUES (?, ?, ?, 'manual_bloco_k', ?, ?, NOW())`,
                [produto_id, tipo_movimento, Math.abs(qtd), observacoes || null, req.user?.id || null]
            );

            // Atualiza saldo conforme tipo
            if (tipo_movimento === 'ajuste' || tipo_movimento === 'inventario') {
                const [prod] = await pool.query('SELECT codigo FROM produtos WHERE id = ?', [produto_id]);
                if (prod.length > 0) {
                    const sinal = qtd > 0 ? 1 : -1;
                    await pool.query(
                        `UPDATE estoque_saldos
                         SET quantidade_fisica = GREATEST(0, quantidade_fisica + ?)
                         WHERE codigo_material = ?`,
                        [Math.abs(qtd) * sinal, prod[0].codigo]
                    ).catch(() => {});
                }
            } else if (tipo_movimento === 'perda') {
                const [prod] = await pool.query('SELECT codigo FROM produtos WHERE id = ?', [produto_id]);
                if (prod.length > 0) {
                    await pool.query(
                        `UPDATE estoque_saldos
                         SET quantidade_fisica = GREATEST(0, quantidade_fisica - ?)
                         WHERE codigo_material = ?`,
                        [Math.abs(qtd), prod[0].codigo]
                    ).catch(() => {});
                }
            }

            res.json({ success: true, tipo_movimento, quantidade: Math.abs(qtd) });
        } catch (error) {
            console.error('❌ Erro ao registrar movimentação:', error);
            res.status(500).json({ error: 'Erro ao registrar movimentação de estoque' });
        }
    });

    /**
     * GET /api/contabil/estoque/movimentacoes
     * Lista movimentações registradas para Bloco K do período
     */
    router.get('/estoque/movimentacoes', authenticateToken, async (req, res) => {
        try {
            const mes = parseInt(req.query.mes) || (new Date().getMonth() + 1);
            const ano = parseInt(req.query.ano) || new Date().getFullYear();

            const [rows] = await pool.query(`
                SELECT m.id, m.tipo_movimento, m.quantidade, m.observacoes, m.data_movimento,
                       p.codigo AS produto_codigo, p.descricao AS produto_descricao
                FROM estoque_movimentos m
                JOIN produtos p ON p.id = m.produto_id
                WHERE m.tipo_movimento IN ('transferencia','ajuste','inventario','perda')
                  AND MONTH(m.data_movimento) = ? AND YEAR(m.data_movimento) = ?
                ORDER BY m.data_movimento DESC
                LIMIT 500
            `, [mes, ano]);

            res.json({ periodo: { mes, ano }, movimentacoes: rows, total: rows.length });
        } catch (error) {
            console.error('❌ Erro ao listar movimentações:', error);
            res.status(500).json({ error: 'Erro ao listar movimentações' });
        }
    });

    return router;
}

module.exports = createContabilFiscalRouter;
