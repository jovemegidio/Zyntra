/**
 * LOGISTICA ROUTES - Extracted from server.js (Lines 2565-2812)
 * @module routes/logistica-routes
 */
const express = require('express');

module.exports = function createLogisticaRoutes(deps) {
    const { pool, authenticateToken, authorizeArea } = deps;
    const router = express.Router();
    router.use(authenticateToken);
    router.use(authorizeArea('logistica'));
    // ===================== ROTAS LOGÍSTICA =====================
    
    // Dashboard da Logística - Contadores por status
    router.get('/dashboard', async (req, res, next) => {
        console.log('[LOGISTICA/DASHBOARD] Requisição recebida');
        try {
            // Contar pedidos faturados que ainda não foram despachados (status_logistica IS NULL ou 'pendente')
            const [[aguardando]] = await pool.query(`
                SELECT COUNT(*) as total FROM pedidos
                WHERE status IN ('faturado', 'recibo')
                AND (status_logistica IS NULL OR status_logistica = 'pendente' OR status_logistica = 'aguardando_separacao' OR status_logistica = '')
            `);
            console.log('[LOGISTICA/DASHBOARD] Aguardando:', aguardando);
    
            const [[separacao]] = await pool.query(`
                SELECT COUNT(*) as total FROM pedidos
                WHERE status IN ('faturado', 'recibo') AND status_logistica = 'em_separacao'
            `);
    
            const [[expedicao]] = await pool.query(`
                SELECT COUNT(*) as total FROM pedidos
                WHERE status IN ('faturado', 'recibo') AND status_logistica = 'em_expedicao'
            `);
    
            const [[transporte]] = await pool.query(`
                SELECT COUNT(*) as total FROM pedidos
                WHERE status IN ('faturado', 'recibo') AND status_logistica = 'em_transporte'
            `);
    
            const [[entregues]] = await pool.query(`
                SELECT COUNT(*) as total FROM pedidos
                WHERE status IN ('faturado', 'recibo') AND status_logistica = 'entregue'
            `);
    
            const result = {
                aguardando_separacao: aguardando?.total || 0,
                em_separacao: separacao?.total || 0,
                em_expedicao: expedicao?.total || 0,
                em_transporte: transporte?.total || 0,
                entregues: entregues?.total || 0
            };
            console.log('[LOGISTICA/DASHBOARD] Resultado:', result);
            res.json(result);
        } catch (error) {
            console.error('[LOGISTICA/DASHBOARD] Erro:', error);
            res.json({
                aguardando_separacao: 0,
                em_separacao: 0,
                em_expedicao: 0,
                em_transporte: 0,
                entregues: 0
            });
        }
    });
    
    // Listar pedidos em logística (sem autenticação)
    router.get('/pedidos', async (req, res, next) => {
        console.log('[LOGISTICA/PEDIDOS] Requisição recebida');
        try {
            const { status, transportadora, nfe, data_inicio, data_fim, limit = 100 } = req.query;
    
            let query = `
                SELECT
                    p.id,
                    p.id as pedido_id,
                    p.valor,
                    p.descricao,
                    p.status,
                    p.status_logistica,
                    p.prioridade,
                    p.created_at,
                    p.faturado_em,
                    p.data_prevista,
                    p.prazo_entrega,
                    p.observacao,
                    p.frete,
                    p.nf,
                    p.numero_nf,
                    p.transportadora_id,
                    c.nome as cliente_nome,
                    c.nome_fantasia as cliente_fantasia,
                    c.cidade as cliente_cidade,
                    c.estado as cliente_uf,
                    t.nome_fantasia as transportadora_nome,
                    t.razao_social as transportadora_razao
                FROM pedidos p
                LEFT JOIN clientes c ON p.cliente_id = c.id
                LEFT JOIN transportadoras t ON p.transportadora_id = t.id
                WHERE p.status IN ('faturado', 'recibo')
            `;
    
            const params = [];
    
            // Tratar filtro de status - pendente/aguardando inclui NULL
            if (status && status !== '' && status !== 'todos') {
                if (status === 'pendente' || status === 'aguardando_separacao') {
                    query += ' AND (p.status_logistica IS NULL OR p.status_logistica = "pendente" OR p.status_logistica = "aguardando_separacao" OR p.status_logistica = "")';
                } else {
                    query += ' AND p.status_logistica = ?';
                    params.push(status);
                }
            }
    
            if (nfe && nfe !== '') {
                query += ' AND p.id = ?';
                params.push(nfe);
            }
    
            if (data_inicio) {
                query += ' AND DATE(p.created_at) >= ?';
                params.push(data_inicio);
            }
    
            if (data_fim) {
                query += ' AND DATE(p.created_at) <= ?';
                params.push(data_fim);
            }
    
            query += ' ORDER BY p.prioridade DESC, p.created_at DESC LIMIT ?';
            params.push(parseInt(limit));
    
            console.log('[LOGISTICA/PEDIDOS] Query:', query);
            console.log('[LOGISTICA/PEDIDOS] Params:', params);
    
            const [rows] = await pool.query(query, params);
            console.log('[LOGISTICA/PEDIDOS] Rows encontrados:', rows.length);
    
            // Formatar dados para o frontend
            const pedidos = rows.map(row => ({
                id: row.id,
                pedido_id: row.pedido_id,
                nfe_numero: row.nf || row.numero_nf || '-',
                cliente: row.cliente_fantasia || row.cliente_nome || 'Cliente não informado',
                cidade_uf: row.cliente_cidade && row.cliente_uf ? `${row.cliente_cidade}/${row.cliente_uf}` : '-',
                transportadora: row.transportadora_nome || row.transportadora_razao || 'Não definida',
                transportadora_id: row.transportadora_id || null,
                status: row.status_logistica || 'pendente',
                previsao: row.data_prevista || row.prazo_entrega || '-',
                prioridade: row.prioridade || 'normal',
                valor: row.valor,
                observacao: row.observacao
            }));
    
            res.json(pedidos);
        } catch (error) {
            console.error('[LOGISTICA/PEDIDOS] Erro:', error);
            res.status(500).json({ error: error.message, pedidos: [] });
        }
    });
    
    // Atualizar status de logística de um pedido
    router.put('/pedidos/:id/status', async (req, res, next) => {
        try {
            const { id } = req.params;
            const { status_logistica, observacao } = req.body;
    
            const validStatuses = ['pendente', 'aguardando_separacao', 'em_separacao', 'em_expedicao', 'em_transporte', 'entregue'];
    
            if (!validStatuses.includes(status_logistica)) {
                return res.status(400).json({
                    message: 'Status inválido',
                    valid: validStatuses
                });
            }
    
            await pool.query(
                'UPDATE pedidos SET status_logistica = ?, observacao = CONCAT(COALESCE(observacao, ""), ?) WHERE id = ?',
                [status_logistica, observacao ? `\n[LOG] ${new Date().toLocaleString('pt-BR')}: ${observacao}` : '', id]
            );
    
            // Se status for 'entregue', atualizar também o status principal
            if (status_logistica === 'entregue') {
                await pool.query('UPDATE pedidos SET status = "entregue" WHERE id = ?', [id]);
            }
    
            res.json({ message: 'Status atualizado com sucesso', status: status_logistica });
        } catch (error) {
            console.error('[LOGISTICA/STATUS] Erro:', error);
            next(error);
        }
    });
    
    // Atribuir transportadora a um pedido
    router.put('/pedidos/:id/transportadora', async (req, res, next) => {
        try {
            const { id } = req.params;
            const { transportadora_id, previsao_entrega } = req.body;
    
            await pool.query(
                'UPDATE pedidos SET transportadora_id = ?, data_prevista = ? WHERE id = ?',
                [transportadora_id, previsao_entrega, id]
            );
    
            res.json({ message: 'Transportadora atribuída com sucesso' });
        } catch (error) {
            console.error('[LOGISTICA/TRANSPORTADORA] Erro:', error);
            next(error);
        }
    });
    
    // Listar transportadoras disponíveis
    router.get('/transportadoras', async (req, res, next) => {
        try {
            let _dec = (v) => v;
            try {
                const lgpdCrypto = require('../lgpd-crypto');
                if (lgpdCrypto && lgpdCrypto.decryptPII) {
                    _dec = lgpdCrypto.decryptPII;
                }
            } catch(e) { /* LGPD crypto não disponível, retorna dados sem decrypt */ }
            const [rows] = await pool.query(`
                SELECT id, razao_social, nome_fantasia, cnpj_cpf, inscricao_estadual, telefone, email,
                       cidade, estado, endereco, cep, contato
                FROM transportadoras
                ORDER BY nome_fantasia, razao_social
            `);
            const resultado = rows.map(r => ({
                ...r,
                cnpj_cpf: _dec(r.cnpj_cpf || ''),
                inscricao_estadual: _dec(r.inscricao_estadual || '')
            }));
            res.json(resultado);
        } catch (error) {
            console.error('[LOGISTICA/TRANSPORTADORAS] Erro:', error);
            res.json([]);
        }
    });

    // Cadastrar nova transportadora
    router.post('/transportadoras', async (req, res, next) => {
        try {
            const { razao_social, fantasia, cnpj, telefone, email, endereco, cidade, estado, cep, contato } = req.body;

            if (!razao_social || razao_social.trim() === '') {
                return res.status(400).json({ error: 'Razão Social é obrigatória' });
            }

            let _enc = (v) => v;
            try {
                const lgpdCrypto = require('../lgpd-crypto');
                if (lgpdCrypto && lgpdCrypto.encryptPII) {
                    _enc = lgpdCrypto.encryptPII;
                }
            } catch(e) { /* LGPD crypto não disponível */ }

            const [result] = await pool.query(`
                INSERT INTO transportadoras (razao_social, nome_fantasia, cnpj_cpf, telefone, email, endereco, cidade, estado, cep, contato)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                razao_social.trim(),
                (fantasia || '').trim(),
                _enc((cnpj || '').trim()),
                (telefone || '').trim(),
                (email || '').trim(),
                (endereco || '').trim(),
                (cidade || '').trim(),
                (estado || '').trim(),
                (cep || '').trim(),
                (contato || '').trim()
            ]);

            res.json({ success: true, message: 'Transportadora cadastrada com sucesso', id: result.insertId });
        } catch (error) {
            console.error('[LOGISTICA/TRANSPORTADORAS/POST] Erro:', error);
            if (error.code === 'ER_DUP_ENTRY') {
                return res.status(400).json({ error: 'Transportadora com este CNPJ já existe' });
            }
            res.status(500).json({ error: error.message });
        }
    });
    
    // Criar nova expedição (manual)
    router.post('/expedicao', async (req, res, next) => {
        try {
            const { nfe, pedido_id, pedido: pedidoBody, cliente, transportadora_id, status, previsao, prioridade, observacoes } = req.body;
            const pedido = pedido_id || pedidoBody;

            // Se for baseado em um pedido existente, atualizar
            if (pedido) {
                await pool.query(`
                    UPDATE pedidos SET
                        status_logistica = ?,
                        transportadora_id = ?,
                        data_prevista = ?,
                        prioridade = ?,
                        observacao = CONCAT(COALESCE(observacao, ''), ?)
                    WHERE id = ?
                `, [status || 'pendente', transportadora_id, previsao, prioridade, observacoes ? `\n[EXP] ${observacoes}` : '', pedido]);
    
                return res.json({ message: 'Expedição criada com sucesso', pedido_id: pedido });
            }
    
            res.status(400).json({ message: 'Pedido ou NF-e é obrigatório' });
        } catch (error) {
            console.error('[LOGISTICA/EXPEDICAO] Erro:', error);
            next(error);
        }
    });
    
    return router;
};
