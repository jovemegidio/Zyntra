// Servidor principal do sistema de faturamento
require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const cookieParser = require('cookie-parser');

// Importar security middleware
const {
    generalLimiter,
    sanitizeInput,
    securityHeaders
} = require('../../security-middleware');

const app = express();
const PORT = process.env.FATURAMENTO_PORT || 3003;

// Security Middleware
app.use(securityHeaders());
app.use(generalLimiter);
app.use(sanitizeInput);

// Middlewares
app.use(cors({
    origin: function(origin, callback) {
        const allowedOrigins = [
            'http://localhost:3000', 'http://localhost:5000',
            'http://127.0.0.1:3000', 'http://127.0.0.1:5000',
            'https://aluforce.api.br', 'https://www.aluforce.api.br',
            'https://aluforce.ind.br', 'https://erp.aluforce.ind.br',
            'https://www.aluforce.ind.br',
            'http://tauri.localhost', 'https://tauri.localhost', 'tauri://localhost',
            process.env.CORS_ORIGIN
        ].filter(Boolean);
        if (!origin && process.env.NODE_ENV === 'development') return callback(null, true);
        if (!origin) return callback(null, false);
        if (allowedOrigins.includes(origin) || process.env.NODE_ENV === 'development') {
            callback(null, true);
        } else {
            callback(new Error('Origem não permitida pelo CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Servir arquivos estáticos
app.use('/modules/Faturamento/public', express.static(path.join(__dirname, 'public'), { dotfiles: 'deny', index: false }));

// Pool MySQL centralizado
const pool = require('../../database/pool');

// CRITICAL: JWT_SECRET must be defined — no hardcoded fallback
const jwt = require('jsonwebtoken');
if (!process.env.JWT_SECRET) {
    console.error('❌ ERRO FATAL [Faturamento]: JWT_SECRET não definido no .env');
    process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET;

const authenticateToken = (req, res, next) => {
    // SECURITY A4: Check cookies FIRST, then Authorization header
    let token = req.cookies?.authToken || req.cookies?.token || null;
    if (!token) {
        const authHeader = req.headers['authorization'];
        token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
    }
    if (!token) return res.status(401).json({ error: 'Token não fornecido' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        req.user = decoded;
        next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expirado. Faça login novamente.' });
        }
        return res.status(403).json({ error: 'Token inválido' });
    }
};

// Rota API de faturamento — passa pool e authenticateToken
const faturamentoRouter = require('./api/faturamento');
app.use('/api/faturamento', faturamentoRouter(pool, authenticateToken));

// Rota inicial
app.get('/', (req, res) => {
  res.json({
    message: 'Sistema de Faturamento NFe - ALUFORCE',
    version: '1.0.0',
    status: 'online',
    endpoints: {
      interface: `http://localhost:${PORT}/modules/Faturamento/public/index.html`,
      api: `http://localhost:${PORT}/api/faturamento`,
      docs: `http://localhost:${PORT}/api/faturamento/docs`
    }
  });
});

// Rota de documentação da API
app.get('/api/faturamento/docs', (req, res) => {
  res.json({
    title: 'API de Faturamento NFe',
    version: '1.0.0',
    endpoints: [
      {
        method: 'POST',
        path: '/api/faturamento/gerar-nfe',
        description: 'Gera uma NFe a partir de um pedido'
      },
      {
        method: 'POST',
        path: '/api/faturamento/enviar-sefaz',
        description: 'Envia NFe para autorização da SEFAZ'
      },
      {
        method: 'GET',
        path: '/api/faturamento/danfe/:nfeId',
        description: 'Gera o DANFE (PDF) da NFe'
      },
      {
        method: 'POST',
        path: '/api/faturamento/cancelar',
        description: 'Cancela uma NFe autorizada'
      },
      {
        method: 'POST',
        path: '/api/faturamento/carta-correcao',
        description: 'Envia carta de correção eletrônica'
      },
      {
        method: 'GET',
        path: '/api/faturamento/consultar/:chaveAcesso',
        description: 'Consulta NFe na SEFAZ'
      },
      {
        method: 'GET',
        path: '/api/faturamento/sefaz/status',
        description: 'Verifica status do serviço SEFAZ'
      }
    ]
  });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log('🚀 ========================================');
  console.log('🚀 Sistema de Faturamento NFe - ALUFORCE');
  console.log('🚀 ========================================');
  console.log(`📡 Servidor rodando na porta ${PORT}`);
  console.log(`🌐 Interface: http://localhost:${PORT}/modules/Faturamento/public/index.html`);
  console.log(`📊 API: http://localhost:${PORT}/api/faturamento`);
  console.log(`📖 Docs: http://localhost:${PORT}/api/faturamento/docs`);
  console.log('🚀 ========================================');
  console.log(`🔧 Ambiente: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📦 Banco: ${process.env.DB_NAME}`);
  console.log(`🔐 NFe Ambiente: ${process.env.NFE_AMBIENTE == 1 ? 'PRODUÇÃO ⚠️' : 'HOMOLOGAÇÃO 🧪'}`);
  console.log('🚀 ========================================');
});

module.exports = app;
