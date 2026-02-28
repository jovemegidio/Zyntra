const express = require('express');
const cors = require('cors');
const path = require('path');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
const { initDatabase, initMySQLPool } = require('./database');
require('dotenv').config();

// ============================================
// 🔐 SECURITY AUDIT FIX: JWT Authentication Required
// All API routes now require authentication
// ============================================

// CRITICAL: JWT_SECRET must be defined in production
if (!process.env.JWT_SECRET) {
    console.error('❌ ERRO FATAL [Compras]: JWT_SECRET não definido no .env');
    process.exit(1);
}

// Importar security middleware
const {
    generalLimiter,
    sanitizeInput,
    securityHeaders
} = require('../../security-middleware');

const app = express();
const PORT = process.env.PORT || 3002;

// ============================================
// 🔐 AUTHENTICATION MIDDLEWARE
// ============================================
const authenticateToken = (req, res, next) => {
    // Check Authorization header first, then cookies
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.startsWith('Bearer ') 
        ? authHeader.split(' ')[1] 
        : (req.cookies?.authToken || req.cookies?.token);

    if (!token) {
        return res.status(401).json({ 
            error: 'Token não fornecido',
            message: 'Autenticação necessária para acessar este recurso'
        });
    }

    // AUDIT-FIX ARCH-004: Enforce HS256 algorithm (audience enforced in sign, verify-side after token rotation)
    jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] }, (err, user) => {
        if (err) {
            console.log('[Compras] Token inválido:', err.message);
            if (err.name === 'TokenExpiredError') {
                return res.status(401).json({ 
                    error: 'Token expirado',
                    message: 'Sessão expirada. Faça login novamente.'
                });
            }
            return res.status(403).json({ 
                error: 'Token inválido ou expirado',
                message: 'Por favor, faça login novamente'
            });
        }
        req.user = user;
        next();
    });
};

// ============================================
// 🔐 AUTHORIZATION MIDDLEWARE - Admin/Manager only for sensitive ops
// ============================================
const requireComprasPermission = (action) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Não autenticado' });
        }
        
        const role = (req.user.role || req.user.cargo || '').toLowerCase();
        const isAdmin = req.user.is_admin === true || req.user.is_admin === 1 || 
                        role === 'admin' || role === 'administrador';
        
        // Admins have full access
        if (isAdmin) return next();
        
        // Define permissions by role
        const permissions = {
            gerente: ['visualizar', 'criar', 'editar', 'aprovar', 'excluir'],
            compras: ['visualizar', 'criar', 'editar'],
            supervisor: ['visualizar', 'criar', 'editar', 'aprovar'],
            usuario: ['visualizar']
        };
        
        const userPerms = permissions[role] || permissions.usuario;
        
        if (!userPerms.includes(action)) {
            return res.status(403).json({
                error: 'Acesso negado',
                message: `Você não tem permissão para ${action} no módulo Compras`
            });
        }
        
        next();
    };
};

// Conexão MySQL para dados reais
const mysqlPool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'aluforce_vendas',
    waitForConnections: true,
    connectionLimit: 5
});

// Inicializar MySQL pool no módulo database.js para as APIs
initMySQLPool().catch(err => console.error('Erro ao inicializar MySQL pool:', err));

// Security Middleware
app.use(securityHeaders());
app.use(generalLimiter);
app.use(sanitizeInput);

// Middleware
app.use(cors());
app.use(express.json({ limit: '2mb' })); // SEGURANÇA: Limite de payload

// Cookie parser for auth token in cookies
const cookieParser = require('cookie-parser');
app.use(cookieParser());

app.use(express.static(__dirname));
app.use('/css', express.static(path.join(__dirname, '../../css')));
app.use('/js', express.static(path.join(__dirname, '../../js')));

// Rotas de páginas
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/pedidos', (req, res) => {
    res.sendFile(path.join(__dirname, 'pedidos.html'));
});

app.get('/requisicoes', (req, res) => {
    res.sendFile(path.join(__dirname, 'requisicoes.html'));
});

app.get('/cotacoes', (req, res) => {
    res.sendFile(path.join(__dirname, 'cotacoes.html'));
});

