// =====================================================
// INICIALIZAÇÃO E CORREÇÕES DO MÓDULO PCP
// =====================================================

(function() {
    'use strict';
    
    console.log('🚀 Inicializando correções do módulo PCP...');
    
    // Aguardar DOM estar pronto
    function init() {
        console.log('✅ DOM pronto, aplicando correções...');
        
        // 1. Ocultar modal antigo de produto
        ocultarModalAntigo();
        
        // 2. Inicializar contadores
        inicializarContadores();
        
        // 3. Verificar carregamento de materiais
        verificarMateriais();
        
        // 4. Adicionar listeners para views
        adicionarListenersViews();
        
        console.log('✅ Correções aplicadas com sucesso!');
    }
    
    // Ocultar modal antigo para usar apenas o modal rico
    function ocultarModalAntigo() {
        const modalAntigo = document.getElementById('modal-editar-produto');
        if (modalAntigo) {
            modalAntigo.style.display = 'none';
            modalAntigo.style.visibility = 'hidden';
            modalAntigo.style.opacity = '0';
            modalAntigo.style.pointerEvents = 'none';
            console.log('✅ Modal antigo ocultado - usando modal rico');
        }
    }
    
    // Inicializar contadores manualmente se necessário
    function inicializarContadores() {
        // Aguardar script de contadores carregar
        let tentativas = 0;
        const maxTentativas = 20;
        
        const verificarContadores = setInterval(() => {
            tentativas++;
            
            if (typeof window.atualizarContadoresPCP === 'function') {
                console.log('✅ Sistema de contadores encontrado, atualizando...');
                window.atualizarContadoresPCP();
                clearInterval(verificarContadores);
            } else if (tentativas >= maxTentativas) {
                console.warn('⚠️ Sistema de contadores não encontrado após', maxTentativas, 'tentativas');
                console.log('💡 Tentando atualizar contadores manualmente...');
                atualizarContadoresManual();
                clearInterval(verificarContadores);
            }
        }, 200);
    }
    
    // Atualizar contadores manualmente se o script não carregar
    async function atualizarContadoresManual() {
        try {
            if (!token) {
                console.log('⚠️ Token não encontrado');
                return;
            }
            
            const headers = { 
                'Content-Type': 'application/json'
            };
            
            // Atualizar contador de materiais
            const resMateriais = await fetch('/api/pcp/materiais', { 
                credentials: 'include', 
                headers 
            });
            if (resMateriais.ok) {
                const materiais = await resMateriais.json();
                const contadorMateriais = document.getElementById('materials-count-display');
                if (contadorMateriais) {
                    contadorMateriais.textContent = materiais.length;
                    console.log('✅ Contador de materiais atualizado:', materiais.length);
                }
            }
            
            // Atualizar contadores de produtos
            const resProdutos = await fetch('/api/pcp/produtos?page=1&limit=10000', { 
                credentials: 'include', 
                headers 
            });
            if (resProdutos.ok) {
                const data = await resProdutos.json();
                const produtos = data.rows || data;
                
                const contadorTotal = document.getElementById('stat-total-produtos-gestao');
                if (contadorTotal) {
                    contadorTotal.textContent = produtos.length;
                    console.log('✅ Contador de produtos atualizado:', produtos.length);
                }
                
                // Calcular produtos com estoque baixo (< 10)
                const produtosBaixo = produtos.filter(p => 
                    p.quantidade_estoque > 0 && p.quantidade_estoque < 10
                ).length;
                
                const contadorBaixo = document.getElementById('stat-estoque-baixo-gestao');
                if (contadorBaixo) {
                    contadorBaixo.textContent = produtosBaixo;
                }
                
                // Produtos críticos (estoque = 0)
                const produtosCriticos = produtos.filter(p => 
                    p.quantidade_estoque === 0 || !p.quantidade_estoque
                ).length;
                
                const contadorCritico = document.getElementById('stat-produtos-criticos-gestao');
                if (contadorCritico) {
                    contadorCritico.textContent = produtosCriticos;
                }
                
                // Produtos OK (estoque >= 10)
                const produtosOk = produtos.filter(p => 
                    p.quantidade_estoque >= 10
                ).length;
                
                const contadorOk = document.getElementById('stat-produtos-ok-gestao');
                if (contadorOk) {
                    contadorOk.textContent = produtosOk;
                }
                
                console.log('✅ Todos os contadores de produtos atualizados');
            }
        } catch (error) {
            console.error('❌ Erro ao atualizar contadores manualmente:', error);
        }
    }
    
    // Verificar se materiais estão carregando corretamente
    function verificarMateriais() {
        setTimeout(() => {
            const tbody = document.getElementById('materiais-tbody');
            if (tbody) {
                const linhas = tbody.querySelectorAll('tr').length;
                console.log('📊 Linhas na tabela de materiais:', linhas);
                
                if (linhas === 0 || (linhas === 1 && tbody.querySelector('.empty-row'))) {
                    console.log('⚠️ Tabela vazia, tentando carregar materiais...');
                    
                    if (typeof window.onMateriaisViewShown === 'function') {
                        window.onMateriaisViewShown();
                    }
                }
            }
        }, 1000);
    }
    
    // Adicionar listeners para quando views ficam visíveis
    function adicionarListenersViews() {
        // Observar mudanças na view de materiais
        const materiaisView = document.getElementById('materiais-view');
        if (materiaisView) {
            const observer = new MutationObserver(function(mutations) {
                mutations.forEach(function(mutation) {
                    if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                        const isVisible = !materiaisView.classList.contains('hidden');
                        
                        if (isVisible) {
                            console.log('👁️ View de materiais visível');
                            
                            // Atualizar contadores
                            setTimeout(() => {
                                if (typeof window.atualizarContadoresPCP === 'function') {
                                    window.atualizarContadoresPCP();
                                } else {
                                    atualizarContadoresManual();
                                }
                            }, 500);
                        }
                    }
                });
            });
            
            observer.observe(materiaisView, { attributes: true });
            console.log('👀 Observer instalado para view de materiais');
        }
        
        // Observar mudanças na view de produtos
        const produtosView = document.getElementById('gestao-produtos-view');
        if (produtosView) {
            const observer = new MutationObserver(function(mutations) {
                mutations.forEach(function(mutation) {
                    if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                        const isVisible = !produtosView.classList.contains('hidden');
                        
                        if (isVisible) {
                            console.log('👁️ View de produtos visível');
                            
                            // Atualizar contadores
                            setTimeout(() => {
                                if (typeof window.atualizarContadoresPCP === 'function') {
                                    window.atualizarContadoresPCP();
                                } else {
                                    atualizarContadoresManual();
                                }
                            }, 500);
                        }
                    }
                });
            });
            
            observer.observe(produtosView, { attributes: true });
            console.log('👀 Observer instalado para view de produtos');
        }
    }
    
    // Expor Função para Atualização manual
    window.forcarAtualizacaoContadores = atualizarContadoresManual;
    
    // Inicializar
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    
    console.log('✅ Script de correções carregado');
    console.log('💡 Use window.forcarAtualizacaoContadores() para atualizar contadores manualmente');
    
})();



