/**
 * ============================================================
 * ALUFORCE - Quick Init
 * Script de inicialização rápida para todos os módulos
 * Inclua este script no <head> de cada módulo
 * ============================================================
 */

(function() {
    'use strict';

    // ============================================================
    // 1. PERFORMANCE TIMING
    // ============================================================
    window.__ALUFORCE_START = performance.now();

    // ============================================================
    // 2. CRITICAL CSS INJECTION
    // ============================================================
    const criticalCSS = `
        /* Prevent FOUC */
        .alu-loading { opacity: 0; }
        .alu-loaded { opacity: 1; transition: opacity 0.2s ease; }
        
        /* Skeleton Shimmer */
        .skeleton {
            background: linear-gradient(90deg, #f0f0f0 25%, #e8e8e8 50%, #f0f0f0 75%);
            background-size: 200% 100%;
            animation: shimmer 1.5s infinite;
            border-radius: 4px;
        }
        @keyframes shimmer {
            0% { background-position: 200% 0; }
            100% { background-position: -200% 0; }
        }
        
        /* Loading Indicator */
        #alu-progress {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 3px;
            background: linear-gradient(90deg, #3b82f6, #8b5cf6);
            z-index: 999999;
            transform: scaleX(0);
            transform-origin: left;
            transition: transform 0.3s ease;
        }
        #alu-progress.loading { animation: progress 2s ease-in-out infinite; }
        @keyframes progress {
            0% { transform: scaleX(0); }
            50% { transform: scaleX(0.7); }
            100% { transform: scaleX(1); opacity: 0; }
        }
    `;

    // Injetar CSS crítico imediatamente
    const style = document.createElement('style');
    style.id = 'alu-critical-css';
    style.textContent = criticalCSS;
    document.head.insertBefore(style, document.head.firstChild);

    // ============================================================
    // 3. PROGRESS BAR
    // ============================================================
    const progressBar = document.createElement('div');
    progressBar.id = 'alu-progress';
    progressBar.className = 'loading';
    document.body?.appendChild(progressBar) || 
        document.addEventListener('DOMContentLoaded', () => document.body.appendChild(progressBar));

    // ============================================================
    // 4. PRELOAD CRITICAL RESOURCES
    // ============================================================
    const preloadResources = [
        { href: '/js/aluforce-turbo.js', as: 'script' },
        { href: '/js/aluforce-data-manager.js', as: 'script' },
        { href: '/css/performance-optimizations.css', as: 'style' }
    ];

    preloadResources.forEach(resource => {
        const link = document.createElement('link');
        link.rel = 'preload';
        link.href = resource.href;
        link.as = resource.as;
        document.head.appendChild(link);
    });

    // ============================================================
    // 5. LAZY LOAD DETECTION
    // ============================================================
    window.AluforceQuickInit = {
        // Marcar página como carregada
        pageLoaded() {
            const progress = document.getElementById('alu-progress');
            if (progress) {
                progress.classList.remove('loading');
                progress.style.transform = 'scaleX(1)';
                setTimeout(() => progress.remove(), 300);
            }
            
            document.body?.classList.add('alu-loaded');
            
            const loadTime = performance.now() - window.__ALUFORCE_START;
            console.log(`✅ Página carregada em ${loadTime.toFixed(0)}ms`);
        },

        // Mostrar skeleton em um container
        showSkeleton(container, type = 'rows', count = 5) {
            if (typeof container === 'string') {
                container = document.querySelector(container);
            }
            if (!container) return;

            let html = '';
            if (type === 'rows') {
                for (let i = 0; i < count; i++) {
                    html += `<div class="skeleton" style="height: 48px; margin-bottom: 8px;"></div>`;
                }
            } else if (type === 'cards') {
                html = '<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px;">';
                for (let i = 0; i < count; i++) {
                    html += `<div class="skeleton" style="height: 120px;"></div>`;
                }
                html += '</div>';
            } else if (type === 'text') {
                for (let i = 0; i < count; i++) {
                    html += `<div class="skeleton" style="height: 16px; width: ${60 + Math.random() * 40}%; margin-bottom: 8px;"></div>`;
                }
            }

            container.innerHTML = html;
            container.dataset.originalContent = '';
        },

        // Esconder skeleton e mostrar conteúdo
        hideSkeleton(container) {
            if (typeof container === 'string') {
                container = document.querySelector(container);
            }
            if (container) {
                container.classList.add('alu-loaded');
            }
        },

        // Detectar módulo atual
        getCurrentModule() {
            const path = window.location.pathname.toLowerCase();
            if (path.includes('financeiro')) return 'financeiro';
            if (path.includes('vendas')) return 'vendas';
            if (path.includes('pcp')) return 'pcp';
            if (path.includes('compras')) return 'compras';
            if (path.includes('rh')) return 'rh';
            if (path.includes('nfe')) return 'nfe';
            if (path.includes('faturamento')) return 'faturamento';
            return 'dashboard';
        },

        // Pré-carregar módulos relacionados
        prefetchRelatedModules() {
            const module = this.getCurrentModule();
            const relatedModules = {
                financeiro: ['contas-pagar.html', 'contas-receber.html', 'fluxo-caixa.html', 'bancos.html'],
                vendas: ['clientes.html', 'orcamentos.html', 'pedidos.html', 'dashboard.html'],
                pcp: ['ordens.html', 'materiais.html', 'producao.html'],
                compras: ['pedidos.html', 'fornecedores.html', 'cotacoes.html'],
                rh: ['funcionarios.html', 'ferias.html', 'folha.html']
            };

            const modules = relatedModules[module] || [];
            
            if (window.AluforceTurbo) {
                modules.forEach((mod, i) => {
                    setTimeout(() => window.AluforceTurbo.prefetch(mod), 1000 + i * 300);
                });
            }
        }
    };

    // ============================================================
    // 6. AUTO INIT ON DOM READY
    // ============================================================
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            // Pré-carregar módulos relacionados após 2s
            setTimeout(() => {
                window.AluforceQuickInit.prefetchRelatedModules();
            }, 2000);
        });
    } else {
        setTimeout(() => {
            window.AluforceQuickInit.prefetchRelatedModules();
        }, 2000);
    }

    // Marcar como carregado quando tudo estiver pronto
    window.addEventListener('load', () => {
        setTimeout(() => {
            window.AluforceQuickInit.pageLoaded();
        }, 100);
    });

    console.log('⚡ ALUFORCE Quick Init carregado');

})();