app.get('/fornecedores', (req, res) => {
    res.sendFile(path.join(__dirname, 'fornecedores.html'));
});

app.get('/gestao-estoque', (req, res) => {
    res.sendFile(path.join(__dirname, 'gestao-estoque.html'));
});

app.get('/relatorios', (req, res) => {
    res.sendFile(path.join(__dirname, 'relatorios.html'));
});

app.get('/recebimento', (req, res) => {
    res.sendFile(path.join(__dirname, 'recebimento.html'));
});

// ============ API ROUTES ============
// 🔐 SECURITY AUDIT: All API routes now require authentication

// Importar rotas disponíveis
const fornecedoresRoutes = require('./api/fornecedores');
const estoqueRoutes = require('./api/estoque');
const materiaisRoutes = require('./api/materiais');
const pedidosRoutes = require('./api/pedidos');
const cotacoesRoutes = require('./api/cotacoes');
const requisicoesRoutes = require('./api/requisicoes');
const recebimentoRoutes = require('./api/recebimento');
const relatoriosRoutes = require('./api/relatorios');

// Usar rotas COM AUTENTICAÇÃO
app.use('/api/compras/fornecedores', authenticateToken, fornecedoresRoutes);
app.use('/api/compras/estoque', authenticateToken, estoqueRoutes);
app.use('/api/compras/materiais', authenticateToken, materiaisRoutes);
app.use('/api/compras/pedidos', authenticateToken, pedidosRoutes);
app.use('/api/compras/cotacoes', authenticateToken, cotacoesRoutes);
app.use('/api/compras/requisicoes', authenticateToken, requisicoesRoutes);
app.use('/api/compras/recebimento', authenticateToken, recebimentoRoutes);
app.use('/api/compras/relatorios', authenticateToken, relatoriosRoutes);

// ============ NF-e ENTRADA & RECEBIMENTO ROUTES ============
// Rota de recebimento via pedido (match frontend: POST /api/compras/pedidos/:id/receber)
app.post('/api/compras/pedidos/:id/receber', authenticateToken, async (req, res) => {
    const connection = await mysqlPool.getConnection();
    try {
        await connection.beginTransaction();
        const pedidoId = req.params.id;
        const {
            data_recebimento, numero_nfe, tipo = 'total',
            chave_acesso, responsavel, local_armazenamento,
            atualizar_estoque = true, observacoes, itens = [], dados_sefaz
        } = req.body;

        const [pedidos] = await connection.query(
            'SELECT pc.*, f.razao_social as fornecedor_nome FROM pedidos_compra pc LEFT JOIN fornecedores f ON pc.fornecedor_id = f.id WHERE pc.id = ?',
            [pedidoId]
        );
        if (pedidos.length === 0) { await connection.rollback(); return res.status(404).json({ error: 'Pedido não encontrado' }); }
        if (pedidos[0].status === 'recebido') { await connection.rollback(); return res.status(400).json({ error: 'Pedido já recebido' }); }

        const novoStatus = tipo === 'parcial' ? 'parcial' : 'recebido';
        await connection.query(`
            UPDATE pedidos_compra SET data_recebimento = ?, data_entrega_real = ?, numero_nfe = COALESCE(?, numero_nfe),
                chave_acesso_nfe = COALESCE(?, chave_acesso_nfe), status = ?, estoque_atualizado = ?,
                observacoes = CONCAT(COALESCE(observacoes, ''), '\n', ?)
            WHERE id = ?
        `, [data_recebimento, data_recebimento, numero_nfe, chave_acesso, novoStatus, atualizar_estoque ? 1 : 0,
            `[${new Date().toLocaleString('pt-BR')}] Recebimento ${tipo} por ${responsavel || 'Sistema'}: NF-e ${numero_nfe || 'N/A'}`, pedidoId]);

        // Atualizar estoque
        if (atualizar_estoque && itens.length > 0) {
            const [itensPedido] = await connection.query('SELECT * FROM pedidos_compra_itens WHERE pedido_id = ?', [pedidoId]);
            for (let i = 0; i < itens.length; i++) {
                const qtd = parseFloat(itens[i].quantidade_recebida) || 0;
                const materialId = itensPedido[i]?.material_id;
                if (qtd <= 0 || !materialId) continue;
                const [est] = await connection.query('SELECT id FROM estoque WHERE material_id = ?', [materialId]);
                if (est.length > 0) {
                    await connection.query('UPDATE estoque SET quantidade_atual = quantidade_atual + ?, data_ultima_entrada = ? WHERE material_id = ?', [qtd, data_recebimento, materialId]);
                } else {
                    await connection.query('INSERT INTO estoque (material_id, quantidade_atual, data_ultima_entrada) VALUES (?, ?, ?)', [materialId, qtd, data_recebimento]);
                }
            }
        }

        await connection.commit();
        res.json({ success: true, message: `Recebimento ${tipo} registrado`, pedido_id: pedidoId, novo_status: novoStatus });
    } catch (err) {
        await connection.rollback();
        console.error('[COMPRAS] Erro ao receber:', err);
        res.status(500).json({ error: 'Erro ao registrar recebimento' });
    } finally {
        connection.release();
    }
});

