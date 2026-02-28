/**
 * ALUFORCE - Módulo Financeiro - Script Comum
 * Funções compartilhadas entre todas as páginas do módulo
 * Versão: 2.0 - Tema Verde + Notificações pelo sino do header
 */

const FinanceiroAPI = {
    base: window.location.origin,
    
    // Buscar dados com tratamento de erro
    async fetch(endpoint, options = {}) {
        try {
            const response = await fetch(`${this.base}${endpoint}`, {
                credentials: 'include',
                ...options,
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    ...options.headers
                }
            });
            
            if (response.ok) {
                return await response.json();
            }
            throw new Error(`HTTP ${response.status}`);
        } catch (error) {
            console.error(`[FinanceiroAPI] Erro em ${endpoint}:`, error);
            return null;
        }
    },
    
    // ===== CONTAS A PAGAR =====
    async getContasPagar(filtros = {}) {
        const params = new URLSearchParams(filtros);
        return await this.fetch(`/api/financeiro/contas-pagar?${params}`);
    },
    
    async getContasPagarResumo() {
        return await this.fetch('/api/financeiro/contas-pagar/resumo');
    },
    
    async salvarContaPagar(dados) {
        return await this.fetch('/api/financeiro/contas-pagar', {
            method: 'POST',
            body: JSON.stringify(dados)
        });
    },
    
    async pagarConta(id, dadosPagamento) {
        return await this.fetch(`/api/financeiro/contas-pagar/${id}/pagar`, {
            method: 'POST',
            body: JSON.stringify(dadosPagamento)
        });
    },
    
    // ===== CONTAS A RECEBER =====
    async getContasReceber(filtros = {}) {
        const params = new URLSearchParams(filtros);
        return await this.fetch(`/api/financeiro/contas-receber?${params}`);
    },
    
    async getContasReceberResumo() {
        return await this.fetch('/api/financeiro/contas-receber/resumo');
    },
    
    async receberConta(id, dadosRecebimento) {
        return await this.fetch(`/api/financeiro/contas-receber/${id}/receber`, {
            method: 'POST',
            body: JSON.stringify(dadosRecebimento)
        });
    },
    
    // ===== CONTAS BANCÁRIAS =====
    async getContasBancarias() {
        return await this.fetch('/api/financeiro/contas-bancarias');
    },
    
    async getSaldoTotal() {
        return await this.fetch('/api/financeiro/contas-bancarias/saldo-total');
    },
    
    // ===== FLUXO DE CAIXA =====
    async getFluxoCaixa(periodo = 'mes') {
        return await this.fetch(`/api/financeiro/fluxo-caixa?periodo=${periodo}`);
    },
    
    async getFluxoCaixaResumo() {
        return await this.fetch('/api/financeiro/fluxo-caixa/resumo');
    },
    
    // ===== CONCILIAÇÃO =====
    async getConciliacaoResumo() {
        return await this.fetch('/api/conciliacao/resumo');
    },
    
    // ===== DASHBOARD =====
    async getDashboardResumo() {
        return await this.fetch('/api/financeiro/dashboard');
    }
};

