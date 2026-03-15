/**
 * ============================================
 * SISTEMA DE CONTADORES DO MÓDULO PCP
 * ============================================
 * 
 * Gerencia todos os contadores das páginas do PCP:
 * - Contador de materiais
 * - Contador de produtos
 * - Alertas de estoque
 * - Paginação
 * 
 * Autor: Sistema Aluforce
 * Data: 03/12/2025
 */

(function() {
    'use strict';

    console.log('🔢 Inicializando sistema de contadores PCP...');

    // ============================================
    // CACHE DE DADOS
    // ============================================
    let dadosMateriaisCache = null;
    let dadosProdutosCache = null;
    let ultimaAtualizacao = {
        materiais: 0,
        produtos: 0
    };

    // ============================================
    // FUNÇÃO: ATUALIZAR CONTADOR DE MATERIAIS
    // ============================================
    async function atualizarContadorMateriais() {
        try {
            const countDisplay = document.getElementById('materials-count-display');
            if (!countDisplay) {
                console.log('⚠️ Elemento materials-count-display não encontrado');
                return;
            }

            // Buscar dados da API
            const response = await fetch('/api/pcp/materiais');
            if (!response.ok) {
                console.error('❌ Erro ao buscar materiais:', response.status);
                return;
            }

            const materiais = await response.json();
            const total = Array.isArray(materiais) ? materiais.length : 0;

            // Atualizar display
            countDisplay.textContent = total;
            dadosMateriaisCache = materiais;
            ultimaAtualizacao.materiais = Date.now();

            console.log(`✅ Contador de materiais atualizado: ${total}`);

            // Verificar alertas de estoque
            atualizarAlertasEstoqueMateriais(materiais);

        } catch (error) {
            console.error('❌ Erro ao atualizar contador de materiais:', error);
        }
    }

    // ============================================
    // FUNÇÃO: ATUALIZAR ALERTAS DE ESTOQUE (MATERIAIS)
    // ============================================
    function atualizarAlertasEstoqueMateriais(materiais) {
        try {
            const alertasContador = document.getElementById('alertas-contador');
            if (!alertasContador) return;

            let alertasCount = 0;

            materiais.forEach(material => {
                const estoque = parseFloat(material.quantidade_estoque || 0);
                const estoqueMinimo = parseFloat(material.estoque_minimo || 0);

                // Contar materiais abaixo do mínimo
                if (estoque < estoqueMinimo) {
                    alertasCount++;
                }
            });

            // Atualizar display
            alertasContador.textContent = alertasCount;
            
            if (alertasCount > 0) {
                alertasContador.style.display = 'flex';
                console.log(`⚠️ ${alertasCount} alertas de estoque de materiais`);
            } else {
                alertasContador.style.display = 'none';
            }

        } catch (error) {
            console.error('❌ Erro ao atualizar alertas de estoque:', error);
        }
    }

    // ============================================
    // FUNÇÃO: ATUALIZAR CONTADORES DE PRODUTOS (GESTÃO)
    // ============================================
    async function atualizarContadoresProdutos() {
        try {
            const statTotal = document.getElementById('stat-total-produtos-gestao');
            const statBaixo = document.getElementById('stat-estoque-baixo-gestao');
            const statCritico = document.getElementById('stat-produtos-criticos-gestao');
            const statOk = document.getElementById('stat-produtos-ok-gestao');

            if (!statTotal) {
                console.log('⚠️ Elementos de estatísticas de produtos não encontrados');
                return;
            }

            // Verificar token
            if (!token) {
                console.log('⚠️ Token não encontrado, aguardando autenticação...');
                return;
            }

            // Buscar dados da API
            const response = await fetch('/api/pcp/produtos?limit=10000', {
                credentials: 'include',
                credentials: 'include'
            });
            
            if (response.status === 401) {
                console.log('⚠️ Não autenticado');
                return;
            }
            
            if (!response.ok) {
                console.error('❌ Erro ao buscar produtos:', response.status);
                return;
            }

            const data = await response.json();
            // API retorna data.produtos, data.rows, ou array direto
            const produtos = data.produtos || data.rows || (Array.isArray(data) ? data : []);

            // Contadores
            let totalProdutos = produtos.length;
            let estoqueBaixo = 0;
            let estoqueCritico = 0;
            let estoqueOk = 0;

            // Analisar cada produto
            produtos.forEach(produto => {
                const estoque = parseFloat(produto.quantidade_estoque || produto.quantidade || 0);
                const estoqueMinimo = parseFloat(produto.estoque_minimo || 10);
                const estoqueCriticoNivel = estoqueMinimo * 0.5; // 50% do mínimo

                if (estoque <= estoqueCriticoNivel) {
                    estoqueCritico++;
                } else if (estoque <= estoqueMinimo) {
                    estoqueBaixo++;
                } else {
                    estoqueOk++;
                }
            });

            // Atualizar displays
            if (statTotal) statTotal.textContent = totalProdutos;
            if (statBaixo) statBaixo.textContent = estoqueBaixo;
            if (statCritico) statCritico.textContent = estoqueCritico;
            if (statOk) statOk.textContent = estoqueOk;

            dadosProdutosCache = produtos;
            ultimaAtualizacao.produtos = Date.now();

            console.log(`✅ Contadores de produtos atualizados:`);
            console.log(`   Total: ${totalProdutos}`);
            console.log(`   Estoque Baixo: ${estoqueBaixo}`);
            console.log(`   Estoque Crítico: ${estoqueCritico}`);
            console.log(`   Estoque Normal: ${estoqueOk}`);

        } catch (error) {
            console.error('❌ Erro ao atualizar contadores de produtos:', error);
        }
    }

    // ============================================
    // FUNÇÃO: ATUALIZAR PAGINAÇÃO
    // ============================================
    function atualizarPaginacao(paginaAtual, totalPaginas) {
        try {
            const currentPageEl = document.getElementById('current-page');
            const totalPagesEl = document.getElementById('total-pages');
            const btnFirst = document.getElementById('btn-first-page');
            const btnPrev = document.getElementById('btn-prev-page');
            const btnNext = document.getElementById('btn-next-page');
            const btnLast = document.getElementById('btn-last-page');

            if (currentPageEl) currentPageEl.textContent = paginaAtual;
            if (totalPagesEl) totalPagesEl.textContent = totalPaginas;

            // Desabilitar botões conforme necessário
            if (btnFirst) btnFirst.disabled = paginaAtual <= 1;
            if (btnPrev) btnPrev.disabled = paginaAtual <= 1;
            if (btnNext) btnNext.disabled = paginaAtual >= totalPaginas;
            if (btnLast) btnLast.disabled = paginaAtual >= totalPaginas;

            console.log(`📄 Paginação atualizada: ${paginaAtual}/${totalPaginas}`);

        } catch (error) {
            console.error('❌ Erro ao atualizar Paginação:', error);
        }
    }

    // ============================================
    // FUNÇÃO: ATUALIZAR TODOS OS CONTADORES
    // ============================================
    async function atualizarTodosContadores() {
        console.log('🔄 Atualizando todos os contadores...');
        
        await Promise.all([
            atualizarContadorMateriais(),
            atualizarContadoresProdutos()
        ]);

        console.log('✅ Todos os contadores atualizados!');
    }

    // ============================================
    // OBSERVADOR DE MUDANÇA DE VIEW
    // ============================================
    function observarMudancasDeView() {
        // Observar mudanças na URL ou hash
        let ultimaView = null;

        function verificarView() {
            // Detectar view ativa
            const viewAtiva = document.querySelector('.pcp-view:not(.hidden)');
            if (!viewAtiva) return;

            const viewId = viewAtiva.id;
            
            // Se mudou de view, atualizar contadores relevantes
            if (viewId !== ultimaView) {
                ultimaView = viewId;
                console.log(`👁️ View mudou para: ${viewId}`);

                switch(viewId) {
                    case 'materiais-view':
                    case 'materiais':
                        atualizarContadorMateriais();
                        break;
                    
                    case 'gestao-produtos':
                    case 'gestao-produtos-view':
                        atualizarContadoresProdutos();
                        break;
                    
                    case 'dashboard':
                    case 'dashboard-view':
                        // Atualizar tudo no dashboard
                        atualizarTodosContadores();
                        break;
                }
            }
        }

        // Verificar a cada 500ms
        setInterval(verificarView, 500);

        // Também observar cliques nos botões de Navegação
        document.addEventListener('click', function(e) {
            const btn = e.target.closest('[id^="btn-"]');
            if (btn) {
                setTimeout(verificarView, 100);
            }
        });
    }

    // ============================================
    // INTERCEPTAR FUNÇÃO showView EXISTENTE
    // ============================================
    function interceptarShowView() {
        if (typeof window.showView === 'function') {
            const originalShowView = window.showView;
            
            window.showView = function(viewName) {
                // Chamar Função original
                const result = originalShowView.apply(this, arguments);
                
                // Atualizar contadores após mudança de view
                setTimeout(() => {
                    console.log(`🔢 Atualizando contadores para view: ${viewName}`);
                    
                    switch(viewName) {
                        case 'materiais':
                            atualizarContadorMateriais();
                            break;
                        
                        case 'gestao-produtos':
                            atualizarContadoresProdutos();
                            break;
                        
                        case 'dashboard':
                            atualizarTodosContadores();
                            break;
                    }
                }, 300);
                
                return result;
            };
            
            console.log('✅ Função showView interceptada');
        }
    }

    // ============================================
    // EVENTOS DE RECARGA
    // ============================================
    function configurarEventosRecarga() {
        // Atualizar quando materiais/produtos forem salvos
        document.addEventListener('material-salvo', () => {
            console.log('📦 Material salvo - atualizando contadores');
            setTimeout(atualizarContadorMateriais, 500);
        });

        document.addEventListener('produto-salvo', () => {
            console.log('📦 Produto salvo - atualizando contadores');
            setTimeout(atualizarContadoresProdutos, 500);
        });

        // Interceptar fetch para detectar POST/PUT/DELETE
        const originalFetch = window.fetch;
        window.fetch = async function(...args) {
            const response = await originalFetch.apply(this, args);
            
            // Verificar se foi uma mutAção
            const method = args[1]?.method || 'GET';
            if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method.toUpperCase())) {
                const url = args[0];
                
                if (url.includes('/materiais')) {
                    setTimeout(atualizarContadorMateriais, 500);
                } else if (url.includes('/produtos')) {
                    setTimeout(atualizarContadoresProdutos, 500);
                }
            }
            
            return response;
        };

        console.log('✅ Eventos de recarga configurados');
    }

    // ============================================
    // FUNÇÃO GLOBAL: FORÇAR ATUALIZAÇÃO
    // ============================================
    window.atualizarContadoresPCP = function() {
        console.log('🔄 Atualização manual de contadores solicitada');
        return atualizarTodosContadores();
    };

    // ============================================
    // INICIALIZAÇÃO
    // ============================================
    function inicializar() {
        console.log('🚀 Inicializando sistema de contadores...');

        // Aguardar DOM estar pronto
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                setTimeout(() => {
                    interceptarShowView();
                    observarMudancasDeView();
                    configurarEventosRecarga();
                    atualizarTodosContadores();
                    console.log('✅ Sistema de contadores inicializado!');
                }, 1000);
            });
        } else {
            setTimeout(() => {
                interceptarShowView();
                observarMudancasDeView();
                configurarEventosRecarga();
                atualizarTodosContadores();
                console.log('✅ Sistema de contadores inicializado!');
            }, 1000);
        }

        // Atualizar contadores periodicamente (a cada 2 minutos)
        setInterval(() => {
            const agora = Date.now();
            
            // Atualizar materiais se passou mais de 2 minutos
            if (agora - ultimaAtualizacao.materiais > 2 * 60 * 1000) {
                atualizarContadorMateriais();
            }
            
            // Atualizar produtos se passou mais de 2 minutos
            if (agora - ultimaAtualizacao.produtos > 2 * 60 * 1000) {
                atualizarContadoresProdutos();
            }
        }, 2 * 60 * 1000);
    }

    // ============================================
    // EXPORTAR API
    // ============================================
    window.PCPContadores = {
        atualizarMateriais: atualizarContadorMateriais,
        atualizarProdutos: atualizarContadoresProdutos,
        atualizarTodos: atualizarTodosContadores,
        atualizarPaginacao: atualizarPaginacao,
        getDadosCache: () => ({
            materiais: dadosMateriaisCache,
            produtos: dadosProdutosCache
        })
    };

    // Iniciar
    inicializar();

})();







