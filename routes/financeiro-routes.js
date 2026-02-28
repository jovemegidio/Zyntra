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
    
    // 1. Conciliação Bancária Automatizada
    router.post('/conciliacao/importar-ofx', async (req, res, next) => {
        res.json({ message: 'Importação de OFX recebida. (Simulação)' });
    });
    router.get('/conciliacao', async (req, res, next) => {
        res.json({ conciliados: [], divergentes: [] });
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
    
    // 4. Gestão de Transações Recorrentes
    router.get('/transacoes-recorrentes', async (req, res, next) => {
        res.json([]);
    });
    router.post('/transacoes-recorrentes', async (req, res, next) => {
        res.status(201).json({ message: 'Transação recorrente agendada.' });
    });
    
    // 5. Emissão de Boletos e Notas Fiscais (NFS-e)
    router.post('/emitir-boleto', async (req, res, next) => {
        res.json({ message: 'Boleto emitido (simulação).' });
    });
    router.post('/emitir-nfse', async (req, res, next) => {
        res.json({ message: 'NFS-e emitida (simulação).' });
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
                    categoria,
                    COALESCE(SUM(valor), 0) as total
                FROM contas_receber
                ${whereClause} AND status = 'pago'
                GROUP BY categoria
            `, params);
    
            // Despesas
            const [despesas] = await pool.query(`
                SELECT
                    categoria,
                    COALESCE(SUM(valor), 0) as total
                FROM contas_pagar
                ${whereClause} AND status = 'pago'
                GROUP BY categoria
            `, params);
    
            const total_receitas = receitas.reduce((sum, item) => sum + item.total, 0);
            const total_despesas = despesas.reduce((sum, item) => sum + item.total, 0);
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
                    mensagem: `${emAtraso[0].count} conta(s) em atraso totalizando R$ ${emAtraso[0].valor_total.toFixed(2)}`,
                    quantidade: emAtraso[0].count,
                    valor: emAtraso[0].valor_total
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
            const [rows] = await pool.query('SELECT id, cliente_id, valor, descricao, status, data_vencimento, data_pagamento, created_at FROM contas_receber ORDER BY id DESC LIMIT ? OFFSET ?', [limit, offset]);
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
        res.status(201).json({ message: 'Orçamento criado (simulação).' });
    });
    router.get('/orcamentos', authorizeACL('ver_orcamento'), async (req, res, next) => {
        res.json([{ categoria: 'Marketing', limite: 10000, gasto: 5000 }]);
    });
    router.get('/orcamentos/alertas', authorizeACL('ver_orcamento'), async (req, res, next) => {
        res.json([{ categoria: 'Marketing', alerta: 'Limite próximo de ser atingido.' }]);
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
            const [[{ total }]] = await pool.execute('SELECT COUNT(*) as total FROM fornecedores WHERE ativo = 1');
            const [fornecedores] = await pool.execute(
                'SELECT id, razao_social, nome_fantasia, cnpj, email, telefone, cidade, uf, ativo, created_at FROM fornecedores WHERE ativo = 1 ORDER BY razao_social LIMIT ? OFFSET ?',
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
            const [[{ total }]] = await pool.execute('SELECT COUNT(*) as total FROM clientes WHERE ativo = 1');
            const [clientes] = await pool.execute(
                'SELECT id, razao_social, nome_fantasia, cnpj, cpf, email, telefone, cidade, uf, ativo, created_at FROM clientes WHERE ativo = 1 ORDER BY razao_social LIMIT ? OFFSET ?',
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
