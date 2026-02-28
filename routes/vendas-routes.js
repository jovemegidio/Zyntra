/**
 * VENDAS ROUTES (CRM) - Extracted from server.js (Lines 17347-19745)
 * Pedidos, clientes, faturamento, parciais
 * @module routes/vendas-routes
 */
const express = require('express');
const multer = require('multer');
const path = require('path');

module.exports = function createVendasRoutes(deps) {
    const { pool, authenticateToken, authorizeArea, authorizeAdmin, authorizeAdminOrComercial, writeAuditLog, cacheMiddleware, CACHE_CONFIG } = deps;
    const router = express.Router();

    // Serviço compartilhado de faturamento (configuração centralizada, CFOP, numeração, admin check)
    const { getFaturamentoSharedService } = require('../services/faturamento-shared.service');
    const faturamentoShared = getFaturamentoSharedService(pool);

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
    router.use(authorizeArea('vendas'));
    
    // Endpoint de KPIs para o módulo de Vendas (Admin Only)
    router.get('/kpis', async (req, res) => {
        try {
            // Verificar se é admin
            const isAdmin = req.user && (req.user.is_admin === 1 || req.user.role === 'admin');
            if (!isAdmin) {
                return res.status(403).json({ success: false, message: 'Acesso negado' });
            }
    
            const hoje = new Date().toISOString().split('T')[0];
    
            // Buscar Contas a Pagar (vencendo hoje)
            let contasPagarHoje = { valor: 0, quantidade: 0 };
            try {
                const [pagarRows] = await pool.query(`
                    SELECT COUNT(*) as quantidade, COALESCE(SUM(valor), 0) as valor
                    FROM contas_pagar
                    WHERE data_vencimento = ? AND (status IS NULL OR status NOT IN ('pago', 'cancelado'))
                `, [hoje]);
                if (pagarRows[0]) {
                    contasPagarHoje = { valor: parseFloat(pagarRows[0].valor) || 0, quantidade: parseInt(pagarRows[0].quantidade) || 0 };
                }
            } catch (e) {
                console.log('[KPIs] Tabela contas_pagar não encontrada:', e.message);
            }
    
            // Buscar Contas a Receber (vencendo hoje)
            let contasReceberHoje = { valor: 0, quantidade: 0 };
            try {
                const [receberRows] = await pool.query(`
                    SELECT COUNT(*) as quantidade, COALESCE(SUM(valor), 0) as valor
                    FROM contas_receber
                    WHERE data_vencimento = ? AND (status IS NULL OR status NOT IN ('recebido', 'cancelado'))
                `, [hoje]);
                if (receberRows[0]) {
                    contasReceberHoje = { valor: parseFloat(receberRows[0].valor) || 0, quantidade: parseInt(receberRows[0].quantidade) || 0 };
                }
            } catch (e) {
                console.log('[KPIs] Tabela contas_receber não encontrada:', e.message);
            }
    
            // Buscar Pedidos a Faturar (etapa = 'Pedido Aprovado' ou 'Pedido a Faturar')
            let pedidosAFaturar = { valor: 0, quantidade: 0 };
            try {
                // FIX: Usar coluna 'status' (padrão do sistema) em vez de 'etapa' que pode não existir
                const [pedidosRows] = await pool.query(`
                    SELECT COUNT(*) as quantidade, COALESCE(SUM(valor), 0) as valor
                    FROM pedidos
                    WHERE status IN ('aprovado', 'pedido-aprovado', 'faturar')
                `);
                if (pedidosRows[0]) {
                    pedidosAFaturar = { valor: parseFloat(pedidosRows[0].valor) || 0, quantidade: parseInt(pedidosRows[0].quantidade) || 0 };
                }
            } catch (e) {
                console.log('[KPIs] Erro ao buscar pedidos a faturar:', e.message);
            }
    
            res.json({
                success: true,
                kpis: {
                    contas_pagar_hoje: contasPagarHoje,
                    a_receber_hoje: contasReceberHoje,
                    pedidos_a_faturar: pedidosAFaturar
                }
            });
        } catch (error) {
            console.error('[API/VENDAS/KPIS] Erro:', error);
            res.status(500).json({ success: false, message: 'Erro ao carregar KPIs' });
        }
    });
    
    // Rota /me para Vendas retornar dados do usuário logado
    router.get('/me', async (req, res) => {
        try {
            if (!req.user) {
                return res.status(401).json({ message: 'Não autenticado' });
            }
    
            // Buscar dados completos do usuário no banco com JOIN para foto do funcionário
            const [[dbUser]] = await pool.query(
                `SELECT u.id, u.nome, u.email, u.role, u.is_admin,
                        u.permissoes_vendas as permissoes, u.foto, u.avatar,
                        f.foto_perfil_url as foto_funcionario
                 FROM usuarios u
                 LEFT JOIN funcionarios f ON u.email = f.email
                 WHERE u.id = ?`,
                [req.user.id]
            );
    
            if (!dbUser) {
                return res.status(404).json({ message: 'Usuário não encontrado' });
            }
    
            // Parse permissões
            let permissoes = [];
            if (dbUser.permissoes) {
                try {
                    permissoes = JSON.parse(dbUser.permissoes);
                } catch (e) {
                    console.error('[API/VENDAS/ME] Erro ao parsear permissoes:', e);
                    permissoes = [];
                }
            }
    
            // Determinar a foto (prioridade: avatar > foto > foto_funcionario)
            const fotoUsuario = dbUser.avatar || dbUser.foto || dbUser.foto_funcionario || "/avatars/default.webp";
    
            // Retornar dados completos do usuário
            res.json({
                user: {
                    id: dbUser.id,
                    nome: dbUser.nome,
                    email: dbUser.email,
                    role: dbUser.role,
                    avatar: fotoUsuario,
                    foto: fotoUsuario,
                    foto_perfil_url: fotoUsuario,
                    is_admin: dbUser.is_admin,
                    permissoes: permissoes
                }
            });
        } catch (error) {
            console.error('[API/VENDAS/ME] Erro ao buscar usuário:', error);
            res.status(500).json({ message: 'Erro ao buscar dados do usuário' });
        }
    });
    
    // PEDIDOS
    router.get('/pedidos', async (req, res, next) => {
        try {
            const { period, page = 1, limit = 1000 } = req.query;
            const offset = (parseInt(page) - 1) * parseInt(limit);
            let whereClause = '';
            let params = [];
    
            if (period && period !== 'all') {
                whereClause = `WHERE p.created_at >= CURDATE() - INTERVAL ? DAY`;
                params.push(parseInt(period));
            }
            params.push(parseInt(limit), offset);
    
            const [rows] = await pool.query(`
                SELECT p.id, p.valor, p.valor as valor_total, p.status, p.created_at, p.created_at as data_pedido,
                       p.vendedor_id, p.cliente_id, p.observacao,
                       p.nf, p.numero_nf, p.nfe_chave,
                       COALESCE(c.nome_fantasia, c.razao_social, c.nome, 'Cliente não informado') AS cliente_nome,
                       c.email AS cliente_email, c.telefone AS cliente_telefone,
                       e.nome_fantasia AS empresa_nome,
                       u.nome AS vendedor_nome
                FROM pedidos p
                LEFT JOIN clientes c ON p.cliente_id = c.id
                LEFT JOIN empresas e ON p.empresa_id = e.id
                LEFT JOIN usuarios u ON p.vendedor_id = u.id
                ${whereClause}
                ORDER BY p.id DESC
                LIMIT ? OFFSET ?
            `, params);
            res.json(rows);
        } catch (error) { next(error); }
    });
    router.get('/pedidos/search', async (req, res, next) => {
        try {
            const q = req.query.q || '';
            const query = `%${q}%`;
            const [rows] = await pool.query(`
                SELECT p.id, p.valor, p.valor as valor_total, p.status, p.created_at, p.created_at as data_pedido,
                       p.vendedor_id, p.cliente_id, p.observacao,
                       COALESCE(c.nome_fantasia, c.razao_social, c.nome, 'Cliente não informado') AS cliente_nome,
                       c.email AS cliente_email, c.telefone AS cliente_telefone,
                       e.nome_fantasia AS empresa_nome,
                       u.nome AS vendedor_nome
                FROM pedidos p
                LEFT JOIN clientes c ON p.cliente_id = c.id
                LEFT JOIN empresas e ON p.empresa_id = e.id
                LEFT JOIN usuarios u ON p.vendedor_id = u.id
                WHERE c.nome_fantasia LIKE ? OR c.razao_social LIKE ? OR c.nome LIKE ?
                   OR e.nome_fantasia LIKE ? OR p.id LIKE ? OR u.nome LIKE ?
                ORDER BY p.id DESC
            `, [query, query, query, query, query, query]);
            res.json(rows);
        } catch (error) { next(error); }
    });
    router.get('/pedidos/:id', async (req, res, next) => {
        try {
            const { id } = req.params;
            const [[pedido]] = await pool.query(`
                SELECT p.*, p.valor as valor_total, p.created_at as data_pedido,
                       p.transportadora_id, p.transportadora_nome,
                       COALESCE(c.nome_fantasia, c.razao_social, c.nome, 'Cliente não informado') AS cliente_nome,
                       c.email AS cliente_email, c.telefone AS cliente_telefone,
                       e.nome_fantasia AS empresa_nome, e.razao_social AS empresa_razao_social,
                       u.nome AS vendedor_nome,
                       t.razao_social AS transp_razao_social,
                       t.cnpj_cpf AS transp_cnpj,
                       t.telefone AS transp_telefone,
                       t.email AS transp_email,
                       t.cidade AS transp_cidade,
                       t.estado AS transp_estado,
                       t.bairro AS transp_bairro,
                       t.cep AS transp_cep,
                       t.endereco AS transp_endereco
                FROM pedidos p
                LEFT JOIN clientes c ON p.cliente_id = c.id
                LEFT JOIN empresas e ON p.empresa_id = e.id
                LEFT JOIN usuarios u ON p.vendedor_id = u.id
                LEFT JOIN transportadoras t ON p.transportadora_id = t.id
                WHERE p.id = ?
            `, [id]);
            if (!pedido) return res.status(404).json({ message: "Pedido não encontrado." });
    
            // Buscar itens do pedido
            let itensDB = [];
            try {
                const [rows] = await pool.query('SELECT id, pedido_id, codigo, descricao, quantidade, quantidade_parcial, unidade, local_estoque, preco_unitario, desconto, subtotal FROM pedido_itens WHERE pedido_id = ? ORDER BY id ASC', [id]);
                itensDB = rows;
            } catch (e) { /* tabela pode não existir */ }
    
            // Auto-repair: se pedido_itens vazio mas produtos_preview tem dados
            // AUDIT-FIX HIGH-007: Wrapped auto-repair in transaction to prevent partial inserts
            let previewItens = [];
            try { previewItens = JSON.parse(pedido.produtos_preview || '[]'); } catch(e) { previewItens = []; }
            if (itensDB.length === 0 && previewItens.length > 0) {
                console.log(`[VENDAS] Auto-repair (router): inserindo ${previewItens.length} itens do preview para pedido #${id}`);
                const repairConn = await pool.getConnection();
                try {
                    await repairConn.beginTransaction();
                    for (const item of previewItens) {
                        const qty = parseFloat(item.quantidade) || 1;
                        const preco = parseFloat(item.preco_unitario || item.valor_unitario || item.preco) || 0;
                        const desc = parseFloat(item.desconto) || 0;
                        const subtotal = (qty * preco) - desc;
                        await repairConn.query(
                            `INSERT INTO pedido_itens (pedido_id, codigo, descricao, quantidade, quantidade_parcial, unidade, local_estoque, preco_unitario, desconto, subtotal)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                            [id, item.codigo || '', item.descricao || item.nome || '', qty, parseFloat(item.quantidade_parcial) || 0,
                             item.unidade || 'UN', item.local_estoque || 'PADRAO - Local de Estoque Padrão', preco, desc, subtotal]
                        );
                    }
                    await repairConn.commit();
                    const [rows2] = await pool.query('SELECT id, pedido_id, codigo, descricao, quantidade, quantidade_parcial, unidade, local_estoque, preco_unitario, desconto, subtotal FROM pedido_itens WHERE pedido_id = ? ORDER BY id ASC', [id]);
                    itensDB = rows2;
                } catch (e) {
                    await repairConn.rollback();
                    console.log('[VENDAS] Erro no auto-repair router (rollback):', e.message);
                } finally {
                    repairConn.release();
                }
            }
    
            pedido.itens = itensDB;
            res.json(pedido);
        } catch (error) { next(error); }
    });
    router.post('/pedidos', [
        body('empresa_id').isInt({ min: 1 }).withMessage('ID da empresa deve ser um número inteiro positivo'),
        body('valor').isFloat({ min: 0.01 }).withMessage('Valor deve ser um número positivo'),
        body('descricao').optional().trim().isLength({ max: 1000 }).withMessage('Descrição muito longa (máx 1000 caracteres)'),
        validate
    ], async (req, res, next) => {
        try {
            const { empresa_id, valor, descricao } = req.body;
            const vendedor_id = req.user.id;
    
            const [result] = await pool.query(
                'INSERT INTO pedidos (empresa_id, vendedor_id, valor, descricao, status) VALUES (?, ?, ?, ?, ?)',
                [empresa_id, vendedor_id, valor, descricao || null, 'orcamento']
            );

            const pedidoId = result.insertId;

            // ========================================
            // CRIAR NOTIFICAÇÃO DO NOVO PEDIDO
            // ========================================
            try {
                // Buscar nome da empresa
                const [empresa] = await pool.query('SELECT razao_social, nome_fantasia FROM empresas WHERE id = ?', [empresa_id]);
                const nomeEmpresa = empresa[0]?.nome_fantasia || empresa[0]?.razao_social || 'Cliente';
                const nomeVendedor = req.user.nome || req.user.apelido || 'Vendedor';
                const valorFormatado = parseFloat(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

                // Garantir que tabela notificacoes existe
                await pool.query(`
                    CREATE TABLE IF NOT EXISTS notificacoes (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        usuario_id INT,
                        titulo VARCHAR(255),
                        mensagem TEXT,
                        tipo VARCHAR(50) DEFAULT 'info',
                        link VARCHAR(500),
                        dados_extras JSON,
                        lida TINYINT(1) DEFAULT 0,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `);

                // Notificar todos os admins e supervisores sobre novo pedido
                const [admins] = await pool.query(`
                    SELECT id FROM usuarios WHERE 
                        (role = 'admin' OR is_admin = 1 OR 
                         departamento IN ('diretoria', 'gerencia', 'supervisao', 'coordenacao', 'ti'))
                        AND id != ?
                `, [vendedor_id]);

                const notificacoes = admins.map(admin => [
                    admin.id,
                    `📋 Novo Pedido #${pedidoId}`,
                    `${nomeVendedor} criou um novo pedido para ${nomeEmpresa} no valor de ${valorFormatado}`,
                    'pedido',
                    `/modules/Vendas/public/index.html`,
                    JSON.stringify({ pedido_id: pedidoId, empresa: nomeEmpresa, vendedor: nomeVendedor, valor })
                ]);

                // Também notificar o próprio vendedor (confirmação)
                notificacoes.push([
                    vendedor_id,
                    `✅ Pedido #${pedidoId} criado`,
                    `Seu pedido para ${nomeEmpresa} (${valorFormatado}) foi criado e está em Orçamento`,
                    'pedido',
                    `/modules/Vendas/public/index.html`,
                    JSON.stringify({ pedido_id: pedidoId, empresa: nomeEmpresa, valor })
                ]);

                if (notificacoes.length > 0) {
                    await pool.query(
                        'INSERT INTO notificacoes (usuario_id, titulo, mensagem, tipo, link, dados_extras) VALUES ?',
                        [notificacoes]
                    );
                    console.log(`[Vendas] 🔔 ${notificacoes.length} notificações criadas para pedido #${pedidoId}`);
                }
            } catch (notifErr) {
                console.error('[Vendas] Erro ao criar notificações (não-bloqueante):', notifErr.message);
            }

            res.status(201).json({ message: 'Pedido criado com sucesso!', id: pedidoId });
        } catch (error) { next(error); }
    });
    router.put('/pedidos/:id', [
        param('id').isInt({ min: 1 }).withMessage('ID do pedido inválido'),
        body('empresa_id').isInt({ min: 1 }).withMessage('ID da empresa deve ser um número inteiro positivo'),
        body('valor').isFloat({ min: 0.01 }).withMessage('Valor deve ser um número positivo'),
        body('descricao').optional().trim().isLength({ max: 1000 }).withMessage('Descrição muito longa (máx 1000 caracteres)'),
        validate
    ], async (req, res, next) => {
        try {
            const { id } = req.params;
            const { empresa_id, valor, descricao } = req.body;
    
            const [result] = await pool.query(
                `UPDATE pedidos SET empresa_id = ?, valor = ?, descricao = ? WHERE id = ?`,
                [empresa_id, valor, descricao || null, id]
            );
            if (result.affectedRows === 0) return res.status(404).json({ message: 'Pedido não encontrado.' });
            res.json({ message: 'Pedido atualizado com sucesso.' });
        } catch (error) { next(error); }
    });
    router.delete('/pedidos/:id', authenticateToken, authorizeAdmin, async (req, res, next) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
    
            const { id } = req.params;
    
            // Verificar se pedido existe
            const [pedido] = await connection.query('SELECT id, status, nfe_chave FROM pedidos WHERE id = ?', [id]);
            if (pedido.length === 0) {
                await connection.rollback();
                return res.status(404).json({ message: "Pedido não encontrado." });
            }
    
            // Não permitir exclusão de pedidos faturados ou com NF-e
            if (pedido[0].status === 'faturado' || pedido[0].nfe_chave) {
                await connection.rollback();
                return res.status(400).json({
                    message: 'Pedido faturado ou com NF-e emitida não pode ser excluído.'
                });
            }
    
            // Verificar contas a receber vinculadas (se a tabela existir)
            try {
                const [contas] = await connection.query('SELECT COUNT(*) as count FROM contas_receber WHERE pedido_id = ?', [id]);
                if (contas[0].count > 0) {
                    await connection.rollback();
                    return res.status(400).json({
                        message: `Pedido possui ${contas[0].count} conta(s) a receber vinculada(s).`
                    });
                }
            } catch (e) {
                // Tabela não existe ou não tem coluna pedido_id - ignorar verificação
                console.log('⚠️ Verificação contas_receber ignorada:', e.message);
            }
    
            // Verificar ordens de produção vinculadas (se a coluna pedido_id existir)
            try {
                const [ops] = await connection.query('SELECT COUNT(*) as count FROM ordens_producao WHERE pedido_id = ?', [id]);
                if (ops[0].count > 0) {
                    await connection.rollback();
                    return res.status(400).json({
                        message: `Pedido possui ${ops[0].count} ordem(ns) de produção vinculada(s).`
                    });
                }
            } catch (e) {
                // Tabela não existe ou não tem coluna pedido_id - ignorar verificação
                console.log('⚠️ Verificação ordens_producao ignorada:', e.message);
            }
    
            // Excluir itens do pedido primeiro
            await connection.query('DELETE FROM pedido_itens WHERE pedido_id = ?', [id]);
    
            // Excluir anexos do pedido
            await connection.query('DELETE FROM pedido_anexos WHERE pedido_id = ?', [id]);
    
            // Excluir histórico do pedido
            await connection.query('DELETE FROM pedido_historico WHERE pedido_id = ?', [id]);
    
            // Excluir pedido
            const [result] = await connection.query('DELETE FROM pedidos WHERE id = ?', [id]);
    
            await connection.commit();
    
            console.log(`🗑️ Pedido #${id} excluído com sucesso por usuário ${req.user?.id}`);
            res.status(204).send();
        } catch (error) {
            await connection.rollback();
            next(error);
        } finally {
            connection.release();
        }
    });
    
    // POST /pedidos/:id/duplicar - Duplicar pedido existente
    router.post('/pedidos/:id/duplicar', async (req, res, next) => {
        const connection = await pool.getConnection();
        try {
            const { id } = req.params;
            await connection.beginTransaction();
    
            // Buscar pedido original
            const [[pedidoOriginal]] = await connection.query('SELECT * FROM pedidos WHERE id = ?', [id]);
            if (!pedidoOriginal) {
                await connection.rollback();
                return res.status(404).json({ message: 'Pedido não encontrado' });
            }
    
            // Criar novo pedido (cópia) - usando nomes corretos das colunas
            const [result] = await connection.query(`
                INSERT INTO pedidos (
                    cliente_id, cliente, valor, status, vendedor_id, vendedor,
                    observacoes, data_prevista, empresa_id, frete, desconto, cenario_fiscal,
                    condicao_pagamento, parcelas, created_at
                ) VALUES (?, ?, ?, 'orcamento', ?, ?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY), ?, ?, ?, ?, ?, ?, NOW())
            `, [
                pedidoOriginal.cliente_id,
                pedidoOriginal.cliente,
                pedidoOriginal.valor,
                pedidoOriginal.vendedor_id,
                pedidoOriginal.vendedor,
                `[CÓPIA DO PEDIDO #${id}] ${pedidoOriginal.observacoes || ''}`,
                pedidoOriginal.empresa_id || 1,
                pedidoOriginal.frete || 0,
                pedidoOriginal.desconto || 0,
                pedidoOriginal.cenario_fiscal || 'Venda Normal',
                pedidoOriginal.condicao_pagamento || 'A Vista',
                pedidoOriginal.parcelas || 1
            ]);
    
            const novoPedidoId = result.insertId;
    
            // Copiar itens do pedido usando colunas corretas (batch INSERT)
            const [itens] = await connection.query('SELECT id, pedido_id, codigo, descricao, quantidade, quantidade_parcial, unidade, local_estoque, preco_unitario, desconto, subtotal FROM pedido_itens WHERE pedido_id = ?', [id]);
            if (itens.length > 0) {
                const values = itens.map(item => [
                    novoPedidoId,
                    item.codigo || item.produto_codigo || '',
                    item.descricao || item.produto_nome || '',
                    item.quantidade || 1,
                    item.unidade || 'UN',
                    item.preco_unitario || item.valor_unitario || 0,
                    item.subtotal || item.valor_total || 0,
                    item.desconto || 0
                ]);
                const placeholders = values.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
                await connection.query(`
                    INSERT INTO pedido_itens (
                        pedido_id, codigo, descricao, quantidade, unidade,
                        preco_unitario, subtotal, desconto
                    ) VALUES ${placeholders}
                `, values.flat());
            }
    
            await connection.commit();
    
            console.log(`📋 Pedido #${id} duplicado como #${novoPedidoId} por usuário ${req.user?.id}`);
            res.status(201).json({
                success: true,
                message: 'Pedido duplicado com sucesso',
                id: novoPedidoId,
                original_id: id
            });
        } catch (error) {
            await connection.rollback();
            console.error('Erro ao duplicar pedido:', error);
            next(error);
        } finally {
            connection.release();
        }
    });
    
    // PATCH /pedidos/:id - Atualização parcial do pedido (para o Kanban)
    router.patch('/pedidos/:id', async (req, res, next) => {
        try {
            const { id } = req.params;
            let updates = req.body;
    
            // Sanitizar valores: converter 'null' string para null real e tratar números inválidos
            const sanitizeValue = (val) => {
                if (val === 'null' || val === 'undefined' || val === '') return null;
                return val;
            };
    
            const sanitizeNumber = (val) => {
                if (val === 'null' || val === 'undefined' || val === '' || val === null) return null;
                const num = parseFloat(val);
                return isNaN(num) ? null : num;
            };
    
            // Aplicar sanitização em todos os campos
            Object.keys(updates).forEach(key => {
                updates[key] = sanitizeValue(updates[key]);
            });
    
            console.log(`📝 PATCH /pedidos/${id} - Dados recebidos:`, updates);
    
            // Verificar se pedido existe
            const [existingRows] = await pool.query('SELECT * FROM pedidos WHERE id = ?', [id]);
            if (existingRows.length === 0) {
                return res.status(404).json({ message: 'Pedido não encontrado.' });
            }
    
            const existing = existingRows[0];
            const user = req.user || {};
            const isAdmin = user.is_admin === true || user.is_admin === 1 || (user.role && user.role.toString().toLowerCase() === 'admin');
    
            // Verificar permissão
            if (!isAdmin && existing.vendedor_id && Number(existing.vendedor_id) !== Number(user.id)) {
                return res.status(403).json({ message: 'Acesso negado: somente o vendedor responsável ou admin podem editar este pedido.' });
            }
    
            // AUDIT-FIX: Block financial field changes on faturado/finalizado pedidos
            const statusAtual = (existing.status || '').toLowerCase().trim();
            const isFaturado = ['faturado', 'finalizado', 'entregue', 'recibo'].includes(statusAtual);
            const financialFields = ['valor', 'frete', 'desconto', 'valor_seguro', 'outras_despesas', 'parcelas', 'condicao_pagamento'];
    
            if (isFaturado && !isAdmin) {
                const blockedFields = financialFields.filter(f => updates[f] !== undefined);
                if (blockedFields.length > 0) {
                    console.log(`🚫 PATCH bloqueado: pedido #${id} status=${statusAtual}, campos financeiros: ${blockedFields.join(', ')}`);
                    return res.status(403).json({
                        message: `Pedido com status "${statusAtual}" não permite alteração de campos financeiros (${blockedFields.join(', ')}). Contate um administrador.`
                    });
                }
            }
    
            // Construir query de atualização dinâmica
            const fieldsToUpdate = [];
            const values = [];
    
            // Atualizar vendedor_id se vendedor_nome foi fornecido
            if (updates.vendedor_nome !== undefined && updates.vendedor_nome !== '') {
                const [vendedorRows] = await pool.query(
                    'SELECT id, nome FROM usuarios WHERE nome LIKE ? OR apelido LIKE ? LIMIT 1',
                    [`%${updates.vendedor_nome}%`, `%${updates.vendedor_nome}%`]
                );
                if (vendedorRows.length > 0) {
                    fieldsToUpdate.push('vendedor_id = ?');
                    values.push(vendedorRows[0].id);
                    console.log(`✅ Vendedor encontrado: "${updates.vendedor_nome}" -> ID ${vendedorRows[0].id}`);
                }
                // Também salvar o nome do vendedor
                fieldsToUpdate.push('vendedor_nome = ?');
                values.push(updates.vendedor_nome);
            }
    
            // Observação existe na tabela
            if (updates.observacao !== undefined) {
                fieldsToUpdate.push('observacao = ?');
                values.push(updates.observacao);
            }
    
            // Status existe na tabela
            if (updates.status !== undefined) {
                fieldsToUpdate.push('status = ?');
                values.push(updates.status);
            }
    
            // Valor existe na tabela (campo numérico)
            if (updates.valor !== undefined) {
                fieldsToUpdate.push('valor = ?');
                values.push(sanitizeNumber(updates.valor));
            }
    
            // Frete existe na tabela (campo numérico)
            if (updates.frete !== undefined) {
                fieldsToUpdate.push('frete = ?');
                values.push(sanitizeNumber(updates.frete));
            }
    
            // Descrição existe na tabela
            if (updates.descricao !== undefined) {
                fieldsToUpdate.push('descricao = ?');
                values.push(updates.descricao);
            }
    
            // Prioridade existe na tabela
            if (updates.prioridade !== undefined) {
                fieldsToUpdate.push('prioridade = ?');
                values.push(updates.prioridade);
            }
    
            // Cliente_id existe na tabela (campo numérico) - só atualiza se valor válido
            if (updates.cliente_id !== undefined && updates.cliente_id !== null && updates.cliente_id !== '') {
                fieldsToUpdate.push('cliente_id = ?');
                values.push(sanitizeNumber(updates.cliente_id));
            }
    
            // Empresa_id existe na tabela (campo numérico) - só atualiza se valor válido
            if (updates.empresa_id !== undefined && updates.empresa_id !== null && updates.empresa_id !== '') {
                fieldsToUpdate.push('empresa_id = ?');
                values.push(sanitizeNumber(updates.empresa_id));
            }
    
            // Cliente nome
            if (updates.cliente !== undefined) {
                fieldsToUpdate.push('cliente_nome = ?');
                values.push(updates.cliente);
            }
    
            // Transportadora - salvar em ambos os campos
            if (updates.transportadora !== undefined || updates.transportadora_nome !== undefined) {
                const transportadoraValor = updates.transportadora || updates.transportadora_nome;
                fieldsToUpdate.push('transportadora_nome = ?');
                values.push(transportadoraValor);
                fieldsToUpdate.push('transportadora = ?');
                values.push(transportadoraValor);
            }
    
            // Transportadora ID
            if (updates.transportadora_id !== undefined && updates.transportadora_id !== null) {
                fieldsToUpdate.push('transportadora_id = ?');
                values.push(sanitizeNumber(updates.transportadora_id));
            }
    
            // NF - salvar em nf
            if (updates.nf !== undefined) {
                fieldsToUpdate.push('nf = ?');
                values.push(updates.nf);
            }
    
            // Parcelas/Condição de Pagamento - salvar em múltiplos campos
            if (updates.parcelas !== undefined || updates.condicao_pagamento !== undefined) {
                const condicaoValor = updates.condicao_pagamento || updates.parcelas;
                fieldsToUpdate.push('condicao_pagamento = ?');
                values.push(condicaoValor);
                fieldsToUpdate.push('condicoes_pagamento = ?');
                values.push(condicaoValor);
                fieldsToUpdate.push('parcelas = ?');
                values.push(condicaoValor);
            }
    
            // ========== CAMPOS DE TRANSPORTE ==========
            if (updates.tipo_frete !== undefined) {
                fieldsToUpdate.push('tipo_frete = ?');
                values.push(updates.tipo_frete);
            }
            if (updates.metodo_envio !== undefined) {
                fieldsToUpdate.push('metodo_envio = ?');
                values.push(updates.metodo_envio);
            }
            if (updates.redespacho !== undefined) {
                fieldsToUpdate.push('redespacho = ?');
                values.push(updates.redespacho === '1' || updates.redespacho === true || updates.redespacho === 'true' ? 1 : 0);
            }
            if (updates.placa_veiculo !== undefined) {
                fieldsToUpdate.push('placa_veiculo = ?');
                values.push(updates.placa_veiculo);
            }
            if (updates.veiculo_uf !== undefined) {
                fieldsToUpdate.push('veiculo_uf = ?');
                values.push(updates.veiculo_uf);
            }
            if (updates.rntrc !== undefined) {
                fieldsToUpdate.push('rntrc = ?');
                values.push(updates.rntrc);
            }
            if (updates.veiculo_proprio !== undefined) {
                fieldsToUpdate.push('veiculo_proprio = ?');
                values.push(updates.veiculo_proprio === '1' || updates.veiculo_proprio === true || updates.veiculo_proprio === 'true' ? 1 : 0);
            }
    
            // ========== CAMPOS DE VOLUMES/PESO ==========
            if (updates.qtd_volumes !== undefined) {
                fieldsToUpdate.push('qtd_volumes = ?');
                values.push(sanitizeNumber(updates.qtd_volumes));
            }
            if (updates.especie_volumes !== undefined) {
                fieldsToUpdate.push('especie_volumes = ?');
                values.push(updates.especie_volumes);
            }
            if (updates.marca_volumes !== undefined) {
                fieldsToUpdate.push('marca_volumes = ?');
                values.push(updates.marca_volumes);
            }
            if (updates.numeracao_volumes !== undefined) {
                fieldsToUpdate.push('numeracao_volumes = ?');
                values.push(updates.numeracao_volumes);
            }
            if (updates.peso_liquido !== undefined) {
                fieldsToUpdate.push('peso_liquido = ?');
                values.push(sanitizeNumber(updates.peso_liquido));
            }
            if (updates.peso_bruto !== undefined) {
                fieldsToUpdate.push('peso_bruto = ?');
                values.push(sanitizeNumber(updates.peso_bruto));
            }
    
            // ========== CAMPOS DE VALORES ADICIONAIS ==========
            if (updates.valor_seguro !== undefined) {
                fieldsToUpdate.push('valor_seguro = ?');
                values.push(sanitizeNumber(updates.valor_seguro));
            }
            if (updates.outras_despesas !== undefined) {
                fieldsToUpdate.push('outras_despesas = ?');
                values.push(sanitizeNumber(updates.outras_despesas));
            }
            if (updates.desconto !== undefined) {
                fieldsToUpdate.push('desconto = ?');
                values.push(sanitizeNumber(updates.desconto));
            }
            if (updates.desconto_pct !== undefined) {
                fieldsToUpdate.push('desconto_pct = ?');
                values.push(sanitizeNumber(updates.desconto_pct));
            }
            if (updates.numero_lacre !== undefined) {
                fieldsToUpdate.push('numero_lacre = ?');
                values.push(updates.numero_lacre);
            }
            if (updates.codigo_rastreio !== undefined) {
                fieldsToUpdate.push('codigo_rastreio = ?');
                values.push(updates.codigo_rastreio);
            }
    
            // ========== CAMPOS DE ENTREGA ==========
            if (updates.endereco_entrega !== undefined) {
                fieldsToUpdate.push('endereco_entrega = ?');
                values.push(updates.endereco_entrega);
            }
            if (updates.municipio_entrega !== undefined) {
                fieldsToUpdate.push('municipio_entrega = ?');
                values.push(updates.municipio_entrega);
            }
            // prazo_entrega é INT (número de dias), só salvar se for número
            if (updates.prazo_entrega !== undefined && !isNaN(parseInt(updates.prazo_entrega))) {
                fieldsToUpdate.push('prazo_entrega = ?');
                values.push(parseInt(updates.prazo_entrega));
            }
            if (updates.tipo_entrega !== undefined) {
                fieldsToUpdate.push('tipo_entrega = ?');
                values.push(updates.tipo_entrega);
            }
            // data_previsao aceita datas
            if (updates.data_previsao !== undefined || updates.previsao_faturamento !== undefined || updates.data_previsao_entrega !== undefined) {
                fieldsToUpdate.push('data_previsao = ?');
                values.push(updates.data_previsao_entrega || updates.data_previsao || updates.previsao_faturamento || null);
            }
    
            // ========== CAMPOS DE OBSERVAÇÕES E INFORMAÇÕES ==========
            if (updates.observacao_cliente !== undefined) {
                fieldsToUpdate.push('observacao_cliente = ?');
                values.push(updates.observacao_cliente);
            }
            if (updates.info_complementar !== undefined) {
                fieldsToUpdate.push('info_complementar = ?');
                values.push(updates.info_complementar);
            }
            if (updates.campos_obs_nfe !== undefined) {
                fieldsToUpdate.push('campos_obs_nfe = ?');
                values.push(updates.campos_obs_nfe);
            }
            if (updates.dados_adicionais_nf !== undefined) {
                fieldsToUpdate.push('dados_adicionais_nf = ?');
                values.push(updates.dados_adicionais_nf);
            }
    
            // ========== CAMPOS DE ORIGEM E EMAIL ==========
            if (updates.origem !== undefined) {
                fieldsToUpdate.push('origem = ?');
                values.push(updates.origem);
            }
            if (updates.email_cliente !== undefined) {
                fieldsToUpdate.push('email_cliente = ?');
                values.push(updates.email_cliente);
            }
            if (updates.email_assunto !== undefined) {
                fieldsToUpdate.push('email_assunto = ?');
                values.push(updates.email_assunto);
            }
            if (updates.email_mensagem !== undefined) {
                fieldsToUpdate.push('email_mensagem = ?');
                values.push(updates.email_mensagem);
            }
    
            // ========== CAMPOS ADICIONAIS ==========
            if (updates.projeto !== undefined) {
                fieldsToUpdate.push('projeto = ?');
                values.push(updates.projeto);
            }
            if (updates.contato !== undefined) {
                fieldsToUpdate.push('contato = ?');
                values.push(updates.contato);
            }
            if (updates.categoria !== undefined) {
                fieldsToUpdate.push('categoria = ?');
                values.push(updates.categoria);
            }
            if (updates.conta_corrente !== undefined) {
                fieldsToUpdate.push('conta_corrente = ?');
                values.push(updates.conta_corrente);
            }
            if (updates.pedido_cliente !== undefined) {
                fieldsToUpdate.push('pedido_cliente = ?');
                values.push(updates.pedido_cliente);
            }
            if (updates.contrato_venda !== undefined) {
                fieldsToUpdate.push('contrato_venda = ?');
                values.push(updates.contrato_venda);
            }
            if (updates.cenario_fiscal !== undefined) {
                fieldsToUpdate.push('cenario_fiscal = ?');
                values.push(updates.cenario_fiscal);
            }
            if (updates.departamento !== undefined) {
                fieldsToUpdate.push('departamento = ?');
                values.push(updates.departamento);
            }
    
            // Se não há campos para atualizar
            if (fieldsToUpdate.length === 0) {
                console.log(`⚠️ Nenhum campo válido para atualizar`);
                return res.status(400).json({ message: 'Nenhum campo válido para atualizar.' });
            }
    
            values.push(id);
    
            const query = `UPDATE pedidos SET ${fieldsToUpdate.join(', ')} WHERE id = ?`;
            console.log(`📝 Query: ${query}`);
            console.log(`📝 Values:`, values);
    
            const [result] = await pool.query(query, values);
    
            if (result.affectedRows === 0) {
                return res.status(404).json({ message: 'Pedido não encontrado.' });
            }
    
            console.log(`✅ Pedido ${id} atualizado com sucesso! (${result.affectedRows} linha(s) afetada(s))`);
    
            // ========================================
            // ESTORNO DE ESTOQUE AO CANCELAR (PATCH/Kanban)
            // ========================================
            let estornoEstoque = [];
            if (updates.status === 'cancelado' && ['analise-credito', 'pedido-aprovado', 'aprovado', 'faturar'].includes(statusAtual)) {
                try {
                    console.log(`[ESTORNO_ESTOQUE] PATCH - Cancelamento do pedido #${id} a partir de "${statusAtual}"`);
                    
                    const [movimentacoes] = await pool.query(`
                        SELECT id, codigo_material, quantidade, quantidade_anterior, quantidade_atual
                        FROM estoque_movimentacoes
                        WHERE documento_tipo = 'pedido' AND documento_id = ? AND tipo_movimento = 'saida'
                        ORDER BY id ASC
                    `, [id]);
                    
                    if (movimentacoes.length > 0) {
                        for (const mov of movimentacoes) {
                            const [produtos] = await pool.query(
                                'SELECT id, codigo, descricao, estoque_atual, estoque_cancelado FROM produtos WHERE codigo = ? LIMIT 1',
                                [mov.codigo_material]
                            );
                            if (produtos.length > 0) {
                                const produto = produtos[0];
                                const canceladoAnterior = parseFloat(produto.estoque_cancelado || 0);
                                const novoCancelado = canceladoAnterior + parseFloat(mov.quantidade);
                                await pool.query('UPDATE produtos SET estoque_cancelado = ? WHERE id = ?', [novoCancelado, produto.id]);
                                await pool.query(`
                                    INSERT INTO estoque_movimentacoes
                                    (codigo_material, tipo_movimento, origem, quantidade, quantidade_anterior, quantidade_atual,
                                     documento_tipo, documento_id, usuario_id, observacao, data_movimento)
                                    VALUES (?, 'entrada', 'ajuste', ?, ?, ?, 'pedido_cancelado', ?, ?, ?, NOW())
                                `, [mov.codigo_material, mov.quantidade, canceladoAnterior, novoCancelado, id, user.id || null,
                                    `Estorno PATCH - Cancelamento Pedido #${id} (estoque cancelado)`]);
                                estornoEstoque.push({ produto: produto.codigo, quantidade_devolvida: parseFloat(mov.quantidade), tipo: 'cancelado' });
                                console.log(`[ESTORNO_ESTOQUE] ${produto.codigo} - ${mov.quantidade} movido para estoque_cancelado`);
                            }
                        }
                    } else {
                        const [itensEstorno] = await pool.query('SELECT codigo, descricao, quantidade, unidade FROM pedido_itens WHERE pedido_id = ?', [id]);
                        for (const item of itensEstorno) {
                            if (!item.codigo) continue;
                            const [produtos] = await pool.query('SELECT id, codigo, descricao, estoque_atual, estoque_cancelado FROM produtos WHERE codigo = ? OR sku = ? LIMIT 1', [item.codigo, item.codigo]);
                            if (produtos.length > 0) {
                                const produto = produtos[0];
                                const qtd = parseFloat(item.quantidade || 0);
                                if (qtd <= 0) continue;
                                const canceladoAnt = parseFloat(produto.estoque_cancelado || 0);
                                const novoCancelado = canceladoAnt + qtd;
                                await pool.query('UPDATE produtos SET estoque_cancelado = ? WHERE id = ?', [novoCancelado, produto.id]);
                                await pool.query(`
                                    INSERT INTO estoque_movimentacoes
                                    (codigo_material, tipo_movimento, origem, quantidade, quantidade_anterior, quantidade_atual,
                                     documento_tipo, documento_id, usuario_id, observacao, data_movimento)
                                    VALUES (?, 'entrada', 'ajuste', ?, ?, ?, 'pedido_cancelado', ?, ?, ?, NOW())
                                `, [produto.codigo, qtd, canceladoAnt, novoCancelado, id, user.id || null,
                                    `Estorno PATCH - Cancelamento Pedido #${id} - ${qtd}${item.unidade || 'UN'} (estoque cancelado)`]);
                                estornoEstoque.push({ produto: produto.codigo, quantidade_devolvida: qtd, tipo: 'cancelado' });
                            }
                        }
                    }
                    if (estornoEstoque.length > 0) console.log(`[ESTORNO_ESTOQUE] PATCH: ${estornoEstoque.length} produto(s) estornados`);
                } catch (estornoErr) {
                    console.error(`[ESTORNO_ESTOQUE] Erro PATCH pedido #${id}:`, estornoErr.message);
                }
            }

            // Buscar pedido atualizado para retornar
            const [updatedRows] = await pool.query(`
                SELECT p.*,
                       c.nome as cliente_nome,
                       u.nome as vendedor_nome
                FROM pedidos p
                LEFT JOIN clientes c ON p.cliente_id = c.id
                LEFT JOIN usuarios u ON p.vendedor_id = u.id
                WHERE p.id = ?
            `, [id]);
    
            res.json({
                message: 'Pedido atualizado com sucesso.',
                pedido: updatedRows[0] || null,
                estoque_estornado: estornoEstoque.length > 0,
                estorno_estoque: estornoEstoque
            });
        } catch (error) {
            console.error('❌ Erro ao atualizar pedido (PATCH):', error);
            next(error);
        }
    });
    
    // ========================================
    // FUNÇÃO: BAIXA AUTOMÁTICA DE ESTOQUE
    // Copiada de pcp-routes.js para uso local em vendas-routes.js
    // ========================================
    async function baixarEstoqueAutomatico(connection, pedidoId, itens, usuarioId = null) {
        console.log(`[ESTOQUE_AUTO] Iniciando baixa automática para pedido ${pedidoId}`);
        const movimentacoes = [];

        for (const item of itens) {
            const codigoMaterial = item.codigo || item.codigo_material || item.sku;
            const quantidade = parseFloat(item.quantidade || 0);
            const unidade = item.unidade || 'm';

            if (!codigoMaterial || quantidade <= 0) continue;

            try {
                // Buscar produto no estoque
                const [produtos] = await connection.query(`
                    SELECT id, codigo, descricao, estoque_atual, unidade_medida
                    FROM produtos
                    WHERE codigo = ? OR sku = ? OR LOWER(descricao) LIKE LOWER(?)
                    LIMIT 1
                `, [codigoMaterial, codigoMaterial, `%${codigoMaterial}%`]);

                if (produtos.length === 0) {
                    console.log(`[ESTOQUE_AUTO] Produto não encontrado: ${codigoMaterial}`);
                    continue;
                }

                const produto = produtos[0];
                const estoqueAnterior = parseFloat(produto.estoque_atual || 0);
                const novoEstoque = Math.max(0, estoqueAnterior - quantidade);

                // Atualizar estoque do produto
                await connection.query(`
                    UPDATE produtos
                    SET estoque_atual = ?
                    WHERE id = ?
                `, [novoEstoque, produto.id]);

                // Registrar movimentação
                await connection.query(`
                    INSERT INTO estoque_movimentacoes
                    (codigo_material, tipo_movimento, origem, quantidade, quantidade_anterior, quantidade_atual,
                     documento_tipo, documento_id, usuario_id, observacao, data_movimento)
                    VALUES (?, 'saida', 'venda', ?, ?, ?, 'pedido', ?, ?, ?, NOW())
                `, [
                    produto.codigo,
                    quantidade,
                    estoqueAnterior,
                    novoEstoque,
                    pedidoId,
                    usuarioId,
                    `Baixa automática - Pedido #${pedidoId} - ${quantidade}${unidade}`
                ]);

                movimentacoes.push({
                    produto: produto.codigo,
                    descricao: produto.descricao,
                    quantidade_baixada: quantidade,
                    estoque_anterior: estoqueAnterior,
                    estoque_atual: novoEstoque,
                    unidade: unidade
                });

                console.log(`[ESTOQUE_AUTO] Baixa realizada: ${produto.codigo} - ${quantidade}${unidade} (${estoqueAnterior} -> ${novoEstoque})`);

            } catch (err) {
                console.error(`[ESTOQUE_AUTO] Erro ao baixar ${codigoMaterial}:`, err.message);
            }
        }

        return movimentacoes;
    }

    // ============================================================
    // SISTEMA DE PERMISSÕES DE STATUS POR USUÁRIO
    // Define quais status cada perfil de usuário pode acessar
    // ============================================================
    const userPermissions = {
        // Mapa de permissões por primeiro nome (lowercase, sem acentos)
        statusPermissions: {
            // Vendedores podem mover até analise e cancelar
            'default': ['orcamento', 'orçamento', 'analise', 'analise-credito', 'cancelado'],
            // Perfis com acesso ampliado (gerentes, supervisores)
            'gerente': ['orcamento', 'orçamento', 'analise', 'analise-credito', 'aprovado', 'pedido-aprovado', 'faturar', 'faturado', 'entregue', 'recibo', 'cancelado'],
            'supervisor': ['orcamento', 'orçamento', 'analise', 'analise-credito', 'aprovado', 'pedido-aprovado', 'faturar', 'faturado', 'entregue', 'recibo', 'cancelado']
        },
        canMoveToStatus(firstName, status) {
            // Verificar se o usuário tem permissão específica
            const perms = this.statusPermissions[firstName] || this.statusPermissions['default'];
            return perms.includes(status);
        }
    };

    // Mapa de transições válidas de status de pedido
    const VALID_STATUS_TRANSITIONS = {
        'orcamento': ['analise', 'analise-credito', 'cancelado'],
        'orçamento': ['analise', 'analise-credito', 'cancelado'],
        'analise': ['analise-credito', 'aprovado', 'orcamento', 'cancelado'],
        'analise-credito': ['aprovado', 'pedido-aprovado', 'orcamento', 'cancelado'],
        'aprovado': ['pedido-aprovado', 'faturar', 'cancelado'],
        'pedido-aprovado': ['faturar', 'faturado', 'cancelado'],
        'faturar': ['faturado', 'cancelado'],
        'parcial': ['faturado', 'entregue', 'cancelado'], // Faturamento parcial pode completar ou cancelar
        'faturado': ['entregue', 'recibo'], // Não pode ser cancelado diretamente (precisa cancelar NF-e)
        'entregue': ['recibo'],
        'recibo': [],
        'cancelado': [] // Estado final
    };
    
    router.put('/pedidos/:id/status', async (req, res, next) => {
        const connection = await pool.getConnection();
        try {
            const { id } = req.params;
            const { status, forceTransition, baixar_estoque = true } = req.body;
    
            console.log(`📝 Atualizando status do pedido ${id} para: ${status}`);
    
            const validStatuses = ['orcamento', 'orçamento', 'analise', 'analise-credito', 'aprovado', 'pedido-aprovado', 'faturar', 'faturado', 'entregue', 'cancelado', 'recibo'];
            if (!status || !validStatuses.includes(status)) {
                console.log(`❌ Status inválido: ${status}`);
                return res.status(400).json({ message: 'Status inválido.' });
            }
    
            // Buscar status atual do pedido para validar transição
            const [pedidoAtual] = await connection.query('SELECT id, status, vendedor_id FROM pedidos WHERE id = ?', [id]);
            if (pedidoAtual.length === 0) {
                return res.status(404).json({ message: 'Pedido não encontrado.' });
            }
    
            const statusAtual = pedidoAtual[0].status || 'orcamento';
    
            // Verificar se é admin (usando serviço centralizado - consulta is_admin/role do banco)
            const user = req.user || {};
            const isAdmin = faturamentoShared.isAdmin(user);
    
            // Validar transição de status (admin pode forçar)
            const transicoesValidas = VALID_STATUS_TRANSITIONS[statusAtual] || [];
            if (!transicoesValidas.includes(status) && !forceTransition) {
                if (!isAdmin) {
                    console.log(`❌ Transição inválida: ${statusAtual} -> ${status}`);
                    return res.status(400).json({
                        message: `Transição de status inválida: "${statusAtual}" → "${status}". Transições válidas: ${transicoesValidas.join(', ') || 'nenhuma'}`
                    });
                }
                console.log(`⚠️ Admin ${user.nome || user.email} forçando transição: ${statusAtual} -> ${status}`);
            }
    
            console.log(`🔐 Verificação de permissão - Usuário: ${user.nome || user.email} | Admin: ${isAdmin} | Status desejado: ${status}`);
    
            // ===== VERIFICAÇÃO GRANULAR DE PERMISSÕES (Sistema de Permissões v2) =====
            if (!isAdmin) {
                let firstName = 'unknown';
                if (user.nome) {
                    firstName = user.nome.split(' ')[0].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                } else if (user.email) {
                    firstName = user.email.split('@')[0].split('.')[0].toLowerCase();
                }
    
                // Verificar se o usuário pode mover para este status específico
                if (!userPermissions.canMoveToStatus(firstName, status)) {
                    console.log(`[PERMISSOES] Usuário ${firstName} não tem permissão para mover para status: ${status}`);
                    return res.status(403).json({
                        message: `Você não tem permissão para mover pedidos para o status "${status}".`,
                        status_negado: status,
                        usuario: firstName
                    });
                }
                console.log(`[PERMISSOES] Usuário ${firstName} autorizado para mover para: ${status}`);
            }
    
    
            // Vendedores (não-admin) só podem mover até "analise"
            if (!isAdmin) {
                // Usar pedidoAtual já consultado acima
                const pedido = pedidoAtual[0];
                if (pedido.vendedor_id && user.id && pedido.vendedor_id !== user.id) {
                    console.log(`❌ Usuário ${user.id} não é dono do pedido ${id}`);
                    return res.status(403).json({ message: 'Você só pode mover seus próprios pedidos.' });
                }
    
                // Vendedor só pode definir status até "analise" ou cancelar seus próprios pedidos
                const allowedForVendedor = ['orcamento', 'orçamento', 'analise', 'analise-credito', 'cancelado'];
                if (!allowedForVendedor.includes(status)) {
                    console.log(`❌ Vendedor tentou mover para status ${status} - apenas admin pode`);
                    return res.status(403).json({ message: 'Apenas administradores podem mover pedidos após "Análise de Crédito".' });
                }
            }
    
            await connection.beginTransaction();
    
            // Atualiza status e registra histórico (usando updated_at se existir)
            const [result] = await connection.query('UPDATE pedidos SET status = ?, updated_at = NOW() WHERE id = ?', [status, id]);
    
            // ========================================
            // BAIXA AUTOMÁTICA DE ESTOQUE
            // Quando pedido vai para "faturar" ou "faturado", baixar estoque automaticamente
            // ========================================
            let movimentacoesEstoque = [];
            // FIX: Estoque só baixa em 'faturar' ou 'faturado', NÃO em 'aprovado'
            // Baixar estoque na aprovação causava estoque fantasma quando pedidos eram cancelados
            if (baixar_estoque && ['faturar', 'faturado'].includes(status) &&
                !['faturar', 'faturado'].includes(statusAtual)) {
                try {
                    // Buscar itens do pedido
                    const [itens] = await connection.query(`
                        SELECT codigo, descricao, quantidade, unidade, preco_unitario
                        FROM pedido_itens
                        WHERE pedido_id = ?
                    `, [id]);
    
                    if (itens.length > 0) {
                        console.log(`[ESTOQUE_AUTO] Baixando estoque para pedido #${id} (${itens.length} itens)`);
                        movimentacoesEstoque = await baixarEstoqueAutomatico(connection, id, itens, user?.id);
                    }
                } catch (estoqueError) {
                    console.error('[ESTOQUE_AUTO] Erro (não crítico):', estoqueError.message);
                    // Não falha a operação principal se a baixa de estoque falhar
                }
            }
    
            // ========================================
            // ESTORNO DE ESTOQUE AO CANCELAR
            // Quando pedido é cancelado a partir de status que já tiveram baixa de estoque,
            // devolver os produtos ao estoque automaticamente.
            // Regra: só retorna estoque se cancelar a partir de "analise-credito" ou "pedido-aprovado"
            // ========================================
            let estornoEstoque = [];
            // FIX: Agora só estorna de status que realmente tiveram baixa de estoque (faturar)
            if (status === 'cancelado' && ['faturar', 'faturado', 'parcial'].includes(statusAtual)) {
                try {
                    console.log(`[ESTORNO_ESTOQUE] Cancelamento do pedido #${id} a partir de "${statusAtual}" - verificando itens para estorno...`);
                    
                    // Buscar movimentações de saída deste pedido
                    const [movimentacoes] = await connection.query(`
                        SELECT id, codigo_material, quantidade, quantidade_anterior, quantidade_atual
                        FROM estoque_movimentacoes
                        WHERE documento_tipo = 'pedido' AND documento_id = ? AND tipo_movimento = 'saida'
                        ORDER BY id ASC
                    `, [id]);
                    
                    if (movimentacoes.length > 0) {
                        for (const mov of movimentacoes) {
                            const [produtos] = await connection.query(
                                'SELECT id, codigo, descricao, estoque_atual, estoque_cancelado FROM produtos WHERE codigo = ? LIMIT 1',
                                [mov.codigo_material]
                            );
                            
                            if (produtos.length > 0) {
                                const produto = produtos[0];
                                const estoqueAnterior = parseFloat(produto.estoque_atual || 0);
                                const qtdEstorno = parseFloat(mov.quantidade);
                                const novoEstoque = estoqueAnterior + qtdEstorno;
                                
                                // FIX: Restaurar para estoque_atual (disponível), não apenas estoque_cancelado
                                await connection.query('UPDATE produtos SET estoque_atual = ?, estoque_cancelado = COALESCE(estoque_cancelado, 0) + ? WHERE id = ?', [novoEstoque, qtdEstorno, produto.id]);
                                
                                // Sync tabela estoque unificada se existir
                                try {
                                    await connection.query('UPDATE estoque SET quantidade_disponivel = quantidade_disponivel + ? WHERE produto_id = ?', [qtdEstorno, produto.id]);
                                } catch (syncErr) { /* tabela pode nao existir */ }
                                
                                await connection.query(`
                                    INSERT INTO estoque_movimentacoes
                                    (codigo_material, tipo_movimento, origem, quantidade, quantidade_anterior, quantidade_atual,
                                     documento_tipo, documento_id, usuario_id, observacao, data_movimento)
                                    VALUES (?, 'entrada', 'estorno', ?, ?, ?, 'pedido_cancelado', ?, ?, ?, NOW())
                                `, [
                                    mov.codigo_material, qtdEstorno, estoqueAnterior, novoEstoque,
                                    id, user.id || null,
                                    `Estorno automatico - Cancelamento Pedido #${id} - ${qtdEstorno} devolvido ao estoque disponivel`
                                ]);
                                
                                estornoEstoque.push({
                                    produto: produto.codigo,
                                    descricao: produto.descricao,
                                    quantidade_devolvida: qtdEstorno,
                                    estoque_anterior: estoqueAnterior,
                                    estoque_atual: novoEstoque,
                                    tipo: 'estorno_disponivel'
                                });
                                
                                console.log(`[ESTORNO_ESTOQUE] ${produto.codigo} - ${qtdEstorno} devolvido ao estoque_atual (${estoqueAnterior} -> ${novoEstoque})`);
                            }
                        }
                        console.log(`[ESTORNO_ESTOQUE] ${estornoEstoque.length} produto(s) movidos para estoque_cancelado no pedido #${id}`);
                    } else {
                        // Sem movimentações registradas - tentar estorno direto pelos itens do pedido
                        const [itensEstorno] = await connection.query('SELECT codigo, descricao, quantidade, unidade FROM pedido_itens WHERE pedido_id = ?', [id]);
                        if (itensEstorno.length > 0) {
                            for (const item of itensEstorno) {
                                const codigoMaterial = item.codigo;
                                if (!codigoMaterial) continue;
                                
                                const [produtos] = await connection.query(
                                    'SELECT id, codigo, descricao, estoque_atual, estoque_cancelado FROM produtos WHERE codigo = ? OR sku = ? LIMIT 1',
                                    [codigoMaterial, codigoMaterial]
                                );
                                
                                if (produtos.length > 0) {
                                    const produto = produtos[0];
                                    const quantidade = parseFloat(item.quantidade || 0);
                                    if (quantidade <= 0) continue;
                                    
                                    const estoqueAnterior = parseFloat(produto.estoque_atual || 0);
                                    const novoEstoque = estoqueAnterior + quantidade;
                                    
                                    // FIX: Restaurar para estoque_atual (disponível)
                                    await connection.query('UPDATE produtos SET estoque_atual = ?, estoque_cancelado = COALESCE(estoque_cancelado, 0) + ? WHERE id = ?', [novoEstoque, quantidade, produto.id]);
                                    
                                    // Sync tabela estoque unificada se existir
                                    try {
                                        await connection.query('UPDATE estoque SET quantidade_disponivel = quantidade_disponivel + ? WHERE produto_id = ?', [quantidade, produto.id]);
                                    } catch (syncErr) { /* tabela pode nao existir */ }
                                    
                                    await connection.query(`
                                        INSERT INTO estoque_movimentacoes
                                        (codigo_material, tipo_movimento, origem, quantidade, quantidade_anterior, quantidade_atual,
                                         documento_tipo, documento_id, usuario_id, observacao, data_movimento)
                                        VALUES (?, 'entrada', 'estorno', ?, ?, ?, 'pedido_cancelado', ?, ?, ?, NOW())
                                    `, [
                                        produto.codigo, quantidade, estoqueAnterior, novoEstoque,
                                        id, user.id || null,
                                        `Estorno automatico - Cancelamento Pedido #${id} - ${quantidade}${item.unidade || 'UN'} devolvido ao estoque`
                                    ]);
                                    
                                    estornoEstoque.push({
                                        produto: produto.codigo,
                                        descricao: produto.descricao,
                                        quantidade_devolvida: quantidade,
                                        estoque_anterior: estoqueAnterior,
                                        estoque_atual: novoEstoque,
                                        tipo: 'estorno_disponivel'
                                    });
                                    
                                    console.log(`[ESTORNO_ESTOQUE] ${produto.codigo} - ${quantidade} devolvido ao estoque_atual (fallback)`);
                                }
                            }
                        }
                        console.log(`[ESTORNO_ESTOQUE] Estorno por itens para estoque_cancelado: ${estornoEstoque.length} produto(s)`);
                    }
                } catch (estornoErr) {
                    console.error(`[ESTORNO_ESTOQUE] Erro ao estornar estoque do pedido #${id}:`, estornoErr.message);
                    // Não falha a operação principal
                }
            }

            await connection.commit();
    
            console.log(`✅ Status do pedido ${id} atualizado: ${statusAtual} → ${status} por ${user.nome || user.email} (Admin: ${isAdmin})`);
            res.json({
                message: 'Status atualizado com sucesso.',
                success: true,
                transicao: { de: statusAtual, para: status },
                estoque_baixado: movimentacoesEstoque.length > 0,
                movimentacoes_estoque: movimentacoesEstoque,
                estoque_estornado: estornoEstoque.length > 0,
                estorno_estoque: estornoEstoque
            });
        } catch (error) {
            await connection.rollback();
            console.error('❌ Erro ao atualizar status:', error);
            next(error);
        } finally {
            connection.release();
        }
    });
    
    // GET /pedidos/:id/historico - Buscar histórico do pedido
    router.get('/pedidos/:id/historico', async (req, res, next) => {
        try {
            const { id } = req.params;
    
            // Verificar se tabela existe
            const [tables] = await pool.query("SHOW TABLES LIKE 'pedido_historico'");
            if (tables.length === 0) {
                return res.json({ success: true, data: [] });
            }
    
            const [historico] = await pool.query(`
                SELECT id, pedido_id, usuario_id, usuario_nome, acao, descricao, meta, created_at
                FROM pedido_historico
                WHERE pedido_id = ?
                ORDER BY created_at DESC
                LIMIT 100
            `, [id]);
    
            res.json({ success: true, data: historico });
        } catch (error) {
            console.error('❌ Erro ao buscar histórico:', error);
            res.json({ success: true, data: [] }); // Retorna vazio em caso de erro
        }
    });
    
    // POST /pedidos/:id/historico - Registrar histórico do pedido
    router.post('/pedidos/:id/historico', async (req, res, next) => {
        try {
            const { id } = req.params;
            const { tipo, action, descricao, usuario, meta } = req.body;
            const user = req.user || {};
    
            // Garantir que a tabela existe com colunas corretas
            try {
                await pool.query(`
                    CREATE TABLE IF NOT EXISTS pedido_historico (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        pedido_id INT NOT NULL,
                        usuario_id INT,
                        usuario_nome VARCHAR(100),
                        acao VARCHAR(50) NOT NULL,
                        descricao TEXT,
                        meta JSON,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        INDEX idx_pedido (pedido_id),
                        INDEX idx_acao (acao)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
                `);
            } catch (e) { /* tabela já existe */ }
    
            // Tentar inserir com colunas corretas (usuario_id/usuario_nome ou user_id/user_name)
            try {
                await pool.query(
                    'INSERT INTO pedido_historico (pedido_id, usuario_id, usuario_nome, acao, descricao, meta) VALUES (?, ?, ?, ?, ?, ?)',
                    [id, user.id || null, usuario || user.nome || 'Sistema', tipo || action || 'status', descricao || '', meta ? JSON.stringify(meta) : null]
                );
            } catch (e) {
                // Fallback para colunas alternativas
                await pool.query(
                    'INSERT INTO pedido_historico (pedido_id, descricao, acao, meta) VALUES (?, ?, ?, ?)',
                    [id, `${usuario || user.nome || 'Sistema'}: ${descricao || ''}`, tipo || action || 'status', meta ? JSON.stringify(meta) : null]
                );
            }
    
            res.status(201).json({ message: 'Histórico registrado com sucesso!' });
        } catch (error) {
            console.error('❌ Erro ao registrar histórico:', error);
            // Não bloqueia a operação principal
            res.status(201).json({ message: 'Histórico não registrado (tabela não configurada)', warning: true });
        }
    });
    
    // EMPRESAS
    router.get('/empresas', async (req, res, next) => {
        try {
            const { page = 1, limit = 20 } = req.query;
            const offset = (parseInt(page) - 1) * parseInt(limit);
    
            // Verificar se o usuário é admin ou vendedor
            const isAdmin = req.user && (req.user.is_admin || req.user.role === 'admin' || req.user.role === 'administrador');
    
            let query = 'SELECT id, razao_social, nome_fantasia, cnpj, email, telefone, cidade, estado, vendedor_id, data_criacao as created_at FROM empresas';
            let params = [];
    
            // Se não for admin, filtrar apenas empresas do vendedor
            if (!isAdmin && req.user && req.user.id) {
                query += ' WHERE vendedor_id = ? OR vendedor_id IS NULL';
                params.push(req.user.id);
            }
    
            query += ' ORDER BY nome_fantasia ASC LIMIT ? OFFSET ?';
            params.push(parseInt(limit), offset);
    
            const [rows] = await pool.query(query, params);
            res.json(rows);
        } catch (error) { next(error); }
    });
    router.get('/empresas/search', async (req, res, next) => {
        try {
            const q = req.query.q || '';
            const queryStr = `%${q}%`;
    
            // Verificar se o usuário é admin ou vendedor
            const isAdmin = req.user && (req.user.is_admin || req.user.role === 'admin' || req.user.role === 'administrador');
    
            let query = `SELECT id, nome_fantasia, cnpj FROM empresas WHERE (nome_fantasia LIKE ? OR razao_social LIKE ? OR cnpj LIKE ?)`;
            let params = [queryStr, queryStr, queryStr];
    
            // Se não for admin, filtrar apenas empresas do vendedor
            if (!isAdmin && req.user && req.user.id) {
                query += ' AND (vendedor_id = ? OR vendedor_id IS NULL)';
                params.push(req.user.id);
            }
    
            query += ' ORDER BY nome_fantasia LIMIT 10';
    
            const [rows] = await pool.query(query, params);
            res.json(rows);
        } catch (error) { next(error); }
    });
    // Busca de empresas (autocomplete) - DEVE ficar ANTES de /empresas/:id
    router.get('/empresas/buscar', async (req, res, next) => {
        try {
            const search = req.query.search || req.query.q || req.query.termo || '';
            const limit = parseInt(req.query.limit) || 15;
            const isAdmin = req.user && (req.user.is_admin || req.user.role === 'admin' || req.user.role === 'administrador');

            let query = `SELECT id, nome_fantasia, razao_social, cnpj, telefone, email FROM empresas WHERE 1=1`;
            const params = [];

            if (search) {
                query += ` AND (nome_fantasia LIKE ? OR razao_social LIKE ? OR cnpj LIKE ?)`;
                params.push(`%${search}%`, `%${search}%`, `%${search}%`);
            }

            if (!isAdmin && req.user && req.user.id) {
                query += ' AND (vendedor_id = ? OR vendedor_id IS NULL)';
                params.push(req.user.id);
            }

            query += ` ORDER BY nome_fantasia LIMIT ?`;
            params.push(limit);

            const [rows] = await pool.query(query, params);
            res.json(rows);
        } catch (error) { next(error); }
    });
    router.get('/empresas/:id', async (req, res, next) => {
        try {
            const { id } = req.params;
            const [[empresa]] = await pool.query('SELECT * FROM empresas WHERE id = ?', [id]);
            if (!empresa) return res.status(404).json({ message: 'Empresa não encontrada.' });
            res.json(empresa);
        } catch (error) { next(error); }
    });
    router.get('/empresas/:id/details', async (req, res, next) => {
        try {
            const { id } = req.params;
            const [empresaResult, kpisResult, pedidosResult, clientesResult] = await Promise.all([
                pool.query('SELECT * FROM empresas WHERE id = ?', [id]),
                pool.query(`SELECT COUNT(*) AS totalPedidos, COALESCE(SUM(CASE WHEN status IN ('faturado', 'recibo') THEN valor ELSE 0 END), 0) AS totalFaturado, COALESCE(AVG(CASE WHEN status IN ('faturado', 'recibo') THEN valor ELSE 0 END), 0) AS ticketMedio FROM pedidos WHERE empresa_id = ?`, [id]),
                pool.query('SELECT id, valor, status, created_at FROM pedidos WHERE empresa_id = ? ORDER BY created_at DESC', [id]),
                pool.query('SELECT id, nome, email, telefone FROM clientes WHERE empresa_id = ? ORDER BY nome ASC', [id])
            ]);
            const [details] = empresaResult[0];
            if (!details) return res.status(404).json({ message: 'Empresa não encontrada.' });
            const [kpis] = kpisResult[0];
            const [pedidos] = pedidosResult;
            const [clientes] = clientesResult;
            res.json({ details, kpis: kpis[0], pedidos, clientes });
        } catch (error) { next(error); }
    });
    router.post('/empresas', [
        body('cnpj').trim().notEmpty().withMessage('CNPJ é obrigatório')
            .matches(/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/).withMessage('CNPJ deve estar no formato XX.XXX.XXX/XXXX-XX'),
        body('nome_fantasia').trim().notEmpty().withMessage('Nome fantasia é obrigatório')
            .isLength({ max: 255 }).withMessage('Nome fantasia muito longo'),
        body('razao_social').optional().trim().isLength({ max: 255 }).withMessage('Razão social muito longa'),
        body('email').optional().trim().isEmail().withMessage('Email inválido'),
        body('telefone').optional().trim().matches(/^\(\d{2}\) \d{4,5}-\d{4}$/).withMessage('Telefone inválido'),
        validate
    ], async (req, res, next) => {
        try {
            const { cnpj, nome_fantasia, razao_social, email, telefone, cep, logradouro, numero, bairro, municipio, uf } = req.body;
    
            // Associar o vendedor que está cadastrando a empresa
            const vendedor_id = req.user ? req.user.id : null;
    
            await pool.query(
                `INSERT INTO empresas (cnpj, nome_fantasia, razao_social, email, telefone, cep, logradouro, numero, bairro, municipio, uf, vendedor_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [cnpj, nome_fantasia, razao_social || null, email || null, telefone || null, cep || null, logradouro || null, numero || null, bairro || null, municipio || null, uf || null, vendedor_id, vendedor_id]
            );
            res.status(201).json({ message: 'Empresa cadastrada com sucesso!' });
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Este CNPJ já está cadastrado.' });
            next(error);
        }
    });
    
    // CLIENTES (CONTATOS)
    router.get('/clientes', async (req, res, next) => {
        try {
            const { page = 1, limit = 2000 } = req.query;
            const offset = (parseInt(page) - 1) * parseInt(limit);
    
            // Verificar se o usuário é admin ou vendedor
            const isAdmin = req.user && (req.user.is_admin || req.user.role === 'admin' || req.user.role === 'administrador');
    
            let query = `
                SELECT c.id, c.nome, c.razao_social, c.nome_fantasia, c.email, c.telefone,
                       c.cnpj, c.cpf, c.cnpj_cpf, c.cidade, c.estado, c.ativo,
                       c.vendedor_responsavel, c.vendedor_proprietario,
                       c.created_at, c.data_cadastro,
                       e.nome_fantasia AS empresa_nome
                FROM clientes c
                LEFT JOIN empresas e ON c.empresa_id = e.id
            `;
            let params = [];
    
            // Se não for admin, filtrar apenas clientes de empresas do vendedor
            if (!isAdmin && req.user && req.user.id) {
                query += ' WHERE (e.vendedor_id = ? OR e.vendedor_id IS NULL)';
                params.push(req.user.id);
            }
    
            query += ' ORDER BY c.nome ASC LIMIT ? OFFSET ?';
            params.push(parseInt(limit), parseInt(offset));
    
            const [rows] = await pool.query(query, params);
            res.json(rows);
        } catch (error) { next(error); }
    });
    router.get('/clientes/:id', async (req, res, next) => {
        try {
            const { id } = req.params;
            const [[cliente]] = await pool.query('SELECT * FROM clientes WHERE id = ?', [id]);
            if (!cliente) return res.status(404).json({ message: 'Cliente não encontrado.' });
            res.json(cliente);
        } catch (error) { next(error); }
    });
    router.post('/clientes', [
        body('nome').trim().notEmpty().withMessage('Nome é obrigatório')
            .isLength({ max: 255 }).withMessage('Nome muito longo'),
        body('email').optional({ checkFalsy: true }).trim().isEmail().withMessage('Email inválido'),
        validate
    ], async (req, res, next) => {
        try {
            const { nome, nome_fantasia, cnpj, contato, telefone, celular, email, website,
                    endereco, numero, complemento, bairro, cidade, uf, cep,
                    inscricao_estadual, inscricao_municipal, limite_credito, ativo, empresa_id } = req.body;
    
            // Montar endereço completo se tiver numero/complemento
            let enderecoFinal = endereco || null;
            if (enderecoFinal && numero) enderecoFinal += `, ${numero}`;
            if (enderecoFinal && complemento) enderecoFinal += ` - ${complemento}`;

            const [result] = await pool.query(
                `INSERT INTO clientes (nome, nome_fantasia, razao_social, cnpj, contato, telefone, email, 
                 endereco, bairro, cidade, estado, cep, inscricao_estadual, inscricao_municipal, 
                 credito_total, ativo, empresa_id, data_cadastro, incluido_por)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
                [nome, nome_fantasia || null, nome || null, cnpj || null, contato || null,
                 telefone || null, email || null, enderecoFinal, bairro || null,
                 cidade || null, uf || null, cep || null, inscricao_estadual || null,
                 inscricao_municipal || null, limite_credito ? parseFloat(limite_credito) : 0,
                 ativo !== undefined ? (ativo ? 1 : 0) : 1,
                 empresa_id || 1, req.user ? req.user.nome : 'Sistema']
            );
            res.status(201).json({ message: 'Cliente cadastrado com sucesso!', id: result.insertId });
        } catch (error) { next(error); }
    });
    router.put('/clientes/:id', async (req, res, next) => {
        try {
            const { id } = req.params;
            const body = req.body;

            // Se é apenas toggle de ativo, permitir sem exigir nome/empresa
            if (body.ativo !== undefined && Object.keys(body).length <= 2) {
                const [result] = await pool.query(
                    'UPDATE clientes SET ativo = ? WHERE id = ?',
                    [body.ativo ? 1 : 0, id]
                );
                if (result.affectedRows === 0) return res.status(404).json({ message: 'Cliente não encontrado.' });
                return res.json({ message: `Cliente ${body.ativo ? 'ativado' : 'inativado'} com sucesso.` });
            }

            const { nome, nome_fantasia, cnpj, contato, telefone, celular, email, website,
                    endereco, numero, complemento, bairro, cidade, uf, cep,
                    inscricao_estadual, inscricao_municipal, limite_credito, empresa_id } = body;
            
            if (!nome) return res.status(400).json({ message: 'Nome é obrigatório.' });

            // Montar endereço completo se tiver numero/complemento
            let enderecoFinal = endereco || null;
            if (enderecoFinal && numero) enderecoFinal += `, ${numero}`;
            if (enderecoFinal && complemento) enderecoFinal += ` - ${complemento}`;

            const [result] = await pool.query(
                `UPDATE clientes SET nome = ?, nome_fantasia = ?, cnpj = ?, contato = ?, 
                 telefone = ?, email = ?, endereco = ?, bairro = ?, cidade = ?, 
                 estado = ?, cep = ?, inscricao_estadual = ?, inscricao_municipal = ?,
                 credito_total = ?, ativo = ?, empresa_id = ?,
                 data_ultima_alteracao = NOW(), alterado_por = ?
                 WHERE id = ?`,
                [nome, nome_fantasia || null, cnpj || null, contato || null,
                 telefone || null, email || null, enderecoFinal, bairro || null,
                 cidade || null, uf || null, cep || null, inscricao_estadual || null,
                 inscricao_municipal || null, 
                 limite_credito ? parseFloat(limite_credito) : 0,
                 body.ativo !== undefined ? (body.ativo ? 1 : 0) : 1,
                 empresa_id || 1,
                 req.user ? req.user.nome : 'Sistema', id]
            );
            if (result.affectedRows === 0) return res.status(404).json({ message: 'Cliente não encontrado.' });
            res.json({ message: 'Cliente atualizado com sucesso.' });
        } catch (error) { next(error); }
    });
    router.delete('/clientes/:id', authenticateToken, authorizeAdmin, async (req, res, next) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
    
            const { id } = req.params;
    
            // Verificar se cliente existe
            const [cliente] = await connection.query('SELECT id, nome FROM clientes WHERE id = ?', [id]);
            if (cliente.length === 0) {
                await connection.rollback();
                return res.status(404).json({ message: 'Cliente não encontrado.' });
            }
    
            // Verificar pedidos vinculados
            const [pedidos] = await connection.query('SELECT COUNT(*) as count FROM pedidos WHERE cliente_id = ?', [id]);
            if (pedidos[0].count > 0) {
                await connection.rollback();
                return res.status(400).json({
                    message: `Cliente possui ${pedidos[0].count} pedido(s) vinculado(s). Inative-o em vez de excluir.`
                });
            }
    
            // Verificar contas a receber vinculadas
            const [contas] = await connection.query('SELECT COUNT(*) as count FROM contas_receber WHERE cliente_id = ?', [id]);
            if (contas[0].count > 0) {
                await connection.rollback();
                return res.status(400).json({
                    message: `Cliente possui ${contas[0].count} conta(s) a receber vinculada(s).`
                });
            }
    
            // Excluir interações do cliente
            await connection.query('DELETE FROM cliente_interacoes WHERE cliente_id = ?', [id]);
    
            // Excluir cliente
            const [result] = await connection.query('DELETE FROM clientes WHERE id = ?', [id]);
    
            await connection.commit();
    
            console.log(`🗑️ Cliente #${id} (${cliente[0].nome}) excluído com sucesso por usuário ${req.user?.id}`);
            res.status(204).send();
        } catch (error) {
            await connection.rollback();
            next(error);
        } finally {
            connection.release();
        }
    });
    router.post('/clientes/:id/interacoes', async (req, res, next) => {
        try {
            const { id: cliente_id } = req.params;
            const { tipo, anotacao } = req.body;
            const { id: usuario_id } = req.user;
            if (!tipo || !anotacao) return res.status(400).json({ message: 'Tipo e anotação são obrigatórios.' });
            await pool.query(
                'INSERT INTO cliente_interacoes (cliente_id, usuario_id, tipo, anotacao) VALUES (?, ?, ?, ?)',
                [cliente_id, usuario_id, tipo, anotacao]
            );
            res.status(201).json({ message: 'Interação registrada com sucesso!' });
        } catch (error) { next(error); }
    });
    
    // METAS, COMISSÕES E RELATÓRIOS (ADMIN)
    router.get('/metas', authorizeAdminOrComercial, async (req, res, next) => {
        try {
            const [rows] = await pool.query(`SELECT m.*, u.nome AS vendedor_nome FROM metas_vendas m LEFT JOIN usuarios u ON m.vendedor_id = u.id ORDER BY m.periodo DESC, m.vendedor_id`);
            res.json(rows);
        } catch (error) { next(error); }
    });
    router.post('/metas', authorizeAdminOrComercial, async (req, res, next) => {
        try {
            const { vendedor_id, periodo, tipo, valor_meta } = req.body;
            await pool.query('INSERT INTO metas_vendas (vendedor_id, periodo, tipo, valor_meta) VALUES (?, ?, ?, ?)', [vendedor_id || null, periodo, tipo, valor_meta]);
            res.status(201).json({ message: 'Meta criada com sucesso!' });
        } catch (error) { next(error); }
    });
    router.put('/metas/:id', authorizeAdminOrComercial, async (req, res, next) => {
        try {
            const { vendedor_id, periodo, tipo, valor_meta } = req.body;
            await pool.query('UPDATE metas_vendas SET vendedor_id=?, periodo=?, tipo=?, valor_meta=? WHERE id=?', [vendedor_id || null, periodo, tipo, valor_meta, req.params.id]);
            res.json({ message: 'Meta atualizada com sucesso!' });
        } catch (error) { next(error); }
    });
    router.delete('/metas/:id', authorizeAdminOrComercial, async (req, res, next) => {
        try {
            await pool.query('DELETE FROM metas_vendas WHERE id=?', [req.params.id]);
            res.json({ message: 'Meta excluída com sucesso!' });
        } catch (error) { next(error); }
    });
    router.get('/metas/progresso', authorizeAdminOrComercial, async (req, res, next) => {
        try {
            // Optimized: Single query with LEFT JOIN instead of N+1 loop
            const [progresso] = await pool.query(`
                SELECT m.id AS meta_id, m.periodo, m.tipo, m.vendedor_id, m.valor_meta,
                       COALESCE(SUM(p.valor), 0) AS totalVendido
                FROM metas_vendas m
                LEFT JOIN pedidos p ON p.status IN ('faturado', 'recibo')
                    AND DATE_FORMAT(p.created_at, '%Y-%m') = m.periodo
                    AND (m.vendedor_id IS NULL OR p.vendedor_id = m.vendedor_id)
                GROUP BY m.id, m.periodo, m.tipo, m.vendedor_id, m.valor_meta
            `);
            res.json(progresso);
        } catch (error) { next(error); }
    });
    
    // Ranking de vendedores com metas
    router.get('/metas/ranking', async (req, res, next) => {
        try {
            const periodo = req.query.periodo || new Date().toISOString().substring(0, 7);
    
            // Verificar se tabela metas_vendas existe
            const [tables] = await pool.query("SHOW TABLES LIKE 'metas_vendas'");
    
            let rows = [];
            if (tables.length > 0) {
                [rows] = await pool.query(`
                    SELECT
                        u.id, u.nome, u.email, u.avatar,
                        COALESCE(m.valor_meta, 0) as valor_meta,
                        COALESCE((SELECT SUM(valor) FROM pedidos
                                  WHERE vendedor_id = u.id
                                  AND status IN ('faturado', 'recibo')
                                  AND DATE_FORMAT(created_at, '%Y-%m') = ?), 0) as valor_realizado,
                        COALESCE((SELECT COUNT(*) FROM pedidos
                                  WHERE vendedor_id = u.id
                                  AND status IN ('faturado', 'recibo')
                                  AND DATE_FORMAT(created_at, '%Y-%m') = ?), 0) as qtd_vendas
                    FROM usuarios u
                    LEFT JOIN metas_vendas m ON u.id = m.vendedor_id AND m.periodo = ?
                    WHERE (u.departamento = 'Comercial' OR u.departamento = 'Vendas' OR u.role = 'comercial')
                    ORDER BY valor_realizado DESC
                `, [periodo, periodo, periodo]);
            } else {
                // Fallback sem tabela de metas
                [rows] = await pool.query(`
                    SELECT
                        u.id, u.nome, u.email, u.avatar,
                        0 as valor_meta,
                        COALESCE((SELECT SUM(valor) FROM pedidos
                                  WHERE vendedor_id = u.id
                                  AND status IN ('faturado', 'recibo')
                                  AND DATE_FORMAT(created_at, '%Y-%m') = ?), 0) as valor_realizado,
                        COALESCE((SELECT COUNT(*) FROM pedidos
                                  WHERE vendedor_id = u.id
                                  AND status IN ('faturado', 'recibo')
                                  AND DATE_FORMAT(created_at, '%Y-%m') = ?), 0) as qtd_vendas
                    FROM usuarios u
                    WHERE (u.departamento = 'Comercial' OR u.departamento = 'Vendas' OR u.role = 'comercial')
                    ORDER BY valor_realizado DESC
                `, [periodo, periodo]);
            }
    
            const ranking = rows.map((r, index) => ({
                ...r,
                posicao: index + 1,
                percentual_atingido: r.valor_meta > 0 ? ((r.valor_realizado / r.valor_meta) * 100).toFixed(2) : 0,
                status_meta: r.valor_realizado >= r.valor_meta && r.valor_meta > 0 ? 'atingida' :
                             r.valor_realizado >= r.valor_meta * 0.8 && r.valor_meta > 0 ? 'proxima' : 'pendente'
            }));
    
            res.json({ periodo, ranking });
        } catch (error) {
            console.error('Erro ao buscar ranking:', error);
            res.json({ periodo: req.query.periodo, ranking: [] });
        }
    });
    
    // --- ROTAS DE COMISSÕES - CONFIGURAÇÃO ---
    
    // Configuração de comissões por vendedor
    router.get('/comissoes/configuracao', async (req, res, next) => {
        try {
            const [vendedores] = await pool.query(`
                SELECT
                    u.id, u.nome, u.email,
                    COALESCE(u.comissao_percentual, 1.0) as comissao_percentual,
                    COALESCE(u.comissao_tipo, 'percentual') as comissao_tipo
                FROM usuarios u
                LEFT JOIN departamentos d ON u.departamento_id = d.id
                WHERE d.nome = 'Comercial' AND u.status = 'ativo'
                ORDER BY u.nome
            `);
    
            res.json(vendedores);
        } catch (error) {
            next(error);
        }
    });
    
    // Atualizar configuração de comissão de vendedor (Apenas Andreia e Antonio T.I.)
    router.put('/comissoes/configuracao/:vendedorId', async (req, res, next) => {
        try {
            const user = req.user;
            const username = (user.email || '').split('@')[0].toLowerCase();
            const USERS_PERMITIDOS_COMISSAO = ['andreia', 'antonio', 'ti', 'tialuforce'];
            const podeAlterarComissao = USERS_PERMITIDOS_COMISSAO.includes(username);
            if (!podeAlterarComissao) {
                return res.status(403).json({ message: 'Apenas Andreia e Antonio (T.I.) podem alterar comissões.' });
            }
    
            const { vendedorId } = req.params;
            const { comissao_percentual } = req.body;
    
            try {
                await pool.query(
                    'UPDATE usuarios SET comissao_percentual = ? WHERE id = ?',
                    [parseFloat(comissao_percentual) || 1.0, vendedorId]
                );
            } catch (e) {
                await pool.query('ALTER TABLE usuarios ADD COLUMN comissao_percentual DECIMAL(5,2) DEFAULT 1.0');
                await pool.query(
                    'UPDATE usuarios SET comissao_percentual = ? WHERE id = ?',
                    [parseFloat(comissao_percentual) || 1.0, vendedorId]
                );
            }
    
            res.json({ message: 'Comissão atualizada com sucesso' });
        } catch (error) {
            next(error);
        }
    });
    
    router.get('/comissoes', authorizeAdminOrComercial, async (req, res, next) => {
        try {
            const { periodo } = req.query; // Ex: '2025-08'
            let where = 'p.status IN ("faturado", "recibo")';
            let params = [];
            if (periodo) {
                where += ' AND DATE_FORMAT(p.created_at, "%Y-%m") = ?';
                params.push(periodo);
            }
            const [rows] = await pool.query(`
                SELECT p.id AS pedido_id, p.valor, p.created_at, u.id AS vendedor_id, u.nome AS vendedor_nome, u.comissao_percentual,
                (p.valor * u.comissao_percentual / 100) AS valor_comissao
                FROM pedidos p
                LEFT JOIN usuarios u ON p.vendedor_id = u.id
                WHERE ${where}
                ORDER BY u.nome, p.created_at DESC
            `, params);
            res.json(rows);
        } catch (error) { next(error); }
    });
    
    // Resumo de comissões por vendedor
    router.get('/comissoes/resumo', authorizeAdminOrComercial, async (req, res, next) => {
        try {
            const { periodo, vendedor_id } = req.query;
            const periodoAtual = periodo || new Date().toISOString().substring(0, 7);

            // Verificar se usuário é admin (pode ver todas as comissões)
            const ADMINS_COMISSAO = ['ti', 'douglas', 'andreia', 'fernando', 'consultoria', 'admin', 'antonio', 'tialuforce'];
            const currentUser = req.user;
            const username = (currentUser.email || '').split('@')[0].toLowerCase();
            const isAdminComissao = currentUser.is_admin === 1 || currentUser.role === 'admin' || ADMINS_COMISSAO.includes(username);

            // Se não é admin de comissões, filtrar apenas a própria comissão
            let whereExtra = '';
            let queryParams = [periodoAtual];

            if (!isAdminComissao) {
                // Vendedor/supervisor vê apenas a própria comissão
                whereExtra = ' AND u.id = ?';
                queryParams.push(currentUser.id);
            } else if (vendedor_id) {
                // Admin filtrando por vendedor específico
                whereExtra = ' AND u.id = ?';
                queryParams.push(vendedor_id);
            }

            const [rows] = await pool.query(`
                SELECT
                    u.id as vendedor_id,
                    u.nome as vendedor_nome,
                    u.email,
                    COALESCE(u.comissao_percentual, 1.0) as percentual_comissao,
                    COUNT(CASE WHEN p.status IN ('faturado', 'recibo') THEN 1 END) as qtd_faturados,
                    COALESCE(SUM(CASE WHEN p.status IN ('faturado', 'recibo') THEN p.valor ELSE 0 END), 0) as valor_faturado,
                    COALESCE(SUM(CASE WHEN p.status IN ('faturado', 'recibo') THEN (p.valor * COALESCE(u.comissao_percentual, 1.0) / 100) ELSE 0 END), 0) as comissao_faturada,
                    COUNT(CASE WHEN p.status NOT IN ('cancelado', 'faturado', 'recibo') THEN 1 END) as qtd_pendentes,
                    COALESCE(SUM(CASE WHEN p.status NOT IN ('cancelado', 'faturado', 'recibo') THEN p.valor ELSE 0 END), 0) as valor_pendente,
                    COALESCE(SUM(CASE WHEN p.status NOT IN ('cancelado', 'faturado', 'recibo') THEN (p.valor * COALESCE(u.comissao_percentual, 1.0) / 100) ELSE 0 END), 0) as comissao_pendente
                FROM usuarios u
                LEFT JOIN pedidos p ON u.id = p.vendedor_id AND DATE_FORMAT(p.created_at, '%Y-%m') = ?
                WHERE (u.role IN ('comercial', 'vendedor') OR u.departamento IN ('Comercial', 'Vendas')) AND u.status = 'ativo'${whereExtra}
                GROUP BY u.id, u.nome, u.email, u.comissao_percentual
                ORDER BY comissao_faturada DESC
            `, queryParams);

            const totais = {
                total_faturado: rows.reduce((sum, r) => sum + parseFloat(r.valor_faturado || 0), 0),
                total_comissao_faturada: rows.reduce((sum, r) => sum + parseFloat(r.comissao_faturada || 0), 0),
                total_pendente: rows.reduce((sum, r) => sum + parseFloat(r.valor_pendente || 0), 0),
                total_comissao_pendente: rows.reduce((sum, r) => sum + parseFloat(r.comissao_pendente || 0), 0)
            };

            res.json({ periodo: periodoAtual, vendedores: rows, totais });
        } catch (error) { next(error); }
    });
    
    // Histórico de comissões pagas
    router.get('/comissoes/historico', authorizeAdminOrComercial, async (req, res, next) => {
        try {
            const { vendedor_id, ano } = req.query;
            const anoAtual = ano || new Date().getFullYear();

            // Verificar se usuário é admin de comissões
            const ADMINS_COMISSAO = ['ti', 'douglas', 'andreia', 'fernando', 'consultoria', 'admin', 'antonio', 'tialuforce'];
            const currentUser = req.user;
            const usernameH = (currentUser.email || '').split('@')[0].toLowerCase();
            const isAdminComissaoH = currentUser.is_admin === 1 || currentUser.role === 'admin' || ADMINS_COMISSAO.includes(usernameH);
    
            let query = `
                SELECT
                    DATE_FORMAT(p.created_at, '%Y-%m') as periodo,
                    u.id as vendedor_id,
                    u.nome as vendedor_nome,
                    COUNT(*) as qtd_vendas,
                    SUM(p.valor) as valor_total,
                    SUM(p.valor * COALESCE(u.comissao_percentual, 1.0) / 100) as comissao_total
                FROM pedidos p
                LEFT JOIN usuarios u ON p.vendedor_id = u.id
                WHERE p.status IN ('faturado', 'recibo')
                AND YEAR(p.created_at) = ?
            `;
            const params = [anoAtual];

            if (!isAdminComissaoH) {
                // Não-admin vê apenas o próprio histórico
                query += ' AND p.vendedor_id = ?';
                params.push(currentUser.id);
            } else if (vendedor_id) {
                query += ' AND p.vendedor_id = ?';
                params.push(vendedor_id);
            }
    
            query += ' GROUP BY DATE_FORMAT(p.created_at, "%Y-%m"), u.id, u.nome ORDER BY periodo DESC, u.nome';
    
            const [rows] = await pool.query(query, params);
    
            res.json(rows);
        } catch (error) { next(error); }
    });
    
    router.get('/relatorios/vendas', authorizeAdminOrComercial, async (req, res, next) => {
        try {
            const { inicio, fim, vendedor_id } = req.query;
            let where = 'p.created_at >= ? AND p.created_at <= ?';
            let params = [inicio, fim];
            if (vendedor_id) {
                where += ' AND p.vendedor_id = ?';
                params.push(vendedor_id);
            }
            const [rows] = await pool.query(`
                SELECT p.id, p.valor, p.status, p.created_at, u.nome AS vendedor_nome, e.nome_fantasia AS empresa_nome
                FROM pedidos p
                LEFT JOIN usuarios u ON p.vendedor_id = u.id
                LEFT JOIN empresas e ON p.empresa_id = e.id
                WHERE ${where}
                ORDER BY p.created_at DESC
            `, params);
            res.json(rows);
        } catch (error) { next(error); }
    });
    router.get('/relatorios/funil', authorizeAdminOrComercial, async (req, res, next) => {
        try {
            const { inicio, fim } = req.query;
            const [rows] = await pool.query(`
                SELECT status, COUNT(*) AS total
                FROM pedidos
                WHERE created_at >= ? AND created_at <= ?
                GROUP BY status
            `, [inicio, fim]);
            res.json(rows);
        } catch (error) { next(error); }
    });
    // Alias para dashboard-stats
    router.get('/dashboard', authorizeAdminOrComercial, async (req, res, next) => {
        try {
            const [faturadoResult] = await pool.query(`SELECT COALESCE(SUM(valor), 0) AS totalFaturadoMes FROM pedidos WHERE status IN ('faturado', 'recibo') AND MONTH(created_at) = MONTH(CURRENT_DATE()) AND YEAR(created_at) = YEAR(CURRENT_DATE())`);
            const [pendentesResult] = await pool.query(`SELECT COUNT(*) AS pedidosPendentes FROM pedidos WHERE status IN ('orcamento', 'analise', 'aprovado')`);
            const [clientesResult] = await pool.query(`SELECT COUNT(*) AS novosClientesMes FROM empresas WHERE MONTH(created_at) = MONTH(CURRENT_DATE()) AND YEAR(created_at) = YEAR(CURRENT_DATE())`);
            res.json({
                totalFaturadoMes: faturadoResult[0].totalFaturadoMes,
                pedidosPendentes: pendentesResult[0].pedidosPendentes,
                novosClientesMes: clientesResult[0].novosClientesMes
            });
        } catch (error) { next(error); }
    });
    router.get('/dashboard-stats', authorizeAdminOrComercial, async (req, res, next) => {
        try {
            const [faturadoResult] = await pool.query(`SELECT COALESCE(SUM(valor), 0) AS totalFaturadoMes FROM pedidos WHERE status IN ('faturado', 'recibo') AND MONTH(created_at) = MONTH(CURRENT_DATE()) AND YEAR(created_at) = YEAR(CURRENT_DATE())`);
            const [pendentesResult] = await pool.query(`SELECT COUNT(*) AS pedidosPendentes FROM pedidos WHERE status IN ('orcamento', 'analise', 'aprovado')`);
            const [clientesResult] = await pool.query(`SELECT COUNT(*) AS novosClientesMes FROM empresas WHERE MONTH(created_at) = MONTH(CURRENT_DATE()) AND YEAR(created_at) = YEAR(CURRENT_DATE())`);
            res.json({
                totalFaturadoMes: faturadoResult[0].totalFaturadoMes,
                pedidosPendentes: pendentesResult[0].pedidosPendentes,
                novosClientesMes: clientesResult[0].novosClientesMes
            });
        } catch (error) { next(error); }
    });
    
    // Helper: criar tabela de itens se não existir
    // AUDIT-FIX DB-005: Added FOREIGN KEY on pedido_id
    async function ensurePedidoItensTable() {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS pedido_itens (
                id INT AUTO_INCREMENT PRIMARY KEY,
                pedido_id INT NOT NULL,
                codigo VARCHAR(100),
                descricao TEXT,
                quantidade DECIMAL(15,3) DEFAULT 1,
                quantidade_parcial DECIMAL(15,3) DEFAULT 0,
                unidade VARCHAR(20) DEFAULT 'UN',
                local_estoque VARCHAR(255) DEFAULT 'PADRAO - Local de Estoque Padrão',
                preco_unitario DECIMAL(18,2) DEFAULT 0,
                desconto DECIMAL(18,2) DEFAULT 0,
                total DECIMAL(18,2) DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_pedido_id (pedido_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);
        // AUDIT-FIX DB-005: Try to add FK if missing (safe — ignores if exists)
        try {
            await pool.query(`ALTER TABLE pedido_itens ADD CONSTRAINT fk_pedido_itens_pedido FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE`);
        } catch(e) { /* FK already exists or table mismatch — safe to ignore */ }

        // Adicionar colunas de impostos se não existirem
        const colunasExtras = [
            { nome: 'produto_id', tipo: 'INT DEFAULT NULL' },
            { nome: 'valor_ipi', tipo: 'DECIMAL(18,2) DEFAULT 0' },
            { nome: 'valor_icms_st', tipo: 'DECIMAL(18,2) DEFAULT 0' },
            { nome: 'aliquota_ipi', tipo: 'DECIMAL(10,2) DEFAULT 0' },
            { nome: 'aliquota_icms', tipo: 'DECIMAL(10,2) DEFAULT 0' },
            { nome: 'mva_st', tipo: 'DECIMAL(10,2) DEFAULT 0' },
            { nome: 'subtotal', tipo: 'DECIMAL(18,2) DEFAULT 0' },
            { nome: 'cfop', tipo: 'VARCHAR(20) DEFAULT NULL' },
            { nome: 'cenario_fiscal', tipo: 'VARCHAR(100) DEFAULT NULL' },
            { nome: 'observacoes', tipo: 'TEXT DEFAULT NULL' }
        ];
        for (const col of colunasExtras) {
            try {
                await pool.query(`ALTER TABLE pedido_itens ADD COLUMN ${col.nome} ${col.tipo}`);
            } catch(e) { /* Column already exists — safe to ignore */ }
        }
    }
    
    // AUDIT-FIX DB-008: audit_trail now consolidated into auditoria_logs (see writeAuditLog helper)
    // Legacy ensureAuditTrailTable kept for backward compatibility with existing data
    async function ensureAuditTrailTable() {
        // No longer needed — auditoria_logs is created at startup
        // Keeping function stub so existing callers don't break
    }
    
    // Call audit trail table creation on startup (no-op, using auditoria_logs instead)
    ensureAuditTrailTable().catch(e => console.log('[AUDIT] Tabela audit_trail init:', e.message));

    // ====================================================
    // Histórico de pedidos por cliente
    // ====================================================
    router.get('/clientes/:clienteId/historico', async (req, res, next) => {
        try {
            const { clienteId } = req.params;
            const nomeCliente = req.query.nome || '';

            let query = `SELECT p.id, p.cliente, p.status, p.valor, p.vendedor, p.nf, p.parcelas,
                         p.data_criacao, p.data_atualizacao, p.desconto_pct,
                         (SELECT COUNT(*) FROM pedido_itens pi WHERE pi.pedido_id = p.id) as total_itens
                         FROM pedidos p WHERE `;
            let params = [];

            if (clienteId && clienteId !== '0' && clienteId !== 'null' && clienteId !== 'undefined') {
                query += `p.cliente_id = ? `;
                params = [clienteId];
            } else if (nomeCliente) {
                query += `(p.cliente LIKE ? OR p.cliente_nome LIKE ?) `;
                params = [`%${nomeCliente}%`, `%${nomeCliente}%`];
            } else {
                return res.json({ pedidos: [], total: 0, totalValor: 0 });
            }

            query += `ORDER BY p.data_criacao DESC LIMIT 100`;

            const [pedidos] = await pool.query(query, params);

            // Calcular totais
            const totalValor = pedidos.reduce((sum, p) => sum + (parseFloat(p.valor) || 0), 0);
            const statusCount = {};
            pedidos.forEach(p => {
                const st = p.status || 'Sem status';
                statusCount[st] = (statusCount[st] || 0) + 1;
            });

            res.json({
                pedidos,
                total: pedidos.length,
                totalValor,
                statusCount
            });
        } catch (error) {
            console.error('[VENDAS] Erro ao buscar histórico do cliente:', error);
            next(error);
        }
    });
    
    // Itens do pedido - Listar
    router.get('/pedidos/:id/itens', async (req, res, next) => {
        try {
            await ensurePedidoItensTable();
            const { id } = req.params;
            const [itens] = await pool.query(
                `SELECT id, pedido_id, codigo, descricao, quantidade, quantidade_parcial, unidade, local_estoque, 
                 preco_unitario, desconto, subtotal, produto_id, valor_ipi, valor_icms_st, 
                 aliquota_ipi, aliquota_icms, mva_st, cfop, cenario_fiscal, observacoes 
                 FROM pedido_itens WHERE pedido_id = ? ORDER BY id ASC`,
                [id]
            );
            res.json(itens);
        } catch (error) {
            if (error && error.code === 'ER_NO_SUCH_TABLE') return res.json([]);
            next(error);
        }
    });
    
    // Itens do pedido - Adicionar
    router.post('/pedidos/:id/itens', async (req, res, next) => {
        try {
            await ensurePedidoItensTable();
            const { id } = req.params;
            const { codigo, descricao, quantidade, quantidade_parcial, unidade, local_estoque, preco_unitario, desconto,
                    produto_id, valor_ipi, valor_icms_st, aliquota_ipi, aliquota_icms, mva_st, cfop, cenario_fiscal, observacoes, preco_custo } = req.body;
    
            if (!codigo || !descricao) {
                return res.status(400).json({ message: 'Código e descrição são obrigatórios.' });
            }
    
            const qty = parseFloat(quantidade) || 1;
            const qtyParcial = parseFloat(quantidade_parcial) || 0;
            const preco = parseFloat(preco_unitario) || 0;
            const desc = parseFloat(desconto) || 0;
            const vIPI = parseFloat(valor_ipi) || 0;
            const vICMSST = parseFloat(valor_icms_st) || 0;
            const total = (qty * preco) - desc;
    
            const [result] = await pool.query(
                `INSERT INTO pedido_itens (pedido_id, codigo, descricao, quantidade, quantidade_parcial, unidade, local_estoque, 
                 preco_unitario, desconto, subtotal, produto_id, valor_ipi, valor_icms_st, aliquota_ipi, aliquota_icms, mva_st, cfop, cenario_fiscal, observacoes, preco_custo)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [id, codigo, descricao, qty, qtyParcial, unidade || 'UN', local_estoque || 'PADRAO - Local de Estoque Padrão', 
                 preco, desc, total, produto_id || null, vIPI, vICMSST, 
                 parseFloat(aliquota_ipi) || 0, parseFloat(aliquota_icms) || 0, parseFloat(mva_st) || 0,
                 cfop || null, cenario_fiscal || null, observacoes || null, parseFloat(preco_custo) || 0]
            );

            // Recalcular totais de impostos e valor do pedido
            const [totaisImpostos] = await pool.query(
                'SELECT COALESCE(SUM(valor_ipi), 0) as total_ipi, COALESCE(SUM(valor_icms_st), 0) as total_icms_st, COALESCE(SUM(subtotal), 0) as total_subtotais FROM pedido_itens WHERE pedido_id = ?',
                [id]
            );
            const [pedidoFrete] = await pool.query('SELECT COALESCE(frete, 0) as frete FROM pedidos WHERE id = ?', [id]);
            const novoValor = parseFloat(totaisImpostos[0].total_subtotais) + parseFloat(totaisImpostos[0].total_ipi) + parseFloat(totaisImpostos[0].total_icms_st) + parseFloat(pedidoFrete[0]?.frete || 0);
            await pool.query('UPDATE pedidos SET total_ipi = ?, total_icms_st = ?, valor = ? WHERE id = ?',
                [totaisImpostos[0].total_ipi, totaisImpostos[0].total_icms_st, novoValor, id]);
    
            console.log(`📦 Item adicionado ao pedido #${id}. Novo valor: R$${novoValor.toFixed(2)} (subtotais: ${totaisImpostos[0].total_subtotais}, IPI: ${totaisImpostos[0].total_ipi}, ICMS ST: ${totaisImpostos[0].total_icms_st}, frete: ${pedidoFrete[0]?.frete || 0})`);
            res.status(201).json({ message: 'Item adicionado com sucesso!', id: result.insertId });
        } catch (error) {
            next(error);
        }
    });
    
    // Itens do pedido - Atualizar
    router.put('/pedidos/:pedidoId/itens/:itemId', async (req, res, next) => {
        try {
            await ensurePedidoItensTable();
            const { pedidoId, itemId } = req.params;
            const { codigo, descricao, quantidade, quantidade_parcial, unidade, local_estoque, preco_unitario, desconto,
                    produto_id, valor_ipi, valor_icms_st, aliquota_ipi, aliquota_icms, mva_st, cfop, cenario_fiscal, observacoes, preco_custo } = req.body;
    
            const qty = parseFloat(quantidade) || 1;
            const qtyParcial = parseFloat(quantidade_parcial) || 0;
            const preco = parseFloat(preco_unitario) || 0;
            const desc = parseFloat(desconto) || 0;
            const vIPI = parseFloat(valor_ipi) || 0;
            const vICMSST = parseFloat(valor_icms_st) || 0;
            const total = (qty * preco) - desc;
    
            await pool.query(
                `UPDATE pedido_itens SET codigo = ?, descricao = ?, quantidade = ?, quantidade_parcial = ?, unidade = ?, 
                 local_estoque = ?, preco_unitario = ?, desconto = ?, subtotal = ?,
                 produto_id = ?, valor_ipi = ?, valor_icms_st = ?, aliquota_ipi = ?, aliquota_icms = ?, mva_st = ?,
                 cfop = ?, cenario_fiscal = ?, observacoes = ?, preco_custo = ? WHERE id = ? AND pedido_id = ?`,
                [codigo, descricao, qty, qtyParcial, unidade, local_estoque, preco, desc, total,
                 produto_id || null, vIPI, vICMSST, parseFloat(aliquota_ipi) || 0, parseFloat(aliquota_icms) || 0, parseFloat(mva_st) || 0,
                 cfop || null, cenario_fiscal || null, observacoes || null, parseFloat(preco_custo) || 0, itemId, pedidoId]
            );

            // Recalcular totais de impostos e valor do pedido
            const [totaisImpostos] = await pool.query(
                'SELECT COALESCE(SUM(valor_ipi), 0) as total_ipi, COALESCE(SUM(valor_icms_st), 0) as total_icms_st, COALESCE(SUM(subtotal), 0) as total_subtotais FROM pedido_itens WHERE pedido_id = ?',
                [pedidoId]
            );
            const [pedidoFrete] = await pool.query('SELECT COALESCE(frete, 0) as frete FROM pedidos WHERE id = ?', [pedidoId]);
            const novoValor = parseFloat(totaisImpostos[0].total_subtotais) + parseFloat(totaisImpostos[0].total_ipi) + parseFloat(totaisImpostos[0].total_icms_st) + parseFloat(pedidoFrete[0]?.frete || 0);
            await pool.query('UPDATE pedidos SET total_ipi = ?, total_icms_st = ?, valor = ? WHERE id = ?',
                [totaisImpostos[0].total_ipi, totaisImpostos[0].total_icms_st, novoValor, pedidoId]);
    
            console.log(`📝 Item atualizado no pedido #${pedidoId}. Novo valor: R$${novoValor.toFixed(2)}`);
            res.json({ message: 'Item atualizado com sucesso!' });
        } catch (error) {
            next(error);
        }
    });
    
    // Itens do pedido - Buscar item específico (GET)
    router.get('/pedidos/:pedidoId/itens/:itemId', async (req, res, next) => {
        try {
            await ensurePedidoItensTable();
            const { pedidoId, itemId } = req.params;
            const [rows] = await pool.query(
                'SELECT * FROM pedido_itens WHERE id = ? AND pedido_id = ?',
                [itemId, pedidoId]
            );
    
            if (rows.length === 0) {
                return res.status(404).json({ message: 'Item não encontrado.' });
            }
    
            res.json(rows[0]);
        } catch (error) {
            next(error);
        }
    });
    
    // Itens do pedido - Excluir
    // AUDIT-FIX: Added transaction + automatic pedido total recalculation after item delete
    router.delete('/pedidos/:pedidoId/itens/:itemId', async (req, res, next) => {
        const connection = await pool.getConnection();
        try {
            await ensurePedidoItensTable();
            const { pedidoId, itemId } = req.params;
    
            await connection.beginTransaction();
    
            // Delete the item
            const [deleteResult] = await connection.query(
                'DELETE FROM pedido_itens WHERE id = ? AND pedido_id = ?',
                [itemId, pedidoId]
            );
    
            if (deleteResult.affectedRows === 0) {
                await connection.rollback();
                return res.status(404).json({ message: 'Item não encontrado.' });
            }
    
            // Recalcular totais (subtotais + impostos) dos itens restantes
            const [totals] = await connection.query(
                `SELECT COALESCE(SUM(subtotal), 0) as total_subtotais,
                        COALESCE(SUM(valor_ipi), 0) as total_ipi,
                        COALESCE(SUM(valor_icms_st), 0) as total_icms_st
                FROM pedido_itens WHERE pedido_id = ?`,
                [pedidoId]
            );
    
            const [pedidoFrete] = await connection.query('SELECT COALESCE(frete, 0) as frete FROM pedidos WHERE id = ?', [pedidoId]);
            const totalSubtotais = parseFloat(totals[0]?.total_subtotais) || 0;
            const totalIPI = parseFloat(totals[0]?.total_ipi) || 0;
            const totalICMSST = parseFloat(totals[0]?.total_icms_st) || 0;
            const frete = parseFloat(pedidoFrete[0]?.frete) || 0;
            const novoTotal = totalSubtotais + totalIPI + totalICMSST + frete;
            await connection.query(
                'UPDATE pedidos SET valor = ?, total_ipi = ?, total_icms_st = ? WHERE id = ?',
                [novoTotal, totalIPI, totalICMSST, pedidoId]
            );
    
            await connection.commit();
    
            console.log(`🗑️ Item #${itemId} excluído do pedido #${pedidoId}. Novo total: R$${novoTotal.toFixed(2)} (subtotais: ${totalSubtotais}, IPI: ${totalIPI}, ICMS ST: ${totalICMSST}, frete: ${frete})`);
            res.json({ message: 'Item excluído com sucesso!', novo_total: novoTotal });
        } catch (error) {
            await connection.rollback();
            next(error);
        } finally {
            connection.release();
        }
    });
    
    // Autocomplete de produtos - busca rápida para dropdown
    // Colunas reais da tabela: unidade_medida (não unidade), gtin (não ean), 
    // localizacao (não local_estoque), status/ativo (não situacao), nome (não descricao para muitos produtos)
    router.get('/produtos/autocomplete/:termo', async (req, res, next) => {
        try {
            const { termo } = req.params;
            const limit = parseInt(req.query.limit) || 15;
    
            const [rows] = await pool.query(
                `SELECT id, codigo, 
                        COALESCE(NULLIF(TRIM(descricao),''), nome, codigo) as descricao,
                        COALESCE(nome, descricao, codigo) as nome,
                        COALESCE(unidade_medida, '') as unidade, 
                        COALESCE(preco_venda, 0) as preco_venda, 
                        COALESCE(estoque_atual, 0) as estoque_atual,
                        COALESCE(localizacao, '') as local_estoque,
                        COALESCE(gtin, '') as ean,
                        COALESCE(aliquota_ipi, 0) as aliquota_ipi,
                        COALESCE(calcular_ipi, 0) as calcular_ipi,
                        COALESCE(aliquota_icms, 0) as aliquota_icms,
                        COALESCE(calcular_icms_st, 0) as calcular_icms_st,
                        COALESCE(mva_st, 0) as mva_st,
                        COALESCE(ncm, '') as ncm
                 FROM produtos
                 WHERE COALESCE(ativo, 1) = 1 
                   AND (codigo LIKE ? OR COALESCE(descricao,'') LIKE ? OR COALESCE(nome,'') LIKE ? OR COALESCE(gtin,'') LIKE ?)
                 ORDER BY
                    CASE
                        WHEN codigo = ? THEN 1
                        WHEN codigo LIKE ? THEN 2
                        ELSE 3
                    END,
                    COALESCE(NULLIF(TRIM(descricao),''), nome) ASC
                 LIMIT ?`,
                [`%${termo}%`, `%${termo}%`, `%${termo}%`, `%${termo}%`, termo, `${termo}%`, limit]
            );
            return res.json(rows);
        } catch (error) {
            console.error('[Vendas] Autocomplete error:', error.code, error.message);
            if (error.code === 'ER_NO_SUCH_TABLE') return res.json([]);
            // Fallback ultra-seguro: apenas colunas básicas que certamente existem
            if (error.code === 'ER_BAD_FIELD_ERROR') {
                try {
                    const { termo } = req.params;
                    const limit = parseInt(req.query.limit) || 15;
                    const [rows] = await pool.query(
                        `SELECT id, codigo, COALESCE(NULLIF(TRIM(descricao),''), nome, codigo) as descricao, COALESCE(nome, codigo) as nome
                         FROM produtos
                         WHERE codigo LIKE ? OR COALESCE(descricao,'') LIKE ? OR COALESCE(nome,'') LIKE ?
                         ORDER BY COALESCE(NULLIF(TRIM(descricao),''), nome) ASC
                         LIMIT ?`,
                        [`%${termo}%`, `%${termo}%`, `%${termo}%`, limit]
                    );
                    return res.json(rows);
                } catch (e2) {
                    console.error('[Vendas] Autocomplete fallback error:', e2.message);
                    return res.json([]);
                }
            }
            next(error);
        }
    });

    // Buscar dados fiscais de um produto específico (para cálculo de IPI/ICMS ST)
    router.get('/produtos/:id/fiscal', async (req, res, next) => {
        try {
            const { id } = req.params;
            const [rows] = await pool.query(
                `SELECT id, codigo,
                        COALESCE(NULLIF(TRIM(descricao),''), nome, codigo) as descricao,
                        COALESCE(aliquota_ipi, 0) as aliquota_ipi,
                        COALESCE(calcular_ipi, 0) as calcular_ipi,
                        COALESCE(aliquota_icms, 0) as aliquota_icms,
                        COALESCE(calcular_icms_st, 0) as calcular_icms_st,
                        COALESCE(mva_st, 0) as mva_st,
                        COALESCE(ncm, '') as ncm,
                        COALESCE(cst_icms, '') as cst_icms,
                        COALESCE(cst_ipi, '') as cst_ipi,
                        COALESCE(aliquota_pis, 0) as aliquota_pis,
                        COALESCE(aliquota_cofins, 0) as aliquota_cofins
                 FROM produtos WHERE id = ?`, [id]
            );
            if (rows.length === 0) return res.status(404).json({ message: 'Produto não encontrado' });
            res.json(rows[0]);
        } catch (error) {
            next(error);
        }
    });

    // Atualizar impostos de todos os itens de um pedido
    router.post('/pedidos/:id/atualizar-impostos', async (req, res, next) => {
        try {
            const { id } = req.params;
            const { cenario_fiscal } = req.body;

            // Buscar itens do pedido
            const [itens] = await pool.query(
                'SELECT id, codigo, produto_id, quantidade, preco_unitario, desconto FROM pedido_itens WHERE pedido_id = ?',
                [id]
            );

            if (itens.length === 0) return res.json({ message: 'Nenhum item para atualizar', itens: [] });

            let totalIPI = 0;
            let totalICMSST = 0;
            const itensAtualizados = [];

            for (const item of itens) {
                // Buscar dados fiscais do produto pelo código ou produto_id
                let produto = null;
                if (item.produto_id) {
                    const [prods] = await pool.query(
                        'SELECT aliquota_ipi, calcular_ipi, aliquota_icms, calcular_icms_st, mva_st FROM produtos WHERE id = ?',
                        [item.produto_id]
                    );
                    if (prods.length > 0) produto = prods[0];
                }
                if (!produto && item.codigo) {
                    const [prods] = await pool.query(
                        'SELECT id, aliquota_ipi, calcular_ipi, aliquota_icms, calcular_icms_st, mva_st FROM produtos WHERE codigo = ?',
                        [item.codigo]
                    );
                    if (prods.length > 0) produto = prods[0];
                }

                const subtotal = (parseFloat(item.quantidade) * parseFloat(item.preco_unitario)) - parseFloat(item.desconto || 0);
                let valorIPI = 0;
                let valorICMSST = 0;

                if (produto) {
                    // Calcular IPI
                    const aliqIPI = parseFloat(produto.aliquota_ipi) || 0;
                    if (aliqIPI > 0) {
                        valorIPI = subtotal * (aliqIPI / 100);
                    }

                    // Calcular ICMS ST (se calcular_icms_st = 1)
                    const calcST = parseInt(produto.calcular_icms_st) || 0;
                    const mvaST = parseFloat(produto.mva_st) || 0;
                    const aliqICMS = parseFloat(produto.aliquota_icms) || 0;
                    if (calcST && mvaST > 0 && aliqICMS > 0) {
                        const baseICMSST = subtotal * (1 + mvaST / 100);
                        const icmsST = (baseICMSST * aliqICMS / 100) - (subtotal * aliqICMS / 100);
                        valorICMSST = Math.max(0, icmsST);
                    }
                }

                totalIPI += valorIPI;
                totalICMSST += valorICMSST;

                itensAtualizados.push({
                    id: item.id,
                    valor_ipi: valorIPI,
                    valor_icms_st: valorICMSST,
                    aliquota_ipi: produto ? parseFloat(produto.aliquota_ipi) || 0 : 0,
                    produto_id: produto ? produto.id || item.produto_id : item.produto_id
                });
            }

            // Salvar valores de impostos em cada item do pedido
            for (const itemCalc of itensAtualizados) {
                await pool.query(
                    'UPDATE pedido_itens SET valor_ipi = ?, valor_icms_st = ?, aliquota_ipi = ?, produto_id = COALESCE(?, produto_id) WHERE id = ?',
                    [itemCalc.valor_ipi, itemCalc.valor_icms_st, itemCalc.aliquota_ipi, itemCalc.produto_id, itemCalc.id]
                );
            }

            // Atualizar totais no pedido
            await pool.query(
                'UPDATE pedidos SET total_ipi = ?, total_icms_st = ? WHERE id = ?',
                [totalIPI, totalICMSST, id]
            );

            res.json({
                message: 'Impostos atualizados com sucesso!',
                total_ipi: totalIPI,
                total_icms_st: totalICMSST,
                itens: itensAtualizados
            });
        } catch (error) {
            console.error('[Vendas] Erro ao atualizar impostos:', error);
            next(error);
        }
    });
    
    // GET /transportadoras - Buscar transportadoras para o módulo de vendas
    router.get('/transportadoras', async (req, res, next) => {
        try {
            const _dec = lgpdCrypto ? lgpdCrypto.decryptPII : (v => v);
            const [rows] = await pool.query(`
                SELECT id, nome_fantasia, razao_social, cnpj_cpf, inscricao_estadual, telefone, email, cidade, estado, cep
                FROM transportadoras
                ORDER BY COALESCE(nome_fantasia, razao_social)
                LIMIT 100
            `);
            const resultado = rows.map(r => ({
                id: r.id,
                nome: r.nome_fantasia || r.razao_social || '',
                razao_social: r.razao_social || '',
                nome_fantasia: r.nome_fantasia || '',
                cnpj: _dec(r.cnpj_cpf || ''),
                inscricao_estadual: _dec(r.inscricao_estadual || ''),
                telefone: r.telefone || '',
                email: r.email || '',
                cidade: r.cidade || '',
                uf: r.estado || '',
                cep: r.cep || ''
            }));
            res.json(resultado);
        } catch (error) {
            if (error.code === 'ER_NO_SUCH_TABLE') {
                return res.json([]);
            }
            console.error('❌ Erro ao buscar transportadoras:', error);
            next(error);
        }
    });
    
    // GET /vendedores - Lista vendedores para filtros e dashboards
    router.get('/vendedores', async (req, res, next) => {
        try {
            // Buscar vendedores comerciais ativos
            const [rows] = await pool.query(`
                SELECT id, nome, email, apelido, avatar, foto, role
                FROM usuarios
                WHERE (role = 'comercial' OR role = 'vendedor' OR departamento = 'Comercial' OR departamento = 'Vendas')
                  AND (ativo = 1 OR ativo IS NULL)
                ORDER BY nome ASC
            `);
    
            if (rows.length === 0) {
                // Fallback - buscar todos usuários que podem vender
                const [fallback] = await pool.query(`
                    SELECT id, nome, email, apelido, avatar, foto, role
                    FROM usuarios
                    WHERE ativo = 1 OR ativo IS NULL
                    ORDER BY nome ASC
                    LIMIT 20
                `);
                return res.json(fallback);
            }
    
            res.json(rows);
        } catch (error) {
            console.error('❌ Erro ao buscar vendedores:', error);
            // Fallback em caso de erro
            res.json([]);
        }
    });
    
    // GET /leads - Lista leads de prospecção
    router.get('/leads', async (req, res, next) => {
        try {
            const { status, vendedor_id, search, limit = 50, offset = 0 } = req.query;
    
            let where = '1=1';
            let params = [];
    
            if (status) {
                where += ' AND status = ?';
                params.push(status);
            }
    
            if (vendedor_id) {
                where += ' AND vendedor_id = ?';
                params.push(vendedor_id);
            }
    
            if (search) {
                where += ' AND (razao_social LIKE ? OR nome_fantasia LIKE ? OR cnpj LIKE ? OR email LIKE ?)';
                const searchTerm = `%${search}%`;
                params.push(searchTerm, searchTerm, searchTerm, searchTerm);
            }
    
            params.push(parseInt(limit), parseInt(offset));
    
            const [rows] = await pool.query(`
                SELECT l.*, u.nome as vendedor_nome
                FROM leads_prospeccao l
                LEFT JOIN usuarios u ON l.vendedor_id = u.id
                WHERE ${where}
                ORDER BY l.created_at DESC
                LIMIT ? OFFSET ?
            `, params);
    
            // Total para paginação
            const [countResult] = await pool.query(`
                SELECT COUNT(*) as total FROM leads_prospeccao WHERE ${where.replace(' LIMIT ? OFFSET ?', '')}
            `, params.slice(0, -2));
    
            res.json({
                leads: rows,
                total: countResult[0]?.total || 0,
                limit: parseInt(limit),
                offset: parseInt(offset)
            });
        } catch (error) {
            // Retornar lista vazia se a tabela não existir
            if (error.code === 'ER_NO_SUCH_TABLE') {
                return res.json({ leads: [], total: 0, limit: 50, offset: 0 });
            }
            console.error('❌ Erro ao buscar leads:', error);
            next(error);
        }
    });
    
    // GET /leads/:id - Detalhes de um lead
    router.get('/leads/:id', async (req, res, next) => {
        try {
            const { id } = req.params;
            const [rows] = await pool.query(`
                SELECT l.*, u.nome as vendedor_nome
                FROM leads_prospeccao l
                LEFT JOIN usuarios u ON l.vendedor_id = u.id
                WHERE l.id = ?
            `, [id]);
    
            if (rows.length === 0) {
                return res.status(404).json({ error: 'Lead não encontrado' });
            }
    
            res.json(rows[0]);
        } catch (error) {
            console.error('❌ Erro ao buscar lead:', error);
            next(error);
        }
    });
    
    // POST /leads - Criar novo lead
    router.post('/leads', async (req, res, next) => {
        try {
            const data = req.body;
            const vendedor_id = req.user?.id || null;
    
            const [result] = await pool.query(`
                INSERT INTO leads_prospeccao (
                    razao_social, nome_fantasia, cnpj, telefone, email,
                    cidade, uf, endereco, status, origem, vendedor_id, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
            `, [
                data.razao_social,
                data.nome_fantasia || null,
                data.cnpj || null,
                data.telefone || null,
                data.email || null,
                data.cidade || null,
                data.uf || null,
                data.endereco || null,
                data.status || 'novo',
                data.origem || 'manual',
                vendedor_id
            ]);
    
            res.status(201).json({ id: result.insertId, message: 'Lead criado com sucesso' });
        } catch (error) {
            console.error('❌ Erro ao criar lead:', error);
            next(error);
        }
    });
    
    // PUT /leads/:id - Atualizar lead
    router.put('/leads/:id', async (req, res, next) => {
        try {
            const { id } = req.params;
            const data = req.body;
    
            const fields = [];
            const values = [];
    
            const allowedFields = ['razao_social', 'nome_fantasia', 'cnpj', 'telefone', 'email',
                'cidade', 'uf', 'endereco', 'status', 'origem', 'vendedor_id', 'observacoes'];
    
            for (const field of allowedFields) {
                if (data[field] !== undefined) {
                    fields.push(`${field} = ?`);
                    values.push(data[field]);
                }
            }
    
            if (fields.length === 0) {
                return res.status(400).json({ error: 'Nenhum campo para atualizar' });
            }
    
            fields.push('updated_at = NOW()');
            values.push(id);
    
            await pool.query(`UPDATE leads_prospeccao SET ${fields.join(', ')} WHERE id = ?`, values);
    
            res.json({ message: 'Lead atualizado com sucesso' });
        } catch (error) {
            console.error('❌ Erro ao atualizar lead:', error);
            next(error);
        }
    });
    
    // DELETE /leads/:id - Excluir lead
    router.delete('/leads/:id', async (req, res, next) => {
        try {
            const { id } = req.params;
            await pool.query('DELETE FROM leads_prospeccao WHERE id = ?', [id]);
            res.json({ message: 'Lead excluído com sucesso' });
        } catch (error) {
            console.error('❌ Erro ao excluir lead:', error);
            next(error);
        }
    });
    
    // GET /condicoes-pagamento - Listar condições de pagamento
    router.get('/condicoes-pagamento', async (req, res, next) => {
        try {
            // Tentar buscar da tabela condicoes_pagamento
            try {
                const [rows] = await pool.query(`
                    SELECT id, nome, dias, descricao, ativo
                    FROM condicoes_pagamento
                    WHERE ativo = 1 OR ativo IS NULL
                    ORDER BY nome
                `);
                return res.json(rows);
            } catch (tableErr) {
                // Tabela não existe ou erro de coluna - retornar condições padrão
                if (tableErr.code === 'ER_NO_SUCH_TABLE' || tableErr.code === 'ER_BAD_FIELD_ERROR') {
                    return res.json([
                        { id: 1, nome: 'À Vista', descricao: 'Pagamento à vista', dias: '0' },
                        { id: 2, nome: '30 dias', descricao: 'Pagamento em 30 dias', dias: '30' },
                        { id: 3, nome: '30/60', descricao: '2x - 30/60 dias', dias: '30,60' },
                        { id: 4, nome: '30/60/90', descricao: '3x - 30/60/90 dias', dias: '30,60,90' },
                        { id: 5, nome: '30/60/90/120', descricao: '4x - 30/60/90/120 dias', dias: '30,60,90,120' },
                        { id: 6, nome: 'Entrada + 30', descricao: 'Entrada + 30 dias', dias: '0,30' },
                        { id: 7, nome: 'Entrada + 30/60', descricao: 'Entrada + 30/60 dias', dias: '0,30,60' }
                    ]);
                }
                throw tableErr;
            }
        } catch (error) {
            console.error('❌ Erro ao buscar condições de pagamento:', error);
            next(error);
        }
    });
    
    // POST /condicoes-pagamento - Criar nova condição de pagamento
    router.post('/condicoes-pagamento', async (req, res, next) => {
        try {
            const { nome, dias, descricao } = req.body;
            if (!nome) {
                return res.status(400).json({ message: 'Nome da condição é obrigatório' });
            }

            // Garantir que a tabela existe
            try {
                await pool.query(`
                    CREATE TABLE IF NOT EXISTS condicoes_pagamento (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        nome VARCHAR(100) NOT NULL,
                        dias VARCHAR(100) DEFAULT '0',
                        descricao VARCHAR(255) DEFAULT '',
                        ativo TINYINT(1) DEFAULT 1,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                `);
            } catch (e) { /* tabela já existe */ }

            const [result] = await pool.query(
                'INSERT INTO condicoes_pagamento (nome, dias, descricao) VALUES (?, ?, ?)',
                [nome, dias || '0', descricao || '']
            );

            res.status(201).json({ 
                id: result.insertId, 
                nome, 
                dias: dias || '0', 
                descricao: descricao || '',
                message: 'Condição de pagamento criada com sucesso' 
            });
        } catch (error) {
            console.error('❌ Erro ao criar condição de pagamento:', error);
            next(error);
        }
    });

    // ========================================
    // ROTAS DE HISTÓRICO (SEM AUTENTICAÇÃO OBRIGATÓRIA)
    // Definidas ANTES do apiVendasRouter para ter prioridade
    // ========================================
    router.get('/pedidos/:id/historico', async (req, res) => {
        try {
            const { id } = req.params;
    
            // Verificar se tabela existe
            try {
                const [tables] = await pool.query("SHOW TABLES LIKE 'pedido_historico'");
                if (tables.length === 0) {
                    return res.json([]);
                }
            } catch (e) {
                return res.json([]);
            }
    
            // Verificar estrutura da tabela e usar colunas corretas
            try {
                // Tentar primeiro com nomes padrão user_id/user_name
                const [historico] = await pool.query(`
                    SELECT id, pedido_id,
                           COALESCE(user_id, usuario_id) as user_id,
                           COALESCE(user_name, usuario_nome) as user_name,
                           COALESCE(action, acao) as action,
                           descricao, meta, created_at
                    FROM pedido_historico
                    WHERE pedido_id = ?
                    ORDER BY created_at DESC
                    LIMIT 100
                `, [id]);
    
                res.json(historico);
            } catch (e) {
                // Se falhar, usar SELECT * e mapear
                try {
                    const [historico] = await pool.query(`
                        SELECT * FROM pedido_historico
                        WHERE pedido_id = ?
                        ORDER BY created_at DESC
                        LIMIT 100
                    `, [id]);
                    res.json(historico);
                } catch (e2) {
                    console.error('❌ Erro ao buscar histórico:', e2);
                    res.json([]);
                }
            }
        } catch (error) {
            console.error('❌ Erro ao buscar histórico:', error);
            res.json([]);
        }
    });
    
    router.post('/pedidos/:id/historico', async (req, res) => {
        try {
            const { id } = req.params;
            const { action, descricao, meta, usuario } = req.body;
    
            // AUDIT-FIX ARCH-002: Removed duplicate CREATE TABLE pedido_historico (already in apiVendasRouter)
    
            await pool.query(
                'INSERT INTO pedido_historico (pedido_id, user_id, user_name, action, descricao, meta) VALUES (?, ?, ?, ?, ?, ?)',
                [id, null, usuario || 'Sistema', action || 'manual', descricao || '', meta ? JSON.stringify(meta) : null]
            );
    
            res.status(201).json({ message: 'Histórico registrado com sucesso!' });
        } catch (error) {
            console.error('❌ Erro ao registrar histórico:', error);
            res.status(500).json({ message: 'Erro ao registrar histórico' });
        }
    });
    
    // =====================================================
    // FATURAMENTO PARCIAL (F9) - ENTREGA FUTURA
    // =====================================================
    
    async function ensureFaturamentoParcialTables() {
        try {
            const [cols] = await pool.query(`SHOW COLUMNS FROM pedidos LIKE 'tipo_faturamento'`);
            if (cols.length === 0) {
                await pool.query(`
                    ALTER TABLE pedidos
                    ADD COLUMN tipo_faturamento ENUM('normal','parcial_50','entrega_futura','consignado') DEFAULT 'normal',
                    ADD COLUMN percentual_faturado DECIMAL(5,2) DEFAULT 0,
                    ADD COLUMN valor_faturado DECIMAL(15,2) DEFAULT 0,
                    ADD COLUMN valor_pendente DECIMAL(15,2) DEFAULT 0,
                    ADD COLUMN estoque_baixado TINYINT(1) DEFAULT 0,
                    ADD COLUMN nfe_faturamento_numero VARCHAR(50) NULL,
                    ADD COLUMN nfe_faturamento_cfop VARCHAR(10) DEFAULT '5922',
                    ADD COLUMN nfe_remessa_numero VARCHAR(50) NULL,
                    ADD COLUMN nfe_remessa_cfop VARCHAR(10) DEFAULT '5117'
                `);
            }
            await pool.query(`
                CREATE TABLE IF NOT EXISTS pedido_faturamentos (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    pedido_id INT NOT NULL,
                    sequencia INT NOT NULL DEFAULT 1,
                    tipo ENUM('faturamento','remessa','complementar') NOT NULL,
                    percentual DECIMAL(5,2) NOT NULL,
                    valor DECIMAL(15,2) NOT NULL,
                    nfe_numero VARCHAR(50) NULL,
                    nfe_chave VARCHAR(50) NULL,
                    nfe_cfop VARCHAR(10) NULL,
                    nfe_status ENUM('pendente','autorizada','cancelada','denegada') DEFAULT 'pendente',
                    baixa_estoque TINYINT(1) DEFAULT 0,
                    conta_receber_id INT NULL,
                    usuario_id INT NULL,
                    usuario_nome VARCHAR(100) NULL,
                    observacoes TEXT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_pedido_id (pedido_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            `);
        } catch (e) {
            console.warn('[FATURAMENTO_PARCIAL] Erro ao garantir tabelas:', e.message);
        }
    }
    
    async function registrarHistoricoPedido(pedidoId, userId, userName, action, descricao, meta) {
        try {
            await pool.query(
                'INSERT INTO pedido_historico (pedido_id, user_id, user_name, action, descricao, meta) VALUES (?, ?, ?, ?, ?, ?)',
                [pedidoId, userId || null, userName || 'Sistema', action, descricao, meta ? JSON.stringify(meta) : null]
            );
        } catch (e) {
            console.warn('[HISTORICO] Erro:', e.message);
        }
    }
    
    router.get('/faturamento/cfops', async (req, res, next) => {
        try {
            res.json({
                faturamento: {
                    dentro_estado: { cfop: '5922', descricao: 'Simples Faturamento - Operacao Interna' },
                    fora_estado: { cfop: '6922', descricao: 'Simples Faturamento - Operacao Interestadual' },
                    zona_franca: { cfop: '7922', descricao: 'Simples Faturamento - Zona Franca de Manaus' }
                },
                remessa: {
                    dentro_estado: { cfop: '5117', descricao: 'Remessa Entrega Futura - Operacao Interna' },
                    fora_estado: { cfop: '6117', descricao: 'Remessa Entrega Futura - Operacao Interestadual' },
                    zona_franca: { cfop: '7117', descricao: 'Remessa Entrega Futura - Zona Franca de Manaus' }
                },
                normal: {
                    dentro_estado: { cfop: '5102', descricao: 'Venda Mercadoria - Operacao Interna' },
                    fora_estado: { cfop: '6102', descricao: 'Venda Mercadoria - Operacao Interestadual' },
                    zona_franca: { cfop: '7102', descricao: 'Venda Mercadoria - Zona Franca de Manaus' }
                },
                suframa: {
                    info: 'UFs Zona Franca: AM, RR, AP, AC, RO',
                    nota: 'Para vendas a Zona Franca de Manaus, usar CFOPs 7xxx com isencao de ICMS/IPI conforme Decreto 288/67'
                }
            });
        } catch (error) { next(error); }
    });
    
    router.post('/pedidos/:id/faturamento-parcial', async (req, res, next) => {
        // AUDIT-FIX R-07 + R-11: Transação completa com lock para evitar NF-e duplicada
        // FIX-2026-02-24: gerarNFe=true, faturamento por item, numeração unificada, validação estoque, CFOP inteligente
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            await ensureFaturamentoParcialTables();
            const { id } = req.params;
            const {
                tipo_faturamento = 'parcial_50',
                percentual = 50,
                cfop: cfopManual,
                gerarNFe = true,
                gerarFinanceiro = true,
                observacoes = '',
                itens_faturar = null
            } = req.body;
            const user = req.user || {};
    
            // Lock do pedido para evitar faturamento concorrente
            const [pedidoRows] = await connection.query('SELECT p.*, c.estado as cliente_uf, e.estado as empresa_uf FROM pedidos p LEFT JOIN clientes c ON p.cliente_id = c.id LEFT JOIN empresas e ON p.empresa_id = e.id WHERE p.id = ? FOR UPDATE', [id]);
            if (pedidoRows.length === 0) { await connection.rollback(); connection.release(); return res.status(404).json({ success: false, message: 'Pedido nao encontrado.' }); }
    
            const pedido = pedidoRows[0];
            if (pedido.status === 'cancelado') { await connection.rollback(); connection.release(); return res.status(400).json({ success: false, message: 'Nao e possivel faturar pedido cancelado.' }); }
            if (pedido.percentual_faturado >= 100) { await connection.rollback(); connection.release(); return res.status(400).json({ success: false, message: 'Pedido ja esta 100% faturado.' }); }
    
            const valorTotal = parseFloat(pedido.valor) || 0;
            let percentualFaturar, valorFaturar;
    
            // FIX-5: Faturamento por item — se itens_faturar é fornecido, calcular valor a partir dos itens
            if (itens_faturar && Array.isArray(itens_faturar) && itens_faturar.length > 0) {
                // Buscar itens do pedido para validação
                const [itensPedido] = await connection.query(`
                    SELECT pi.*, p.descricao as produto_descricao, p.estoque_atual,
                        COALESCE((SELECT SUM(nfi.quantidade) FROM nfe_itens nfi INNER JOIN nfe n ON nfi.nfe_id = n.id WHERE n.pedido_id = pi.pedido_id AND nfi.produto_id = pi.produto_id AND n.status != 'cancelada'), 0) as qtd_ja_faturada
                    FROM pedido_itens pi
                    INNER JOIN produtos p ON pi.produto_id = p.id
                    WHERE pi.pedido_id = ?
                `, [id]);
    
                // Validar cada item
                valorFaturar = 0;
                const problemas = [];
                for (const itemFat of itens_faturar) {
                    const itemPedido = itensPedido.find(i => i.produto_id === itemFat.produto_id);
                    if (!itemPedido) {
                        problemas.push(`Produto ID ${itemFat.produto_id} nao encontrado no pedido`);
                        continue;
                    }
                    const qtdRestante = parseFloat(itemPedido.quantidade) - parseFloat(itemPedido.qtd_ja_faturada);
                    if (parseFloat(itemFat.quantidade) > qtdRestante) {
                        problemas.push(`Produto ${itemPedido.produto_descricao}: solicitado ${itemFat.quantidade}, disponivel ${qtdRestante}`);
                    }
                    // Validar estoque disponível
                    if (parseFloat(itemPedido.estoque_atual || 0) < parseFloat(itemFat.quantidade)) {
                        problemas.push(`Produto ${itemPedido.produto_descricao}: estoque insuficiente (${itemPedido.estoque_atual || 0} disponivel, ${itemFat.quantidade} solicitado)`);
                    }
                    valorFaturar += parseFloat(itemFat.quantidade) * parseFloat(itemPedido.preco_unitario || 0);
                }
    
                if (problemas.length > 0) {
                    await connection.rollback(); connection.release();
                    return res.status(400).json({ success: false, message: 'Validacao falhou', problemas });
                }
    
                percentualFaturar = valorTotal > 0 ? Math.round((valorFaturar / valorTotal) * 10000) / 100 : 0;
                percentualFaturar = Math.min(percentualFaturar, 100 - (parseFloat(pedido.percentual_faturado) || 0));
            } else {
                // Modo percentual (legado)
                percentualFaturar = Math.min(parseFloat(percentual), 100 - (parseFloat(pedido.percentual_faturado) || 0));
                valorFaturar = Math.round((valorTotal * percentualFaturar) / 100 * 100) / 100;
            }
    
            // CFOP inteligente via serviço compartilhado
            const ufEmpresa = (pedido.empresa_uf || 'MG').toUpperCase();
            const ufCliente = (pedido.cliente_uf || pedido.estado || '').toUpperCase();
            const tipoOp = (tipo_faturamento === 'normal' || percentualFaturar >= 100) ? 'venda' : 'faturamento';
            const cfopResult = await faturamentoShared.determinarCFOP(tipoOp, ufEmpresa, ufCliente, cfopManual);
            const cfop = cfopResult.cfop;
    
            // Numeração unificada via serviço compartilhado (verifica nfe + pedidos faturamento + pedidos remessa)
            const nfNumero = await faturamentoShared.gerarProximoNumeroNFe(connection);
            const novoNfNumero = nfNumero.numero;
    
            const novoPercentualFaturado = Math.round(((parseFloat(pedido.percentual_faturado) || 0) + percentualFaturar) * 100) / 100;
            const novoValorFaturado = Math.round(((parseFloat(pedido.valor_faturado) || 0) + valorFaturar) * 100) / 100;
            const novoStatus = novoPercentualFaturado >= 100 ? 'faturado' : 'parcial';
    
            await connection.query(`
                UPDATE pedidos SET tipo_faturamento = ?, percentual_faturado = ?, valor_faturado = ?,
                    valor_pendente = ? - ?, nfe_faturamento_numero = ?, nfe_faturamento_cfop = ?,
                    status = ?, data_faturamento = IF(data_faturamento IS NULL, NOW(), data_faturamento)
                WHERE id = ?
            `, [tipo_faturamento, novoPercentualFaturado, novoValorFaturado, valorTotal, novoValorFaturado, novoNfNumero, cfop, novoStatus, id]);
    
            // Calcular sequência corretamente
            const [seqRows] = await connection.query('SELECT COALESCE(MAX(sequencia), 0) + 1 as proxSeq FROM pedido_faturamentos WHERE pedido_id = ?', [id]);
            const proxSeq = seqRows[0].proxSeq;
    
            const [fatResult] = await connection.query(`
                INSERT INTO pedido_faturamentos (pedido_id, sequencia, tipo, percentual, valor, nfe_numero, nfe_cfop, baixa_estoque, usuario_id, usuario_nome, observacoes)
                VALUES (?, ?, 'faturamento', ?, ?, ?, ?, 0, ?, ?, ?)
            `, [id, proxSeq, percentualFaturar, valorFaturar, novoNfNumero, cfop, user.id || null, user.nome || 'Sistema', observacoes]);
    
            await registrarHistoricoPedido(id, user.id, user.nome || 'Sistema', 'faturamento_parcial',
                `Faturamento Parcial (${percentualFaturar}%) - NF ${novoNfNumero} - CFOP ${cfop} - R$ ${valorFaturar.toFixed(2)}`,
                { tipo: 'faturamento', percentual: percentualFaturar, valor: valorFaturar, nf_numero: novoNfNumero, cfop, baixa_estoque: false, itens_faturar: itens_faturar || 'percentual' });
    
            let contaReceberId = null;
            if (gerarFinanceiro) {
                try {
                    // Vencimento inteligente: usa condicao_pagamento do pedido, ou prazo padrão do config
                    const contaResult = await faturamentoShared.gerarContaReceber(connection, {
                        pedido_id: id,
                        cliente_id: pedido.cliente_id || pedido.empresa_id,
                        descricao: `Faturamento ${percentualFaturar}% - Pedido #${id}`,
                        valor: valorFaturar,
                        tipo: 'faturamento_parcial',
                        pedido: pedido
                    });
                    contaReceberId = contaResult.insertId;
                    await connection.query('UPDATE pedido_faturamentos SET conta_receber_id = ? WHERE id = ?', [contaReceberId, fatResult.insertId]);
                } catch (finErr) { console.warn('[FATURAMENTO_PARCIAL] Erro financeiro:', finErr.message); }
            }
    
            await connection.commit();
            connection.release();
    
            res.json({
                success: true,
                message: `Faturamento parcial de ${percentualFaturar}% realizado com sucesso!`,
                dados: {
                    pedido_id: id, nf_numero: novoNfNumero, cfop,
                    percentual_faturado: novoPercentualFaturado, valor_faturado: novoValorFaturado,
                    valor_pendente: Math.round((valorTotal - novoValorFaturado) * 100) / 100, baixa_estoque: false,
                    conta_receber_id: contaReceberId,
                    modo: itens_faturar ? 'por_item' : 'percentual',
                    proximo_passo: novoPercentualFaturado < 100 ? 'Aguardando remessa para completar faturamento' : 'Faturamento completo'
                }
            });
        } catch (error) {
            try { await connection.rollback(); } catch (e) { /* ignore */ }
            try { connection.release(); } catch (e) { /* ignore */ }
            console.error('[FATURAMENTO_PARCIAL] Erro:', error);
            next(error);
        }
    });
    
    router.post('/pedidos/:id/remessa-entrega', async (req, res, next) => {
        // AUDIT-FIX R-07 + R-11: Transação completa com lock para NF-e remessa
        // FIX-2026-02-24: Rollback estoque, numeração unificada, sync estoque table, CFOP inteligente
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            await ensureFaturamentoParcialTables();
            const { id } = req.params;
            const { cfop: cfopManual, gerarNFe = true, gerarFinanceiro = true, baixarEstoque = true, observacoes = '' } = req.body;
            const user = req.user || {};
    
            // Lock do pedido com UF para CFOP inteligente
            const [pedidoRows] = await connection.query('SELECT p.*, c.estado as cliente_uf, e.estado as empresa_uf FROM pedidos p LEFT JOIN clientes c ON p.cliente_id = c.id LEFT JOIN empresas e ON p.empresa_id = e.id WHERE p.id = ? FOR UPDATE', [id]);
            if (pedidoRows.length === 0) { await connection.rollback(); connection.release(); return res.status(404).json({ success: false, message: 'Pedido nao encontrado.' }); }
    
            const pedido = pedidoRows[0];
            if (pedido.estoque_baixado === 1) { await connection.rollback(); connection.release(); return res.status(400).json({ success: false, message: 'Estoque ja foi baixado para este pedido.' }); }
            if (pedido.tipo_faturamento === 'normal') { await connection.rollback(); connection.release(); return res.status(400).json({ success: false, message: 'Este pedido nao e de faturamento parcial.' }); }
    
            const valorTotal = parseFloat(pedido.valor) || 0;
            const valorFaturado = parseFloat(pedido.valor_faturado) || 0;
            const valorRestante = Math.round((valorTotal - valorFaturado) * 100) / 100;
            const percentualRestante = Math.round((100 - (parseFloat(pedido.percentual_faturado) || 0)) * 100) / 100;
    
            // FIX-6: Validar estoque ANTES de baixar — rollback se insuficiente
            if (baixarEstoque) {
                const [itensCheck] = await connection.query('SELECT pi.produto_id, pi.quantidade, p.descricao, p.estoque_atual FROM pedido_itens pi INNER JOIN produtos p ON pi.produto_id = p.id WHERE pi.pedido_id = ?', [id]);
                const estoqueProblemas = [];
                for (const item of itensCheck) {
                    const estAtual = parseFloat(item.estoque_atual) || 0;
                    const qtdNecessaria = parseFloat(item.quantidade) || 0;
                    if (estAtual < qtdNecessaria) {
                        estoqueProblemas.push(`${item.descricao}: disponivel ${estAtual}, necessario ${qtdNecessaria} (faltam ${Math.round((qtdNecessaria - estAtual) * 100) / 100})`);
                    }
                }
                if (estoqueProblemas.length > 0) {
                    await connection.rollback(); connection.release();
                    return res.status(400).json({ success: false, message: 'Estoque insuficiente para remessa. Transação abortada.', problemas: estoqueProblemas });
                }
            }
    
            // CFOP inteligente via serviço compartilhado
            const ufEmpresa = (pedido.empresa_uf || 'MG').toUpperCase();
            const ufCliente = (pedido.cliente_uf || '').toUpperCase();
            const cfopResult = await faturamentoShared.determinarCFOP('remessa', ufEmpresa, ufCliente, cfopManual);
            const cfop = cfopResult.cfop;
    
            // Numeração unificada via serviço compartilhado
            const nfNumero = await faturamentoShared.gerarProximoNumeroNFe(connection);
            const novoNfRemessa = nfNumero.numero;
    
            await connection.query(`
                UPDATE pedidos SET percentual_faturado = 100, valor_faturado = ?, valor_pendente = 0,
                    estoque_baixado = 1, data_baixa_estoque = NOW(), nfe_remessa_numero = ?,
                    nfe_remessa_cfop = ?, status = 'faturado', data_entrega_efetiva = NOW()
                WHERE id = ?
            `, [valorTotal, novoNfRemessa, cfop, id]);
    
            // Sequência correta de faturamentos
            const [seqRows] = await connection.query('SELECT COALESCE(MAX(sequencia), 0) + 1 as proxSeq FROM pedido_faturamentos WHERE pedido_id = ?', [id]);
            const proxSeq = seqRows[0].proxSeq;
    
            const [fatResult] = await connection.query(`
                INSERT INTO pedido_faturamentos (pedido_id, sequencia, tipo, percentual, valor, nfe_numero, nfe_cfop, baixa_estoque, usuario_id, usuario_nome, observacoes)
                VALUES (?, ?, 'remessa', ?, ?, ?, ?, 1, ?, ?, ?)
            `, [id, proxSeq, percentualRestante, valorRestante, novoNfRemessa, cfop, user.id || null, user.nome || 'Sistema', observacoes]);
    
            if (baixarEstoque) {
                const [itens] = await connection.query('SELECT produto_id, quantidade FROM pedido_itens WHERE pedido_id = ?', [id]);
                if (itens.length > 0) {
                    // Batch INSERT for estoque_movimentos
                    const movValues = itens.map(item => [
                        item.produto_id, item.quantidade, id, `Remessa pedido #${id}`, user.id || null
                    ]);
                    const movPlaceholders = movValues.map(() => "(?, 'saida', ?, 'remessa', ?, ?, ?)").join(', ');
                    await connection.query(
                        `INSERT INTO estoque_movimentos (produto_id, tipo, quantidade, referencia_tipo, referencia_id, observacoes, usuario_id) VALUES ${movPlaceholders}`,
                        movValues.flat()
                    );
                    // FIX-6: Estoque agora faz rollback se insuficiente (validado acima)
                    for (const item of itens) {
                        await connection.query(`UPDATE produtos SET estoque_atual = estoque_atual - ? WHERE id = ?`, [item.quantidade, item.produto_id]);
                    }
                    // FIX-2: Sync tabela estoque (Enterprise) se existir
                    try {
                        for (const item of itens) {
                            await connection.query(`UPDATE estoque SET quantidade_disponivel = GREATEST(0, quantidade_disponivel - ?) WHERE produto_id = ?`, [item.quantidade, item.produto_id]);
                        }
                    } catch (syncErr) { /* tabela estoque pode não existir ainda */ }
                }
            }
    
            await registrarHistoricoPedido(id, user.id, user.nome || 'Sistema', 'remessa_entrega',
                `Remessa/Entrega - NF ${novoNfRemessa} - CFOP ${cfop} - R$ ${valorRestante.toFixed(2)} - Estoque baixado`,
                { tipo: 'remessa', percentual: percentualRestante, valor: valorRestante, nf_numero: novoNfRemessa, cfop, baixa_estoque: true });
    
            let contaReceberId = null;
            if (gerarFinanceiro && valorRestante > 0) {
                try {
                    // Vencimento inteligente: usa condicao_pagamento do pedido, ou prazo padrão do config
                    const contaResult = await faturamentoShared.gerarContaReceber(connection, {
                        pedido_id: id,
                        cliente_id: pedido.cliente_id || pedido.empresa_id,
                        descricao: `Remessa/Entrega - Pedido #${id}`,
                        valor: valorRestante,
                        tipo: 'remessa_entrega',
                        pedido: pedido
                    });
                    contaReceberId = contaResult.insertId;
                    await connection.query('UPDATE pedido_faturamentos SET conta_receber_id = ? WHERE id = ?', [contaReceberId, fatResult.insertId]);
                } catch (finErr) { console.warn('[REMESSA] Erro financeiro:', finErr.message); }
            }
    
            await connection.commit();
            connection.release();
    
            res.json({
                success: true, message: 'Remessa/Entrega realizada com sucesso! Estoque baixado.',
                dados: { pedido_id: id, nf_remessa: novoNfRemessa, cfop, percentual_faturado: 100, valor_total: valorTotal, estoque_baixado: true, conta_receber_id: contaReceberId, status: 'Faturamento completo' }
            });
        } catch (error) {
            try { await connection.rollback(); } catch (e) { /* ignore */ }
            try { connection.release(); } catch (e) { /* ignore */ }
            console.error('[REMESSA] Erro:', error);
            next(error);
        }
    });
    
    router.get('/pedidos/:id/faturamento-status', async (req, res, next) => {
        try {
            await ensureFaturamentoParcialTables();
            const { id } = req.params;
    
            const [pedidoRows] = await pool.query(`SELECT p.*, e.nome_fantasia as empresa_nome, e.estado as empresa_uf, c.estado as cliente_uf FROM pedidos p LEFT JOIN empresas e ON p.empresa_id = e.id LEFT JOIN clientes c ON p.cliente_id = c.id WHERE p.id = ?`, [id]);
            if (pedidoRows.length === 0) return res.status(404).json({ success: false, message: 'Pedido nao encontrado.' });
    
            const pedido = pedidoRows[0];
            const [faturamentos] = await pool.query(`SELECT id, pedido_id, sequencia, tipo, valor, percentual, nfe_numero, nfe_chave, cfop, data_faturamento, status, observacoes, created_at FROM pedido_faturamentos WHERE pedido_id = ? ORDER BY sequencia ASC`, [id]);
    
            let proximaAcao = null, cfopSugerido = null;
            const ufClienteStatus = (pedido.cliente_uf || '').toUpperCase();
            const ufEmpresaStatus = (pedido.empresa_uf || 'MG').toUpperCase();
            // CFOP via serviço compartilhado (usa mapa centralizado com Zona Franca e interestadual)
            if (pedido.tipo_faturamento === 'normal' || !pedido.tipo_faturamento) {
                proximaAcao = 'faturamento_normal';
                const r = await faturamentoShared.determinarCFOP('venda', ufEmpresaStatus, ufClienteStatus);
                cfopSugerido = r.cfop;
            } else if (pedido.percentual_faturado < 100) {
                proximaAcao = 'aguardando_remessa';
                const r = await faturamentoShared.determinarCFOP('remessa', ufEmpresaStatus, ufClienteStatus);
                cfopSugerido = r.cfop;
            } else if (!pedido.estoque_baixado) {
                proximaAcao = 'aguardando_baixa_estoque';
                const r = await faturamentoShared.determinarCFOP('remessa', ufEmpresaStatus, ufClienteStatus);
                cfopSugerido = r.cfop;
            } else { proximaAcao = 'completo'; }
    
            res.json({
                success: true,
                pedido: { id: pedido.id, numero: pedido.numero, status: pedido.status, tipo_faturamento: pedido.tipo_faturamento || 'normal', valor_total: parseFloat(pedido.valor) || 0, percentual_faturado: parseFloat(pedido.percentual_faturado) || 0, valor_faturado: parseFloat(pedido.valor_faturado) || 0, valor_pendente: parseFloat(pedido.valor_pendente) || 0, estoque_baixado: pedido.estoque_baixado === 1, nfe_faturamento: pedido.nfe_faturamento_numero, nfe_remessa: pedido.nfe_remessa_numero, empresa_nome: pedido.empresa_nome, empresa_uf: pedido.empresa_uf },
                faturamentos, proxima_acao: proximaAcao, cfop_sugerido: cfopSugerido,
                resumo: { etapa_1: pedido.nfe_faturamento_numero ? 'concluido' : 'pendente', etapa_2: pedido.nfe_remessa_numero ? 'concluido' : 'pendente' }
            });
        } catch (error) { next(error); }
    });
    
    router.get('/faturamento/parciais-pendentes', async (req, res, next) => {
        try {
            await ensureFaturamentoParcialTables();
            const [rows] = await pool.query(`
                SELECT p.*, e.nome_fantasia as empresa_nome, u.nome as vendedor_nome
                FROM pedidos p LEFT JOIN empresas e ON p.empresa_id = e.id LEFT JOIN usuarios u ON p.vendedor_id = u.id
                WHERE p.tipo_faturamento IN ('parcial_50', 'entrega_futura') AND (p.percentual_faturado < 100 OR p.estoque_baixado = 0) AND p.status NOT IN ('cancelado', 'denegado')
                ORDER BY p.created_at DESC
            `);
            res.json({
                success: true, total: rows.length,
                pedidos: rows.map(p => ({ id: p.id, numero: p.numero, empresa: p.empresa_nome, vendedor: p.vendedor_nome, valor_total: parseFloat(p.valor) || 0, percentual_faturado: parseFloat(p.percentual_faturado) || 0, valor_pendente: parseFloat(p.valor_pendente) || 0, estoque_baixado: p.estoque_baixado === 1, proxima_acao: p.percentual_faturado < 100 ? 'Emitir Remessa' : 'Baixar Estoque', created_at: p.created_at }))
            });
        } catch (error) { next(error); }
    });
    
    // ============================================================
    // DANFE — Geração de Documento Auxiliar da NF-e
    // GET /api/vendas/pedidos/:id/danfe
    // ============================================================
    router.get('/pedidos/:id/danfe', authenticateToken, async (req, res, next) => {
        try {
            const { id } = req.params;

            // Buscar pedido completo com cliente e empresa
            const [[pedido]] = await pool.query(`
                SELECT p.*, p.valor as valor_total,
                       COALESCE(c.nome_fantasia, c.razao_social, c.nome) AS cliente_nome,
                       c.razao_social AS cliente_razao_social,
                       c.cnpj AS cliente_cnpj, c.cpf AS cliente_cpf,
                       c.email AS cliente_email, c.telefone AS cliente_telefone,
                       c.endereco AS cliente_endereco, c.bairro AS cliente_bairro,
                       c.cidade AS cliente_cidade, c.estado AS cliente_estado,
                       c.cep AS cliente_cep,
                       e.nome_fantasia AS empresa_nome, e.razao_social AS empresa_razao_social,
                       e.cnpj AS empresa_cnpj, e.inscricao_estadual AS empresa_ie,
                       e.endereco AS empresa_endereco, e.bairro AS empresa_bairro,
                       e.cidade AS empresa_cidade, e.estado AS empresa_uf, e.cep AS empresa_cep,
                       e.telefone AS empresa_telefone
                FROM pedidos p
                LEFT JOIN clientes c ON p.cliente_id = c.id
                LEFT JOIN empresas e ON p.empresa_id = e.id
                WHERE p.id = ?
            `, [id]);

            if (!pedido) {
                return res.status(404).json({ message: 'Pedido não encontrado' });
            }

            // Verificar se tem NF
            const nfNumero = pedido.nf || pedido.numero_nf;
            if (!nfNumero) {
                return res.status(404).json({ message: 'Este pedido não possui Nota Fiscal emitida' });
            }

            // Buscar itens do pedido
            let itens = [];
            try {
                const [rows] = await pool.query(
                    'SELECT codigo, descricao, quantidade, unidade, preco_unitario, desconto, subtotal FROM pedido_itens WHERE pedido_id = ? ORDER BY id ASC',
                    [id]
                );
                itens = rows;
            } catch (e) { /* tabela pode não existir */ }

            // Se não tem itens, tentar do preview
            if (itens.length === 0) {
                try {
                    itens = JSON.parse(pedido.produtos_preview || '[]').map(item => ({
                        codigo: item.codigo || '-',
                        descricao: item.descricao || item.nome || '-',
                        quantidade: parseFloat(item.quantidade) || 1,
                        unidade: item.unidade || 'UN',
                        preco_unitario: parseFloat(item.preco_unitario || item.valor_unitario || item.preco) || 0,
                        desconto: parseFloat(item.desconto) || 0,
                        subtotal: parseFloat(item.subtotal || item.total) || 0
                    }));
                } catch (e) { itens = []; }
            }

            const valorTotal = parseFloat(pedido.valor_total || pedido.valor) || 0;
            const frete = parseFloat(pedido.frete) || 0;
            const desconto = parseFloat(pedido.desconto) || 0;
            const clienteDoc = pedido.cliente_cnpj || pedido.cliente_cpf || '-';
            const dataFat = pedido.data_faturamento ? new Date(pedido.data_faturamento).toLocaleDateString('pt-BR') : new Date().toLocaleDateString('pt-BR');
            const horaFat = pedido.data_faturamento ? new Date(pedido.data_faturamento).toLocaleTimeString('pt-BR') : new Date().toLocaleTimeString('pt-BR');

            // Gerar HTML da DANFE
            const danfeHTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <title>DANFE - NF-e ${nfNumero} - Pedido #${id}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: Arial, sans-serif; font-size: 10px; color: #000; background: #fff; padding: 10mm; }
        .danfe { max-width: 210mm; margin: 0 auto; border: 2px solid #000; }
        .row { display: flex; border-bottom: 1px solid #000; }
        .row:last-child { border-bottom: none; }
        .cell { padding: 3px 5px; border-right: 1px solid #000; flex: 1; }
        .cell:last-child { border-right: none; }
        .cell label { font-size: 7px; color: #555; display: block; text-transform: uppercase; margin-bottom: 1px; }
        .cell span { font-size: 10px; font-weight: bold; display: block; }
        .header { display: flex; border-bottom: 2px solid #000; }
        .header-logo { width: 30%; padding: 8px; text-align: center; border-right: 1px solid #000; }
        .header-logo .empresa-nome { font-size: 14px; font-weight: bold; margin-bottom: 4px; }
        .header-logo .empresa-info { font-size: 8px; color: #333; }
        .header-danfe { width: 15%; padding: 8px; text-align: center; border-right: 1px solid #000; }
        .header-danfe h1 { font-size: 16px; }
        .header-danfe .subtit { font-size: 7px; margin-top: 2px; }
        .header-danfe .nf-num { font-size: 12px; font-weight: bold; margin-top: 5px; }
        .header-barcode { width: 55%; padding: 8px; text-align: center; }
        .header-barcode .chave { font-size: 8px; word-break: break-all; margin-top: 5px; font-family: monospace; }
        .section-title { background: #f0f0f0; padding: 3px 5px; font-weight: bold; font-size: 9px; border-bottom: 1px solid #000; }
        table { width: 100%; border-collapse: collapse; }
        table th { background: #f0f0f0; font-size: 8px; padding: 3px 5px; border: 1px solid #000; text-align: center; }
        table td { font-size: 9px; padding: 3px 5px; border: 1px solid #000; }
        table td.right { text-align: right; }
        table td.center { text-align: center; }
        .totais { display: flex; border-top: 2px solid #000; }
        .totais .cell { text-align: right; }
        .info-complementar { padding: 5px; font-size: 8px; min-height: 40px; border-top: 1px solid #000; }
        @media print { body { padding: 0; } .danfe { border: 2px solid #000; } }
        .no-print { text-align: center; margin: 15px 0; }
        @media print { .no-print { display: none; } }
    </style>
</head>
<body>
    <div class="no-print">
        <button onclick="window.print()" style="padding: 10px 30px; font-size: 14px; cursor: pointer; background: #2563eb; color: #fff; border: none; border-radius: 5px;">🖨️ Imprimir DANFE</button>
    </div>
    <div class="danfe">
        <!-- CABEÇALHO -->
        <div class="header">
            <div class="header-logo">
                <div class="empresa-nome">${pedido.empresa_razao_social || pedido.empresa_nome || 'EMPRESA'}</div>
                <div class="empresa-info">
                    ${pedido.empresa_endereco || ''} ${pedido.empresa_bairro ? ', ' + pedido.empresa_bairro : ''}<br>
                    ${pedido.empresa_cidade || ''} - ${pedido.empresa_uf || ''} | CEP: ${pedido.empresa_cep || ''}<br>
                    CNPJ: ${pedido.empresa_cnpj || '-'} | IE: ${pedido.empresa_ie || '-'}<br>
                    Tel: ${pedido.empresa_telefone || '-'}
                </div>
            </div>
            <div class="header-danfe">
                <h1>DANFE</h1>
                <div class="subtit">Documento Auxiliar da<br>Nota Fiscal Eletrônica</div>
                <div class="subtit" style="margin-top:3px">0 - ENTRADA<br><strong>1 - SAÍDA</strong></div>
                <div class="nf-num">Nº ${nfNumero}</div>
                <div class="subtit">SÉRIE 1</div>
            </div>
            <div class="header-barcode">
                <label style="font-size:7px;">CHAVE DE ACESSO</label>
                <div class="chave">${pedido.nfe_chave || pedido.chave_acesso || 'Chave não disponível - ambiente homologação'}</div>
                <div style="margin-top:8px; font-size:8px; padding:3px; border:1px solid #000;">
                    Consulta de autenticidade no portal nacional da NF-e<br>
                    www.nfe.fazenda.gov.br/portal
                </div>
            </div>
        </div>

        <!-- NATUREZA DA OPERAÇÃO -->
        <div class="row">
            <div class="cell" style="flex:3"><label>Natureza da Operação</label><span>Venda de Mercadoria</span></div>
            <div class="cell"><label>Protocolo de Autorização</label><span>${pedido.nfe_protocolo || 'Homologação'}</span></div>
        </div>

        <!-- DADOS DO EMITENTE -->
        <div class="section-title">DESTINATÁRIO / REMETENTE</div>
        <div class="row">
            <div class="cell" style="flex:3"><label>Nome/Razão Social</label><span>${pedido.cliente_razao_social || pedido.cliente_nome || '-'}</span></div>
            <div class="cell"><label>CNPJ/CPF</label><span>${clienteDoc}</span></div>
            <div class="cell"><label>Data Emissão</label><span>${dataFat}</span></div>
        </div>
        <div class="row">
            <div class="cell" style="flex:2"><label>Endereço</label><span>${pedido.cliente_endereco || '-'}</span></div>
            <div class="cell"><label>Bairro</label><span>${pedido.cliente_bairro || '-'}</span></div>
            <div class="cell"><label>CEP</label><span>${pedido.cliente_cep || '-'}</span></div>
            <div class="cell"><label>Hora Emissão</label><span>${horaFat}</span></div>
        </div>
        <div class="row">
            <div class="cell" style="flex:2"><label>Município</label><span>${pedido.cliente_cidade || '-'}</span></div>
            <div class="cell"><label>UF</label><span>${pedido.cliente_estado || '-'}</span></div>
            <div class="cell"><label>Telefone</label><span>${pedido.cliente_telefone || '-'}</span></div>
            <div class="cell"><label>IE</label><span>-</span></div>
        </div>

        <!-- PRODUTOS -->
        <div class="section-title">DADOS DOS PRODUTOS / SERVIÇOS</div>
        <table>
            <thead>
                <tr>
                    <th style="width:10%">Código</th>
                    <th style="width:35%">Descrição</th>
                    <th style="width:8%">UN</th>
                    <th style="width:10%">Qtd</th>
                    <th style="width:12%">V. Unit</th>
                    <th style="width:10%">Desc.</th>
                    <th style="width:15%">V. Total</th>
                </tr>
            </thead>
            <tbody>
                ${itens.map(item => `<tr>
                    <td class="center">${item.codigo || '-'}</td>
                    <td>${item.descricao || '-'}</td>
                    <td class="center">${item.unidade || 'UN'}</td>
                    <td class="right">${parseFloat(item.quantidade || 0).toFixed(2)}</td>
                    <td class="right">${parseFloat(item.preco_unitario || 0).toFixed(2)}</td>
                    <td class="right">${parseFloat(item.desconto || 0).toFixed(2)}</td>
                    <td class="right">${parseFloat(item.subtotal || 0).toFixed(2)}</td>
                </tr>`).join('')}
            </tbody>
        </table>

        <!-- TOTAIS -->
        <div class="section-title">CÁLCULO DO IMPOSTO</div>
        <div class="row">
            <div class="cell"><label>Base Cálculo ICMS</label><span>0,00</span></div>
            <div class="cell"><label>Valor ICMS</label><span>0,00</span></div>
            <div class="cell"><label>Base Cálculo ICMS ST</label><span>0,00</span></div>
            <div class="cell"><label>Valor ICMS ST</label><span>0,00</span></div>
            <div class="cell"><label>Valor Total Produtos</label><span>${valorTotal.toFixed(2)}</span></div>
        </div>
        <div class="row">
            <div class="cell"><label>Valor Frete</label><span>${frete.toFixed(2)}</span></div>
            <div class="cell"><label>Valor Seguro</label><span>${(parseFloat(pedido.valor_seguro) || 0).toFixed(2)}</span></div>
            <div class="cell"><label>Desconto</label><span>${desconto.toFixed(2)}</span></div>
            <div class="cell"><label>Outras Despesas</label><span>${(parseFloat(pedido.outras_despesas) || 0).toFixed(2)}</span></div>
            <div class="cell"><label>Valor IPI</label><span>0,00</span></div>
            <div class="cell"><label>Valor Total da NF</label><span style="font-size:12px">${(valorTotal + frete - desconto).toFixed(2)}</span></div>
        </div>

        <!-- TRANSPORTADORA -->
        <div class="section-title">TRANSPORTADOR / VOLUMES TRANSPORTADOS</div>
        <div class="row">
            <div class="cell" style="flex:2"><label>Razão Social</label><span>${pedido.transportadora_nome || '-'}</span></div>
            <div class="cell"><label>Frete por conta</label><span>${pedido.tipo_frete === 'CIF' ? '0-Emitente' : '1-Destinatário'}</span></div>
            <div class="cell"><label>Placa</label><span>${pedido.placa_veiculo || '-'}</span></div>
            <div class="cell"><label>UF</label><span>${pedido.veiculo_uf || '-'}</span></div>
        </div>
        <div class="row">
            <div class="cell"><label>Qtd Volumes</label><span>${pedido.qtd_volumes || '-'}</span></div>
            <div class="cell"><label>Espécie</label><span>${pedido.especie_volumes || '-'}</span></div>
            <div class="cell"><label>Marca</label><span>${pedido.marca_volumes || '-'}</span></div>
            <div class="cell"><label>Peso Bruto</label><span>${pedido.peso_bruto || '-'}</span></div>
            <div class="cell"><label>Peso Líquido</label><span>${pedido.peso_liquido || '-'}</span></div>
        </div>

        <!-- INFORMAÇÕES COMPLEMENTARES -->
        <div class="section-title">DADOS ADICIONAIS</div>
        <div class="info-complementar">
            <label>Informações Complementares</label><br>
            Pedido Nº ${id} | Condição: ${pedido.condicao_pagamento || pedido.parcelas || 'À Vista'}<br>
            ${pedido.observacao || ''}
        </div>
    </div>
</body>
</html>`;

            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(danfeHTML);

        } catch (error) {
            console.error('[DANFE] Erro ao gerar:', error);
            next(error);
        }
    });

    // ============================================================
    // GERAR NF NÚMERO — Para uso pelo drag-drop do Kanban
    // POST /api/vendas/pedidos/:id/gerar-nf
    // ============================================================
    router.post('/pedidos/:id/gerar-nf', authenticateToken, async (req, res, next) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            const { id } = req.params;

            // Verificar pedido
            const [[pedido]] = await connection.query(
                'SELECT id, status, nf, numero_nf, empresa_id, cliente_id FROM pedidos WHERE id = ? FOR UPDATE',
                [id]
            );
            if (!pedido) {
                await connection.rollback();
                return res.status(404).json({ message: 'Pedido não encontrado' });
            }

            // Se já tem NF, retornar o existente
            if (pedido.nf || pedido.numero_nf) {
                await connection.rollback();
                return res.json({
                    success: true,
                    nf_numero: pedido.nf || pedido.numero_nf,
                    ja_existia: true
                });
            }

            // Gerar novo número via faturamentoShared
            const nfData = await faturamentoShared.gerarProximoNumeroNFe(connection);
            const nfNumero = nfData.numero;

            // Salvar em AMBOS os campos
            await connection.query(
                'UPDATE pedidos SET nf = ?, numero_nf = ?, data_faturamento = COALESCE(data_faturamento, NOW()), updated_at = NOW() WHERE id = ?',
                [nfNumero, nfNumero, id]
            );

            await connection.commit();

            console.log(`[GERAR-NF] NF ${nfNumero} gerada para pedido #${id}`);
            res.json({
                success: true,
                nf_numero: nfNumero,
                serie: nfData.serie,
                ja_existia: false
            });

        } catch (error) {
            await connection.rollback();
            console.error('[GERAR-NF] Erro:', error);
            next(error);
        } finally {
            connection.release();
        }
    });

    return router;
};
