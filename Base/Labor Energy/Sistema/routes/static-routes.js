// =================================================================
// ROTAS ESTÁTICAS - ALUFORCE v2.0
// Configuração de arquivos estáticos e cache
// =================================================================
'use strict';

const express = require('express');
const path = require('path');

function setupStaticRoutes(app, baseDir) {
    // ========================================
    // MIDDLEWARE GLOBAL PARA ENCODING UTF-8
    // ========================================
    app.use((req, res, next) => {
        const url = req.url.split('?')[0].toLowerCase(); // Remove query string
        
        // Definir charset UTF-8 para todos arquivos de texto
        if (url.endsWith('.css')) {
            res.setHeader('Content-Type', 'text/css; charset=utf-8');
        } else if (url.endsWith('.js') || url.endsWith('.mjs')) {
            res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        } else if (url.endsWith('.json')) {
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
        } else if (url.endsWith('.html') || url.endsWith('.htm')) {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
        } else if (url.endsWith('.xml')) {
            res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        } else if (url.endsWith('.svg')) {
            res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
        } else if (url.endsWith('.txt')) {
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        }
        next();
    });

    // Servir página de Ajuda (institucional)
    app.use('/ajuda', express.static(path.join(baseDir, 'Ajuda - Aluforce')));

    // ========================================
    // CONFIGURAÇÍO OTIMIZADA DE CACHE
    // ========================================

    // Fontes e ícones - Cache longo
    app.use('/fonts', express.static(path.join(baseDir, 'public', 'fonts'), { 
        index: false,
        maxAge: '30d',
        etag: true,
        lastModified: true,
        immutable: true
    }));

    app.use('/icons', express.static(path.join(baseDir, 'public', 'icons'), { 
        index: false,
        maxAge: '7d',
        etag: true,
        lastModified: true
    }));

    // Imagens estáticas - Cache médio
    app.use('/images', express.static(path.join(baseDir, 'public', 'images'), { 
        index: false,
        maxAge: '7d',
        etag: true,
        lastModified: true
    }));

    // CSS e JS - Cache com revalidação
    app.use('/css', express.static(path.join(baseDir, 'public', 'css'), { 
        index: false,
        maxAge: '4h',
        etag: true,
        lastModified: true
    }));

    app.use('/js', express.static(path.join(baseDir, 'public', 'js'), { 
        index: false,
        maxAge: '4h',
        etag: true,
        lastModified: true
    }));

    // Outros assets - Cache padrão
    app.use(express.static(path.join(baseDir, 'public'), { 
        index: false,
        maxAge: '1d',
        etag: true,
        lastModified: true
    }));

    // Rota para /public/index.html - redireciona para dashboard
    app.get('/public/index.html', (req, res) => {
        res.redirect('/');
    });

    // Servir Socket.io client library
    app.use('/socket.io', express.static(path.join(baseDir, 'node_modules', 'socket.io', 'client-dist')));

    // ========================================
    // MÓDULOS ESTÁTICOS
    // ========================================

    // Helper para definir headers corretos
    const setTextHeaders = (res, filePath) => {
        const ext = path.extname(filePath).toLowerCase();
        switch(ext) {
            case '.js':
            case '.mjs':
                res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
                break;
            case '.css':
                res.setHeader('Content-Type', 'text/css; charset=utf-8');
                break;
            case '.html':
            case '.htm':
                res.setHeader('Content-Type', 'text/html; charset=utf-8');
                break;
            case '.json':
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                break;
            case '.svg':
                res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
                break;
        }
    };

    // Vendas - JS, CSS e imagens
    app.use('/Vendas/js', express.static(path.join(baseDir, 'modules', 'Vendas', 'public', 'js'), {
        setHeaders: (res, filePath) => setTextHeaders(res, filePath)
    }));

    app.use('/Vendas/css', express.static(path.join(baseDir, 'modules', 'Vendas', 'public', 'css'), {
        setHeaders: (res, filePath) => setTextHeaders(res, filePath)
    }));

    app.use('/Vendas/images', express.static(path.join(baseDir, 'modules', 'Vendas', 'public', 'images')));
    app.use('/Vendas/assets', express.static(path.join(baseDir, 'modules', 'Vendas', 'public', 'assets')));

    // Uploads do Vendas
    app.use('/uploads', express.static(path.join(baseDir, 'modules', 'Vendas', 'public', 'uploads')));

    // PCP - Com headers corretos
    app.use('/PCP', express.static(path.join(baseDir, 'modules', 'PCP'), {
        setHeaders: (res, filePath) => setTextHeaders(res, filePath)
    }));

    // Outros módulos - Com headers corretos
    app.use('/NFe', express.static(path.join(baseDir, 'modules', 'NFe'), {
        setHeaders: (res, filePath) => setTextHeaders(res, filePath)
    }));
    app.use('/e-Nf-e', express.static(path.join(baseDir, 'modules', 'NFe'), {
        setHeaders: (res, filePath) => setTextHeaders(res, filePath)
    }));
    app.use('/Financeiro', express.static(path.join(baseDir, 'modules', 'Financeiro', 'public'), {
        setHeaders: (res, filePath) => setTextHeaders(res, filePath)
    }));
    app.use('/Compras', express.static(path.join(baseDir, 'modules', 'Compras'), {
        setHeaders: (res, filePath) => setTextHeaders(res, filePath)
    }));
    app.use('/RecursosHumanos', express.static(path.join(baseDir, 'modules', 'RH', 'public'), {
        setHeaders: (res, filePath) => setTextHeaders(res, filePath)
    }));
    app.use('/RH', express.static(path.join(baseDir, 'modules', 'RH', 'public'), {
        setHeaders: (res, filePath) => setTextHeaders(res, filePath)
    }));

    // Arquivos compartilhados - Com headers corretos
    app.use('/_shared', express.static(path.join(baseDir, 'modules', '_shared'), {
        setHeaders: (res, filePath) => setTextHeaders(res, filePath)
    }));
    app.use('/modules', express.static(path.join(baseDir, 'modules'), {
        setHeaders: (res, filePath) => setTextHeaders(res, filePath)
    }));

    // Avatars e uploads gerais
    app.use('/avatars', express.static(path.join(baseDir, 'public', 'avatars'), {
        maxAge: '1h',
        etag: true
    }));
    
    app.use('/uploads', express.static(path.join(baseDir, 'public', 'uploads')));
    app.use('/uploads', express.static(path.join(baseDir, 'modules', 'RH', 'public', 'uploads')));

    console.log('✅ Rotas estáticas configuradas');
}

module.exports = { setupStaticRoutes };
