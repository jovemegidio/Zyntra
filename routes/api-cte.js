// =================================================================
// ROTAS API CT-e - ALUFORCE v2.0
// CRUD + Geração XML + Emissão CT-e
// =================================================================
'use strict';

const express = require('express');
const router = express.Router();
const path = require('path');
const CTeService = require(path.join(__dirname, '..', 'modules', 'Faturamento', 'services', 'cte.service.js'));

function createCTeRouter(pool, authenticateToken) {

    // ============================================================
    // LISTAR CT-e
    // ============================================================

    router.get('/', authenticateToken, async (req, res) => {
        try {
            const { status, data_inicio, data_fim, pagina = 1, limite = 50 } = req.query;
            let query = 'SELECT id, chave_acesso, numero_cte, serie, cfop, natureza_operacao, tipo_cte, modal, ' +
                        'rem_razao_social, dest_razao_social, valor_total_servico, valor_icms, ' +
                        'municipio_inicio, uf_inicio, municipio_fim, uf_fim, placa_veiculo, ' +
                        'status, data_emissao, protocolo_autorizacao FROM cte_emitidos WHERE 1=1';
            const params = [];

            if (status) { query += ' AND status = ?'; params.push(status); }
            if (data_inicio) { query += ' AND data_emissao >= ?'; params.push(data_inicio); }
            if (data_fim) { query += ' AND data_emissao <= ?'; params.push(data_fim + ' 23:59:59'); }

            const countQ = query.replace(/SELECT .+ FROM/, 'SELECT COUNT(*) as total FROM');
            const [countRows] = await pool.query(countQ, params);

            query += ' ORDER BY data_emissao DESC LIMIT ? OFFSET ?';
            params.push(parseInt(limite), (parseInt(pagina) - 1) * parseInt(limite));

            const [rows] = await pool.query(query, params);
            res.json({ total: countRows[0].total, pagina: parseInt(pagina), ctes: rows });
        } catch (error) {
            console.error('❌ Erro ao listar CT-e:', error);
            res.status(500).json({ error: 'Erro ao listar CT-e' });
        }
    });

    // ============================================================
    // DETALHE CT-e
    // ============================================================

    router.get('/:id', authenticateToken, async (req, res) => {
        try {
            const [ctes] = await pool.query('SELECT * FROM cte_emitidos WHERE id = ?', [req.params.id]);
            if (ctes.length === 0) return res.status(404).json({ error: 'CT-e não encontrado' });

            const [componentes] = await pool.query(
                'SELECT * FROM cte_componentes_valor WHERE cte_id = ?', [req.params.id]
            );
            const [documentos] = await pool.query(
                'SELECT * FROM cte_documentos WHERE cte_id = ?', [req.params.id]
            );

            res.json({ ...ctes[0], componentes, documentos });
        } catch (error) {
            console.error('❌ Erro ao buscar CT-e:', error);
            res.status(500).json({ error: 'Erro ao buscar CT-e' });
        }
    });

    // ============================================================
    // CRIAR CT-e (RASCUNHO)
    // ============================================================

    router.post('/', authenticateToken, async (req, res) => {
        try {
            const dados = req.body;

            // Validar
            const validacao = CTeService.validar(dados);
            if (!validacao.valido) {
                return res.status(400).json({ error: 'Dados inválidos', erros: validacao.erros });
            }

            // Buscar config da empresa para regime
            const [config] = await pool.query('SELECT * FROM empresa_config WHERE id = 1');
            const empresa = config[0] || {};
            const regime = empresa.regime_tributario || 'simples';

            // Calcular ICMS
            const icms = CTeService.calcularICMS(dados, regime);

            // Próximo número
            const [numRows] = await pool.query('SELECT cte_proximo_numero, cte_serie FROM empresa_config WHERE id = 1');
            const proximoNum = numRows[0]?.cte_proximo_numero || 1;
            const serie = numRows[0]?.cte_serie || 1;

            const [result] = await pool.query(`
                INSERT INTO cte_emitidos (
                    numero_cte, serie, modelo, cfop, natureza_operacao,
                    tipo_cte, tipo_servico, modal, tomador_tipo,
                    rem_cnpj, rem_razao_social, rem_ie, rem_uf, rem_municipio, rem_codigo_municipio,
                    dest_cnpj, dest_razao_social, dest_ie, dest_uf, dest_municipio, dest_codigo_municipio,
                    valor_total_servico, valor_receber, valor_carga,
                    valor_frete_peso, valor_frete_valor, valor_pedagio, valor_outros,
                    cst_icms, bc_icms, aliquota_icms, valor_icms, reducao_bc,
                    produto_predominante, carga_peso_bruto, carga_volume,
                    uf_inicio, uf_fim, municipio_inicio, municipio_fim,
                    codigo_municipio_inicio, codigo_municipio_fim,
                    placa_veiculo, renavam, uf_veiculo, rntrc,
                    motorista_cpf, motorista_nome,
                    ambiente, status, data_emissao, created_by
                ) VALUES (?, ?, '57', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'rascunho', NOW(), ?)
            `, [
                proximoNum, serie, dados.cfop, dados.natureza_operacao || 'PRESTACAO DE SERVICO DE TRANSPORTE',
                dados.tipo_cte || 'normal', dados.tipo_servico || 'normal',
                dados.modal || 'rodoviario', dados.tomador_tipo || 'remetente',
                dados.rem_cnpj, dados.rem_razao_social, dados.rem_ie, dados.rem_uf, dados.rem_municipio, dados.rem_codigo_municipio,
                dados.dest_cnpj, dados.dest_razao_social, dados.dest_ie, dados.dest_uf, dados.dest_municipio, dados.dest_codigo_municipio,
                dados.valor_total_servico, dados.valor_receber || dados.valor_total_servico, dados.valor_carga || 0,
                dados.valor_frete_peso || 0, dados.valor_frete_valor || 0, dados.valor_pedagio || 0, dados.valor_outros || 0,
                icms.cst_icms, icms.bc_icms, icms.aliquota_icms, icms.valor_icms, icms.reducao_bc,
                dados.produto_predominante || '', dados.carga_peso_bruto || 0, dados.carga_volume || 0,
                dados.uf_inicio, dados.uf_fim, dados.municipio_inicio, dados.municipio_fim,
                dados.codigo_municipio_inicio, dados.codigo_municipio_fim,
                dados.placa_veiculo, dados.renavam, dados.uf_veiculo, dados.rntrc,
                dados.motorista_cpf, dados.motorista_nome,
                empresa.nfe_ambiente || 2,
                req.user.id
            ]);

            const cteId = result.insertId;

            // Incrementar numeração
            await pool.query('UPDATE empresa_config SET cte_proximo_numero = ? WHERE id = 1', [proximoNum + 1]);

            // Inserir componentes de valor
            if (dados.componentes && dados.componentes.length > 0) {
                for (const comp of dados.componentes) {
                    await pool.query(
                        'INSERT INTO cte_componentes_valor (cte_id, nome, valor) VALUES (?, ?, ?)',
                        [cteId, comp.nome, comp.valor]
                    );
                }
            }

            // Inserir documentos vinculados
            if (dados.documentos && dados.documentos.length > 0) {
                for (const doc of dados.documentos) {
                    await pool.query(
                        'INSERT INTO cte_documentos (cte_id, tipo_documento, chave_nfe, numero_nf, serie, data_emissao, valor, peso) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                        [cteId, doc.tipo_documento || 'nfe', doc.chave_nfe, doc.numero_nf, doc.serie, doc.data_emissao, doc.valor || 0, doc.peso || 0]
                    );
                }
            }

            res.status(201).json({
                success: true,
                id: cteId,
                numero_cte: proximoNum,
                serie,
                icms,
                message: `CT-e ${proximoNum} criado como rascunho`
            });
        } catch (error) {
            console.error('❌ Erro ao criar CT-e:', error);
            res.status(500).json({ error: 'Erro ao criar CT-e: ' + error.message });
        }
    });

    // ============================================================
    // GERAR XML CT-e
    // ============================================================

    router.post('/:id/gerar-xml', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const [ctes] = await pool.query('SELECT * FROM cte_emitidos WHERE id = ?', [id]);
            if (ctes.length === 0) return res.status(404).json({ error: 'CT-e não encontrado' });

            const cte = ctes[0];
            if (cte.status !== 'rascunho' && cte.status !== 'rejeitado') {
                return res.status(400).json({ error: 'Apenas CT-e em rascunho ou rejeitado pode gerar XML' });
            }

            // Buscar dados complementares
            const [componentes] = await pool.query('SELECT * FROM cte_componentes_valor WHERE cte_id = ?', [id]);
            const [documentos] = await pool.query('SELECT * FROM cte_documentos WHERE cte_id = ?', [id]);
            const [config] = await pool.query('SELECT * FROM empresa_config WHERE id = 1');

            cte.componentes = componentes;
            cte.documentos = documentos;

            const resultado = CTeService.gerarXML(cte, config[0] || {});

            // Salvar XML e chave no banco
            await pool.query(
                'UPDATE cte_emitidos SET xml_envio = ?, chave_acesso = ?, status = ? WHERE id = ?',
                [resultado.xml, resultado.chave, 'validado', id]
            );

            res.json({
                success: true,
                chave_acesso: resultado.chave,
                xml_preview: resultado.xml.substring(0, 500) + '...',
                message: 'XML gerado com sucesso'
            });
        } catch (error) {
            console.error('❌ Erro ao gerar XML CT-e:', error);
            res.status(500).json({ error: 'Erro ao gerar XML: ' + error.message });
        }
    });

    // ============================================================
    // CANCELAR CT-e
    // ============================================================

    router.post('/:id/cancelar', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const { justificativa } = req.body;

            if (!justificativa || justificativa.length < 15) {
                return res.status(400).json({ error: 'Justificativa deve ter pelo menos 15 caracteres' });
            }

            const [ctes] = await pool.query('SELECT * FROM cte_emitidos WHERE id = ?', [id]);
            if (ctes.length === 0) return res.status(404).json({ error: 'CT-e não encontrado' });

            if (!['rascunho', 'validado', 'autorizado'].includes(ctes[0].status)) {
                return res.status(400).json({ error: 'CT-e não pode ser cancelado no status atual' });
            }

            await pool.query(
                'UPDATE cte_emitidos SET status = ?, motivo_rejeicao = ? WHERE id = ?',
                ['cancelado', justificativa, id]
            );

            res.json({ success: true, message: `CT-e ${ctes[0].numero_cte} cancelado` });
        } catch (error) {
            console.error('❌ Erro ao cancelar CT-e:', error);
            res.status(500).json({ error: 'Erro ao cancelar CT-e' });
        }
    });

    // ============================================================
    // VEÍCULOS CRUD
    // ============================================================

    router.get('/veiculos/lista', authenticateToken, async (req, res) => {
        try {
            const [rows] = await pool.query('SELECT * FROM veiculos WHERE ativo = 1 ORDER BY placa');
            res.json(rows);
        } catch (error) {
            res.status(500).json({ error: 'Erro ao listar veículos' });
        }
    });

    router.post('/veiculos', authenticateToken, async (req, res) => {
        try {
            const { placa, renavam, tipo, uf, marca, modelo, ano_fabricacao, tara, capacidade_kg, capacidade_m3, rntrc } = req.body;
            if (!placa) return res.status(400).json({ error: 'Placa é obrigatória' });

            const [result] = await pool.query(`
                INSERT INTO veiculos (placa, renavam, tipo, uf, marca, modelo, ano_fabricacao, tara, capacidade_kg, capacidade_m3, rntrc)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE renavam = VALUES(renavam), uf = VALUES(uf), rntrc = VALUES(rntrc)
            `, [placa, renavam, tipo || 'tração', uf, marca, modelo, ano_fabricacao, tara || 0, capacidade_kg || 0, capacidade_m3 || 0, rntrc]);

            res.status(201).json({ success: true, id: result.insertId });
        } catch (error) {
            res.status(500).json({ error: 'Erro ao salvar veículo' });
        }
    });

    // ============================================================
    // MOTORISTAS CRUD
    // ============================================================

    router.get('/motoristas/lista', authenticateToken, async (req, res) => {
        try {
            const [rows] = await pool.query('SELECT * FROM motoristas WHERE ativo = 1 ORDER BY nome');
            res.json(rows);
        } catch (error) {
            res.status(500).json({ error: 'Erro ao listar motoristas' });
        }
    });

    router.post('/motoristas', authenticateToken, async (req, res) => {
        try {
            const { cpf, nome, cnh, categoria_cnh, validade_cnh, telefone, email } = req.body;
            if (!cpf || !nome) return res.status(400).json({ error: 'CPF e nome são obrigatórios' });

            const [result] = await pool.query(`
                INSERT INTO motoristas (cpf, nome, cnh, categoria_cnh, validade_cnh, telefone, email)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE nome = VALUES(nome), cnh = VALUES(cnh), telefone = VALUES(telefone)
            `, [cpf, nome, cnh, categoria_cnh || 'C', validade_cnh, telefone, email]);

            res.status(201).json({ success: true, id: result.insertId });
        } catch (error) {
            res.status(500).json({ error: 'Erro ao salvar motorista' });
        }
    });

    return router;
}

module.exports = createCTeRouter;
