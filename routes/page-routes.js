// =================================================================
// ROTAS DE PÁGINAS AUTENTICADAS - ALUFORCE v2.0
// Páginas HTML que requerem autenticação
// =================================================================
'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');

function setupPageRoutes(app, baseDir, authenticatePage, userPermissions) {
    
    // Helper para verificar permissão e servir página
    const serveWithPermission = (module, filePath) => (req, res) => {
        if (req.user && req.user.nome) {
            const firstName = req.user.nome.split(' ')[0].toLowerCase();
            if (userPermissions.hasAccess(firstName, module)) {
                res.sendFile(path.join(baseDir, filePath));
            } else {
                res.status(403).send(`<h1>Acesso Negado</h1><p>Você não tem permissão para acessar o módulo de ${module.toUpperCase()}.</p>`);
            }
        } else {
            res.redirect('/login.html');
        }
    };

    // ========================================
    // MÓDULO RH
    // ========================================
    
    app.get('/RecursosHumanos', authenticatePage, (req, res) => {
        if (req.user && (req.user.nome || req.user.email)) {
            const firstName = req.user.nome ? req.user.nome.split(' ')[0].toLowerCase() : '';
            const emailPrefix = req.user.email ? req.user.email.split('@')[0].toLowerCase() : '';
            
            if (userPermissions.isAdmin(firstName) || userPermissions.isAdmin(emailPrefix)) {
                return res.redirect('/RH/areaadm.html');
            }
        }
        return res.redirect('/RH/funcionario.html');
    });

    app.get('/RH/areaadm.html', authenticatePage, (req, res) => {
        if (req.user && (req.user.nome || req.user.email)) {
            const firstName = req.user.nome ? req.user.nome.split(' ')[0].toLowerCase() : '';
            const emailPrefix = req.user.email ? req.user.email.split('@')[0].toLowerCase() : '';
            
            if (userPermissions.isAdmin(firstName) || userPermissions.isAdmin(emailPrefix)) {
                res.sendFile(path.join(baseDir, 'modules', 'RH', 'public', 'areaadm.html'));
            } else {
                res.status(403).send('<h1>Acesso Negado</h1><p>Esta área é restrita a administradores.</p>');
            }
        } else {
            res.redirect('/login.html');
        }
    });

    app.get('/RH/area.html', authenticatePage, (req, res) => {
        res.sendFile(path.join(baseDir, 'modules', 'RH', 'public', 'area.html'));
    });

    app.get('/RH/funcionario.html', authenticatePage, (req, res) => {
        res.sendFile(path.join(baseDir, 'modules', 'RH', 'public', 'funcionario.html'));
    });

    // Páginas do RH
    const rhPages = ['dashboard', 'dados-pessoais', 'holerites', 'solicitacoes', 
                     'admin-dashboard', 'admin-funcionarios', 'admin-folha-pagamento', 
                     'admin-ponto', 'admin-beneficios'];
    
    rhPages.forEach(page => {
        app.get(`/RH/${page}.html`, authenticatePage, (req, res) => {
            const filePath = path.join(baseDir, 'modules', 'RH', 'public', `${page}.html`);
            if (fs.existsSync(filePath)) {
                res.sendFile(filePath);
            } else {
                // Tenta na pasta pages
                const pagesPath = path.join(baseDir, 'modules', 'RH', 'public', 'pages', `${page}.html`);
                if (fs.existsSync(pagesPath)) {
                    res.sendFile(pagesPath);
                } else {
                    res.status(404).send('<h1>Página não encontrada</h1>');
                }
            }
        });
    });

    // Rota dinmica para páginas do RH
    app.get('/rh/pages/:page', authenticatePage, (req, res) => {
        const page = req.params.page;
        const fileName = page.endsWith('.html') ? page : `${page}.html`;
        const filePath = path.join(baseDir, 'modules', 'RH', 'public', 'pages', fileName);
        
        if (fs.existsSync(filePath)) {
            res.sendFile(filePath);
        } else {
            res.status(404).send('<h1>Página não encontrada</h1>');
        }
    });

    // ========================================
    // MÓDULO VENDAS
    // ========================================
    
    app.get('/Vendas/', authenticatePage, serveWithPermission('vendas', 'modules/Vendas/public/index.html'));
    app.get('/Vendas/index.html', authenticatePage, serveWithPermission('vendas', 'modules/Vendas/public/index.html'));
    app.get('/Vendas/pedidos.html', authenticatePage, serveWithPermission('vendas', 'modules/Vendas/public/pedidos.html'));
    app.get('/Vendas/clientes.html', authenticatePage, serveWithPermission('vendas', 'modules/Vendas/public/clientes.html'));
    app.get('/Vendas/dashboard.html', authenticatePage, serveWithPermission('vendas', 'modules/Vendas/public/dashboard.html'));
    app.get('/Vendas/dashboard-admin.html', authenticatePage, serveWithPermission('vendas', 'modules/Vendas/public/dashboard-admin.html'));
    app.get('/Vendas/relatorios.html', authenticatePage, serveWithPermission('vendas', 'modules/Vendas/public/relatorios.html'));
    
    // Redirecionamentos
    app.get('/Vendas/kanban.html', authenticatePage, (req, res) => res.redirect('/Vendas/index.html'));
    app.get('/Vendas/vendas.html', authenticatePage, (req, res) => res.redirect('/Vendas/index.html'));
    app.get('/modules/Vendas/', authenticatePage, (req, res) => res.redirect('/Vendas/'));
    app.get('/modules/Vendas/index.html', authenticatePage, (req, res) => res.redirect('/Vendas/'));

    // ========================================
    // MÓDULO PCP
    // ========================================
    
    app.get('/PCP/', authenticatePage, serveWithPermission('pcp', 'modules/PCP/index.html'));
    app.get('/PCP/index.html', authenticatePage, serveWithPermission('pcp', 'modules/PCP/index.html'));
    app.get('/PCP/ordens-producao.html', authenticatePage, serveWithPermission('pcp', 'modules/PCP/ordens-producao.html'));
    app.get('/PCP/apontamentos.html', authenticatePage, serveWithPermission('pcp', 'modules/PCP/apontamentos.html'));
    app.get('/PCP/relatorios-apontamentos.html', authenticatePage, serveWithPermission('pcp', 'modules/PCP/relatorios-apontamentos.html'));
    app.get('/modules/PCP/index.html', authenticatePage, (req, res) => res.redirect('/PCP/index.html'));
    app.get('/modules/PCP/ordens-producao.html', authenticatePage, (req, res) => res.redirect('/PCP/ordens-producao.html'));
    app.get('/modules/PCP/apontamentos.html', authenticatePage, (req, res) => res.redirect('/PCP/apontamentos.html'));

    // ========================================
    // MÓDULO CRM
    // ========================================
    
    app.get('/CRM/crm.html', authenticatePage, serveWithPermission('crm', 'modules/CRM/crm.html'));

    // ========================================
    // MÓDULO NFE
    // ========================================
    
    app.get('/NFe/nfe.html', authenticatePage, serveWithPermission('nfe', 'modules/NFe/index.html'));
    app.get('/NFe/', authenticatePage, (req, res) => res.redirect('/NFe/nfe.html'));
    app.get('/modules/NFe/', authenticatePage, (req, res) => res.redirect('/NFe/nfe.html'));
    app.get('/modules/NFe/index.html', authenticatePage, serveWithPermission('nfe', 'modules/NFe/index.html'));

    // ========================================
    // MÓDULO COMPRAS
    // ========================================
    
    const comprasPages = ['index.html', 'compras.html', 'cotacoes.html', 'pedidos.html', 
                          'recebimento.html', 'fornecedores.html', 'gestao-estoque.html',
                          'requisicoes.html', 'relatorios.html', 'alcadas.html', 
                          'otimizacao-estoque.html', 'dashboard-executivo.html', 'dashboard-pro.html'];

    app.get('/Compras', authenticatePage, serveWithPermission('compras', 'modules/Compras/public/index.html'));
    app.get('/Compras/', authenticatePage, (req, res) => res.redirect('/Compras/compras.html'));
    app.get('/Compras/compras.html', authenticatePage, serveWithPermission('compras', 'modules/Compras/public/index.html'));
    
    app.get('/Compras/:page', authenticatePage, (req, res) => {
        if (req.user && req.user.nome) {
            const firstName = req.user.nome.split(' ')[0].toLowerCase();
            if (userPermissions.hasAccess(firstName, 'compras')) {
                const page = req.params.page;
                if (comprasPages.includes(page)) {
                    res.sendFile(path.join(baseDir, 'modules', 'Compras', page));
                } else {
                    res.sendFile(path.join(baseDir, 'modules', 'Compras', 'index.html'));
                }
            } else {
                res.status(403).send('<h1>Acesso Negado</h1>');
            }
        } else {
            res.redirect('/login.html');
        }
    });

    // ========================================
    // MÓDULO FINANCEIRO
    // ========================================
    
    app.get('/modules/Financeiro/', authenticatePage, (req, res) => res.redirect('/modules/Financeiro/index.html'));
    app.get('/modules/Financeiro/public/', authenticatePage, (req, res) => res.redirect('/modules/Financeiro/index.html'));
    app.get('/modules/Financeiro/index.html', authenticatePage, serveWithPermission('financeiro', 'modules/Financeiro/index.html'));
    
    // Mapeamento de URLs antigas para novas
    const financeiroMapping = {
        'contas_pagar.html': 'contas-pagar.html',
        'contas_receber.html': 'contas-receber.html',
        'fluxo_caixa.html': 'fluxo-caixa.html',
        'contas_bancarias.html': 'bancos.html'
    };
    
    Object.entries(financeiroMapping).forEach(([oldName, newName]) => {
        app.get(`/modules/Financeiro/public/${oldName}`, authenticatePage, (req, res) => {
            res.redirect(`/modules/Financeiro/${newName}`);
        });
    });

    console.log('✅ Rotas de páginas autenticadas configuradas');
}

module.exports = { setupPageRoutes };