// ===== SISTEMA DE NOTIFICAÇÕES PELO SINO DO HEADER =====
const NotificacoesFinanceiro = {
    // Inicializar usando o sino que já existe no header
    init() {
        // Busca o botão do sino no header
        const bellBtn = document.querySelector('.header-btn[title="Notificações"]') ||
                        document.querySelector('#btn-notificacoes') ||
                        document.querySelector('.notification-btn');
        
        if (bellBtn) {
            bellBtn.style.cursor = 'pointer';
            bellBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.abrirModal();
            };
        }
        
        this.atualizarContagem();
        setInterval(() => this.atualizarContagem(), 30000);
    },
    
    // Atualizar badge de contagem
    async atualizarContagem() {
        try {
            const response = await FinanceiroAPI.fetch('/api/notificacoes/count?area=financeiro');
            const count = response?.count || response?.total || 0;
            
            const badges = document.querySelectorAll('.notif-badge, .notification-badge, #notif-count');
            badges.forEach(badge => {
                badge.textContent = count > 99 ? '99+' : count;
                badge.style.display = count > 0 ? 'flex' : 'none';
            });
        } catch (e) {
            console.log('[Notificações] Serviço indisponível');
        }
    },
    
    // Abrir modal de notificações
    abrirModal() {
        document.querySelectorAll('.notificacoes-modal-overlay').forEach(el => el.remove());
        
        const modal = document.createElement('div');
        modal.className = 'notificacoes-modal-overlay';
        modal.style.cssText = `
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.5); z-index: 9999;
            display: flex; align-items: flex-start; justify-content: flex-end;
            padding: 60px 20px 20px 20px;
        `;
        
        modal.innerHTML = `
            <div style="
                background: white; border-radius: 16px; width: 400px; max-height: 500px;
                box-shadow: 0 20px 40px rgba(0,0,0,0.2); overflow: hidden;
            ">
                <div style="padding: 20px; border-bottom: 1px solid #f1f5f9; display: flex; justify-content: space-between; align-items: center;">
                    <h3 style="font-size: 18px; font-weight: 700; display: flex; align-items: center; gap: 10px; color: #1e293b;">
                        <i class="fas fa-bell" style="color: #16a34a;"></i> Notificações
                    </h3>
                    <button onclick="this.closest('.notificacoes-modal-overlay').remove()" style="
                        width: 32px; height: 32px; border: none; background: #f1f5f9;
                        border-radius: 8px; cursor: pointer; font-size: 16px;
                    "><i class="fas fa-times"></i></button>
                </div>
                <div class="notificacoes-lista" style="max-height: 400px; overflow-y: auto; padding: 12px;">
                    <div style="text-align: center; padding: 40px; color: #64748b;">
                        <i class="fas fa-spinner fa-spin" style="font-size: 24px;"></i>
                        <p style="margin-top: 12px;">Carregando...</p>
                    </div>
                </div>
            </div>
        `;
        
        modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
        document.body.appendChild(modal);
        this.carregarNotificacoes();
    },
    
    // Carregar lista de notificações
    async carregarNotificacoes() {
        const lista = document.querySelector('.notificacoes-lista');
        if (!lista) return;
        
        try {
            const response = await FinanceiroAPI.fetch('/api/notificacoes?area=financeiro&limit=20');
            const raw = response?.data || response || [];
            const notificacoes = Array.isArray(raw) ? raw : [];
            
            if (notificacoes.length === 0) {
                lista.innerHTML = `
                    <div style="text-align: center; padding: 60px 20px; color: #64748b;">
                        <i class="fas fa-check-circle" style="font-size: 48px; margin-bottom: 16px; color: #16a34a;"></i>
                        <p style="font-weight: 600;">Tudo em dia!</p>
                        <p style="font-size: 13px; margin-top: 4px;">Nenhuma notificação pendente</p>
                    </div>
                `;
                return;
            }
            
            lista.innerHTML = notificacoes.map(n => {
                const icone = n.tipo === 'alerta' ? 'exclamation-triangle' : 
                              n.tipo === 'erro' ? 'times-circle' : 
                              n.tipo === 'sucesso' ? 'check-circle' : 'info-circle';
                const cor = n.tipo === 'alerta' ? '#f59e0b' : 
                            n.tipo === 'erro' ? '#ef4444' : 
                            n.tipo === 'sucesso' ? '#16a34a' : '#3b82f6';
                
                return `
                    <div style="padding: 16px; border-bottom: 1px solid #f1f5f9; display: flex; gap: 12px;">
                        <div style="width: 40px; height: 40px; border-radius: 10px; background: ${cor}15; 
                                    display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                            <i class="fas fa-${icone}" style="color: ${cor}; font-size: 16px;"></i>
                        </div>
                        <div style="flex: 1;">
                            <p style="font-weight: 600; font-size: 14px; margin-bottom: 4px; color: #1e293b;">
                                ${n.titulo || n.mensagem || 'Notificação'}
                            </p>
                            <p style="font-size: 13px; color: #64748b; margin-bottom: 4px;">
                                ${n.descricao || ''}
                            </p>
                            <span style="font-size: 11px; color: #94a3b8;">
                                ${this.formatarData(n.created_at)}
                            </span>
                        </div>
                    </div>
                `;
            }).join('');
            
        } catch (error) {
            lista.innerHTML = `
                <div style="text-align: center; padding: 40px; color: #ef4444;">
                    <i class="fas fa-exclamation-circle" style="font-size: 32px; margin-bottom: 12px;"></i>
                    <p>Erro ao carregar notificações</p>
                </div>
            `;
        }
    },
    
    formatarData(data) {
        if (!data) return '';
        const d = new Date(data);
        const agora = new Date();
        const diff = agora - d;
        if (diff < 60000) return 'Agora';
        if (diff < 3600000) return `${Math.floor(diff / 60000)} min atrás`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}h atrás`;
        return d.toLocaleDateString('pt-BR');
    }
};

// ===== UTILITÁRIOS DE FORMATAÇÃO =====
const FinanceiroUtils = {
    formatarMoeda(valor) {
        return new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL'
        }).format(valor || 0);
    },
    
    formatarData(data) {
        if (!data) return '--/--/----';
        return new Date(data).toLocaleDateString('pt-BR');
    },
    
    getStatusLabel(status) {
        const labels = {
            'pendente': 'Pendente',
            'pago': 'Pago',
            'recebido': 'Recebido',
            'vencido': 'Vencido',
            'parcial': 'Parcial',
            'cancelado': 'Cancelado'
        };
        return labels[status] || status;
    },
    
    getStatusClass(status) {
        return `status-badge ${status}`;
    },
    
    carregarUsuario() {
        try {
            const userData = JSON.parse(localStorage.getItem('user') || '{}');
            const userName = userData.name || userData.nome || userData.nome_completo || 'Usuário';
            
            const userNameEl = document.getElementById('user-name');
            const userInitialEl = document.getElementById('user-initials');
            
            if (userNameEl) userNameEl.textContent = userName.split(' ')[0];
            if (userInitialEl) userInitialEl.textContent = userName.charAt(0).toUpperCase();
        } catch (e) {}
    },
    
    toast(mensagem, tipo = 'info') {
        const cores = { success: '#16a34a', error: '#ef4444', warning: '#f59e0b', info: '#3b82f6' };
        const icones = { success: 'check-circle', error: 'times-circle', warning: 'exclamation-triangle', info: 'info-circle' };
        
        const toast = document.createElement('div');
        toast.style.cssText = `
            position: fixed; bottom: 24px; right: 24px; z-index: 10000;
            background: ${cores[tipo]}; color: white;
            padding: 16px 24px; border-radius: 12px;
            font-weight: 600; font-size: 14px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.2);
            display: flex; align-items: center; gap: 10px;
        `;
        toast.innerHTML = `<i class="fas fa-${icones[tipo]}"></i><span>${mensagem}</span>`;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }
};

// ===== CARREGADORES DE DADOS REAIS =====
const DadosReais = {
    async carregarDashboard() {
        const [pagar, receber, bancos, fluxo] = await Promise.all([
            FinanceiroAPI.getContasPagarResumo(),
            FinanceiroAPI.getContasReceberResumo(),
            FinanceiroAPI.getSaldoTotal(),
            FinanceiroAPI.getFluxoCaixaResumo()
        ]);
        
        return {
            contasPagar: {
                total: pagar?.total_pendente || 0,
                venceHoje: pagar?.vence_hoje || 0,
                vencidas: pagar?.total_vencido || 0,
                pagoMes: pagar?.total_pago || 0
            },
            contasReceber: {
                total: receber?.total_pendente || 0,
                venceHoje: receber?.vence_hoje || 0,
                vencidas: receber?.total_vencido || 0,
                recebidoMes: receber?.total_pago || receber?.total_recebido || 0
            },
            bancos: {
                saldoTotal: bancos?.saldo_total || 0,
                contasAtivas: bancos?.contas_ativas || 0,
                entradasMes: bancos?.entradas_mes || 0,
                saidasMes: bancos?.saidas_mes || 0
            },
            fluxo: {
                entradas: fluxo?.total_entradas || 0,
                saidas: fluxo?.total_saidas || 0,
                saldo: fluxo?.saldo || 0,
                projecao: fluxo?.projecao_30dias || 0
            }
        };
    },
    
    async carregarConciliacao() {
        const resumo = await FinanceiroAPI.getConciliacaoResumo();
        return {
            conciliados: resumo?.conciliados || 0,
            pendentes: resumo?.pendentes || 0,
            divergentes: resumo?.divergentes || 0,
            total: resumo?.total || 0,
            saldoSistema: resumo?.saldo_sistema || 0,
            saldoExtrato: resumo?.saldo_extrato || 0,
            diferenca: resumo?.diferenca || 0
        };
    }
};

// ===== INICIALIZAÇÃO =====
document.addEventListener('DOMContentLoaded', () => {
    NotificacoesFinanceiro.init();
    FinanceiroUtils.carregarUsuario();
});

window.FinanceiroAPI = FinanceiroAPI;
window.NotificacoesFinanceiro = NotificacoesFinanceiro;
window.FinanceiroUtils = FinanceiroUtils;
window.DadosReais = DadosReais;