// Consultar NF-e por chave de acesso
app.get('/api/compras/nfe/consultar/:chave', authenticateToken, async (req, res) => {
    try {
        const chave = req.params.chave.replace(/\D/g, '');
        if (chave.length !== 44) return res.status(400).json({ error: 'Chave deve ter 44 dígitos' });

        const [nfs] = await mysqlPool.query('SELECT * FROM nf_entrada WHERE chave_acesso = ?', [chave]);
        if (nfs.length > 0) {
            return res.json({
                encontrada: true, numero: nfs[0].numero_nfe, serie: nfs[0].serie,
                data_emissao: nfs[0].data_emissao,
                emitente: { razao_social: nfs[0].fornecedor_razao_social, cnpj: nfs[0].fornecedor_cnpj },
                valor_total: nfs[0].valor_total, status: nfs[0].status
            });
        }

        // Decodificar chave
        const info = { cnpj: chave.substring(6, 20), serie: parseInt(chave.substring(22, 25)), numero: parseInt(chave.substring(25, 34)) };
        const [forn] = await mysqlPool.query('SELECT razao_social, cnpj FROM fornecedores WHERE cnpj = ?', [info.cnpj]);
        res.json({
            encontrada: false, decodificada: true, numero: info.numero, serie: info.serie,
            emitente: forn.length > 0 ? { razao_social: forn[0].razao_social, cnpj: forn[0].cnpj } : { cnpj: info.cnpj },
            valor_total: null, message: 'NF-e não encontrada. Dados da chave de acesso.'
        });
    } catch (error) {
        console.error('[COMPRAS] Erro consulta NF-e:', error);
        res.status(500).json({ error: 'Erro ao consultar NF-e' });
    }
});

