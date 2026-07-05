/**
 * MISC API ROUTES - Extracted from server.js (Lines 16502-17345)
 * User API, dashboard KPIs, avisos/SSE, kanban, notifications
 * @module routes/misc-routes
 */
const express = require('express');
let logger;
try { logger = require('../src/logger'); } catch(_) { logger = console; }

module.exports = function createMiscRoutes(deps) {
    const { pool, authenticateToken, authorizeArea, writeAuditLog, cacheMiddleware, CACHE_CONFIG, jwt, JWT_SECRET } = deps;
    const router = express.Router();

    function normalizarCodigoCondicaoPagamento(valor) {
        if (valor == null || valor === '') return null;
        const raw = String(valor).trim();
        const lower = raw.toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/\s+/g, ' ');
        if (['a vista', 'a_vista', 'avista', 'av', '0'].includes(lower)) return 'a_vista';
        const onlyNumbers = raw.replace(/[^\d/_-]+/g, '').replace(/[-_]+/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
        if (/^\d+(\/\d+)*$/.test(onlyNumbers)) return onlyNumbers;
        return raw.replace(/_/g, '/');
    }

    function formatarDescricaoCondicaoPagamento(valor) {
        const codigo = normalizarCodigoCondicaoPagamento(valor);
        if (!codigo) return 'A combinar';
        if (codigo === 'a_vista') return 'À Vista';
        if (/^\d+$/.test(codigo)) return `${codigo} dias`;
        if (/^\d+(\/\d+)+$/.test(codigo)) return `${codigo} dias`;
        return codigo;
    }
    // Rota para obter informações do usuário logado
    router.get('/user/me', authenticateToken, async (req, res) => {
        try {
            if (!req.user) {
                return res.status(401).json({ error: 'Usuário não autenticado' });
            }
    
            // Buscar informações completas do usuário no banco
            const [rows] = await pool.query(
                'SELECT id, nome_completo as nome, email, departamento as setor, avatar, foto_perfil_url FROM funcionarios WHERE email = ?',
                [req.user.email]
            );
    
            if (rows.length > 0) {
                const user = rows[0];
                // Determinar avatar baseado no nome (fallback)
                const firstName = user.nome ? user.nome.split(' ')[0].toLowerCase() : '';
                const avatarMap = {
                    'douglas': '/avatars/douglas.webp',
                    'andreia': '/avatars/andreia.webp',
                    'ti': '/avatars/ti.webp',
                    'clemerson': '/avatars/clemerson.webp',
                    'thiago': '/avatars/thiago.webp',
                    'guilherme': '/avatars/guilherme.webp',
                    'junior': '/avatars/junior.webp',
                    'hellen': '/avatars/hellen.webp',
                    'antonio': '/avatars/antonio.webp',
                    'egidio': '/avatars/egidio.webp'
                };
    
                // Prioridade: foto_perfil_url > avatar no banco > mapa por nome > default
                let fotoUrl = '/avatars/default.webp';
                if (user.foto_perfil_url && user.foto_perfil_url !== 'default.webp') {
                    fotoUrl = user.foto_perfil_url;
                } else if (user.avatar && user.avatar !== 'default.webp') {
                    fotoUrl = user.avatar.startsWith('/') ? user.avatar : `/avatars/${user.avatar}`;
                } else if (avatarMap[firstName]) {
                    fotoUrl = avatarMap[firstName];
                }
    
                res.json({
                    id: user.id,
                    nome: user.nome,
                    email: user.email,
                    setor: user.setor,
                    avatar: fotoUrl,
                    foto_perfil_url: fotoUrl
                });
            } else {
                // Fallback para usuários sem registro no banco
                res.json({
                    nome: req.user.nome || req.user.email,
                    email: req.user.email,
                    setor: 'N/A',
                    avatar: '/avatars/default.webp',
                    foto_perfil_url: '/avatars/default.webp'
                });
            }
        } catch (error) {
            console.error('Erro ao buscar informações do usuário:', error);
            res.status(500).json({ error: 'Erro interno do servidor' });
        }
    });
    
    // ===================== API DE NOTIFICAÇÕES DO CHAT =====================
    // Endpoint para notificar suporte técnico via chat (requer autenticação)
    router.post('/notify-support', authenticateToken, express.json(), async (req, res) => {
        try {
            const { userName, userEmail, message, timestamp } = req.body;
    
            if (!userName || !userEmail || !message) {
                return res.status(400).json({
                    success: false,
                    error: 'Dados incompletos'
                });
            }
    
            // Log da notificação
            logger.info(`[CHAT-SUPPORT] Nova solicitação de ${userName} (${userEmail})`);
            console.log(`📧 [CHAT-SUPPORT] Usuário: ${userName} | Email: ${userEmail}`);
            console.log(`📧 [CHAT-SUPPORT] Mensagem: ${message.substring(0, 100)}...`);
    
            // Enviar email para TI via Nodemailer
            const emailHtml = `
                <!DOCTYPE html>
                <html>
                <head>
                    <style>
                        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                        .header { background: linear-gradient(135deg, #00b894, #00cec9); color: white; padding: 20px; border-radius: 8px 8px 0 0; }
                        .header h1 { margin: 0; font-size: 24px; }
                        .content { background: #f8f9fa; padding: 20px; border: 1px solid #e8ecf1; }
                        .info-row { margin: 10px 0; padding: 10px; background: white; border-radius: 4px; }
                        .info-label { font-weight: bold; color: #00b894; }
                        .message-box { background: white; padding: 15px; border-left: 4px solid #00b894; margin-top: 15px; }
                        .footer { text-align: center; color: #7f8c8d; padding: 20px; font-size: 12px; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="header">
                            <h1>💬 Nova Solicitação de Suporte - Chat ALUFORCE</h1>
                        </div>
                        <div class="content">
                            <div class="info-row">
                                <span class="info-label">👤 Usuário:</span> ${userName}
                            </div>
                            <div class="info-row">
                                <span class="info-label">📧 Email:</span> ${userEmail}
                            </div>
                            <div class="info-row">
                                <span class="info-label">🕐 Data/Hora:</span> ${new Date(timestamp).toLocaleString('pt-BR')}
                            </div>
                            <div class="message-box">
                                <strong>📝 Mensagem:</strong><br><br>
                                ${message.replace(/\n/g, '<br>')}
                            </div>
                            <p style="margin-top: 20px; color: #7f8c8d; font-size: 14px;">
                                <strong>📍 Próximos passos:</strong><br>
                                • Entre em contato com o usuário via email ou telefone<br>
                                • Acesse o painel admin do chat: <a href="http://localhost:3002/admin">http://localhost:3002/admin</a><br>
                                • Responda diretamente pelo sistema de chat
                            </p>
                        </div>
                        <div class="footer">
                            Sistema ALUFORCE v2.0 | Chat Widget com Bob<br>
                            © ${new Date().getFullYear()} ALUFORCE - Todos os direitos reservados
                        </div>
                    </div>
                </body>
                </html>
            `;
    
            // Tentar enviar email
            const emailResult = await sendEmail(
                'ti@aluforce.ind.br',
                `[CHAT] Suporte solicitado por ${userName}`,
                emailHtml
            );
    
            res.json({
                success: true,
                message: emailResult.success
                    ? 'Notificação enviada ao suporte técnico via email'
                    : 'Notificação registrada (email não enviado - SMTP não configurado)',
                supportEmail: 'ti@aluforce.ind.br',
                emailSent: emailResult.success
            });
    
        } catch (error) {
            logger.error('[CHAT-SUPPORT] Erro ao processar notificação:', error);
            res.status(500).json({
                success: false,
                error: 'Erro ao enviar notificação'
            });
        }
    });
    
    // Rota para verificar sessão ativa (compatibilidade com módulos)
    router.get('/verificar-sessao', async (req, res) => {
        try {
            // SECURITY: Busca token apenas em header e cookies (não query string)
            const authHeader = req.headers['authorization'];
            const token = (authHeader && authHeader.split(' ')[1]) ||
                         req.cookies?.authToken ||
                         req.cookies?.token;
    
            console.log('[VERIFICAR-SESSAO] Token encontrado:', !!token);
    
            if (!token) {
                console.log('[VERIFICAR-SESSAO] Nenhum token - retornando não autenticado');
                return res.json({ autenticado: false });
            }
    
            // Verificar token JWT usando promise
            // AUDIT-FIX HIGH-006: Enforce HS256 algorithm
            const user = await new Promise((resolve, reject) => {
                jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }, (err, decoded) => {
                    if (err) reject(err);
                    else resolve(decoded);
                });
            }).catch(err => {
                console.log('[VERIFICAR-SESSAO] Token inválido:', err.message);
                return null;
            });
    
            if (!user) {
                return res.json({ autenticado: false });
            }
    
            console.log('[VERIFICAR-SESSAO] Token válido para:', user.email);
    
            // Buscar informações completas do usuário
            const [rows] = await pool.query(
                'SELECT id, nome_completo as nome, email, departamento as setor, role FROM funcionarios WHERE email = ?',
                [user.email]
            );
    
            if (rows.length > 0) {
                const dbUser = rows[0];
                const firstName = dbUser.nome.split(' ')[0].toLowerCase();
    
                // Determinar avatar
                const avatarMap = {
                    'douglas': 'douglas.webp',
                    'andreia': 'andreia.webp',
                    'ti': 'ti.webp',
                    'clemerson': 'clemerson.webp',
                    'thiago': 'thiago.webp',
                    'guilherme': 'guilherme.webp',
                    'junior': 'junior.webp',
                    'hellen': 'hellen.webp'
                };
    
                // Verificar se é admin baseado apenas no campo role do banco + token JWT
                const isAdmin = dbUser.role === 'admin' || user.is_admin === 1;
    
                console.log('[VERIFICAR-SESSAO] Usuário autenticado:', firstName, 'Admin:', isAdmin);
    
                return res.json({
                    autenticado: true,
                    usuario: {
                        id: dbUser.id,
                        nome: dbUser.nome,
                        firstName: firstName,
                        email: dbUser.email,
                        setor: dbUser.setor,
                        role: dbUser.role || 'user',
                        isAdmin: isAdmin,
                        is_admin: isAdmin ? 1 : 0,
                        avatar: avatarMap[firstName] || 'default.webp'
                    }
                });
            } else {
                // Fallback para usuários da tabela usuarios
                const firstName = (user.nome || user.email).split(' ')[0].toLowerCase();
                // SECURITY: isAdmin baseado apenas no JWT claim, sem lista hardcoded de nomes
                const isAdmin = user.is_admin === 1 || user.role === 'admin';
    
                console.log('[VERIFICAR-SESSAO] Usuário autenticado (fallback):', firstName);
    
                return res.json({
                    autenticado: true,
                    usuario: {
                        id: user.id,
                        nome: user.nome || user.email,
                        firstName: firstName,
                        email: user.email,
                        setor: 'N/A',
                        role: user.role || 'user',
                        isAdmin: isAdmin,
                        is_admin: isAdmin ? 1 : 0,
                        avatar:'/avatars/default.webp'
                    }
                });
            }
        } catch (error) {
            console.error('[VERIFICAR-SESSAO] Erro ao buscar usuário:', error);
            return res.json({ autenticado: false });
        }
    });
    
    // Rotas globais de avisos (para compatibilidade)
    router.get('/avisos', authenticateToken, async (req, res) => {
        try {
            // AUDIT-FIX ARCH-002: Removed duplicate CREATE TABLE (already in RH module)
    
            const usuario_id = req.user.id;
            const [rows] = await pool.query(
                'SELECT * FROM avisos WHERE usuario_id = ? OR usuario_id IS NULL ORDER BY created_at DESC LIMIT 50',
                [usuario_id]
            );
            res.json(rows);
        } catch (e) {
            console.error('Erro ao buscar avisos:', e);
            res.json([]);
        }
    });
    
    router.get('/avisos/stream', authenticateToken, async (req, res) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.write(': connected\n\n');
    
        const interval = setInterval(() => {
            res.write('data: {"type":"ping"}\n\n');
        }, 30000);
    
        req.on('close', () => {
            clearInterval(interval);
        });
    });
    
    router.post('/avisos/sse-handshake', authenticateToken, async (req, res) => {
        res.json({ success: true });
    });
    
    router.get('/funcionarios/:id/doc-status', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
    
            if (req.user.id !== parseInt(id) && req.user.role !== 'admin' && req.user.is_admin !== 1) {
                return res.status(403).json({ message: 'Acesso negado' });
            }
    
            const [rows] = await pool.query(`
                SELECT
                    CASE WHEN cpf IS NOT NULL AND cpf != '' THEN 1 ELSE 0 END as cpf_ok,
                    CASE WHEN rg IS NOT NULL AND rg != '' THEN 1 ELSE 0 END as rg_ok,
                    CASE WHEN ctps IS NOT NULL AND ctps != '' THEN 1 ELSE 0 END as ctps_ok,
                    CASE WHEN pis_pasep IS NOT NULL AND pis_pasep != '' THEN 1 ELSE 0 END as pis_ok,
                    CASE WHEN titulo_eleitor IS NOT NULL AND titulo_eleitor != '' THEN 1 ELSE 0 END as titulo_ok,
                    CASE WHEN certificado_reservista IS NOT NULL AND certificado_reservista != '' THEN 1 ELSE 0 END as reservista_ok,
                    CASE WHEN cnh IS NOT NULL AND cnh != '' THEN 1 ELSE 0 END as cnh_ok
                FROM funcionarios
                WHERE id = ?
            `, [id]);
    
            if (rows.length === 0) {
                return res.json({
                    cpf_ok: 0, rg_ok: 0, ctps_ok: 0, pis_ok: 0,
                    titulo_ok: 0, reservista_ok: 0, cnh_ok: 0
                });
            }
    
            res.json(rows[0]);
        } catch (error) {
            res.json({
                cpf_ok: 0, rg_ok: 0, ctps_ok: 0, pis_ok: 0,
                titulo_ok: 0, reservista_ok: 0, cnh_ok: 0
            });
        }
    });
    
    // ============================================================================
    // DASHBOARD PRINCIPAL - KPIs DE RESUMO (CONTAS A PAGAR, RECEBER, PEDIDOS)
    // Acesso: Fernando, Antonio (T.I), Andreia, Douglas, Consultoria, Admins
    // Auto-refresh: Frontend faz polling a cada 30s para dados em tempo real
    // ============================================================================
    router.get('/dashboard/kpis-principal', authenticateToken, cacheMiddleware('dash_kpis', CACHE_CONFIG.dashboardKPIs), async (req, res) => {
        // Validação server-side dos usuários autorizados
        const KPI_EMAILS = ['fernando@aluforce.ind.br','fernando.kofugi@aluforce.ind.br','ti@aluforce.ind.br','andreia@aluforce.ind.br','douglas@aluforce.ind.br'];
        const KPI_ROLES = ['admin','administrador','consultoria'];
        const userEmail = (req.user?.email || '').toLowerCase();
        const userRole = (req.user?.role || '').toLowerCase();
        const isAdmin = req.user?.is_admin === 1 || req.user?.is_admin === true || req.user?.is_admin === '1';
        const autorizado = isAdmin || KPI_ROLES.includes(userRole) || KPI_EMAILS.includes(userEmail);
    
        if (!autorizado) {
            return res.status(403).json({ success: false, message: 'Sem permissão para acessar KPIs' });
        }
    
        try {
            const hoje = new Date().toISOString().split('T')[0];
            const inicioMes = new Date();
            inicioMes.setDate(1);
            const inicioMesStr = inicioMes.toISOString().split('T')[0];
    
            // Contas a Pagar - total em aberto
            let contasPagar = { valor: 0, quantidade: 0 };
            try {
                // Primeiro tenta buscar da tabela contas_pagar
                const [result] = await pool.query(`
                    SELECT COALESCE(SUM(valor), 0) as total, COUNT(*) as qtd
                    FROM contas_pagar
                    WHERE status IS NULL OR status NOT IN ('pago', 'cancelado', 'quitado')
                `);
                contasPagar.valor = parseFloat(result[0]?.total || 0);
                contasPagar.quantidade = result[0]?.qtd || 0;
            } catch (e) {
                console.log('[Dashboard KPIs] Erro contas_pagar:', e.message);
            }
    
            // Contas a Receber - pedidos faturados aguardando pagamento
            let contasReceber = { valor: 0, quantidade: 0 };
            try {
                // Busca pedidos faturados que são valores a receber
                const [result] = await pool.query(`
                    SELECT COALESCE(SUM(valor), 0) as total, COUNT(*) as qtd
                    FROM pedidos
                    WHERE status IN ('faturado', 'recibo')
                `);
                contasReceber.valor = parseFloat(result[0]?.total || 0);
                contasReceber.quantidade = result[0]?.qtd || 0;
    
                // Se não houver pedidos faturados, tenta a tabela contas_receber
                if (contasReceber.quantidade === 0) {
                    const [result2] = await pool.query(`
                        SELECT COALESCE(SUM(valor), 0) as total, COUNT(*) as qtd
                        FROM contas_receber
                        WHERE status IS NULL OR status NOT IN ('pago', 'cancelado', 'recebido', 'quitado')
                    `);
                    contasReceber.valor = parseFloat(result2[0]?.total || 0);
                    contasReceber.quantidade = result2[0]?.qtd || 0;
                }
            } catch (e) {
                console.log('[Dashboard KPIs] Erro contas_receber:', e.message);
            }
    
            // Pedidos a Faturar (aprovados, pendentes faturamento)
            let pedidosFaturar = { valor: 0, quantidade: 0 };
            try {
                const [result] = await pool.query(`
                    SELECT COALESCE(SUM(valor), 0) as total, COUNT(*) as qtd
                    FROM pedidos
                    WHERE status IN ('aprovado', 'faturar', 'pendente', 'confirmado', 'aguardando_faturamento', 'orcamento', 'analise')
                `);
                pedidosFaturar.valor = parseFloat(result[0]?.total || 0);
                pedidosFaturar.quantidade = result[0]?.qtd || 0;
            } catch (e) {
                console.log('[Dashboard KPIs] Erro pedidos:', e.message);
            }
    
            console.log('[Dashboard KPIs] Dados:', { contasPagar, contasReceber, pedidosFaturar });
    
            res.json({
                success: true,
                contas_pagar: contasPagar,
                contas_receber: contasReceber,
                pedidos_faturar: pedidosFaturar
            });
        } catch (error) {
            console.error('[Dashboard KPIs] Erro geral:', error);
            res.status(500).json({
                success: false,
                message: 'Erro ao buscar KPIs',
                contas_pagar: { valor: 0, quantidade: 0 },
                contas_receber: { valor: 0, quantidade: 0 },
                pedidos_faturar: { valor: 0, quantidade: 0 }
            });
        }
    });
    
    // ============================================================================
    // DASHBOARD EXECUTIVO - KPIs DE TODOS OS MÓDULOS
    // ============================================================================
    router.get('/dashboard/executivo', authenticateToken, cacheMiddleware('dash_exec', CACHE_CONFIG.dashboardExec), async (req, res) => {
        try {
            const periodo = parseInt(req.query.periodo) || 30;
            const dataInicio = new Date();
            dataInicio.setDate(dataInicio.getDate() - periodo);
            const dataInicioStr = dataInicio.toISOString().split('T')[0];
    
            // Resumo Financeiro
            let resumoFinanceiro = {
                receitas: 0,
                despesas: 0,
                lucro_estimado: 0,
                margem_percentual: 0,
                faturamento_periodo: 0,
                nfes_emitidas: 0
            };
    
            try {
                // Receitas (títulos a receber pagos)
                const [receitasResult] = await pool.query(`
                    SELECT COALESCE(SUM(valor), 0) as total
                    FROM contas_receber
                    WHERE status = 'pago' AND data_pagamento >= ?
                `, [dataInicioStr]);
                resumoFinanceiro.receitas = receitasResult[0]?.total || 0;
    
                // Despesas (títulos a pagar pagos)
                const [despesasResult] = await pool.query(`
                    SELECT COALESCE(SUM(valor), 0) as total
                    FROM contas_pagar
                    WHERE status = 'pago' AND data_pagamento >= ?
                `, [dataInicioStr]);
                resumoFinanceiro.despesas = despesasResult[0]?.total || 0;
    
                // Calcular lucro e margem
                resumoFinanceiro.lucro_estimado = resumoFinanceiro.receitas - resumoFinanceiro.despesas;
                resumoFinanceiro.margem_percentual = resumoFinanceiro.receitas > 0
                    ? ((resumoFinanceiro.lucro_estimado / resumoFinanceiro.receitas) * 100).toFixed(1)
                    : 0;
    
                // Faturamento (pedidos faturados)
                const [faturamentoResult] = await pool.query(`
                    SELECT COALESCE(SUM(valor), 0) as total, COUNT(*) as nfes
                    FROM pedidos
                    WHERE status IN ('faturado', 'recibo') AND data_criacao >= ?
                `, [dataInicioStr]);
                resumoFinanceiro.faturamento_periodo = faturamentoResult[0]?.total || 0;
                resumoFinanceiro.nfes_emitidas = faturamentoResult[0]?.nfes || 0;
            } catch (e) {
                console.log('[Dashboard] Erro ao buscar financeiro:', e.message);
            }
    
            // KPIs de Vendas
            let vendas = { total_pedidos: 0, taxa_conversao: 0, ticket_medio: 0 };
            try {
                const [vendasResult] = await pool.query(`
                    SELECT COUNT(*) as total,
                           COALESCE(AVG(valor), 0) as ticket,
                           SUM(CASE WHEN status IN ('aprovado', 'faturar', 'faturado', 'entregue') THEN 1 ELSE 0 END) as convertidos
                    FROM pedidos
                    WHERE data_criacao >= ?
                `, [dataInicioStr]);
                vendas.total_pedidos = vendasResult[0]?.total || 0;
                vendas.ticket_medio = vendasResult[0]?.ticket || 0;
                vendas.taxa_conversao = vendas.total_pedidos > 0
                    ? ((vendasResult[0]?.convertidos || 0) / vendas.total_pedidos * 100).toFixed(1)
                    : 0;
            } catch (e) {
                console.log('[Dashboard] Erro ao buscar vendas:', e.message);
            }
    
            // KPIs de Compras
            let compras = { total_pedidos: 0, pedidos_pendentes: 0, economia_gerada: 0 };
            try {
                const [comprasResult] = await pool.query(`
                    SELECT COUNT(*) as total,
                           SUM(CASE WHEN status IN ('pendente', 'aguardando', 'analise') THEN 1 ELSE 0 END) as pendentes
                    FROM pedidos_compra
                    WHERE data_criacao >= ?
                `, [dataInicioStr]);
                compras.total_pedidos = comprasResult[0]?.total || 0;
                compras.pedidos_pendentes = comprasResult[0]?.pendentes || 0;
            } catch (e) {
                console.log('[Dashboard] Erro ao buscar compras:', e.message);
            }
    
            // KPIs de Produção (PCP)
            let producao = { ordens_producao: 0, eficiencia_percentual: 0, alertas_estoque: 0 };
            try {
                const [pcpResult] = await pool.query(`
                    SELECT COUNT(*) as total,
                           SUM(CASE WHEN status = 'concluida' THEN 1 ELSE 0 END) as concluidas
                    FROM ordens_producao
                    WHERE data_criacao >= ?
                `, [dataInicioStr]);
                producao.ordens_producao = pcpResult[0]?.total || 0;
                producao.eficiencia_percentual = producao.ordens_producao > 0
                    ? ((pcpResult[0]?.concluidas || 0) / producao.ordens_producao * 100).toFixed(1)
                    : 0;
    
                // Alertas de estoque baixo
                const [estoqueResult] = await pool.query(`
                    SELECT COUNT(*) as alertas FROM produtos
                    WHERE estoque_atual <= estoque_minimo AND estoque_minimo > 0
                `);
                producao.alertas_estoque = estoqueResult[0]?.alertas || 0;
            } catch (e) {
                console.log('[Dashboard] Erro ao buscar PCP:', e.message);
            }
    
            // KPIs de RH
            let rh = { total_funcionarios: 0, ferias_programadas: 0, aniversariantes_mes: 0 };
            try {
                const [rhResult] = await pool.query(`
                    SELECT COUNT(*) as total FROM funcionarios WHERE ativo = 1 OR ativo IS NULL
                `);
                rh.total_funcionarios = rhResult[0]?.total || 0;
    
                // Férias (aproximado)
                const [feriasResult] = await pool.query(`
                    SELECT COUNT(*) as ferias FROM funcionarios
                    WHERE status_ferias = 'em_ferias' OR situacao = 'ferias'
                `);
                rh.ferias_programadas = feriasResult[0]?.ferias || 0;
    
                // Aniversariantes do mês
                const mesAtual = new Date().getMonth() + 1;
                const [anivResult] = await pool.query(`
                    SELECT COUNT(*) as aniversarios FROM funcionarios
                    WHERE MONTH(data_nascimento) = ? AND (ativo = 1 OR ativo IS NULL)
                `, [mesAtual]);
                rh.aniversariantes_mes = anivResult[0]?.aniversarios || 0;
            } catch (e) {
                console.log('[Dashboard] Erro ao buscar RH:', e.message);
            }
    
            // Alertas do sistema
            let alertas = [];
            try {
                // Títulos vencendo hoje (Financeiro)
                const [titulosResult] = await pool.query(`
                    SELECT COUNT(*) as vencendo FROM contas_pagar
                    WHERE status != 'pago' AND DATE(data_vencimento) = CURDATE()
                `);
                if (titulosResult[0]?.vencendo > 0) {
                    alertas.push({
                        tipo: 'warning',
                        modulo: 'Financeiro',
                        mensagem: `${titulosResult[0].vencendo} título(s) vencendo hoje`,
                        link: '/modules/Financeiro/index.html'
                    });
                }
    
                // Pedidos aguardando aprovação (Vendas)
                const [pedidosResult] = await pool.query(`
                    SELECT COUNT(*) as aguardando FROM pedidos
                    WHERE status IN ('orcamento', 'analise')
                `);
                if (pedidosResult[0]?.aguardando > 0) {
                    alertas.push({
                        tipo: 'info',
                        modulo: 'Vendas',
                        mensagem: `${pedidosResult[0].aguardando} pedido(s) aguardando aprovação`,
                        link: '/modules/Vendas/index.html'
                    });
                }
    
                // Alertas de estoque baixo (PCP)
                if (producao.alertas_estoque > 0) {
                    alertas.push({
                        tipo: 'danger',
                        modulo: 'Produção',
                        mensagem: `${producao.alertas_estoque} produto(s) com estoque baixo`,
                        link: '/modules/PCP/index.html'
                    });
                }
            } catch (e) {
                console.log('[Dashboard] Erro ao buscar alertas:', e.message);
            }
    
            res.json({
                resumo_executivo: resumoFinanceiro,
                vendas,
                compras,
                producao,
                rh,
                alertas,
                periodo_dias: periodo,
                atualizado_em: new Date().toISOString()
            });
    
        } catch (error) {
            console.error('[Dashboard Executivo] Erro:', error);
            res.status(500).json({ message: 'Erro ao carregar dashboard executivo' });
        }
    });
    
    // === KANBAN PÚBLICO === (Rota pública ANTES do router autenticado)
    router.get('/vendas/kanban/pedidos', authenticateToken, async (req, res) => {
        try {
            let pedidos = [];
    
            // Extrair filtros da query string
            const { vendedor, dataInclusao, dataPrevisao, dataFaturamento, exibirCancelados, exibirDenegados, exibirEncerrados } = req.query;
    
            // Construir WHERE dinâmico
            let whereConditions = [];
            let params = [];
    
            // Verificar se é admin
            const user = req.user || {};
            const isAdmin = user.is_admin === true || user.is_admin === 1 || (user.role && user.role.toString().toLowerCase() === 'admin');
    
            // Para vendedores (não-admin), filtrar apenas seus próprios pedidos
            const isComprasUser = String((req.user||{}).email||'').toLowerCase().indexOf('compras@') === 0;
            if (!isAdmin && !isComprasUser && user.id) {
                whereConditions.push('p.vendedor_id = ?');
                params.push(user.id);
            } else if (vendedor && vendedor !== 'todos') {
                // Admin pode filtrar por vendedor específico
                whereConditions.push('p.vendedor_id = ?');
                params.push(vendedor);
            }
    
            // Filtro por data de inclusão
            if (dataInclusao && dataInclusao !== 'tudo') {
                const dataFiltro = calcularDataFiltro(dataInclusao, 'passado');
                if (dataFiltro) {
                    whereConditions.push('p.created_at >= ?');
                    params.push(dataFiltro);
                }
            }
    
            // Filtro por data de faturamento (para status faturado/recibo)
            if (dataFaturamento && dataFaturamento !== 'tudo') {
                const dataFiltro = calcularDataFiltro(dataFaturamento, 'passado');
                if (dataFiltro) {
                    whereConditions.push("(p.status NOT IN ('faturado', 'recibo') OR p.updated_at >= ?)");
                    params.push(dataFiltro);
                }
            }
    
            // Status a excluir
            let statusExcluir = [];
            if (exibirCancelados !== 'true') statusExcluir.push('cancelado');
            if (exibirDenegados !== 'true') statusExcluir.push('denegado');
            if (exibirEncerrados !== 'true') statusExcluir.push('encerrado');
            // Sempre excluir pedidos com soft-delete (status = 'excluido')
            statusExcluir.push('excluido');
    
            if (statusExcluir.length > 0) {
                whereConditions.push(`p.status NOT IN (${statusExcluir.map(() => '?').join(', ')})`);
                params.push(...statusExcluir);
            }
    
            const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';
    
            try {
                const query = `
                    SELECT p.*,
                           COALESCE(c.nome_fantasia, c.razao_social, c.nome, p.cliente_nome, p.cliente, 'Cliente não informado') as cliente_nome,
                           c.email as cliente_email,
                           c.telefone as cliente_telefone,
                           COALESCE(NULLIF(u.nome, ''), NULLIF(p.vendedor_nome, '')) as vendedor_nome,
                           (SELECT COALESCE(SUM(COALESCE(pi.subtotal, pi.quantidade * pi.preco_unitario, 0)), 0)
                            FROM pedido_itens pi WHERE pi.pedido_id = p.id) as valor_itens
                    FROM pedidos p
                    LEFT JOIN clientes c ON p.cliente_id = c.id
                    LEFT JOIN usuarios u ON p.vendedor_id = u.id
                    ${whereClause}
                    ORDER BY p.id DESC
                    LIMIT 200
                `;
    
                console.log('[KANBAN] Query:', query.replace(/\s+/g, ' ').trim());
                console.log('[KANBAN] Params:', params);
    
                const [result] = await pool.query(query, params);
                pedidos = result;
            } catch (poolError) {
                console.warn('⚠️ Erro ao buscar pedidos:', poolError.message);
                return res.json([]);
            }
    
            if (!pedidos || pedidos.length === 0) {
                console.log('📋 Nenhum pedido encontrado com os filtros aplicados');
                return res.json([]);
            }
    
            const pedidosFormatados = pedidos.map(p => {
                // Priorizar valor dos itens, depois valor do pedido
                // Priorizar p.valor (já inclui IPI + ICMS ST + frete), fallback para valor_itens
                const valorFinal = parseFloat(p.valor) || parseFloat(p.valor_itens) || parseFloat(p.valor_total) || 0;
    
                // Gerar label baseado no status
                const statusLabel = {
                    'orcamento': 'Orçamento',
                    'analise-credito': 'Análise',
                    'pedido-aprovado': 'Pedido',
                    'faturar': 'Pedido',
                    'faturado': 'Faturado',
                    'recibo': 'Finalizado'
                };
                const labelNumero = statusLabel[p.status] || 'Pedido';
    
                const condicaoCodigo = normalizarCodigoCondicaoPagamento(p.condicao_pagamento || p.parcelas);
                const condicaoDescricao = formatarDescricaoCondicaoPagamento(condicaoCodigo || p.condicao_pagamento || p.parcelas);

                return {
                    id: p.id,
                    numero: `${labelNumero} Nº ${p.id}`,
                    cliente: p.cliente_nome || 'Cliente não informado',
                    cliente_nome: p.cliente_nome || 'Cliente não informado',
                    cliente_id: p.cliente_id || null,
                    valor: valorFinal,
                    valor_total: valorFinal,
                    total_ipi: parseFloat(p.total_ipi) || 0,
                    total_icms_st: parseFloat(p.total_icms_st) || 0,
                    frete: parseFloat(p.frete) || 0,
                    tipo_frete: p.tipo_frete || '',
                    status: p.status || 'orcamento',
                    origem: p.origem || 'Sistema',
                    vendedor: p.vendedor_nome || 'Não atribuído',
                    vendedor_nome: p.vendedor_nome || 'Não atribuído',
                    vendedor_id: p.vendedor_id,
                    parcelas: condicaoCodigo || 'a_vista',
                    condicoes_pagamento: condicaoDescricao,
                    transportadora: p.transportadora || p.transportadora_nome || p.metodo_envio || null,
                    transportadora_id: p.transportadora_id || null,
                    nf: p.nf || p.nota_fiscal || null,
                    numero_pedido: p.numero_pedido || p.id,
                    data_pedido: p.created_at,
                    created_at: p.created_at,
                    data_criacao: p.created_at,
                    data_inclusao: p.created_at,
                    observacao: p.observacao,
                    observacao_producao: p.observacao_producao || '',
                    mensagem: p.observacao,
                    // Campos de transporte
                    placa_veiculo: p.placa_veiculo || '',
                    veiculo_uf: p.veiculo_uf || '',
                    rntrc: p.rntrc || '',
                    qtd_volumes: p.qtd_volumes || 0,
                    especie_volumes: p.especie_volumes || '',
                    marca_volumes: p.marca_volumes || '',
                    numeracao_volumes: p.numeracao_volumes || '',
                    peso_liquido: parseFloat(p.peso_liquido) || 0,
                    peso_bruto: parseFloat(p.peso_bruto) || 0,
                    valor_seguro: parseFloat(p.valor_seguro) || 0,
                    tipo_entrega: p.tipo_entrega || '',
                    numero_lacre: p.numero_lacre || '',
                    outras_despesas: parseFloat(p.outras_despesas) || 0,
                    codigo_rastreio: p.codigo_rastreio || '',
                    cenario_fiscal: p.cenario_fiscal || '',
                    condicao_pagamento: condicaoCodigo || '',
                    desconto: parseFloat(p.desconto) || 0,
                    desconto_pct: parseFloat(p.desconto_pct) || 0
                };
            });
    
            res.json(pedidosFormatados);
        } catch (error) {
            console.error('❌ Erro no Kanban:', error);
            res.status(500).json({ error: 'Erro ao buscar pedidos para o Kanban' });
        }
    });
    
    // Função auxiliar para calcular datas de filtro
    function calcularDataFiltro(filtro, direcao = 'passado') {
        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);
    
        const dias = {
            'hoje': 0,
            'ontem': 1,
            'amanha': -1,
            'ultimos-3': 3,
            'ultimos-7': 7,
            'ultimos-15': 15,
            'ultimos-30': 30,
            'ultimos-60': 60,
            'ultimos-90': 90,
            'ultimos-120': 120,
            'ultimo-ano': 365,
            'proximos-3': -3,
            'proximos-7': -7,
            'proximos-15': -15,
            'proximos-30': -30,
            'proximos-90': -90
        };
    
        if (dias[filtro] !== undefined) {
            const data = new Date(hoje);
            if (direcao === 'passado') {
                data.setDate(data.getDate() - dias[filtro]);
            } else {
                data.setDate(data.getDate() + Math.abs(dias[filtro]));
            }
            return data.toISOString().split('T')[0];
        }
    
        return null;
    }
    
    // ----------------- ROTAS PÚBLICAS DE VENDAS (para autocomplete e itens) -----------------
    // Autocomplete de produtos - ROTA PÚBLICA (antes do middleware de auth)
    router.get('/vendas/produtos/autocomplete/:termo', authenticateToken, async (req, res) => {
        try {
            const { termo } = req.params;
            const limit = parseInt(req.query.limit) || 15;
    
            const [rows] = await pool.query(
                `SELECT id, codigo, nome as descricao, unidade_medida as unidade, preco_venda, COALESCE(estoque_atual, 0) as estoque_atual, localizacao as local_estoque
                 FROM produtos
                 WHERE (codigo LIKE ? OR nome LIKE ? OR gtin LIKE ?)
                 ORDER BY
                    CASE
                        WHEN codigo = ? THEN 1
                        WHEN codigo LIKE ? THEN 2
                        ELSE 3
                    END,
                    nome ASC
                 LIMIT ?`,
                [`%${termo}%`, `%${termo}%`, `%${termo}%`, termo, `${termo}%`, limit]
            );
    
            res.json(rows);
        } catch (error) {
            console.error('Erro no autocomplete de produtos:', error);
            if (error.code === 'ER_NO_SUCH_TABLE') return res.json([]);
            res.status(500).json({ error: 'Erro ao buscar produtos' });
        }
    });
    
    // Itens do pedido - ROTA PÚBLICA para listagem
    router.get('/vendas/pedidos/:id/itens', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            if (!id || id === 'null' || id === 'undefined' || !Number.isFinite(Number(id))) {
                return res.status(400).json({ error: 'ID do pedido inválido' });
            }
            const [itens] = await pool.query(
                'SELECT * FROM pedido_itens WHERE pedido_id = ? ORDER BY id ASC',
                [id]
            );
            res.json(itens);
        } catch (error) {
            console.error('Erro ao buscar itens do pedido:', error);
            if (error && error.code === 'ER_NO_SUCH_TABLE') return res.json([]);
            res.status(500).json({ error: 'Erro ao buscar itens' });
        }
    });
    
    
    // ========================================
    // SISTEMA DE NOTIFICAÇÕES (tabela notificacoes)
    // ========================================

    // GET /api/notifications - Listar notificações do usuário
    router.get('/notifications', authenticateToken, async (req, res) => {
        try {
            const userId = req.user.id;
            const filter = req.query.filter || 'all'; // 'all', 'unread', 'important'

            let where = 'WHERE usuario_id = ?';
            const params = [userId];

            if (filter === 'unread') {
                where += ' AND lida = 0';
            } else if (filter === 'important') {
                where += ' AND prioridade <= 2';
            }

            const [rows] = await pool.query(
                `SELECT id, titulo as title, tipo as type, modulo as module, mensagem as message,
                        lida as \`read\`, criado_em as createdAt, link, prioridade as priority,
                        entidade_tipo, entidade_id,
                        CASE WHEN prioridade <= 2 THEN 1 ELSE 0 END as important
                 FROM notificacoes ${where}
                 ORDER BY criado_em DESC LIMIT 50`,
                params
            );

            const [countResult] = await pool.query(
                'SELECT COUNT(*) as cnt FROM notificacoes WHERE usuario_id = ? AND lida = 0',
                [userId]
            );

            const [totalResult] = await pool.query(
                'SELECT COUNT(*) as cnt FROM notificacoes WHERE usuario_id = ?',
                [userId]
            );

            res.json({
                notifications: rows.map(r => ({
                    ...r,
                    read: !!r.read,
                    important: !!r.important,
                    data: { tipo: r.entidade_tipo, entidade_id: r.entidade_id }
                })),
                unreadCount: countResult[0]?.cnt || 0,
                total: totalResult[0]?.cnt || 0
            });
        } catch (error) {
            console.error('[NOTIFICATIONS] Erro ao listar:', error.message);
            // Fallback: retornar vazio para não quebrar frontend
            res.json({ notifications: [], unreadCount: 0, total: 0 });
        }
    });

    // GET /api/notifications/history - Histórico com paginação
    router.get('/notifications/history', authenticateToken, async (req, res) => {
        try {
            const userId = req.user.id;
            const page = parseInt(req.query.page) || 1;
            const limit = Math.min(parseInt(req.query.limit) || 20, 100);
            const offset = (page - 1) * limit;
            const startDate = req.query.startDate || null;
            const endDate = req.query.endDate || null;
            const type = req.query.type || null;

            let where = 'WHERE usuario_id = ?';
            const params = [userId];

            if (startDate) { where += ' AND criado_em >= ?'; params.push(startDate); }
            if (endDate) { where += ' AND criado_em <= ?'; params.push(endDate + ' 23:59:59'); }
            if (type && type !== 'all') { where += ' AND tipo = ?'; params.push(type); }

            const [rows] = await pool.query(
                `SELECT id, titulo as title, tipo as type, modulo as module, mensagem as message,
                        lida as \`read\`, criado_em as createdAt, link, prioridade as priority,
                        entidade_tipo, entidade_id,
                        CASE WHEN prioridade <= 2 THEN 1 ELSE 0 END as important
                 FROM notificacoes ${where}
                 ORDER BY criado_em DESC LIMIT ? OFFSET ?`,
                [...params, limit, offset]
            );

            const [countResult] = await pool.query(
                `SELECT COUNT(*) as cnt FROM notificacoes ${where}`,
                params
            );

            res.json({
                notifications: rows.map(r => ({
                    ...r,
                    read: !!r.read,
                    important: !!r.important,
                    data: { tipo: r.entidade_tipo, entidade_id: r.entidade_id }
                })),
                total: countResult[0]?.cnt || 0,
                page,
                limit,
                totalPages: Math.ceil((countResult[0]?.cnt || 0) / limit)
            });
        } catch (error) {
            console.error('[NOTIFICATIONS] Erro ao buscar histórico:', error.message);
            res.json({ notifications: [], total: 0, page: 1, limit: 20, totalPages: 0 });
        }
    });

    // POST /api/notifications/:id/read - Marcar como lida
    router.post('/notifications/:id/read', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const userId = req.user.id;
            await pool.query(
                'UPDATE notificacoes SET lida = 1, lida_em = NOW() WHERE id = ? AND usuario_id = ?',
                [id, userId]
            );
            res.json({ success: true });
        } catch (error) {
            console.error('[NOTIFICATIONS] Erro ao marcar lida:', error.message);
            res.json({ success: false });
        }
    });

    // POST /api/notifications/read-all - Marcar todas como lidas
    router.post('/notifications/read-all', authenticateToken, async (req, res) => {
        try {
            const userId = req.user.id;
            await pool.query(
                'UPDATE notificacoes SET lida = 1, lida_em = NOW() WHERE usuario_id = ? AND lida = 0',
                [userId]
            );
            res.json({ success: true });
        } catch (error) {
            console.error('[NOTIFICATIONS] Erro ao marcar todas lidas:', error.message);
            res.json({ success: false });
        }
    });

    // DELETE /api/notifications/:id - Excluir notificação
    router.delete('/notifications/:id', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const userId = req.user.id;
            await pool.query(
                'DELETE FROM notificacoes WHERE id = ? AND usuario_id = ?',
                [id, userId]
            );
            res.json({ success: true });
        } catch (error) {
            console.error('[NOTIFICATIONS] Erro ao excluir:', error.message);
            res.json({ success: false });
        }
    });

    // POST /api/notifications - Criar notificação (uso interno/admin)
    router.post('/notifications', authenticateToken, async (req, res) => {
        try {
            const { type, title, message, data, usuario_id } = req.body;
            const targetUserId = usuario_id || req.user.id;
            const [result] = await pool.query(
                `INSERT INTO notificacoes (usuario_id, titulo, tipo, mensagem, modulo, prioridade, entidade_tipo, entidade_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [targetUserId, title, type || 'info', message, data?.modulo || 'sistema', data?.prioridade || 3, data?.tipo || null, data?.entidade_id || null]
            );
            res.json({ id: result.insertId, success: true });
        } catch (error) {
            console.error('[NOTIFICATIONS] Erro ao criar:', error.message);
            res.status(500).json({ success: false, error: 'Erro interno no servidor. Tente novamente.' });
        }
    });

    // POST /api/admin/test-email — envia email de teste para destinatários especificados
    router.post('/admin/test-email', authenticateToken, async (req, res) => {
        if (!req.user || !(req.user.is_admin || req.user.role === 'admin' || req.user.role === 'ti')) {
            return res.status(403).json({ success: false, error: 'Sem permissão' });
        }
        try {
            const { sendEmail } = require('../utils/email');
            const { getBrandConfig, getLogoAttachment } = require('../services/scheduler.service');
            const path = require('path');
            const fs = require('fs');
            const destinatarios = req.body.destinatarios || [
                'ti@aluforce.ind.br',
                'antonio.egidio2004@hotmail.com',
                'gerenciavendas@aluforce.ind.br',
                'financeiro@aluforce.ind.br',
                'aluforce@aluforce.ind.br',
                'financeiro3@aluforce.ind.br'
            ];
            const to = Array.isArray(destinatarios) ? destinatarios.join(',') : destinatarios;
            const cfg = getBrandConfig();
            const companyLabel = cfg.label;
            const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
            const smtpHost = process.env.SMTP_HOST || '-';
            const logoAttachment = getLogoAttachment();
            const logoSrc = logoAttachment ? `cid:${logoAttachment.cid}` : '';
            const logoImg = logoSrc
                ? `<img src="${logoSrc}" alt="${companyLabel}" height="38" style="display:block;height:38px;max-width:200px;border:0;">`
                : `<span style="font-size:20px;font-weight:800;color:#ffffff;">${companyLabel}</span>`;
            const attachments = logoAttachment
                ? [{ filename: logoAttachment.filename, content: logoAttachment.content, cid: logoAttachment.cid, contentType: logoAttachment.mimeType }]
                : [];

            const html = `<!DOCTYPE html>
<html lang="pt-BR" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Email de Teste — Zyntra SGE</title>
</head>
<body style="margin:0;padding:0;background-color:#eef2f7;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef2f7;padding:32px 12px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
      style="max-width:600px;width:100%;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.12);">

      <!-- HEADER -->
      <tr><td style="${cfg.headerGradient};padding:0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="padding:26px 30px 16px;">${logoImg}</td>
            <td align="right" style="padding:26px 30px 16px;white-space:nowrap;">
              <span style="display:inline-block;background:#16a34a;color:#fff;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;padding:5px 12px;border-radius:20px;">&#10003; SMTP OK</span>
            </td>
          </tr>
          <tr><td colspan="2" style="padding:0 30px 24px;">
            <div style="font-size:10px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.5);margin-bottom:5px;">${companyLabel} &#x25CF; Sistema</div>
            <div style="font-size:23px;font-weight:700;color:#ffffff;letter-spacing:-.3px;">Email de Teste</div>
          </td></tr>
        </table>
      </td></tr>

      <!-- SUCCESS BAND -->
      <tr><td style="background:#f0fdf4;border-top:3px solid #16a34a;padding:13px 30px;">
        <span style="font-family:Arial,sans-serif;font-size:13px;font-weight:600;color:#15803d;">
          &#10003; &nbsp;Servidor SMTP configurado e funcionando corretamente.
        </span>
      </td></tr>

      <!-- BODY -->
      <tr><td style="background:#ffffff;padding:30px;">
        <p style="font-family:Arial,sans-serif;font-size:14px;color:#475569;margin:0 0 24px;line-height:1.6;">
          Este é um email de teste do sistema <strong style="color:#0f172a;">Zyntra SGE</strong>.
          Se você recebeu esta mensagem, o envio automático de notificações está operacional.
        </p>

        <!-- Info table -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
          style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;margin-bottom:24px;">
          <tr style="background:#f8fafc;">
            <td colspan="2" style="padding:10px 18px;border-bottom:1px solid #e2e8f0;">
              <span style="font-family:Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#64748b;">Informações do Teste</span>
            </td>
          </tr>
          <tr>
            <td style="padding:11px 18px;border-bottom:1px solid #f1f5f9;width:130px;"><span style="font-family:Arial,sans-serif;font-size:12px;color:#94a3b8;">Empresa</span></td>
            <td style="padding:11px 18px;border-bottom:1px solid #f1f5f9;"><span style="font-family:Arial,sans-serif;font-size:13px;font-weight:600;color:#0f172a;">${companyLabel}</span></td>
          </tr>
          <tr style="background:#fafafa;">
            <td style="padding:11px 18px;border-bottom:1px solid #f1f5f9;"><span style="font-family:Arial,sans-serif;font-size:12px;color:#94a3b8;">Data / Hora</span></td>
            <td style="padding:11px 18px;border-bottom:1px solid #f1f5f9;"><span style="font-family:Arial,sans-serif;font-size:13px;font-weight:600;color:#0f172a;">${now}</span></td>
          </tr>
          <tr>
            <td style="padding:11px 18px;border-bottom:1px solid #f1f5f9;"><span style="font-family:Arial,sans-serif;font-size:12px;color:#94a3b8;">Servidor SMTP</span></td>
            <td style="padding:11px 18px;border-bottom:1px solid #f1f5f9;"><span style="font-family:Arial,sans-serif;font-size:13px;font-weight:600;color:#0f172a;">${smtpHost}</span></td>
          </tr>
          <tr style="background:#fafafa;">
            <td style="padding:11px 18px;"><span style="font-family:Arial,sans-serif;font-size:12px;color:#94a3b8;">Enviado por</span></td>
            <td style="padding:11px 18px;"><span style="font-family:Arial,sans-serif;font-size:13px;font-weight:600;color:#0f172a;">${req.user.nome || req.user.email}</span></td>
          </tr>
        </table>

        <!-- Status card -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
          style="background:linear-gradient(135deg,#f0fdf4 0%,#dcfce7 100%);border:1px solid #bbf7d0;border-radius:10px;">
          <tr><td style="padding:18px 20px;">
            <div style="font-family:Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#15803d;margin-bottom:10px;">Automações Ativas</div>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td width="18" style="vertical-align:top;padding-top:1px;"><div style="width:14px;height:14px;border-radius:50%;background:#16a34a;"></div></td>
                <td style="padding-left:8px;padding-bottom:8px;"><span style="font-family:Arial,sans-serif;font-size:13px;color:#166534;"><strong>8h diário</strong> — Alertas de cobrança para contas a receber vencidas</span></td>
              </tr>
              <tr>
                <td width="18" style="vertical-align:top;padding-top:1px;"><div style="width:14px;height:14px;border-radius:50%;background:#16a34a;"></div></td>
                <td style="padding-left:8px;"><span style="font-family:Arial,sans-serif;font-size:13px;color:#166534;"><strong>4h30 diário</strong> — Bloqueio automático de clientes inadimplentes após 3 dias sem comprovante</span></td>
              </tr>
            </table>
          </td></tr>
        </table>
      </td></tr>

      <!-- FOOTER -->
      <tr><td style="background:#0f172a;padding:18px 30px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td><span style="font-family:Arial,sans-serif;font-size:11px;font-weight:600;color:#94a3b8;">Zyntra SGE</span><span style="font-family:Arial,sans-serif;font-size:11px;color:#475569;"> &#x2022; ${companyLabel}</span></td>
            <td align="right"><span style="font-family:Arial,sans-serif;font-size:10px;color:#475569;">Não responda este e-mail</span></td>
          </tr>
        </table>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
            const text = `[${companyLabel}] Email de Teste — Zyntra SGE\nData/Hora: ${now}\nSMTP: ${smtpHost} — OK\nEnviado por: ${req.user.nome || req.user.email}\n\nAutomações ativas:\n- 8h: Alertas de cobrança (contas vencidas)\n- 4h30: Bloqueio automático por inadimplência (>3 dias sem comprovante)`;
            const result = await sendEmail(to, `[${companyLabel}] Email de Teste — Zyntra SGE`, html, text, attachments);
            if (result && result.success) {
                logger.info(`[TEST-EMAIL] Enviado para ${to} por ${req.user.email}`);
                res.json({ success: true, destinatarios: to, messageId: result.messageId });
            } else {
                res.status(500).json({ success: false, error: result?.error || 'Falha ao enviar', destinatarios: to });
            }
        } catch (err) {
            logger.error('[TEST-EMAIL] Erro:', err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    return router;
};
