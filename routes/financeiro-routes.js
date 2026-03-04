/**
 * FINANCEIRO ROUTES (PART 1 - Professional) - Extracted from server.js (Lines 3199-4017)
 * Dashboard, clientes, contas, conciliac�o, fluxo de caixa
 * @module routes/financeiro-routes
 */
const express = require('express');

module.exports = function createFinanceiroRoutes(deps) {
    const { pool, authenticateToken, authorizeArea, authorizeACL, writeAuditLog, cacheMiddleware, CACHE_CONFIG } = deps;
    const router = express.Router();

    // --- Standard requires for extracted routes ---
    const { body, param, query, validationResult } = require('express-validator');
    const path = require('path');
    const multer = require('multer');
    const fs = require('fs');
    const upload = multer({ dest: path.join(__dirname, '..', 'uploads'), limits: { fileSize: 10 * 1024 * 1024 } });
    const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
    const validate = (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ message: 'Dados inválidos', errors: errors.array() });
        next();
    };
    router.use(authenticateToken);
    router.use(authorizeArea('financeiro'));
    // Dashboard principal do financeiro
    router.get('/dashboard', async (req, res, next) => {
        try {
            // Faturamento total do mês
            const [faturamento] = await pool.query(`
                SELECT COALESCE(SUM(valor), 0) as total
                FROM contas_receber
                WHERE status = 'pago'
                AND MONTH(data_vencimento) = MONTH(CURRENT_DATE())
                AND YEAR(data_vencimento) = YEAR(CURRENT_DATE())
            `);

            // Contas a receber pendentes
            const [contasReceber] = await pool.query(`
                SELECT COALESCE(SUM(valor), 0) as total
                FROM contas_receber
                WHERE status = 'pendente'
            `);

            // Contas a pagar pendentes
            const [contasPagar] = await pool.query(`
                SELECT COALESCE(SUM(valor), 0) as total
                FROM contas_pagar
                WHERE status = 'pendente'
            `);

            const saldoTotal = faturamento[0].total + contasReceber[0].total - contasPagar[0].total;

            res.json({
                success: true,
                data: {
                    faturamento_total: faturamento[0].total,
                    contas_receber: contasReceber[0].total,
                    contas_pagar: contasPagar[0].total,
                    saldo_total: saldoTotal
                }
            });
        } catch (error) {
            console.error('Erro no dashboard financeiro:', error);
            res.status(500).json({
                success: false,
                message: 'Erro ao carregar dashboard financeiro',
                error: error.message
            });
        }
    });

    // ============================================================
    // CONCILIAÇÃO BANCÁRIA — TABELAS AUTO-CRIADAS
    // ============================================================
    async function ensureConciliacaoTables() {
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS extratos_importados (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    conta_id INT NOT NULL,
                    data DATE NOT NULL,
                    descricao VARCHAR(500),
                    valor DECIMAL(15,2) NOT NULL,
                    tipo ENUM('entrada','saida') NOT NULL,
                    saldo DECIMAL(15,2),
                    numero_documento VARCHAR(100),
                    arquivo_origem VARCHAR(255),
                    hash_linha VARCHAR(64),
                    conciliado TINYINT(1) DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_conta_data (conta_id, data),
                    INDEX idx_hash (hash_linha)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            await pool.query(`
                CREATE TABLE IF NOT EXISTS conciliacoes_bancarias (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    conta_id INT NOT NULL,
                    movimentacao_sistema_id INT,
                    movimentacao_sistema_tipo ENUM('pagar','receber','movimentacao') DEFAULT 'movimentacao',
                    extrato_id INT NOT NULL,
                    valor DECIMAL(15,2) NOT NULL,
                    tipo_match ENUM('automatico','manual') DEFAULT 'manual',
                    observacoes TEXT,
                    usuario_id INT,
                    data_conciliacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_conta (conta_id),
                    INDEX idx_extrato (extrato_id),
                    INDEX idx_mov (movimentacao_sistema_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
        } catch (err) {
            console.error('[Conciliação] Erro ao criar tabelas:', err.message);
        }
    }
    ensureConciliacaoTables();

    // 1a. Importar extrato (OFX/CSV/XLSX)
    router.post('/conciliacao/importar-ofx', async (req, res, next) => {
        try {
            const { conta_id, movimentacoes, arquivo } = req.body;
            if (!conta_id || !movimentacoes || !Array.isArray(movimentacoes) || movimentacoes.length === 0) {
                return res.status(400).json({ success: false, message: 'conta_id e movimentacoes[] são obrigatórios' });
            }

            let inseridos = 0;
            let duplicados = 0;
            const crypto = require('crypto');

            for (const mov of movimentacoes) {
                // Gerar hash para evitar duplicatas
                const hashStr = `${conta_id}|${mov.data}|${mov.descricao || mov.descrição || ''}|${mov.valor}`;
                const hash = crypto.createHash('sha256').update(hashStr).digest('hex');

                // Verificar duplicata
                const [existing] = await pool.query('SELECT id FROM extratos_importados WHERE hash_linha = ?', [hash]);
                if (existing.length > 0) { duplicados++; continue; }

                const tipo = (mov.tipo === 'entrada' || mov.tipo === 'credito' || Number(mov.valor) > 0) ? 'entrada' : 'saida';
                const valor = Math.abs(Number(mov.valor));

                await pool.query(
                    `INSERT INTO extratos_importados (conta_id, data, descricao, valor, tipo, saldo, numero_documento, arquivo_origem, hash_linha)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [conta_id, mov.data, mov.descricao || mov.descrição || '', valor, tipo, mov.saldo || null, mov.numero_documento || null, arquivo || 'manual', hash]
                );
                inseridos++;
            }

            res.json({
                success: true,
                message: `${inseridos} lançamento(s) importado(s), ${duplicados} duplicata(s) ignorada(s)`,
                inseridos,
                duplicados
            });
        } catch (error) {
            console.error('[Conciliação] Erro ao importar:', error);
            next(error);
        }
    });

    // 1b. Buscar dados de conciliação
    router.get('/conciliacao', async (req, res, next) => {
        try {
            const { conta, inicio, fim, tipo } = req.query;

            if (!conta) {
                return res.json([]);
            }

            // Se pediu extrato importado
            if (tipo === 'extrato') {
                let query = 'SELECT * FROM extratos_importados WHERE conta_id = ?';
                const params = [conta];
                if (inicio && fim) {
                    query += ' AND data BETWEEN ? AND ?';
                    params.push(inicio, fim);
                }
                query += ' ORDER BY data DESC';
                const [rows] = await pool.query(query, params);
                return res.json(rows);
            }

            // Senão, retorna conciliações já feitas
            let query = `SELECT c.*, e.descricao as extrato_descricao, e.data as extrato_data, e.valor as extrato_valor
                         FROM conciliacoes_bancarias c
                         LEFT JOIN extratos_importados e ON c.extrato_id = e.id
                         WHERE c.conta_id = ?`;
            const params = [conta];
            if (inicio && fim) {
                query += ' AND c.data_conciliacao BETWEEN ? AND ?';
                params.push(inicio + ' 00:00:00', fim + ' 23:59:59');
            }
            query += ' ORDER BY c.data_conciliacao DESC';
            const [rows] = await pool.query(query, params);
            res.json(rows);
        } catch (error) {
            console.error('[Conciliação] Erro ao buscar:', error);
            next(error);
        }
    });

    // 1c. Salvar conciliação (manual ou automática)
    router.post('/conciliacao', async (req, res, next) => {
        try {
            const { conta_id, movimentacoes_sistema, movimentacoes_extrato, observacoes, tipo_match } = req.body;
            if (!conta_id) return res.status(400).json({ success: false, message: 'conta_id é obrigatório' });

            const usuario_id = req.user?.id || null;
            let conciliadas = 0;

            // Para cada par sistema×extrato, criar registro
            const sistemaIds = movimentacoes_sistema || [];
            const extratoIds = movimentacoes_extrato || [];

            if (extratoIds.length === 0) {
                return res.status(400).json({ success: false, message: 'Selecione ao menos um lançamento do extrato' });
            }

            for (const extratoId of extratoIds) {
                const sistemaId = sistemaIds.length > 0 ? sistemaIds[0] : null;

                // Buscar valor do extrato
                const [ext] = await pool.query('SELECT valor FROM extratos_importados WHERE id = ?', [extratoId]);
                const valor = ext.length > 0 ? ext[0].valor : 0;

                await pool.query(
                    `INSERT INTO conciliacoes_bancarias (conta_id, movimentacao_sistema_id, extrato_id, valor, tipo_match, observacoes, usuario_id)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [conta_id, sistemaId, extratoId, valor, tipo_match || 'manual', observacoes || null, usuario_id]
                );

                // Marcar extrato como conciliado
                await pool.query('UPDATE extratos_importados SET conciliado = 1 WHERE id = ?', [extratoId]);
                conciliadas++;
            }

            res.json({ success: true, message: `${conciliadas} lançamento(s) conciliado(s)`, conciliadas });
        } catch (error) {
            console.error('[Conciliação] Erro ao salvar:', error);
            next(error);
        }
    });

    // 1d. Desfazer conciliação
    router.delete('/conciliacao/:id', async (req, res, next) => {
        try {
            const { id } = req.params;
            const [conc] = await pool.query('SELECT extrato_id FROM conciliacoes_bancarias WHERE id = ?', [id]);
            if (conc.length > 0) {
                await pool.query('UPDATE extratos_importados SET conciliado = 0 WHERE id = ?', [conc[0].extrato_id]);
            }
            await pool.query('DELETE FROM conciliacoes_bancarias WHERE id = ?', [id]);
            res.json({ success: true, message: 'Conciliação desfeita' });
        } catch (error) { next(error); }
    });

    // 1e. Conciliação automática (server-side)
    router.post('/conciliacao/automatica', async (req, res, next) => {
        try {
            const { conta_id, data_inicio, data_fim } = req.body;
            if (!conta_id) return res.status(400).json({ success: false, message: 'conta_id é obrigatório' });

            const usuario_id = req.user?.id || null;

            // Buscar movimentações do sistema (não conciliadas)
            const [movSistema] = await pool.query(
                `SELECT id, valor, data, descricao, tipo FROM movimentacoes_bancarias
                 WHERE banco_id = ? AND id NOT IN (SELECT COALESCE(movimentacao_sistema_id,0) FROM conciliacoes_bancarias WHERE conta_id = ?)
                 ${data_inicio && data_fim ? 'AND data BETWEEN ? AND ?' : ''}
                 ORDER BY data`,
                data_inicio && data_fim ? [conta_id, conta_id, data_inicio, data_fim] : [conta_id, conta_id]
            );

            // Buscar extrato não conciliado
            const [extrato] = await pool.query(
                `SELECT id, valor, data, descricao, tipo FROM extratos_importados
                 WHERE conta_id = ? AND conciliado = 0
                 ${data_inicio && data_fim ? 'AND data BETWEEN ? AND ?' : ''}
                 ORDER BY data`,
                data_inicio && data_fim ? [conta_id, data_inicio, data_fim] : [conta_id]
            );

            let conciliadas = 0;
            const usedExtrato = new Set();
            const usedSistema = new Set();

            // Passo 1: Match exato (valor + data)
            for (const mov of movSistema) {
                if (usedSistema.has(mov.id)) continue;
                const match = extrato.find(e =>
                    !usedExtrato.has(e.id) &&
                    Math.abs(Number(e.valor) - Number(mov.valor)) < 0.01 &&
                    e.data?.toISOString?.()?.slice(0,10) === mov.data?.toISOString?.()?.slice(0,10) &&
                    e.tipo === mov.tipo
                );
                if (match) {
                    await pool.query(
                        `INSERT INTO conciliacoes_bancarias (conta_id, movimentacao_sistema_id, extrato_id, valor, tipo_match, usuario_id)
                         VALUES (?, ?, ?, ?, 'automatico', ?)`,
                        [conta_id, mov.id, match.id, mov.valor, usuario_id]
                    );
                    await pool.query('UPDATE extratos_importados SET conciliado = 1 WHERE id = ?', [match.id]);
                    usedExtrato.add(match.id);
                    usedSistema.add(mov.id);
                    conciliadas++;
                }
            }

            // Passo 2: Match por valor com tolerância de ±3 dias
            for (const mov of movSistema) {
                if (usedSistema.has(mov.id)) continue;
                const movDate = new Date(mov.data);
                const match = extrato.find(e => {
                    if (usedExtrato.has(e.id)) return false;
                    const extDate = new Date(e.data);
                    const diffDays = Math.abs((extDate - movDate) / (1000*60*60*24));
                    return Math.abs(Number(e.valor) - Number(mov.valor)) < 0.01 && diffDays <= 3 && e.tipo === mov.tipo;
                });
                if (match) {
                    await pool.query(
                        `INSERT INTO conciliacoes_bancarias (conta_id, movimentacao_sistema_id, extrato_id, valor, tipo_match, observacoes, usuario_id)
                         VALUES (?, ?, ?, ?, 'automatico', 'Match por valor (±3 dias)', ?)`,
                        [conta_id, mov.id, match.id, mov.valor, usuario_id]
                    );
                    await pool.query('UPDATE extratos_importados SET conciliado = 1 WHERE id = ?', [match.id]);
                    usedExtrato.add(match.id);
                    usedSistema.add(mov.id);
                    conciliadas++;
                }
            }

            res.json({ success: true, message: `Conciliação automática: ${conciliadas} lançamento(s) conciliado(s)`, conciliadas });
        } catch (error) {
            console.error('[Conciliação] Erro automática:', error);
            next(error);
        }
    });

    // 2. Fluxo de Caixa Detalhado e Projetado
    router.get('/fluxo-caixa', async (req, res, next) => {
        try {
            const [receber] = await pool.query('SELECT SUM(valor) AS total FROM contas_receber WHERE status != "pago"');
            const [pagar] = await pool.query('SELECT SUM(valor) AS total FROM contas_pagar WHERE status != "pago"');
            res.json({
                saldoAtual: (receber[0]?.total || 0) - (pagar[0]?.total || 0),
                projecao: [
                    { dias: 30, saldo: 10000 },
                    { dias: 60, saldo: 8000 },
                    { dias: 90, saldo: 12000 }
                ]
            });
        } catch (error) { next(error); }
    });

    // 3. Centro de Custos e de Lucro
    router.get('/centros-custo', async (req, res, next) => {
        try {
            const [rows] = await pool.query('SELECT id, codigo, nome, departamento, responsavel, orcamento_mensal, utilizado, ativo, created_at, updated_at FROM centros_custo ORDER BY codigo, nome');
            res.json({ data: rows });
        } catch (error) {
            console.error('[Financeiro] Erro GET centros-custo:', error.message);
            next(error);
        }
    });
    router.post('/centros-custo', async (req, res, next) => {
        try {
            const { codigo, nome, departamento, responsavel, orcamento_mensal, ativo } = req.body;
            if (!nome) return res.status(400).json({ message: 'Nome é obrigatório' });
            const [result] = await pool.query(
                'INSERT INTO centros_custo (codigo, nome, departamento, responsavel, orcamento_mensal, ativo) VALUES (?, ?, ?, ?, ?, ?)',
                [codigo || null, nome, departamento || null, responsavel || null, orcamento_mensal || 0, ativo !== undefined ? (ativo ? 1 : 0) : 1]
            );
            res.status(201).json({ success: true, message: 'Centro de custo criado com sucesso', id: result.insertId });
        } catch (error) {
            console.error('[Financeiro] Erro POST centros-custo:', error.message);
            next(error);
        }
    });

    // ============================================================
    // GESTÃO DE TRANSAÇÕES RECORRENTES
    // ============================================================
    async function ensureRecorrenciasTable() {
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS recorrencias (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    tipo ENUM('pagar','receber') NOT NULL,
                    descricao VARCHAR(500) NOT NULL,
                    valor DECIMAL(15,2) NOT NULL,
                    dia_vencimento INT DEFAULT 1,
                    frequencia ENUM('semanal','quinzenal','mensal','bimestral','trimestral','semestral','anual') DEFAULT 'mensal',
                    categoria VARCHAR(100),
                    centro_custo VARCHAR(100),
                    fornecedor_nome VARCHAR(255),
                    cliente_nome VARCHAR(255),
                    conta_bancaria_id INT,
                    forma_pagamento VARCHAR(50),
                    data_inicio DATE NOT NULL,
                    data_fim DATE,
                    proximo_vencimento DATE,
                    total_geradas INT DEFAULT 0,
                    ativo TINYINT(1) DEFAULT 1,
                    observacoes TEXT,
                    usuario_criacao_id INT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    INDEX idx_proximo (proximo_vencimento),
                    INDEX idx_ativo (ativo)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
        } catch (err) {
            console.error('[Recorrências] Erro ao criar tabela:', err.message);
        }
    }
    ensureRecorrenciasTable();

    // 4a. Listar recorrências
    router.get('/transacoes-recorrentes', async (req, res, next) => {
        try {
            const { ativo, tipo } = req.query;
            let query = 'SELECT * FROM recorrencias WHERE 1=1';
            const params = [];
            if (ativo !== undefined) { query += ' AND ativo = ?'; params.push(ativo === 'true' || ativo === '1' ? 1 : 0); }
            if (tipo) { query += ' AND tipo = ?'; params.push(tipo); }
            query += ' ORDER BY proximo_vencimento ASC, created_at DESC';
            const [rows] = await pool.query(query, params);
            res.json({ success: true, data: rows });
        } catch (error) {
            if (error.code === 'ER_NO_SUCH_TABLE') return res.json({ success: true, data: [] });
            next(error);
        }
    });

    // 4b. Criar recorrência
    router.post('/transacoes-recorrentes', async (req, res, next) => {
        try {
            const { tipo, descricao, valor, dia_vencimento, frequencia, categoria, centro_custo,
                    fornecedor_nome, cliente_nome, conta_bancaria_id, forma_pagamento,
                    data_inicio, data_fim, observacoes } = req.body;

            if (!tipo || !descricao || !valor || !data_inicio) {
                return res.status(400).json({ success: false, message: 'Tipo, descrição, valor e data de início são obrigatórios' });
            }

            // Calcular próximo vencimento
            const inicio = new Date(data_inicio);
            const dia = dia_vencimento || inicio.getDate();
            let proxVencimento = new Date(inicio.getFullYear(), inicio.getMonth(), dia);
            if (proxVencimento < new Date()) {
                // Se já passou, avançar conforme frequência
                proxVencimento = calcularProximoVencimento(proxVencimento, frequencia || 'mensal');
            }

            const [result] = await pool.query(
                `INSERT INTO recorrencias (tipo, descricao, valor, dia_vencimento, frequencia, categoria, centro_custo,
                    fornecedor_nome, cliente_nome, conta_bancaria_id, forma_pagamento, data_inicio, data_fim,
                    proximo_vencimento, observacoes, usuario_criacao_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [tipo, descricao, valor, dia || 1, frequencia || 'mensal', categoria || null, centro_custo || null,
                 fornecedor_nome || null, cliente_nome || null, conta_bancaria_id || null, forma_pagamento || null,
                 data_inicio, data_fim || null, proxVencimento.toISOString().slice(0,10), observacoes || null, req.user?.id || null]
            );

            res.status(201).json({ success: true, message: 'Transação recorrente criada', id: result.insertId });
        } catch (error) {
            console.error('[Recorrências] Erro POST:', error);
            next(error);
        }
    });

    // 4c. Atualizar recorrência
    router.put('/transacoes-recorrentes/:id', async (req, res, next) => {
        try {
            const { id } = req.params;
            const fields = req.body;
            delete fields.id; delete fields.created_at;

            if (Object.keys(fields).length === 0) return res.status(400).json({ success: false, message: 'Nada para atualizar' });

            const setClauses = Object.keys(fields).map(k => `${k} = ?`).join(', ');
            const values = [...Object.values(fields), id];
            await pool.query(`UPDATE recorrencias SET ${setClauses} WHERE id = ?`, values);
            res.json({ success: true, message: 'Recorrência atualizada' });
        } catch (error) { next(error); }
    });

    // 4d. Excluir recorrência (soft delete)
    router.delete('/transacoes-recorrentes/:id', async (req, res, next) => {
        try {
            await pool.query('UPDATE recorrencias SET ativo = 0 WHERE id = ?', [req.params.id]);
            res.json({ success: true, message: 'Recorrência desativada' });
        } catch (error) { next(error); }
    });

    // 4e. Processar recorrências vencidas (gera lançamentos)
    router.post('/transacoes-recorrentes/processar', async (req, res, next) => {
        try {
            const hoje = new Date().toISOString().slice(0, 10);
            const [pendentes] = await pool.query(
                'SELECT * FROM recorrencias WHERE ativo = 1 AND proximo_vencimento <= ? AND (data_fim IS NULL OR data_fim >= ?)',
                [hoje, hoje]
            );

            let geradas = 0;
            for (const rec of pendentes) {
                const tabela = rec.tipo === 'pagar' ? 'contas_pagar' : 'contas_receber';
                const nomeField = rec.tipo === 'pagar' ? 'fornecedor_nome' : 'cliente_nome';
                const nome = rec.tipo === 'pagar' ? rec.fornecedor_nome : rec.cliente_nome;

                await pool.query(
                    `INSERT INTO ${tabela} (${nomeField}, descricao, valor, data_vencimento, categoria, status, observacoes)
                     VALUES (?, ?, ?, ?, ?, 'pendente', ?)`,
                    [nome || rec.descricao, `[Recorrente] ${rec.descricao}`, rec.valor, rec.proximo_vencimento,
                     rec.categoria, `Gerado automaticamente da recorrência #${rec.id}`]
                );

                // Atualizar próximo vencimento
                const proxVenc = calcularProximoVencimento(new Date(rec.proximo_vencimento), rec.frequencia);
                await pool.query(
                    'UPDATE recorrencias SET proximo_vencimento = ?, total_geradas = total_geradas + 1 WHERE id = ?',
                    [proxVenc.toISOString().slice(0,10), rec.id]
                );
                geradas++;
            }

            res.json({ success: true, message: `${geradas} lançamento(s) gerado(s) de recorrências`, geradas });
        } catch (error) {
            console.error('[Recorrências] Erro ao processar:', error);
            next(error);
        }
    });

    function calcularProximoVencimento(dataAtual, frequencia) {
        const d = new Date(dataAtual);
        switch (frequencia) {
            case 'semanal': d.setDate(d.getDate() + 7); break;
            case 'quinzenal': d.setDate(d.getDate() + 15); break;
            case 'mensal': d.setMonth(d.getMonth() + 1); break;
            case 'bimestral': d.setMonth(d.getMonth() + 2); break;
            case 'trimestral': d.setMonth(d.getMonth() + 3); break;
            case 'semestral': d.setMonth(d.getMonth() + 6); break;
            case 'anual': d.setFullYear(d.getFullYear() + 1); break;
            default: d.setMonth(d.getMonth() + 1);
        }
        return d;
    }

    // ============================================================
    // EMISSÃO DE BOLETOS
    // ============================================================
    async function ensureBoletosTable() {
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS boletos (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    conta_receber_id INT,
                    conta_bancaria_id INT,
                    nosso_numero VARCHAR(30),
                    numero_documento VARCHAR(30),
                    valor DECIMAL(15,2) NOT NULL,
                    valor_multa DECIMAL(15,2) DEFAULT 0,
                    valor_juros_dia DECIMAL(15,2) DEFAULT 0,
                    data_emissao DATE NOT NULL,
                    data_vencimento DATE NOT NULL,
                    data_pagamento DATE,
                    valor_pago DECIMAL(15,2),
                    sacado_nome VARCHAR(255) NOT NULL,
                    sacado_cpf_cnpj VARCHAR(20),
                    sacado_endereco VARCHAR(500),
                    sacado_cidade VARCHAR(100),
                    sacado_uf CHAR(2),
                    sacado_cep VARCHAR(10),
                    instrucao1 VARCHAR(255),
                    instrucao2 VARCHAR(255),
                    status ENUM('emitido','enviado','pago','vencido','cancelado') DEFAULT 'emitido',
                    linha_digitavel VARCHAR(60),
                    codigo_barras VARCHAR(50),
                    pix_qrcode TEXT,
                    observacoes TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    INDEX idx_status (status),
                    INDEX idx_vencimento (data_vencimento),
                    INDEX idx_conta_receber (conta_receber_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
        } catch (err) {
            console.error('[Boletos] Erro ao criar tabela:', err.message);
        }
    }
    ensureBoletosTable();

    // 5a. Emitir boleto
    router.post('/emitir-boleto', async (req, res, next) => {
        try {
            const { conta_receber_id, conta_bancaria_id, sacado_nome, sacado_cpf_cnpj, sacado_endereco,
                    sacado_cidade, sacado_uf, sacado_cep, valor, data_vencimento, instrucao1, instrucao2,
                    observacoes } = req.body;

            if (!sacado_nome || !valor || !data_vencimento) {
                return res.status(400).json({ success: false, message: 'Nome do sacado, valor e vencimento são obrigatórios' });
            }

            // Buscar configuração de integração bancária (se houver)
            let config = {};
            if (conta_bancaria_id) {
                const [configs] = await pool.query(
                    'SELECT * FROM integracoes_bancarias WHERE banco_id = ?', [conta_bancaria_id]
                );
                if (configs.length > 0) config = configs[0];
            }

            // Gerar nosso número sequencial
            let nossoNumero;
            if (config.boleto_nosso_numero_proximo) {
                nossoNumero = config.boleto_nosso_numero_proximo;
                await pool.query(
                    'UPDATE integracoes_bancarias SET boleto_nosso_numero_proximo = ? WHERE id = ?',
                    [String(parseInt(nossoNumero) + 1).padStart(nossoNumero.length, '0'), config.id]
                );
            } else {
                // Gerar baseado no último ID
                const [last] = await pool.query('SELECT MAX(id) as maxId FROM boletos');
                nossoNumero = String((last[0]?.maxId || 0) + 1).padStart(10, '0');
            }

            // Gerar número do documento
            const numDoc = `BOL${new Date().getFullYear()}${nossoNumero}`;

            // Gerar linha digitável simulada (formato ITF-25)
            const bancoCode = '001'; // Banco do Brasil como padrão
            const valorStr = Math.round(valor * 100).toString().padStart(10, '0');
            const venc = new Date(data_vencimento);
            const fatorVencimento = Math.floor((venc - new Date('1997-10-07')) / (1000*60*60*24));
            const linhaDigitavel = `${bancoCode}9.${nossoNumero.slice(0,5)}  ${nossoNumero.slice(5)}${String(fatorVencimento).padStart(4,'0')}  ${valorStr}`;
            const codigoBarras = `${bancoCode}9${String(fatorVencimento).padStart(4,'0')}${valorStr}${nossoNumero.padStart(25,'0')}`;

            // Calcular multa e juros
            const multa = config.boleto_multa ? (valor * config.boleto_multa / 100) : (valor * 0.02);
            const jurosDia = config.boleto_juros ? (valor * config.boleto_juros / 100 / 30) : (valor * 0.01 / 30);

            const [result] = await pool.query(
                `INSERT INTO boletos (conta_receber_id, conta_bancaria_id, nosso_numero, numero_documento,
                    valor, valor_multa, valor_juros_dia, data_emissao, data_vencimento,
                    sacado_nome, sacado_cpf_cnpj, sacado_endereco, sacado_cidade, sacado_uf, sacado_cep,
                    instrucao1, instrucao2, status, linha_digitavel, codigo_barras, observacoes)
                 VALUES (?, ?, ?, ?, ?, ?, ?, CURDATE(), ?, ?, ?, ?, ?, ?, ?, ?, ?, 'emitido', ?, ?, ?)`,
                [conta_receber_id || null, conta_bancaria_id || null, nossoNumero, numDoc,
                 valor, multa, jurosDia, data_vencimento,
                 sacado_nome, sacado_cpf_cnpj || null, sacado_endereco || null, sacado_cidade || null,
                 sacado_uf || null, sacado_cep || null,
                 instrucao1 || config.boleto_instrucao1 || 'Não receber após vencimento',
                 instrucao2 || config.boleto_instrucao2 || 'Cobrar multa e juros após vencimento',
                 linhaDigitavel, codigoBarras, observacoes || null]
            );

            // Vincular ao conta_receber
            if (conta_receber_id) {
                await pool.query('UPDATE contas_receber SET observacoes = CONCAT(COALESCE(observacoes,""), ?) WHERE id = ?',
                    [`\n[Boleto #${result.insertId} emitido em ${new Date().toLocaleDateString('pt-BR')}]`, conta_receber_id]);
            }

            res.json({
                success: true,
                message: 'Boleto emitido com sucesso',
                boleto: {
                    id: result.insertId,
                    nosso_numero: nossoNumero,
                    numero_documento: numDoc,
                    linha_digitavel: linhaDigitavel,
                    codigo_barras: codigoBarras,
                    valor,
                    data_vencimento,
                    sacado_nome,
                    status: 'emitido'
                }
            });
        } catch (error) {
            console.error('[Boletos] Erro ao emitir:', error);
            next(error);
        }
    });

    // 5b. Listar boletos
    router.get('/boletos', async (req, res, next) => {
        try {
            const { status, data_inicio, data_fim, page = 1, limit = 50 } = req.query;
            let query = 'SELECT * FROM boletos WHERE 1=1';
            const params = [];

            if (status) { query += ' AND status = ?'; params.push(status); }
            if (data_inicio && data_fim) {
                query += ' AND data_vencimento BETWEEN ? AND ?';
                params.push(data_inicio, data_fim);
            }

            query += ' ORDER BY data_vencimento DESC LIMIT ? OFFSET ?';
            params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

            const [rows] = await pool.query(query, params);
            const [[{ total }]] = await pool.query('SELECT COUNT(*) as total FROM boletos');
            res.json({ success: true, data: rows, total });
        } catch (error) {
            if (error.code === 'ER_NO_SUCH_TABLE') return res.json({ success: true, data: [], total: 0 });
            next(error);
        }
    });

    // 5c. Atualizar status boleto (baixa manual)
    router.put('/boletos/:id', async (req, res, next) => {
        try {
            const { status, data_pagamento, valor_pago } = req.body;
            const updates = [];
            const params = [];

            if (status) { updates.push('status = ?'); params.push(status); }
            if (data_pagamento) { updates.push('data_pagamento = ?'); params.push(data_pagamento); }
            if (valor_pago) { updates.push('valor_pago = ?'); params.push(valor_pago); }

            if (updates.length === 0) return res.status(400).json({ success: false, message: 'Nada para atualizar' });

            params.push(req.params.id);
            await pool.query(`UPDATE boletos SET ${updates.join(', ')} WHERE id = ?`, params);

            // Se marcado como pago, atualizar conta_receber vinculada
            if (status === 'pago') {
                const [boleto] = await pool.query('SELECT conta_receber_id FROM boletos WHERE id = ?', [req.params.id]);
                if (boleto.length > 0 && boleto[0].conta_receber_id) {
                    await pool.query("UPDATE contas_receber SET status = 'pago', data_recebimento = ? WHERE id = ?",
                        [data_pagamento || new Date().toISOString().slice(0,10), boleto[0].conta_receber_id]);
                }
            }

            res.json({ success: true, message: 'Boleto atualizado' });
        } catch (error) { next(error); }
    });

    // 5d. Cancelar boleto
    router.delete('/boletos/:id', async (req, res, next) => {
        try {
            await pool.query("UPDATE boletos SET status = 'cancelado' WHERE id = ?", [req.params.id]);
            res.json({ success: true, message: 'Boleto cancelado' });
        } catch (error) { next(error); }
    });

    // ============================================================
    // EMISSÃO DE NFS-e (Nota Fiscal de Serviço Eletrônica)
    // ============================================================
    async function ensureNfseTable() {
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS notas_fiscais_servico (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    numero_nfse VARCHAR(30),
                    serie VARCHAR(10) DEFAULT '1',
                    conta_receber_id INT,
                    -- Prestador
                    prestador_cnpj VARCHAR(20),
                    prestador_razao_social VARCHAR(255),
                    prestador_inscricao_municipal VARCHAR(30),
                    -- Tomador
                    tomador_nome VARCHAR(255) NOT NULL,
                    tomador_cpf_cnpj VARCHAR(20),
                    tomador_email VARCHAR(255),
                    tomador_endereco VARCHAR(500),
                    tomador_cidade VARCHAR(100),
                    tomador_uf CHAR(2),
                    tomador_cep VARCHAR(10),
                    -- Serviço
                    codigo_servico VARCHAR(20),
                    descricao_servico TEXT NOT NULL,
                    valor_servico DECIMAL(15,2) NOT NULL,
                    valor_deducoes DECIMAL(15,2) DEFAULT 0,
                    base_calculo DECIMAL(15,2),
                    aliquota_iss DECIMAL(5,2) DEFAULT 5.00,
                    valor_iss DECIMAL(15,2),
                    iss_retido TINYINT(1) DEFAULT 0,
                    -- Outros impostos
                    valor_pis DECIMAL(15,2) DEFAULT 0,
                    valor_cofins DECIMAL(15,2) DEFAULT 0,
                    valor_inss DECIMAL(15,2) DEFAULT 0,
                    valor_ir DECIMAL(15,2) DEFAULT 0,
                    valor_csll DECIMAL(15,2) DEFAULT 0,
                    valor_liquido DECIMAL(15,2),
                    -- Status
                    status ENUM('rascunho','emitida','cancelada','substituida') DEFAULT 'rascunho',
                    data_emissao DATE,
                    data_competencia DATE,
                    observacoes TEXT,
                    -- Controle
                    xml_nfse LONGTEXT,
                    pdf_url VARCHAR(500),
                    protocolo VARCHAR(100),
                    codigo_verificacao VARCHAR(100),
                    usuario_emissao_id INT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    INDEX idx_status (status),
                    INDEX idx_tomador (tomador_cpf_cnpj),
                    INDEX idx_data (data_emissao)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
        } catch (err) {
            console.error('[NFS-e] Erro ao criar tabela:', err.message);
        }
    }
    ensureNfseTable();

    // 6a. Emitir NFS-e
    router.post('/emitir-nfse', async (req, res, next) => {
        try {
            const { conta_receber_id, tomador_nome, tomador_cpf_cnpj, tomador_email,
                    tomador_endereco, tomador_cidade, tomador_uf, tomador_cep,
                    codigo_servico, descricao_servico, valor_servico,
                    valor_deducoes, aliquota_iss, iss_retido,
                    data_competencia, observacoes } = req.body;

            if (!tomador_nome || !descricao_servico || !valor_servico) {
                return res.status(400).json({ success: false, message: 'Tomador, descrição e valor do serviço são obrigatórios' });
            }

            // Calcular impostos
            const valor = Number(valor_servico);
            const deducoes = Number(valor_deducoes || 0);
            const baseCalculo = valor - deducoes;
            const aliquota = Number(aliquota_iss || 5);
            const valorIss = Number((baseCalculo * aliquota / 100).toFixed(2));

            // PIS/COFINS/INSS/IR/CSLL (alíquotas padrão serviços)
            const valorPis = Number((valor * 0.0065).toFixed(2));
            const valorCofins = Number((valor * 0.03).toFixed(2));
            const valorInss = Number((valor * 0.011).toFixed(2));
            const valorIr = valor > 666.66 ? Number((valor * 0.015).toFixed(2)) : 0;
            const valorCsll = Number((valor * 0.01).toFixed(2));

            const retencoes = (iss_retido ? valorIss : 0) + valorPis + valorCofins + valorInss + valorIr + valorCsll;
            const valorLiquido = Number((valor - retencoes).toFixed(2));

            // Gerar número sequencial
            const [lastNfse] = await pool.query('SELECT MAX(id) as maxId FROM notas_fiscais_servico');
            const proximoNum = String((lastNfse[0]?.maxId || 0) + 1).padStart(8, '0');

            // Gerar protocolo e código de verificação
            const crypto = require('crypto');
            const protocolo = `PROT${new Date().getFullYear()}${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
            const codVerificacao = crypto.randomBytes(6).toString('hex').toUpperCase();

            const [result] = await pool.query(
                `INSERT INTO notas_fiscais_servico (
                    numero_nfse, conta_receber_id,
                    tomador_nome, tomador_cpf_cnpj, tomador_email,
                    tomador_endereco, tomador_cidade, tomador_uf, tomador_cep,
                    codigo_servico, descricao_servico, valor_servico, valor_deducoes,
                    base_calculo, aliquota_iss, valor_iss, iss_retido,
                    valor_pis, valor_cofins, valor_inss, valor_ir, valor_csll, valor_liquido,
                    status, data_emissao, data_competencia, observacoes,
                    protocolo, codigo_verificacao, usuario_emissao_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'emitida', CURDATE(), ?, ?, ?, ?, ?)`,
                [proximoNum, conta_receber_id || null,
                 tomador_nome, tomador_cpf_cnpj || null, tomador_email || null,
                 tomador_endereco || null, tomador_cidade || null, tomador_uf || null, tomador_cep || null,
                 codigo_servico || null, descricao_servico, valor, deducoes,
                 baseCalculo, aliquota, valorIss, iss_retido ? 1 : 0,
                 valorPis, valorCofins, valorInss, valorIr, valorCsll, valorLiquido,
                 data_competencia || new Date().toISOString().slice(0,10), observacoes || null,
                 protocolo, codVerificacao, req.user?.id || null]
            );

            res.json({
                success: true,
                message: 'NFS-e emitida com sucesso',
                nfse: {
                    id: result.insertId,
                    numero: proximoNum,
                    protocolo,
                    codigo_verificacao: codVerificacao,
                    valor_servico: valor,
                    valor_iss: valorIss,
                    valor_liquido: valorLiquido,
                    status: 'emitida',
                    data_emissao: new Date().toISOString().slice(0,10)
                }
            });
        } catch (error) {
            console.error('[NFS-e] Erro ao emitir:', error);
            next(error);
        }
    });

    // 6b. Listar NFS-e
    router.get('/nfse', async (req, res, next) => {
        try {
            const { status, data_inicio, data_fim, page = 1, limit = 50 } = req.query;
            let query = 'SELECT * FROM notas_fiscais_servico WHERE 1=1';
            const params = [];

            if (status) { query += ' AND status = ?'; params.push(status); }
            if (data_inicio && data_fim) {
                query += ' AND data_emissao BETWEEN ? AND ?';
                params.push(data_inicio, data_fim);
            }

            query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
            params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

            const [rows] = await pool.query(query, params);
            const [[{ total }]] = await pool.query('SELECT COUNT(*) as total FROM notas_fiscais_servico');
            res.json({ success: true, data: rows, total });
        } catch (error) {
            if (error.code === 'ER_NO_SUCH_TABLE') return res.json({ success: true, data: [], total: 0 });
            next(error);
        }
    });

    // 6c. Buscar NFS-e por ID
    router.get('/nfse/:id', async (req, res, next) => {
        try {
            const [rows] = await pool.query('SELECT * FROM notas_fiscais_servico WHERE id = ?', [req.params.id]);
            if (rows.length === 0) return res.status(404).json({ success: false, message: 'NFS-e não encontrada' });
            res.json({ success: true, data: rows[0] });
        } catch (error) { next(error); }
    });

    // 6d. Cancelar NFS-e
    router.put('/nfse/:id/cancelar', async (req, res, next) => {
        try {
            const { motivo } = req.body;
            await pool.query("UPDATE notas_fiscais_servico SET status = 'cancelada', observacoes = CONCAT(COALESCE(observacoes,''), ?) WHERE id = ?",
                [`\n[CANCELADA em ${new Date().toLocaleDateString('pt-BR')}: ${motivo || 'Sem motivo informado'}]`, req.params.id]);
            res.json({ success: true, message: 'NFS-e cancelada' });
        } catch (error) { next(error); }
    });

    // 6. Anexo de Comprovantes Digitais
    router.post('/anexar-comprovante', upload.single('comprovante'), async (req, res, next) => {
        if (!req.file) return res.status(400).json({ message: 'Arquivo não enviado.' });
        res.json({ message: 'Comprovante anexado!', url: `/uploads/comprovantes/${req.file.filename}` });
    });

    // 7. Dashboard de Indicadores-Chave (KPIs) - VERSÁO MELHORADA
    router.get('/dashboard-kpis', async (req, res, next) => {
        try {
            // Receitas do mês atual
            const [receitas] = await pool.query(`
                SELECT COALESCE(SUM(valor), 0) as total
                FROM contas_receber
                WHERE status = 'pago'
                AND MONTH(data_vencimento) = MONTH(CURRENT_DATE())
                AND YEAR(data_vencimento) = YEAR(CURRENT_DATE())
            `);

            // Despesas do mês atual
            const [despesas] = await pool.query(`
                SELECT COALESCE(SUM(valor), 0) as total
                FROM contas_pagar
                WHERE status = 'pago'
                AND MONTH(data_vencimento) = MONTH(CURRENT_DATE())
                AND YEAR(data_vencimento) = YEAR(CURRENT_DATE())
            `);

            // Contas em atraso
            const [atrasadas] = await pool.query(`
                SELECT COUNT(*) as count, COALESCE(SUM(valor), 0) as valor_total
                FROM contas_receber
                WHERE status != 'pago' AND data_vencimento < CURRENT_DATE()
            `);

            // Fluxo de caixa projetado próximos 30 dias
            const [fluxo30dias] = await pool.query(`
                SELECT
                    COALESCE(SUM(CASE WHEN tipo = 'receber' THEN valor ELSE 0 END), 0) as receitas_projetadas,
                    COALESCE(SUM(CASE WHEN tipo = 'pagar' THEN valor ELSE 0 END), 0) as despesas_projetadas
                FROM (
                    SELECT valor, 'receber' as tipo FROM contas_receber
                    WHERE status != 'pago' AND data_vencimento BETWEEN CURRENT_DATE() AND DATE_ADD(CURRENT_DATE(), INTERVAL 30 DAY)
                    UNION ALL
                    SELECT valor, 'pagar' as tipo FROM contas_pagar
                    WHERE status != 'pago' AND data_vencimento BETWEEN CURRENT_DATE() AND DATE_ADD(CURRENT_DATE(), INTERVAL 30 DAY)
                ) as fluxo
            `);

            const receita_mes = receitas[0].total;
            const despesa_mes = despesas[0].total;
            const lucro_mes = receita_mes - despesa_mes;
            const margem_lucro = receita_mes > 0 ? ((lucro_mes / receita_mes) * 100).toFixed(2) : 0;
            const inadimplencia = receita_mes > 0 ? ((atrasadas[0].valor_total / receita_mes) * 100).toFixed(2) : 0;

            res.json({
                success: true,
                data: {
                    receita_mes_atual: receita_mes,
                    despesa_mes_atual: despesa_mes,
                    lucro_mes_atual: lucro_mes,
                    margem_lucro: `${margem_lucro}%`,
                    inadimplencia: `${inadimplencia}%`,
                    contas_atrasadas: atrasadas[0].count,
                    valor_contas_atrasadas: atrasadas[0].valor_total,
                    fluxo_projetado_30_dias: {
                        receitas: fluxo30dias[0].receitas_projetadas,
                        despesas: fluxo30dias[0].despesas_projetadas,
                        saldo_projetado: fluxo30dias[0].receitas_projetadas - fluxo30dias[0].despesas_projetadas
                    },
                    periodo: new Date().toISOString().slice(0, 7)
                }
            });
        } catch (error) {
            next(error);
        }
    });

    // 8. Gestão de Contas a Receber - NOVA FUNCIONALIDADE
    router.get('/contas-receber', async (req, res, next) => {
        try {
            const { page = 1, limit = 100, status, vencimento_inicio, vencimento_fim } = req.query;
            const offset = (page - 1) * limit;

            let whereClause = 'WHERE 1=1';
            const params = [];

            if (status) {
                whereClause += ' AND cr.status = ?';
                params.push(status);
            }

            if (vencimento_inicio && vencimento_fim) {
                whereClause += ' AND cr.data_vencimento BETWEEN ? AND ?';
                params.push(vencimento_inicio, vencimento_fim);
            }

            const [contas] = await pool.query(`
                SELECT
                    cr.id,
                    cr.cliente_id,
                    COALESCE(c.razao_social, c.nome_fantasia, cr.descricao, 'Cliente não identificado') as cliente_nome,
                    COALESCE(c.cnpj_cpf, '') as cnpj_cpf,
                    cr.valor as valor_total,
                    cr.valor,
                    cr.descricao,
                    cr.status,
                    cr.data_vencimento,
                    cr.data_criacao,
                    cr.forma_recebimento,
                    cr.observacoes as categoria,
                    cr.parcela_numero,
                    cr.total_parcelas,
                    cr.valor_recebido,
                    cr.data_recebimento,
                    CASE
                        WHEN cr.data_vencimento < CURRENT_DATE() AND cr.status != 'pago' AND cr.status != 'recebido' THEN 'vencido'
                        WHEN cr.data_vencimento = CURRENT_DATE() AND cr.status != 'pago' AND cr.status != 'recebido' THEN 'vence_hoje'
                        ELSE cr.status
                    END as status_detalhado,
                    DATEDIFF(CURRENT_DATE(), cr.data_vencimento) as dias_atraso
                FROM contas_receber cr
                LEFT JOIN clientes c ON cr.cliente_id = c.id
                ${whereClause}
                ORDER BY cr.data_vencimento ASC
                LIMIT ? OFFSET ?
            `, [...params, parseInt(limit), offset]);

            console.log('[Financeiro] Contas a receber carregadas:', contas.length);

            // Retornar dados em formato compatível com frontend
            res.json({
                success: true,
                data: contas,
                total: contas.length
            });
        } catch (error) {
            console.error('[Financeiro] Erro em contas-receber:', error);
            next(error);
        }
    });

    router.post('/contas-receber', async (req, res, next) => {
        try {
            const { cliente_nome, valor, data_vencimento, descricao, categoria } = req.body;

            if (!cliente_nome || !valor || !data_vencimento) {
                return res.status(400).json({
                    success: false,
                    message: 'Cliente, valor e data de vencimento são obrigatórios'
                });
            }

            const [result] = await pool.query(`
                INSERT INTO contas_receber
                (cliente_nome, valor, data_vencimento, descricao, categoria, status, data_cadastro)
                VALUES (?, ?, ?, ?, ?, 'pendente', NOW())
            `, [cliente_nome, valor, data_vencimento, descricao, categoria]);

            res.status(201).json({
                success: true,
                message: 'Conta a receber criada com sucesso',
                data: { id: result.insertId }
            });
        } catch (error) {
            next(error);
        }
    });

    // 9. Gestão de Contas a Pagar - NOVA FUNCIONALIDADE
    router.get('/contas-pagar', async (req, res, next) => {
        try {
            const { page = 1, limit = 100, status, vencimento_inicio, vencimento_fim } = req.query;
            const offset = (page - 1) * limit;

            let whereClause = 'WHERE 1=1';
            const params = [];

            if (status) {
                whereClause += ' AND cp.status = ?';
                params.push(status);
            }

            if (vencimento_inicio && vencimento_fim) {
                whereClause += ' AND cp.data_vencimento BETWEEN ? AND ?';
                params.push(vencimento_inicio, vencimento_fim);
            }

            let contas;
            try {
                // Tenta query completa com JOIN
                const [result] = await pool.query(`
                    SELECT
                        cp.id,
                        cp.fornecedor_id,
                        COALESCE(f.razao_social, f.nome_fantasia, cp.fornecedor_nome, cp.descricao, 'Fornecedor não identificado') as fornecedor_nome,
                        COALESCE(f.cnpj, '') as fornecedor_cnpj,
                        cp.valor as valor_total,
                        cp.valor,
                        cp.descricao,
                        cp.numero_documento,
                        cp.status,
                        DATE_FORMAT(cp.data_vencimento, '%Y-%m-%d') as data_vencimento,
                        cp.data_criacao,
                        cp.forma_pagamento,
                        COALESCE(cp.categoria_nome, cp.observacoes) as categoria,
                        cp.observacoes,
                        cp.parcela_numero,
                        cp.total_parcelas,
                        cp.valor_pago,
                        cp.data_recebimento as data_pagamento,
                        cp.pedido_compra_id,
                        CASE
                            WHEN cp.data_vencimento < CURRENT_DATE() AND cp.status != 'pago' THEN 'vencido'
                            WHEN cp.data_vencimento = CURRENT_DATE() AND cp.status != 'pago' THEN 'vence_hoje'
                            ELSE cp.status
                        END as status_detalhado,
                        DATEDIFF(CURRENT_DATE(), cp.data_vencimento) as dias_atraso
                    FROM contas_pagar cp
                    LEFT JOIN fornecedores f ON cp.fornecedor_id = f.id
                    ${whereClause}
                    ORDER BY cp.data_vencimento ASC
                    LIMIT ? OFFSET ?
                `, [...params, parseInt(limit), offset]);
                contas = result;
            } catch (sqlError) {
                // Fallback: query simples sem JOIN (colunas opcionais podem não existir)
                console.warn('[Financeiro] Query completa falhou, usando fallback simples:', sqlError.message);
                const simplWhere = whereClause.replace(/cp\./g, '');
                const [result] = await pool.query(`
                    SELECT id, descricao, fornecedor_nome, valor, data_vencimento, status, categoria, forma_pagamento, observacoes, created_at FROM contas_pagar ${simplWhere}
                    ORDER BY data_vencimento ASC
                    LIMIT ? OFFSET ?
                `, [...params, parseInt(limit), offset]);
                contas = result;
            }

            console.log('[Financeiro] Contas a pagar carregadas:', contas.length);

            // Retornar dados em formato compatível com frontend
            res.json({
                success: true,
                data: contas,
                total: contas.length
            });
        } catch (error) {
            console.error('[Financeiro] Erro em contas-pagar:', error);
            res.status(500).json({ success: false, data: [], message: 'Erro ao buscar contas a pagar' });
        }
    });

    router.post('/contas-pagar', async (req, res, next) => {
        try {
            const { fornecedor_nome, valor, data_vencimento, descricao, categoria } = req.body;

            if (!fornecedor_nome || !valor || !data_vencimento) {
                return res.status(400).json({
                    success: false,
                    message: 'Fornecedor, valor e data de vencimento são obrigatórios'
                });
            }

            const [result] = await pool.query(`
                INSERT INTO contas_pagar
                (fornecedor_nome, valor, data_vencimento, descricao, categoria, status, data_cadastro)
                VALUES (?, ?, ?, ?, ?, 'pendente', NOW())
            `, [fornecedor_nome, valor, data_vencimento, descricao, categoria]);

            res.status(201).json({
                success: true,
                message: 'Conta a pagar criada com sucesso',
                data: { id: result.insertId }
            });
        } catch (error) {
            next(error);
        }
    });

    // 10. Relatórios Financeiros Avançados - MELHORADOS
    router.get('/relatorios/dre', async (req, res, next) => {
        try {
            const { ano = new Date().getFullYear(), mes } = req.query;

            let whereClause = 'WHERE YEAR(data_vencimento) = ?';
            const params = [ano];

            if (mes) {
                whereClause += ' AND MONTH(data_vencimento) = ?';
                params.push(mes);
            }

            // Receitas
            const [receitas] = await pool.query(`
                SELECT
                    COALESCE(categoria_nome, 'Sem Categoria') as categoria,
                    COALESCE(SUM(valor), 0) as total
                FROM contas_receber
                ${whereClause} AND status = 'pago'
                GROUP BY categoria_nome
            `, params);

            // Despesas
            const [despesas] = await pool.query(`
                SELECT
                    COALESCE(categoria_nome, 'Sem Categoria') as categoria,
                    COALESCE(SUM(valor), 0) as total
                FROM contas_pagar
                ${whereClause} AND status = 'pago'
                GROUP BY categoria_nome
            `, params);

            const total_receitas = receitas.reduce((sum, item) => sum + Number(item.total), 0);
            const total_despesas = despesas.reduce((sum, item) => sum + Number(item.total), 0);
            const lucro_liquido = total_receitas - total_despesas;

            res.json({
                success: true,
                data: {
                    periodo: mes ? `${mes}/${ano}` : ano.toString(),
                    receitas: {
                        categorias: receitas,
                        total: total_receitas
                    },
                    despesas: {
                        categorias: despesas,
                        total: total_despesas
                    },
                    resultado: {
                        lucro_bruto: total_receitas,
                        despesas_operacionais: total_despesas,
                        lucro_liquido: lucro_liquido,
                        margem_liquida: total_receitas > 0 ? ((lucro_liquido / total_receitas) * 100).toFixed(2) + '%' : '0%'
                    }
                }
            });
        } catch (error) {
            next(error);
        }
    });

    // 11. Fluxo de Caixa Detalhado - NOVA FUNCIONALIDADE
    router.get('/fluxo-caixa', async (req, res, next) => {
        try {
            const { data_inicio, data_fim } = req.query;

            if (!data_inicio || !data_fim) {
                return res.status(400).json({
                    success: false,
                    message: 'Data de início e fim são obrigatórias'
                });
            }

            const [movimentacoes] = await pool.query(`
                SELECT
                    data_vencimento as data,
                    'entrada' as tipo,
                    valor,
                    cliente_nome as origem_destino,
                    descricao,
                    categoria
                FROM contas_receber
                WHERE data_vencimento BETWEEN ? AND ? AND status = 'pago'

                UNION ALL

                SELECT
                    data_vencimento as data,
                    'saida' as tipo,
                    valor,
                    fornecedor_nome as origem_destino,
                    descricao,
                    categoria
                FROM contas_pagar
                WHERE data_vencimento BETWEEN ? AND ? AND status = 'pago'

                ORDER BY data ASC
            `, [data_inicio, data_fim, data_inicio, data_fim]);

            // Calcular saldo acumulado
            let saldo_acumulado = 0;
            const fluxo_detalhado = movimentacoes.map(mov => {
                if (mov.tipo === 'entrada') {
                    saldo_acumulado += mov.valor;
                } else {
                    saldo_acumulado -= mov.valor;
                }

                return {
                    ...mov,
                    saldo_acumulado
                };
            });

            res.json({
                success: true,
                data: {
                    periodo: { inicio: data_inicio, fim: data_fim },
                    movimentacoes: fluxo_detalhado,
                    resumo: {
                        total_entradas: movimentacoes.filter(m => m.tipo === 'entrada').reduce((sum, m) => sum + m.valor, 0),
                        total_saidas: movimentacoes.filter(m => m.tipo === 'saida').reduce((sum, m) => sum + m.valor, 0),
                        saldo_final: saldo_acumulado
                    }
                }
            });
        } catch (error) {
            next(error);
        }
    });

    // 12. Alertas Financeiros Inteligentes - MELHORADOS
    router.get('/alertas', async (req, res, next) => {
        try {
            const alertas = [];

            // Contas vencendo hoje
            const [vencendoHoje] = await pool.query(`
                SELECT COUNT(*) as count FROM contas_receber
                WHERE data_vencimento = CURRENT_DATE() AND status != 'pago'
            `);

            if (vencendoHoje[0].count > 0) {
                alertas.push({
                    tipo: 'contas_vencendo_hoje',
                    nivel: 'warning',
                    titulo: 'Contas a Receber Vencendo Hoje',
                    mensagem: `${vencendoHoje[0].count} conta(s) a receber vencem hoje`,
                    quantidade: vencendoHoje[0].count
                });
            }

            // Contas em atraso
            const [emAtraso] = await pool.query(`
                SELECT COUNT(*) as count, COALESCE(SUM(valor), 0) as valor_total
                FROM contas_receber
                WHERE data_vencimento < CURRENT_DATE() AND status != 'pago'
            `);

            if (emAtraso[0].count > 0) {
                alertas.push({
                    tipo: 'contas_em_atraso',
                    nivel: 'danger',
                    titulo: 'Contas em Atraso',
                    mensagem: `${emAtraso[0].count} conta(s) em atraso totalizando R$ ${Number(emAtraso[0].valor_total).toFixed(2)}`,
                    quantidade: emAtraso[0].count,
                    valor: Number(emAtraso[0].valor_total)
                });
            }

            // Contas a pagar vencendo em 3 dias
            const [pagarVencendo] = await pool.query(`
                SELECT COUNT(*) as count, COALESCE(SUM(valor), 0) as valor_total
                FROM contas_pagar
                WHERE data_vencimento BETWEEN CURRENT_DATE() AND DATE_ADD(CURRENT_DATE(), INTERVAL 3 DAY)
                AND status != 'pago'
            `);

            if (pagarVencendo[0].count > 0) {
                alertas.push({
                    tipo: 'contas_pagar_vencendo',
                    nivel: 'info',
                    titulo: 'Contas a Pagar Vencendo',
                    mensagem: `${pagarVencendo[0].count} conta(s) a pagar vencem em até 3 dias`,
                    quantidade: pagarVencendo[0].count,
                    valor: pagarVencendo[0].valor_total
                });
            }

            res.json({
                success: true,
                data: { alertas }
            });
        } catch (error) {
            next(error);
        }
    });

    // Integração com Vendas/CRM
    router.post('/integracao/vendas/venda-ganha', [
        body('pedido_id').isInt({ min: 1 }).withMessage('ID do pedido inválido'),
        body('cliente_id').isInt({ min: 1 }).withMessage('ID do cliente inválido'),
        body('valor').isFloat({ min: 0.01 }).withMessage('Valor deve ser positivo'),
        body('descricao').trim().notEmpty().withMessage('Descrição é obrigatória')
            .isLength({ max: 500 }).withMessage('Descrição muito longa'),
        validate
    ], async (req, res, next) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const { pedido_id, cliente_id, valor, descricao } = req.body;

            // Verificar se pedido existe e não está já faturado
            const [pedido] = await connection.query('SELECT id, status FROM pedidos WHERE id = ?', [pedido_id]);
            if (pedido.length === 0) {
                await connection.rollback();
                return res.status(404).json({ error: 'Pedido não encontrado' });
            }
            if (pedido[0].status === 'faturado') {
                await connection.rollback();
                return res.status(400).json({ error: 'Pedido já está faturado' });
            }

            // Criar conta a receber
            await connection.query('INSERT INTO contas_receber (pedido_id, cliente_id, valor, descricao, status) VALUES (?, ?, ?, ?, "pendente")', [pedido_id, cliente_id, valor, descricao]);

            // Atualizar status do pedido
            await connection.query('UPDATE pedidos SET status = "faturado" WHERE id = ?', [pedido_id]);

            await connection.commit();
            res.json({ message: 'Conta a receber e pedido faturado gerados.' });
        } catch (error) {
            await connection.rollback();
            next(error);
        } finally {
            connection.release();
        }
    });

    // Integração com Estoque
    router.post('/integracao/estoque/nf-compra', [
        body('fornecedor_id').isInt({ min: 1 }).withMessage('ID do fornecedor inválido'),
        body('valor').isFloat({ min: 0.01 }).withMessage('Valor deve ser positivo'),
        body('itens').isArray({ min: 1 }).withMessage('Itens devem ser um array não vazio'),
        body('itens.*.material_id').isInt({ min: 1 }).withMessage('ID do material inválido'),
        body('itens.*.quantidade').isFloat({ min: 0.01 }).withMessage('Quantidade deve ser positiva'),
        validate
    ], async (req, res, next) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const { fornecedor_id, valor, itens } = req.body;

            // Verificar se fornecedor existe
            const [fornecedor] = await connection.query('SELECT id FROM fornecedores WHERE id = ?', [fornecedor_id]);
            if (fornecedor.length === 0) {
                await connection.rollback();
                return res.status(404).json({ error: 'Fornecedor não encontrado' });
            }

            // Criar conta a pagar
            const [contaResult] = await connection.query('INSERT INTO contas_pagar (fornecedor_id, valor, status) VALUES (?, ?, "pendente")', [fornecedor_id, valor]);
            const contaPagarId = contaResult.insertId;

            // Atualizar estoque de cada item e registrar movimentação
            for (const item of itens) {
                // Verificar se material existe
                const [material] = await connection.query('SELECT id, nome FROM materiais WHERE id = ?', [item.material_id]);
                if (material.length === 0) {
                    await connection.rollback();
                    return res.status(404).json({ error: `Material ID ${item.material_id} não encontrado` });
                }

                // Atualizar estoque
                await connection.query('UPDATE materiais SET quantidade_estoque = quantidade_estoque + ? WHERE id = ?', [item.quantidade, item.material_id]);

                // Registrar movimentação de estoque
                await connection.query(`
                    INSERT INTO estoque_movimentacoes (material_id, tipo, quantidade, referencia_tipo, referencia_id, observacao, data_movimentacao)
                    VALUES (?, 'entrada', ?, 'nf_compra', ?, 'Entrada via NF de compra', NOW())
                `, [item.material_id, item.quantidade, contaPagarId]);
            }

            await connection.commit();
            res.json({ message: 'Financeiro e estoque atualizados.', conta_pagar_id: contaPagarId });
        } catch (error) {
            await connection.rollback();
            next(error);
        } finally {
            connection.release();
        }
    });

    // AUDIT-FIX: SECURED previously open API routes — added authenticateToken middleware.
    // These routes were accessible WITHOUT ANY authentication, exposing all contas_receber data.
    router.get('/api-aberta/contas-receber', authenticateToken, async (req, res, next) => {
        try {
            const limit = Math.min(parseInt(req.query.limit) || 200, 500);
            const offset = parseInt(req.query.offset) || 0;
            const [rows] = await pool.query('SELECT id, cliente_id, valor, descricao, status, data_vencimento, data_recebimento, data_criacao FROM contas_receber ORDER BY id DESC LIMIT ? OFFSET ?', [limit, offset]);
            res.json(rows);
        } catch (error) { next(error); }
    });
    router.post('/api-aberta/contas-receber', authenticateToken, [
        body('cliente_id').isInt({ min: 1 }).withMessage('ID do cliente inválido'),
        body('valor').isFloat({ min: 0.01 }).withMessage('Valor deve ser positivo'),
        body('descricao').trim().notEmpty().withMessage('Descrição é obrigatória')
            .isLength({ max: 500 }).withMessage('Descrição muito longa'),
        validate
    ], async (req, res, next) => {
        try {
            const { cliente_id, valor, descricao } = req.body;
            await pool.query('INSERT INTO contas_receber (cliente_id, valor, descricao, status) VALUES (?, ?, ?, "pendente")', [cliente_id, valor, descricao]);
            res.status(201).json({ message: 'Conta a receber criada via API.' });
        } catch (error) { next(error); }
    });

    // Gestão de Riscos com ACL
    router.post('/contas-pagar', authorizeACL('lancar_conta'), async (req, res, next) => {
        res.json({ message: 'Conta a pagar lançada (simulação).' });
    });
    router.post('/contas-pagar/aprovar', authorizeACL('aprovar_pagamento'), async (req, res, next) => {
        res.json({ message: 'Pagamento aprovado (simulação).' });
    });
    router.get('/relatorios/lucratividade', authorizeACL('ver_relatorio'), async (req, res, next) => {
        res.json({ lucro: 8000 });
    });

    // Trilha de Auditoria
    router.post('/audit-trail', [
        body('acao').trim().notEmpty().withMessage('Ação é obrigatória')
            .isLength({ max: 100 }).withMessage('Ação muito longa'),
        body('entidade').trim().notEmpty().withMessage('Entidade é obrigatória')
            .isLength({ max: 100 }).withMessage('Entidade muito longa'),
        body('entidade_id').isInt({ min: 1 }).withMessage('ID da entidade inválido'),
        validate
    ], async (req, res, next) => {
        try {
            const { acao, entidade, entidade_id } = req.body;
            const usuario_id = req.user.id;
            const ip = req.ip;
            await writeAuditLog({ userId: usuario_id, action: acao, module: 'FINANCEIRO', description: `${acao} ${entidade} #${entidade_id}`, ip });
            res.status(201).json({ message: 'Ação registrada na trilha de auditoria.' });
        } catch (error) { next(error); }
    });
    router.get('/audit-trail', authorizeACL('ver_auditoria'), async (req, res, next) => {
        try {
            const [rows] = await pool.query('SELECT id, usuario_id, acao, modulo, descricao, ip_address as ip, created_at as data, dados_anteriores as detalhes FROM auditoria_logs ORDER BY created_at DESC LIMIT 100');
            res.json(rows);
        } catch (error) { next(error); }
    });

    // Gestão de Orçamento
    router.post('/orcamentos', authorizeACL('criar_orcamento'), async (req, res, next) => {
        try {
            const { categoria, centro_custo, limite, alerta, alerta_pct, gasto } = req.body;
            if (!categoria || !limite) {
                return res.status(400).json({ error: 'Categoria e limite são obrigatórios' });
            }
            const [result] = await pool.query(
                'INSERT INTO orcamentos (categoria, centro_custo, limite, alerta, alerta_pct, gasto) VALUES (?, ?, ?, ?, ?, ?)',
                [categoria, centro_custo || null, limite, alerta || null, alerta_pct || 80, gasto || 0]
            );
            res.status(201).json({ success: true, id: result.insertId, message: 'Orçamento criado com sucesso' });
        } catch (error) {
            console.error('[Financeiro] Erro POST orcamentos:', error.message);
            next(error);
        }
    });
    router.get('/orcamentos', authorizeACL('ver_orcamento'), async (req, res, next) => {
        try {
            const [rows] = await pool.query('SELECT * FROM orcamentos ORDER BY id DESC');
            res.json(rows);
        } catch (error) {
            if (error.code === 'ER_NO_SUCH_TABLE') return res.json([]);
            console.error('[Financeiro] Erro GET orcamentos:', error.message);
            next(error);
        }
    });
    router.get('/orcamentos/alertas', authorizeACL('ver_orcamento'), async (req, res, next) => {
        try {
            const [rows] = await pool.query(
                'SELECT id, categoria, centro_custo, limite, gasto, alerta, alerta_pct, ROUND((gasto/limite)*100, 1) AS pct_usado FROM orcamentos WHERE limite > 0 AND (gasto/limite)*100 >= COALESCE(alerta_pct, 80) ORDER BY (gasto/limite) DESC'
            );
            res.json(rows);
        } catch (error) {
            if (error.code === 'ER_NO_SUCH_TABLE') return res.json([]);
            console.error('[Financeiro] Erro GET orcamentos/alertas:', error.message);
            next(error);
        }
    });

    // Usabilidade e Experiência
    router.post('/dashboard/personalizar', async (req, res, next) => {
        res.json({ message: 'Preferências de dashboard salvas (simulação).' });
    });
    router.get('/dashboard/personalizar', async (req, res, next) => {
        res.json({ kpis: ['ticketMedio', 'inadimplencia'], atalhos: ['contas-pagar', 'contas-receber'] });
    });
    router.post('/relatorios/personalizar', async (req, res, next) => {
        res.json({ message: 'Modelo de relatório salvo (simulação).' });
    });
    router.get('/relatorios/personalizar', async (req, res, next) => {
        res.json([{ nome: 'DRE Custom', colunas: ['receitas', 'despesas', 'lucro'] }]);
    });

    // Busca Global Inteligente
    router.get('/busca-global', async (req, res, next) => {
        try {
            const { q: _q } = req.query; // query param accepted but not used in this stub
            res.json({
                resultados: [
                    { tipo: 'cliente', nome: 'Empresa X', id: 1 },
                    { tipo: 'conta_receber', valor: 1200, id: 10 },
                    { tipo: 'nota_fiscal', numero: 'NF12345', id: 5 }
                ]
            });
        } catch (error) { next(error); }
    });

    // Endpoints básicos mantidos para compatibilidade
    router.get('/faturamento', async (req, res, next) => {
        try {
            const [rows] = await pool.query('SELECT SUM(valor) AS total FROM pedidos WHERE status IN ("faturado", "recibo")');
            res.json({ total: rows[0]?.total || 0 });
        } catch (error) { next(error); }
    });
    router.get('/balanco', async (req, res, next) => {
        try {
            const [[receber]] = await pool.query('SELECT SUM(valor) AS total FROM contas_receber WHERE status != "pago"');
            const [[pagar]] = await pool.query('SELECT SUM(valor) AS total FROM contas_pagar WHERE status != "pago"');
            res.json({ receber: receber?.total || 0, pagar: pagar?.total || 0, saldo: (receber?.total || 0) - (pagar?.total || 0) });
        } catch (error) { next(error); }
    });

    // Fornecedores e Clientes do Financeiro
    router.get('/fornecedores', async (req, res, next) => {
        try {
            const limit = Math.min(parseInt(req.query.limit) || 100, 500);
            const page = Math.max(parseInt(req.query.page) || 1, 1);
            const offset = (page - 1) * limit;
            const [[{ total }]] = await pool.query('SELECT COUNT(*) as total FROM fornecedores WHERE ativo = 1');
            const [fornecedores] = await pool.query(
                'SELECT id, razao_social, nome_fantasia, cnpj, email, telefone, cidade, estado, ativo, data_cadastro FROM fornecedores WHERE ativo = 1 ORDER BY razao_social LIMIT ? OFFSET ?',
                [limit, offset]
            );
            res.json({ success: true, data: fornecedores, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
        } catch (error) {
            console.error('❌ Erro ao buscar fornecedores:', error);
            res.status(500).json({ error: 'Erro ao buscar fornecedores', message: error.message });
        }
    });

    router.get('/clientes', async (req, res, next) => {
        try {
            const limit = Math.min(parseInt(req.query.limit) || 100, 500);
            const page = Math.max(parseInt(req.query.page) || 1, 1);
            const offset = (page - 1) * limit;
            const [[{ total }]] = await pool.query('SELECT COUNT(*) as total FROM clientes');
            const [clientes] = await pool.query(
                'SELECT id, razao_social, nome_fantasia, cnpj_cpf, email, telefone, cidade, estado, created_at FROM clientes ORDER BY razao_social LIMIT ? OFFSET ?',
                [limit, offset]
            );
            res.json({ success: true, data: clientes, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
        } catch (error) {
            console.error('❌ Erro ao buscar clientes:', error);
            res.status(500).json({ error: 'Erro ao buscar clientes', message: error.message });
        }
    });

    return router;
};
