/**
 * Controle de Acesso RH - Restrição de Consultoria
 * 
 * Este script deve ser incluído em todas as páginas do módulo RH
 * Ele verifica se o usuário é do departamento Consultoria e
 * redireciona para o dashboard se tentar acessar outras páginas.
 */

(function() {
    'use strict';
    
    // Páginas permitidas para Consultoria (somente dashboard)
    const PAGINAS_PERMITIDAS_CONSULTORIA = [
        '/modules/RH/public/areaadm.html',
        '/modules/rh/public/areaadm.html',
        '/rh/areaadm.html',
        '/areaadm.html'
    ];
    
    // URL do dashboard para redirecionamento
    const DASHBOARD_URL = '/modules/RH/public/areaadm.html';
    
    // Departamentos com restrição
    const DEPARTAMENTOS_RESTRITOS = ['Consultoria'];
    
    async function verificarAcessoConsultoria() {
        try {
            const token = localStorage.getItem('authToken') || 
                          localStorage.getItem('token') || 
                          sessionStorage.getItem('authToken') ||
                          sessionStorage.getItem('token');
            
            if (!token) {
                console.log('[RH Access] Token não encontrado, permitindo acesso padrão');
                return; // Sem token, deixa o sistema de autenticação normal tratar
            }
            
            const response = await fetch('/api/me', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                credentials: 'include'
            });
            
            if (!response.ok) {
                console.log('[RH Access] Não foi possível verificar usuário');
                return;
            }
            
            const user = await response.json();
            
            // Verificar se o departamento é restrito
            const departamento = (user.departamento || '').trim();
            const isRestrito = DEPARTAMENTOS_RESTRITOS.some(
                d => d.toLowerCase() === departamento.toLowerCase()
            );
            
            if (!isRestrito) {
                console.log(`[RH Access] Usuário ${user.nome} - Departamento: ${departamento} - Acesso livre`);
                return; // Não é departamento restrito, acesso liberado
            }
            
            // Verificar se a página atual é permitida
            const paginaAtual = window.location.pathname.toLowerCase();
            const paginaPermitida = PAGINAS_PERMITIDAS_CONSULTORIA.some(
                p => paginaAtual.includes(p.toLowerCase()) || 
                     paginaAtual.endsWith('areaadm.html')
            );
            
            if (paginaPermitida) {
                console.log(`[RH Access] ${user.nome} (Consultoria) - Página permitida: ${paginaAtual}`);
                return; // Página permitida para Consultoria
            }
            
            // Redirecionar para o dashboard
            console.warn(`[RH Access] ${user.nome} (Consultoria) - Acesso negado a: ${paginaAtual}`);
            console.log('[RH Access] Redirecionando para dashboard...');
            
            // Mostrar mensagem amigável antes de redirecionar
            if (typeof mostrarNotificacao === 'function') {
                mostrarNotificacao('Acesso restrito. Redirecionando para o Dashboard...', 'warning');
            }
            
            setTimeout(() => {
                window.location.href = DASHBOARD_URL;
            }, 500);
            
        } catch (error) {
            console.error('[RH Access] Erro ao verificar acesso:', error);
            // Em caso de erro, permite o acesso para não bloquear completamente
        }
    }
    
    // Executar verificação quando o DOM estiver pronto
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', verificarAcessoConsultoria);
    } else {
        verificarAcessoConsultoria();
    }
    
    // Expor função globalmente para possível reuso
    window.verificarAcessoConsultoria = verificarAcessoConsultoria;
})();
