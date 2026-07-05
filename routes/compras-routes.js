/**
 * COMPRAS ROUTES (PART 1) - Rotas complementares (recebimento, relatórios, centros de custo)
 * NOTA: Dashboard, fornecedores e pedidos CRUD estão em compras-extended.js
 * @module routes/compras-routes
 */
const express = require('express');

module.exports = function createComprasRoutes(deps) {
    const { pool, authenticateToken, authorizeArea, writeAuditLog } = deps;
    const router = express.Router();

    router.use(authenticateToken);
    router.use(authorizeArea('compras'));

    // ===================== DEVOLUCAO AO FORNECEDOR =====================
    let _dfReady = false;
    async function ensureDevForn() {
        if (_dfReady) return;
        await pool.query(`CREATE TABLE IF NOT EXISTS devolucoes_fornecedor (
            id INT AUTO_INCREMENT PRIMARY KEY, numero INT NULL,
            fornecedor_id INT NULL, fornecedor_nome VARCHAR(255) NULL,
            nota_fiscal VARCHAR(120) NULL, nota_fiscal_origem VARCHAR(120) NULL, origem VARCHAR(255) NULL,
            motivo TEXT NULL, valor_total DECIMAL(15,2) DEFAULT 0,
            observacoes TEXT NULL, situacao VARCHAR(20) DEFAULT 'pendente',
            concluido_em DATETIME NULL, concluido_por VARCHAR(180) NULL,
            criado_por INT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
        await pool.query(`CREATE TABLE IF NOT EXISTS devolucoes_fornecedor_itens (
            id INT AUTO_INCREMENT PRIMARY KEY, devolucao_id INT NOT NULL,
            produto_id INT NULL, codigo VARCHAR(120) NULL, descricao VARCHAR(255) NULL,
            quantidade DECIMAL(15,4) DEFAULT 0, preco_unitario DECIMAL(15,4) DEFAULT 0,
            valor_total DECIMAL(15,2) DEFAULT 0, KEY idx_df (devolucao_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
        _dfReady = true;
    }
    const _dfNum = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
    const _dfMerc = itens => (itens || []).reduce((s, it) => s + _dfNum(it.valor_total != null ? it.valor_total : _dfNum(it.quantidade) * _dfNum(it.preco_unitario)), 0);

    router.get('/devolucao-fornecedor', async (req, res, next) => {
        try { await ensureDevForn();
            const [rows] = await pool.query(`SELECT d.*, (SELECT COUNT(*) FROM devolucoes_fornecedor_itens i WHERE i.devolucao_id=d.id) itens_count FROM devolucoes_fornecedor d ORDER BY d.id DESC LIMIT 500`);
            res.json({ success: true, data: rows });
        } catch (e) { next(e); }
    });
    router.get('/devolucao-fornecedor/:id', async (req, res, next) => {
        try { await ensureDevForn();
            const [[d]] = await pool.query('SELECT * FROM devolucoes_fornecedor WHERE id=?', [req.params.id]);
            if (!d) return res.status(404).json({ success: false, message: 'Devolucao nao encontrada.' });
            const [itens] = await pool.query('SELECT * FROM devolucoes_fornecedor_itens WHERE devolucao_id=? ORDER BY id', [req.params.id]);
            res.json({ success: true, data: Object.assign({}, d, { itens }) });
        } catch (e) { next(e); }
    });
    router.post('/devolucao-fornecedor', async (req, res, next) => {
        const cn = await pool.getConnection();
        try { await ensureDevForn(); const b = req.body || {}; const itens = Array.isArray(b.itens) ? b.itens : [];
            const valorTotal = _dfMerc(itens);
            await cn.beginTransaction();
            const [[mx]] = await cn.query('SELECT COALESCE(MAX(numero),0)+1 AS prox FROM devolucoes_fornecedor');
            const [r] = await cn.query(`INSERT INTO devolucoes_fornecedor (numero, fornecedor_id, fornecedor_nome, nota_fiscal, nota_fiscal_origem, origem, motivo, valor_total, observacoes, situacao, criado_por) VALUES (?,?,?,?,?,?,?,?,?,'pendente',?)`,
                [mx.prox, b.fornecedor_id || null, b.fornecedor_nome || null, b.nota_fiscal || null, b.nota_fiscal_origem || null, b.origem || null, b.motivo || null, valorTotal, b.observacoes || null, (req.user && req.user.id) || null]);
            const did = r.insertId;
            for (const it of itens) await cn.query(`INSERT INTO devolucoes_fornecedor_itens (devolucao_id, produto_id, codigo, descricao, quantidade, preco_unitario, valor_total) VALUES (?,?,?,?,?,?,?)`, [did, it.produto_id || null, it.codigo || null, it.descricao || null, _dfNum(it.quantidade), _dfNum(it.preco_unitario), _dfNum(it.valor_total != null ? it.valor_total : _dfNum(it.quantidade) * _dfNum(it.preco_unitario))]);
            await cn.commit(); res.json({ success: true, id: did, numero: mx.prox });
        } catch (e) { await cn.rollback(); next(e); } finally { cn.release(); }
    });
    router.put('/devolucao-fornecedor/:id', async (req, res, next) => {
        const cn = await pool.getConnection();
        try { await ensureDevForn(); const id = req.params.id; const b = req.body || {}; const itens = Array.isArray(b.itens) ? b.itens : [];
            const valorTotal = _dfMerc(itens);
            await cn.beginTransaction();
            await cn.query(`UPDATE devolucoes_fornecedor SET fornecedor_id=?, fornecedor_nome=?, nota_fiscal=?, nota_fiscal_origem=?, origem=?, motivo=?, valor_total=?, observacoes=? WHERE id=?`,
                [b.fornecedor_id || null, b.fornecedor_nome || null, b.nota_fiscal || null, b.nota_fiscal_origem || null, b.origem || null, b.motivo || null, valorTotal, b.observacoes || null, id]);
            await cn.query('DELETE FROM devolucoes_fornecedor_itens WHERE devolucao_id=?', [id]);
            for (const it of itens) await cn.query(`INSERT INTO devolucoes_fornecedor_itens (devolucao_id, produto_id, codigo, descricao, quantidade, preco_unitario, valor_total) VALUES (?,?,?,?,?,?,?)`, [id, it.produto_id || null, it.codigo || null, it.descricao || null, _dfNum(it.quantidade), _dfNum(it.preco_unitario), _dfNum(it.valor_total != null ? it.valor_total : _dfNum(it.quantidade) * _dfNum(it.preco_unitario))]);
            await cn.commit(); res.json({ success: true });
        } catch (e) { await cn.rollback(); next(e); } finally { cn.release(); }
    });
    router.post('/devolucao-fornecedor/:id/concluir', async (req, res, next) => {
        try { await ensureDevForn();
            await pool.query("UPDATE devolucoes_fornecedor SET situacao='concluida', concluido_em=NOW(), concluido_por=? WHERE id=?", [(req.user && (req.user.nome || req.user.username)) || null, req.params.id]);
            res.json({ success: true });
        } catch (e) { next(e); }
    });
    router.delete('/devolucao-fornecedor/:id', async (req, res, next) => {
        try { await ensureDevForn();
            await pool.query('DELETE FROM devolucoes_fornecedor_itens WHERE devolucao_id=?', [req.params.id]);
            await pool.query('DELETE FROM devolucoes_fornecedor WHERE id=?', [req.params.id]);
            res.json({ success: true });
        } catch (e) { next(e); }
    });

    // ===================== OUTRAS NOTAS DE ENTRADA =====================
    let _oneReady = false;
    async function ensureNotasEntrada() {
        if (_oneReady) return;
        await pool.query(`CREATE TABLE IF NOT EXISTS outras_notas_entrada (
            id INT AUTO_INCREMENT PRIMARY KEY, numero INT NULL,
            fornecedor_id INT NULL, fornecedor_nome VARCHAR(255) NULL, remetente VARCHAR(255) NULL,
            previsao DATE NULL, gerar_contas_pagar TINYINT(1) DEFAULT 0,
            vendedor VARCHAR(180) NULL, tipo_frete VARCHAR(60) NULL, valor_frete DECIMAL(15,2) DEFAULT 0,
            nota_fiscal VARCHAR(120) NULL, natureza_operacao VARCHAR(255) NULL,
            total_mercadorias DECIMAL(15,2) DEFAULT 0, total_desconto DECIMAL(15,2) DEFAULT 0,
            total_ipi DECIMAL(15,2) DEFAULT 0, total_icms_st DECIMAL(15,2) DEFAULT 0, valor_total DECIMAL(15,2) DEFAULT 0,
            info_adicionais TEXT NULL, email VARCHAR(255) NULL, observacoes TEXT NULL,
            situacao VARCHAR(20) DEFAULT 'pendente', concluido_em DATETIME NULL, concluido_por VARCHAR(180) NULL,
            criado_por INT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
        await pool.query(`CREATE TABLE IF NOT EXISTS outras_notas_entrada_itens (
            id INT AUTO_INCREMENT PRIMARY KEY, nota_id INT NOT NULL,
            produto_id INT NULL, codigo VARCHAR(120) NULL, descricao VARCHAR(255) NULL,
            quantidade DECIMAL(15,4) DEFAULT 0, local_estoque VARCHAR(120) NULL,
            preco_unitario DECIMAL(15,4) DEFAULT 0, valor_total DECIMAL(15,2) DEFAULT 0, KEY idx_one (nota_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
        _oneReady = true;
    }
    const _oneNum = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
    function _oneTotais(itens, frete, desc) {
        const merc = (itens || []).reduce((s, it) => s + _oneNum(it.valor_total != null ? it.valor_total : _oneNum(it.quantidade) * _oneNum(it.preco_unitario)), 0);
        return { merc, valorTotal: merc + _oneNum(frete) - _oneNum(desc) };
    }

    router.get('/notas-entrada', async (req, res, next) => {
        try { await ensureNotasEntrada();
            const [rows] = await pool.query(`SELECT n.*, (SELECT COUNT(*) FROM outras_notas_entrada_itens i WHERE i.nota_id=n.id) itens_count FROM outras_notas_entrada n ORDER BY n.id DESC LIMIT 500`);
            res.json({ success: true, data: rows });
        } catch (e) { next(e); }
    });
    router.get('/notas-entrada/:id', async (req, res, next) => {
        try { await ensureNotasEntrada();
            const [[nota]] = await pool.query('SELECT * FROM outras_notas_entrada WHERE id=?', [req.params.id]);
            if (!nota) return res.status(404).json({ success: false, message: 'Nota nao encontrada.' });
            const [itens] = await pool.query('SELECT * FROM outras_notas_entrada_itens WHERE nota_id=? ORDER BY id', [req.params.id]);
            res.json({ success: true, data: Object.assign({}, nota, { itens }) });
        } catch (e) { next(e); }
    });
    router.post('/notas-entrada', async (req, res, next) => {
        const cn = await pool.getConnection();
        try { await ensureNotasEntrada(); const b = req.body || {}; const itens = Array.isArray(b.itens) ? b.itens : [];
            const { merc, valorTotal } = _oneTotais(itens, b.valor_frete, b.total_desconto);
            await cn.beginTransaction();
            const [[mx]] = await cn.query('SELECT COALESCE(MAX(numero),0)+1 AS prox FROM outras_notas_entrada');
            const [r] = await cn.query(`INSERT INTO outras_notas_entrada (numero, fornecedor_id, fornecedor_nome, remetente, previsao, gerar_contas_pagar, vendedor, tipo_frete, valor_frete, nota_fiscal, natureza_operacao, total_mercadorias, total_desconto, total_ipi, total_icms_st, valor_total, info_adicionais, email, observacoes, situacao, criado_por) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pendente',?)`,
                [mx.prox, b.fornecedor_id || null, b.fornecedor_nome || null, b.remetente || null, b.previsao || null, b.gerar_contas_pagar ? 1 : 0, b.vendedor || null, b.tipo_frete || null, _oneNum(b.valor_frete), b.nota_fiscal || null, b.natureza_operacao || null, merc, _oneNum(b.total_desconto), _oneNum(b.total_ipi), _oneNum(b.total_icms_st), valorTotal, b.info_adicionais || null, b.email || null, b.observacoes || null, (req.user && req.user.id) || null]);
            const notaId = r.insertId;
            for (const it of itens) await cn.query(`INSERT INTO outras_notas_entrada_itens (nota_id, produto_id, codigo, descricao, quantidade, local_estoque, preco_unitario, valor_total) VALUES (?,?,?,?,?,?,?,?)`, [notaId, it.produto_id || null, it.codigo || null, it.descricao || null, _oneNum(it.quantidade), it.local_estoque || null, _oneNum(it.preco_unitario), _oneNum(it.valor_total != null ? it.valor_total : _oneNum(it.quantidade) * _oneNum(it.preco_unitario))]);
            await cn.commit();
            res.json({ success: true, id: notaId, numero: mx.prox });
        } catch (e) { await cn.rollback(); next(e); } finally { cn.release(); }
    });
    router.put('/notas-entrada/:id', async (req, res, next) => {
        const cn = await pool.getConnection();
        try { await ensureNotasEntrada(); const id = req.params.id; const b = req.body || {}; const itens = Array.isArray(b.itens) ? b.itens : [];
            const { merc, valorTotal } = _oneTotais(itens, b.valor_frete, b.total_desconto);
            await cn.beginTransaction();
            await cn.query(`UPDATE outras_notas_entrada SET fornecedor_id=?, fornecedor_nome=?, remetente=?, previsao=?, gerar_contas_pagar=?, vendedor=?, tipo_frete=?, valor_frete=?, nota_fiscal=?, natureza_operacao=?, total_mercadorias=?, total_desconto=?, total_ipi=?, total_icms_st=?, valor_total=?, info_adicionais=?, email=?, observacoes=? WHERE id=?`,
                [b.fornecedor_id || null, b.fornecedor_nome || null, b.remetente || null, b.previsao || null, b.gerar_contas_pagar ? 1 : 0, b.vendedor || null, b.tipo_frete || null, _oneNum(b.valor_frete), b.nota_fiscal || null, b.natureza_operacao || null, merc, _oneNum(b.total_desconto), _oneNum(b.total_ipi), _oneNum(b.total_icms_st), valorTotal, b.info_adicionais || null, b.email || null, b.observacoes || null, id]);
            await cn.query('DELETE FROM outras_notas_entrada_itens WHERE nota_id=?', [id]);
            for (const it of itens) await cn.query(`INSERT INTO outras_notas_entrada_itens (nota_id, produto_id, codigo, descricao, quantidade, local_estoque, preco_unitario, valor_total) VALUES (?,?,?,?,?,?,?,?)`, [id, it.produto_id || null, it.codigo || null, it.descricao || null, _oneNum(it.quantidade), it.local_estoque || null, _oneNum(it.preco_unitario), _oneNum(it.valor_total != null ? it.valor_total : _oneNum(it.quantidade) * _oneNum(it.preco_unitario))]);
            await cn.commit(); res.json({ success: true });
        } catch (e) { await cn.rollback(); next(e); } finally { cn.release(); }
    });
    router.post('/notas-entrada/:id/concluir', async (req, res, next) => {
        try { await ensureNotasEntrada();
            await pool.query("UPDATE outras_notas_entrada SET situacao='concluida', concluido_em=NOW(), concluido_por=? WHERE id=?", [(req.user && (req.user.nome || req.user.username)) || null, req.params.id]);
            res.json({ success: true });
        } catch (e) { next(e); }
    });
    router.delete('/notas-entrada/:id', async (req, res, next) => {
        try { await ensureNotasEntrada();
            await pool.query('DELETE FROM outras_notas_entrada_itens WHERE nota_id=?', [req.params.id]);
            await pool.query('DELETE FROM outras_notas_entrada WHERE id=?', [req.params.id]);
            res.json({ success: true });
        } catch (e) { next(e); }
    });

    // SUGESTAO DE COMPRA — recomendacao por estoque x minimo x consumo medio (dados reais)
    router.get('/sugestao-compra', async (req, res, next) => {
        try {
            const diasConsumo = Math.max(1, parseInt(req.query.dias_consumo) || 30);
            const diasEstimativa = Math.max(1, parseInt(req.query.dias_estimativa) || 30);
            const busca = req.query.busca ? `%${req.query.busca}%` : null;
            let where = 'm.ativo = 1';
            const params = [diasConsumo];
            if (busca) { where += ' AND (m.codigo LIKE ? OR m.descricao LIKE ?)'; params.push(busca, busca); }
            const [rows] = await pool.query(`
                SELECT m.id, m.codigo, m.descricao, m.categoria, m.unidade,
                       COALESCE(m.estoque_atual,0) estoque_atual, COALESCE(m.estoque_min,0) estoque_min,
                       COALESCE(m.estoque_max,0) estoque_max, COALESCE(m.lead_time,0) lead_time,
                       COALESCE(m.ultimo_preco,0) ultimo_preco, m.fornecedor_id,
                       COALESCE(f.razao_social, f.nome) fornecedor_nome,
                       (SELECT COALESCE(SUM(me.quantidade),0) FROM movimentacao_materias_primas me
                        WHERE me.material_id = m.id AND me.tipo_movimentacao = 'SAIDA'
                          AND me.created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)) consumo_periodo
                FROM compras_materiais m LEFT JOIN fornecedores f ON m.fornecedor_id = f.id
                WHERE ${where}
                ORDER BY (COALESCE(m.estoque_atual,0) <= COALESCE(m.estoque_min,0)) DESC, m.descricao
                LIMIT 500`, params);
            const sugestoes = rows.map(m => {
                const cmd = +(((m.consumo_periodo || 0) / diasConsumo)).toFixed(3);
                const necessidade = +(cmd * diasEstimativa).toFixed(2);
                const saldoProj = +((m.estoque_atual - necessidade)).toFixed(2);
                let recomendacao, prioridade;
                if (m.estoque_atual <= 0) { recomendacao = 'Comprar imediatamente'; prioridade = 1; }
                else if (m.estoque_atual <= m.estoque_min) { recomendacao = 'Comprar imediatamente'; prioridade = 2; }
                else if (saldoProj < m.estoque_min) { recomendacao = 'Comprar em breve'; prioridade = 5; }
                else { recomendacao = 'Nao comprar'; prioridade = 9; }
                const alvo = m.estoque_max > 0 ? m.estoque_max : (m.estoque_min * 2);
                let quantidade_sugerida = 0;
                if (prioridade < 9) quantidade_sugerida = Math.max(Math.ceil(alvo - m.estoque_atual + necessidade), Math.ceil(m.estoque_min - m.estoque_atual), 1);
                return Object.assign({}, m, { consumo_medio_diario: cmd, necessidade, saldo_projetado: saldoProj, recomendacao, prioridade, quantidade_sugerida });
            });
            res.json({ success: true, dias_consumo: diasConsumo, dias_estimativa: diasEstimativa, total: sugestoes.length, sugestoes });
        } catch (e) { next(e); }
    });

    router.post('/sugestao-compra/gerar-pedido', async (req, res, next) => {
        const conn = await pool.getConnection();
        try {
            const { material_id, quantidade } = req.body || {};
            const qtd = parseFloat(quantidade);
            if (!material_id || !(qtd > 0)) return res.status(400).json({ error: 'material_id e quantidade sao obrigatorios.' });
            const [[m]] = await conn.query('SELECT * FROM compras_materiais WHERE id = ?', [material_id]);
            if (!m) return res.status(404).json({ error: 'Material nao encontrado.' });
            if (!m.fornecedor_id) return res.status(400).json({ error: 'Material sem fornecedor definido. Defina um fornecedor antes de gerar o pedido.' });
            const [[f]] = await conn.query('SELECT id, ativo FROM fornecedores WHERE id = ?', [m.fornecedor_id]);
            if (!f) return res.status(400).json({ error: 'Fornecedor do material nao encontrado.' });
            if (f.ativo === 0) return res.status(400).json({ error: 'Fornecedor inativo.' });
            await conn.beginTransaction();
            const [[nx]] = await conn.query('SELECT COALESCE(MAX(CAST(numero_pedido AS UNSIGNED)),0)+1 AS n FROM pedidos_compra FOR UPDATE');
            const numero = String(nx.n);
            const preco = parseFloat(m.ultimo_preco) || 0;
            const total = +((qtd * preco)).toFixed(2);
            const [r] = await conn.query(
                `INSERT INTO pedidos_compra (numero_pedido, fornecedor_id, data_pedido, valor_total, valor_final, observacoes, usuario_solicitante_id, status)
                 VALUES (?, ?, CURDATE(), ?, ?, ?, ?, 'pendente')`,
                [numero, m.fornecedor_id, total, total, 'Gerado a partir de Sugestao de Compra', (req.user && req.user.id) || null]);
            const pedidoId = r.insertId;
            await conn.query(
                `INSERT INTO itens_pedido (pedido_id, codigo_produto, descricao, quantidade, unidade, preco_unitario, preco_total, observacoes)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [pedidoId, m.codigo, m.descricao, qtd, m.unidade || 'UN', preco, total, 'Sugestao de Compra']);
            try { await conn.query(`INSERT INTO historico_aprovacoes (pedido_id, usuario_id, acao, observacoes) VALUES (?, ?, 'solicitado', 'Pedido criado via Sugestao de Compra')`, [pedidoId, (req.user && req.user.id) || null]); } catch (_) {}
            await conn.commit();
            res.status(201).json({ success: true, id: pedidoId, numero_pedido: numero });
        } catch (e) { try { await conn.rollback(); } catch (_) {} next(e); }
        finally { conn.release(); }
    });

    // ETAPAS DAS COMPRAS (kanban) — agrega requisicoes + pedidos_compra + nf_entrada em 6 etapas.
    // Cada coluna vem de uma entidade (tolera tabela/coluna ausente -> array vazio).
    router.get('/etapas', async (req, res, next) => {
        const safe = async (sql, params = []) => { try { const [r] = await pool.query(sql, params); return r; } catch (e) { return []; } };
        try {
            const out = {};
            out.requisicao = await safe("SELECT * FROM requisicoes WHERE COALESCE(status,'pendente') IN ('pendente','aberta','rascunho','em_aprovacao','aguardando','aguardando_aprovacao') ORDER BY id DESC LIMIT 200");
            out.pedido = await safe("SELECT pc.*, COALESCE(f.razao_social, f.nome) AS fornecedor_nome FROM pedidos_compra pc LEFT JOIN fornecedores f ON pc.fornecedor_id = f.id WHERE pc.status IN ('aprovado','enviado') ORDER BY pc.id DESC LIMIT 200");
            out.aprovacao = await safe("SELECT pc.*, COALESCE(f.razao_social, f.nome) AS fornecedor_nome FROM pedidos_compra pc LEFT JOIN fornecedores f ON pc.fornecedor_id = f.id WHERE pc.status IN ('pendente','rascunho','em_aprovacao') ORDER BY pc.id DESC LIMIT 200");
            out.faturado = await safe("SELECT * FROM nf_entrada WHERE COALESCE(status,'pendente') IN ('pendente','faturado','importada') ORDER BY id DESC LIMIT 200");
            out.recebido = await safe("SELECT * FROM nf_entrada WHERE status IN ('recebido','parcial') ORDER BY id DESC LIMIT 200");
            out.conferido = await safe("SELECT * FROM nf_entrada WHERE status IN ('conferido','concluido','finalizado') ORDER BY id DESC LIMIT 200");
            const counts = {}; Object.keys(out).forEach(k => counts[k] = out[k].length);
            res.json({ success: true, etapas: out, counts });
        } catch (error) { next(error); }
    });

    // ===================== RELATÓRIOS DE COMPRAS =====================

    // Relatório de gastos por período
    router.get('/relatorios/gastos-periodo', async (req, res, next) => {
        try {
            const { data_inicio, data_fim, fornecedor_id } = req.query;

            let whereClause = 'WHERE pc.status = "aprovado"';
            const params = [];

            if (data_inicio && data_fim) {
                whereClause += ' AND pc.data_pedido BETWEEN ? AND ?';
                params.push(data_inicio, data_fim);
            }

            if (fornecedor_id) {
                whereClause += ' AND pc.fornecedor_id = ?';
                params.push(fornecedor_id);
            }

            const [gastos] = await pool.query(`
                SELECT
                    COALESCE(f.razao_social, f.nome) as fornecedor,
                    COUNT(pc.id) as total_pedidos,
                    SUM(pc.valor_total) as total_gasto,
                    AVG(pc.valor_total) as ticket_medio
                FROM pedidos_compra pc
                LEFT JOIN fornecedores f ON pc.fornecedor_id = f.id
                ${whereClause}
                GROUP BY pc.fornecedor_id, f.razao_social, f.nome
                ORDER BY total_gasto DESC
            `, params);

            res.json({
                success: true,
                data: { gastos }
            });
        } catch (error) {
            next(error);
        }
    });

    // ===================== ROTAS DE RECEBIMENTO =====================

    // Estatísticas de Recebimento
    router.get('/recebimento/stats', async (req, res, next) => {
        try {
            const hoje = new Date().toISOString().split('T')[0];

            const [pendentes] = await pool.query(`
                SELECT COUNT(*) as total FROM pedidos_compra
                WHERE status IN ('aprovado', 'enviado', 'pendente')
                AND data_recebimento IS NULL
            `);

            const [atrasados] = await pool.query(`
                SELECT COUNT(*) as total FROM pedidos_compra
                WHERE status IN ('aprovado', 'enviado', 'pendente')
                AND data_recebimento IS NULL
                AND data_entrega_prevista < ?
            `, [hoje]);

            const [recebidosHoje] = await pool.query(`
                SELECT COUNT(*) as total FROM pedidos_compra
                WHERE DATE(data_recebimento) = ?
            `, [hoje]);

            const [valorPendente] = await pool.query(`
                SELECT COALESCE(SUM(valor_total), 0) as total FROM pedidos_compra
                WHERE status IN ('aprovado', 'enviado', 'pendente')
                AND data_recebimento IS NULL
            `);

            res.json({
                pendentes: pendentes[0].total || 0,
                atrasados: atrasados[0].total || 0,
                recebidos_hoje: recebidosHoje[0].total || 0,
                valor_pendente: valorPendente[0].total || 0
            });
        } catch (error) {
            console.error('Erro ao buscar estatísticas de recebimento:', error);
            next(error);
        }
    });

    // Listar Pedidos para Recebimento
    router.get('/recebimento/pedidos', async (req, res, next) => {
        try {
            const { status = 'pendente', offset = 0, busca } = req.query;
            const limit = Math.min(parseInt(req.query.limit) || 50, 500); // cap em 500
            const hoje = new Date().toISOString().split('T')[0];

            let sql = `
                SELECT pc.*, COALESCE(f.razao_social, f.nome) as fornecedor_nome
                FROM pedidos_compra pc
                LEFT JOIN fornecedores f ON pc.fornecedor_id = f.id
                WHERE 1=1
            `;
            const params = [];

            if (status === 'pendente') {
                sql += ` AND pc.status IN ('aprovado', 'enviado', 'pendente')
                         AND pc.data_recebimento IS NULL`;
            } else if (status === 'atrasado') {
                sql += ` AND pc.status IN ('aprovado', 'enviado', 'pendente')
                         AND pc.data_recebimento IS NULL
                         AND pc.data_entrega_prevista < ?`;
                params.push(hoje);
            } else if (status === 'recebido') {
                sql += ` AND pc.status = 'recebido'`;
            } else if (status === 'parcial') {
                sql += ` AND pc.status = 'parcial'`;
            }

            if (busca) {
                sql += ` AND (pc.numero_pedido LIKE ? OR f.razao_social LIKE ? OR pc.numero_nfe LIKE ?)`;
                const buscaTerm = `%${busca}%`;
                params.push(buscaTerm, buscaTerm, buscaTerm);
            }

            sql += ` ORDER BY
                CASE WHEN pc.data_entrega_prevista < ? AND pc.status != 'recebido' THEN 0 ELSE 1 END,
                pc.data_entrega_prevista ASC, pc.data_pedido DESC
            `;
            params.push(hoje);

            // Count total — query explícita para não depender de regex frágil
            let countSql = `
                SELECT COUNT(*) as total
                FROM pedidos_compra pc
                LEFT JOIN fornecedores f ON pc.fornecedor_id = f.id
                WHERE 1=1
            `;
            const countParams = [];

            if (status === 'pendente') {
                countSql += ` AND pc.status IN ('aprovado', 'enviado', 'pendente')
                         AND pc.data_recebimento IS NULL`;
            } else if (status === 'atrasado') {
                countSql += ` AND pc.status IN ('aprovado', 'enviado', 'pendente')
                         AND pc.data_recebimento IS NULL
                         AND pc.data_entrega_prevista < ?`;
                countParams.push(hoje);
            } else if (status === 'recebido') {
                countSql += ` AND pc.status = 'recebido'`;
            } else if (status === 'parcial') {
                countSql += ` AND pc.status = 'parcial'`;
            }

            if (busca) {
                countSql += ` AND (pc.numero_pedido LIKE ? OR f.razao_social LIKE ? OR pc.numero_nfe LIKE ?)`;
                const buscaTerm = `%${busca}%`;
                countParams.push(buscaTerm, buscaTerm, buscaTerm);
            }

            const [countResult] = await pool.query(countSql, countParams);
            const total = countResult[0].total;

            sql += ` LIMIT ? OFFSET ?`;
            params.push(parseInt(limit), parseInt(offset));

            const [pedidos] = await pool.query(sql, params);

            res.json({
                pedidos,
                total,
                limit: parseInt(limit),
                offset: parseInt(offset)
            });
        } catch (error) {
            console.error('Erro ao listar pedidos para recebimento:', error);
            next(error);
        }
    });

    // Centros de Custo
    router.get('/centros-custo', async (req, res, next) => {
        try {
            const [rows] = await pool.query('SELECT id, nome FROM centros_custo WHERE ativo = 1 ORDER BY nome');
            res.json(rows);
        } catch (error) {
            res.json([{ id: 1, nome: 'Vendas' }, { id: 2, nome: 'Marketing' }, { id: 3, nome: 'Produção' }, { id: 4, nome: 'Administrativo' }]);
        }
    });

    return router;
};