// Importar XML NF-e (texto colado)
app.post('/api/compras/nf-entrada/importar-xml-texto', authenticateToken, async (req, res) => {
    try {
        const { xml } = req.body;
        if (!xml) return res.status(400).json({ error: 'XML é obrigatório' });

        const parseTag = (x, tag) => { const m = x.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i')); return m ? m[1].trim() : null; };
        const parseSimple = (x, tag) => { const m = new RegExp(`<${tag}>([^<]*)<\\/${tag}>`, 'gi').exec(x); return m ? m[1].trim() : ''; };

        let chave = '';
        const idMatch = xml.match(/Id="NFe(\d{44})"/);
        if (idMatch) chave = idMatch[1];
        else { const chMatch = xml.match(/<chNFe>(\d{44})<\/chNFe>/); if (chMatch) chave = chMatch[1]; }
        if (chave.length !== 44) return res.status(400).json({ error: 'Chave de acesso não encontrada no XML' });

        const [existe] = await mysqlPool.query('SELECT id FROM nf_entrada WHERE chave_acesso = ?', [chave]);
        if (existe.length > 0) return res.json({ success: false, error: 'NF já importada', id: existe[0].id, duplicada: true });

        const emit = parseTag(xml, 'emit') || '';
        const ide = parseTag(xml, 'ide') || '';
        const tot = parseTag(xml, 'ICMSTot') || '';

        const [ins] = await mysqlPool.query(`
            INSERT INTO nf_entrada (chave_acesso, numero_nfe, serie, modelo,
                fornecedor_cnpj, fornecedor_razao_social, fornecedor_nome_fantasia, fornecedor_ie, fornecedor_uf,
                valor_produtos, valor_total, valor_icms, valor_ipi, valor_pis, valor_cofins,
                data_emissao, natureza_operacao, status, xml_completo, importado_por)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'importada', ?, ?)
        `, [
            chave, parseInt(parseSimple(ide, 'nNF')) || 0, parseInt(parseSimple(ide, 'serie')) || 1, parseSimple(ide, 'mod') || '55',
            parseSimple(emit, 'CNPJ'), parseSimple(emit, 'xNome'), parseSimple(emit, 'xFant'), parseSimple(emit, 'IE'), parseSimple(emit, 'UF'),
            parseFloat(parseSimple(tot, 'vProd')) || 0, parseFloat(parseSimple(tot, 'vNF')) || 0,
            parseFloat(parseSimple(tot, 'vICMS')) || 0, parseFloat(parseSimple(tot, 'vIPI')) || 0,
            parseFloat(parseSimple(tot, 'vPIS')) || 0, parseFloat(parseSimple(tot, 'vCOFINS')) || 0,
            parseSimple(ide, 'dhEmi') || new Date(), parseSimple(ide, 'natOp') || '', xml, req.user?.id
        ]);

        // Auto-cadastrar fornecedor
        try {
            await mysqlPool.query(`INSERT INTO fornecedores (cnpj, razao_social, nome_fantasia, inscricao_estadual, uf)
                VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE razao_social = VALUES(razao_social)`,
                [parseSimple(emit, 'CNPJ'), parseSimple(emit, 'xNome'), parseSimple(emit, 'xFant'), parseSimple(emit, 'IE'), parseSimple(emit, 'UF')]);
        } catch (e) { /* ok */ }

        res.json({
            success: true, id: ins.insertId, chave_acesso: chave,
            numero_nfe: parseInt(parseSimple(ide, 'nNF')),
            fornecedor: parseSimple(emit, 'xNome'),
            valor_total: parseFloat(parseSimple(tot, 'vNF')) || 0,
            message: `NF ${parseSimple(ide, 'nNF')} importada com sucesso`
        });
    } catch (error) {
        console.error('[COMPRAS] Erro importar XML:', error);
        res.status(500).json({ error: 'Erro ao importar XML: ' + error.message });
    }
});

// Dashboard endpoint - COM AUTENTICAÇÃO
app.get('/api/compras/dashboard', authenticateToken, async (req, res) => {
    try {
        const conn = await mysqlPool.getConnection();
        
        // Total de pedidos e valor
        const [totais] = await conn.query(`
            SELECT 
                COUNT(*) as total_pedidos,
                COALESCE(SUM(valor_total), 0) as valor_total_pedidos
            FROM pedidos_compra
        `);
        
        // Pedidos por status
        const [porStatus] = await conn.query(`
            SELECT status, COUNT(*) as quantidade, COALESCE(SUM(valor_total), 0) as valor
            FROM pedidos_compra
            GROUP BY status
        `);
        
        // Pedidos pendentes de aprovação
        const [pendentes] = await conn.query(`
            SELECT COUNT(*) as total FROM pedidos_compra WHERE status = 'pendente'
        `);
        
        // Cotações abertas
        const [cotacoes] = await conn.query(`
            SELECT COUNT(*) as total FROM cotacoes WHERE status = 'aberta' OR status = 'em_analise'
        `).catch(() => [[{total: 0}]]);
        
        // Fornecedores ativos
        const [fornecedores] = await conn.query(`
            SELECT COUNT(*) as total FROM fornecedores WHERE ativo = 1 OR ativo IS NULL
        `);
        
        // Compras dos últimos 12 meses
        const [evolucaoMensal] = await conn.query(`
            SELECT 
                DATE_FORMAT(data_pedido, '%Y-%m') as mes,
                COUNT(*) as qtd_pedidos,
                COALESCE(SUM(valor_total), 0) as valor
            FROM pedidos_compra
            WHERE data_pedido >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
            GROUP BY DATE_FORMAT(data_pedido, '%Y-%m')
            ORDER BY mes ASC
        `);
        
        // Top 5 fornecedores por valor
        const [topFornecedores] = await conn.query(`
            SELECT 
                f.razao_social,
                f.nome_fantasia,
                COUNT(pc.id) as qtd_pedidos,
                COALESCE(SUM(pc.valor_total), 0) as valor_total
            FROM fornecedores f
            LEFT JOIN pedidos_compra pc ON pc.fornecedor_id = f.id
            WHERE f.ativo = 1 OR f.ativo IS NULL
            GROUP BY f.id, f.razao_social, f.nome_fantasia
            HAVING qtd_pedidos > 0
            ORDER BY valor_total DESC
            LIMIT 5
        `);
        
        // Pedidos recentes (últimos 10)
        const [pedidosRecentes] = await conn.query(`
            SELECT 
                pc.id,
                pc.numero_pedido,
                pc.status,
                pc.valor_total,
                pc.data_pedido,
                f.razao_social as fornecedor
            FROM pedidos_compra pc
            LEFT JOIN fornecedores f ON f.id = pc.fornecedor_id
            ORDER BY pc.created_at DESC
            LIMIT 10
        `);
        
        // Atividades recentes
        const [atividades] = await conn.query(`
            SELECT * FROM compras_atividades 
            ORDER BY created_at DESC 
            LIMIT 10
        `).catch(() => [[]]);
        
        conn.release();
        
        res.json({
            total_pedidos: totais[0].total_pedidos || 0,
            valor_total_pedidos: parseFloat(totais[0].valor_total_pedidos) || 0,
            pedidos_por_status: porStatus,
            requisicoes_pendentes: pendentes[0].total || 0,
            cotacoes_abertas: cotacoes[0]?.total || 0,
            fornecedores_ativos: fornecedores[0].total || 0,
            evolucao_mensal: evolucaoMensal,
            top_fornecedores: topFornecedores,
            pedidos_recentes: pedidosRecentes,
            atividades_recentes: atividades
        });
    } catch (error) {
        console.error('Erro ao buscar dashboard:', error);
        // Fallback com dados básicos
        res.json({
            total_pedidos: 0,
            valor_total_pedidos: 0,
            pedidos_por_status: [],
            requisicoes_pendentes: 0,
            cotacoes_abertas: 0,
            fornecedores_ativos: 0,
            evolucao_mensal: [],
            top_fornecedores: [],
            pedidos_recentes: [],
            atividades_recentes: []
        });
    }
});

// AUDIT-FIX ARCH-005: Added authenticateToken + requireComprasPermission('criar')
app.post('/api/pedidos', authenticateToken, requireComprasPermission('criar'), (req, res) => {
    const pedido = req.body;
    console.log('Novo pedido recebido:', pedido);
    
    // Simular salvamento do pedido
    const novoPedido = {
        id: 'PC-' + Date.now().toString().slice(-6),
        ...pedido,
        dataCriacao: new Date().toISOString(),
        status: 'pendente'
    };

    res.json({
        success: true,
        message: 'Pedido criado com sucesso',
        pedido: novoPedido
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('❌ Erro:', err);
    res.status(500).json({ 
        error: 'Erro interno do servidor',
        message: err.message 
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Rota não encontrada' });
});

// Inicializar servidor
async function startServer() {
    try {
        // Inicializar banco de dados
        await initDatabase();
        console.log('✅ Banco de dados inicializado');
        
        // Iniciar servidor
        app.listen(PORT, () => {
            console.log(`🚀 Servidor de Compras rodando em http://localhost:${PORT}`);
            console.log(`📊 Dashboard: http://localhost:${PORT}`);
            console.log(`🛒 Pedidos: http://localhost:${PORT}/pedidos`);
            console.log(`📝 Requisições: http://localhost:${PORT}/requisicoes`);
            console.log(`💰 Cotações: http://localhost:${PORT}/cotacoes`);
            console.log(`👥 Fornecedores: http://localhost:${PORT}/fornecedores`);
        });
    } catch (error) {
        console.error('❌ Erro ao iniciar servidor:', error);
        process.exit(1);
    }
}

startServer();

module.exports = app;