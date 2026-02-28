/**
 * ALUFORCE - Módulo Financeiro - API Client
 * Gerencia todas as chamadas à API do financeiro
 * @version 2.0
 * @date 2026-01-09
 */

const FinanceiroAPI = {
    // ===========================================
    // CONFIGURAÇÕES
    // ===========================================
    baseUrl: '/api/financeiro',
    
    // ===========================================
    // UTILITÁRIOS
    // ===========================================
    formatarMoeda(valor) {
        return new Intl.NumberFormat('pt-BR', { 
            style: 'currency', 
            currency: 'BRL' 
        }).format(valor || 0);
    },
    
    parseMoeda(str) {
        if (!str) return 0;
        if (typeof str === 'number') return str;
        return parseFloat(str.replace(/[^\d,.-]/g, '').replace('.', '').replace(',', '.')) || 0;
    },
    
    formatarData(data) {
        if (!data) return '-';
        const d = new Date(data + 'T00:00:00');
        return d.toLocaleDateString('pt-BR');
    },
    
    formatarDataISO(data) {
        if (!data) return null;
        const d = new Date(data);
        return d.toISOString().split('T')[0];
    },
    
    // ===========================================
    // CONTAS A PAGAR
    // ===========================================
    async listarContasPagar(filtros = {}) {
        try {
            const params = new URLSearchParams();
            if (filtros.status) params.append('status', filtros.status);
            if (filtros.categoria) params.append('categoria', filtros.categoria);
            if (filtros.dataInicio) params.append('data_inicio', filtros.dataInicio);
            if (filtros.dataFim) params.append('data_fim', filtros.dataFim);
            
            const url = `${this.baseUrl}/contas-pagar${params.toString() ? '?' + params.toString() : ''}`;
            const response = await fetch(url, { credentials: 'include' });
            
            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                throw new Error(error.message || 'Erro ao carregar contas a pagar');
            }
            
            const data = await response.json();
            return data.data || data || [];
        } catch (error) {
            console.error('Erro ao listar contas a pagar:', error);
            throw error;
        }
    },
    
    async obterContaPagar(id) {
        try {
            const response = await fetch(`${this.baseUrl}/contas-pagar/${id}`, { credentials: 'include' });
            if (!response.ok) throw new Error('Conta não encontrada');
            return await response.json();
        } catch (error) {
            console.error('Erro ao obter conta a pagar:', error);
            throw error;
        }
    },
    
    async criarContaPagar(dados) {
        try {
            const response = await fetch(`${this.baseUrl}/contas-pagar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    fornecedor_id: dados.fornecedor_id || null,
                    valor: this.parseMoeda(dados.valor),
                    descricao: dados.descricao,
                    data_vencimento: dados.vencimento || dados.data_vencimento,
                    categoria_id: dados.categoria_id || null,
                    banco_id: dados.banco_id || null,
                    forma_pagamento: dados.forma_pagamento || dados.forma || 'boleto',
                    observacoes: dados.observacoes || dados.descricao,
                    cnpj_cpf: dados.cnpj_cpf || dados.cnpjCpf || null,
                    parcela_numero: dados.parcela_numero || 1,
                    total_parcelas: dados.total_parcelas || 1
                })
            });
            
            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                throw new Error(error.message || 'Erro ao criar conta a pagar');
            }
            
            return await response.json();
        } catch (error) {
            console.error('Erro ao criar conta a pagar:', error);
            throw error;
        }
    },
    
    async atualizarContaPagar(id, dados) {
        try {
            const response = await fetch(`${this.baseUrl}/contas-pagar/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    fornecedor_id: dados.fornecedor_id || null,
                    valor: this.parseMoeda(dados.valor),
                    descricao: dados.descricao,
                    data_vencimento: dados.vencimento || dados.data_vencimento,
                    categoria_id: dados.categoria_id || null,
                    banco_id: dados.banco_id || null,
                    forma_pagamento: dados.forma_pagamento || dados.forma || 'boleto',
                    observacoes: dados.observacoes || dados.descricao,
                    status: dados.status || 'pendente'
                })
            });
            
            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                throw new Error(error.message || 'Erro ao atualizar conta');
            }
            
            return await response.json();
        } catch (error) {
            console.error('Erro ao atualizar conta a pagar:', error);
            throw error;
        }
    },
    
    async excluirContaPagar(id) {
        try {
            const response = await fetch(`${this.baseUrl}/contas-pagar/${id}`, {
                method: 'DELETE',
                credentials: 'include'
            });
            
            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                throw new Error(error.message || 'Erro ao excluir conta');
            }
            
            return await response.json();
        } catch (error) {
            console.error('Erro ao excluir conta a pagar:', error);
            throw error;
        }
    },
    
    async pagarConta(id, dadosPagamento) {
        try {
            const response = await fetch(`${this.baseUrl}/contas-pagar/${id}/pagar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    valor_pago: this.parseMoeda(dadosPagamento.valor_pago || dadosPagamento.valorPago),
                    data_pagamento: dadosPagamento.data_pagamento || dadosPagamento.dataPagamento,
                    banco_id: dadosPagamento.banco_id || dadosPagamento.contaBancaria,
                    juros: this.parseMoeda(dadosPagamento.juros) || 0,
                    desconto: this.parseMoeda(dadosPagamento.desconto) || 0,
                    observacoes: dadosPagamento.observacoes || ''
                })
            });
            
            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                throw new Error(error.message || 'Erro ao registrar pagamento');
            }
            
            return await response.json();
        } catch (error) {
            console.error('Erro ao pagar conta:', error);
            throw error;
        }
    },
    
    // ===========================================
    // CONTAS A RECEBER
    // ===========================================
    async listarContasReceber(filtros = {}) {
        try {
            const params = new URLSearchParams();
            if (filtros.status) params.append('status', filtros.status);
            if (filtros.categoria) params.append('categoria', filtros.categoria);
            if (filtros.dataInicio) params.append('data_inicio', filtros.dataInicio);
            if (filtros.dataFim) params.append('data_fim', filtros.dataFim);
            
            const url = `${this.baseUrl}/contas-receber${params.toString() ? '?' + params.toString() : ''}`;
            const response = await fetch(url, { credentials: 'include' });
            
            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                throw new Error(error.message || 'Erro ao carregar contas a receber');
            }
            
            const data = await response.json();
            return data.data || data || [];
        } catch (error) {
            console.error('Erro ao listar contas a receber:', error);
            throw error;
        }
    },
    
    async obterContaReceber(id) {
        try {
            const response = await fetch(`${this.baseUrl}/contas-receber/${id}`, { credentials: 'include' });
            if (!response.ok) throw new Error('Conta não encontrada');
            return await response.json();
        } catch (error) {
            console.error('Erro ao obter conta a receber:', error);
            throw error;
        }
    },
    
    async criarContaReceber(dados) {
        try {
            const response = await fetch(`${this.baseUrl}/contas-receber`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    cliente_id: dados.cliente_id || null,
                    valor: this.parseMoeda(dados.valor),
                    descricao: dados.descricao,
                    data_vencimento: dados.vencimento || dados.data_vencimento,
                    categoria_id: dados.categoria_id || null,
                    banco_id: dados.banco_id || null,
                    forma_recebimento: dados.forma_recebimento || dados.forma || 'boleto',
                    observacoes: dados.observacoes || dados.descricao,
                    parcela_numero: dados.parcela_numero || 1,
                    total_parcelas: dados.total_parcelas || 1
                })
            });
            
            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                throw new Error(error.message || 'Erro ao criar conta a receber');
            }
            
            return await response.json();
        } catch (error) {
            console.error('Erro ao criar conta a receber:', error);
            throw error;
        }
    },
    
    async atualizarContaReceber(id, dados) {
        try {
            const response = await fetch(`${this.baseUrl}/contas-receber/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    cliente_id: dados.cliente_id || null,
                    valor: this.parseMoeda(dados.valor),
                    descricao: dados.descricao,
                    data_vencimento: dados.vencimento || dados.data_vencimento,
                    categoria_id: dados.categoria_id || null,
                    banco_id: dados.banco_id || null,
                    forma_recebimento: dados.forma_recebimento || dados.forma || 'boleto',
                    observacoes: dados.observacoes || dados.descricao,
                    status: dados.status || 'pendente'
                })
            });
            
            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                throw new Error(error.message || 'Erro ao atualizar conta');
            }
            
            return await response.json();
        } catch (error) {
            console.error('Erro ao atualizar conta a receber:', error);
            throw error;
        }
    },
    
    async excluirContaReceber(id) {
        try {
            const response = await fetch(`${this.baseUrl}/contas-receber/${id}`, {
                method: 'DELETE',
                credentials: 'include'
            });
            
            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                throw new Error(error.message || 'Erro ao excluir conta');
            }
            
            return await response.json();
        } catch (error) {
            console.error('Erro ao excluir conta a receber:', error);
            throw error;
        }
    },
    
    async receberConta(id, dadosRecebimento) {
        try {
            const response = await fetch(`${this.baseUrl}/contas-receber/${id}/receber`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    valor_recebido: this.parseMoeda(dadosRecebimento.valor_recebido || dadosRecebimento.valorRecebido),
                    data_recebimento: dadosRecebimento.data_recebimento || dadosRecebimento.dataRecebimento,
                    banco_id: dadosRecebimento.banco_id || dadosRecebimento.contaBancaria,
                    observacoes: dadosRecebimento.observacoes || ''
                })
            });
            
            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                throw new Error(error.message || 'Erro ao registrar recebimento');
            }
            
            return await response.json();
        } catch (error) {
            console.error('Erro ao receber conta:', error);
            throw error;
        }
    },
    
    // ===========================================
    // DASHBOARD E ESTATÍSTICAS
    // ===========================================
    async obterResumoPagar() {
        try {
            const response = await fetch(`${this.baseUrl}/contas-pagar/resumo`, { credentials: 'include' });
            if (!response.ok) throw new Error('Erro ao obter resumo');
            return await response.json();
        } catch (error) {
            console.error('Erro ao obter resumo contas a pagar:', error);
            return { total: 0, vencidas: 0, venceHoje: 0, pagoMes: 0 };
        }
    },
    
    async obterResumoReceber() {
        try {
            const response = await fetch(`${this.baseUrl}/contas-receber/resumo`, { credentials: 'include' });
            if (!response.ok) throw new Error('Erro ao obter resumo');
            return await response.json();
        } catch (error) {
            console.error('Erro ao obter resumo contas a receber:', error);
            return { total: 0, vencidas: 0, venceHoje: 0, recebidoMes: 0 };
        }
    },
    
    async obterEstatisticasPagar() {
        try {
            const response = await fetch(`${this.baseUrl}/contas-pagar/estatisticas`, { credentials: 'include' });
            if (!response.ok) throw new Error('Erro ao obter estatísticas');
            return await response.json();
        } catch (error) {
            console.error('Erro ao obter estatísticas:', error);
            return {};
        }
    },
    
    async obterEstatisticasReceber() {
        try {
            const response = await fetch(`${this.baseUrl}/contas-receber/estatisticas`, { credentials: 'include' });
            if (!response.ok) throw new Error('Erro ao obter estatísticas');
            return await response.json();
        } catch (error) {
            console.error('Erro ao obter estatísticas:', error);
            return {};
        }
    },
    
    // ===========================================
    // BANCOS
    // ===========================================
    async listarBancos() {
        try {
            const response = await fetch(`${this.baseUrl}/bancos`, { credentials: 'include' });
            if (!response.ok) throw new Error('Erro ao listar bancos');
            const data = await response.json();
            return data.data || data || [];
        } catch (error) {
            console.error('Erro ao listar bancos:', error);
            return [];
        }
    },
    
    // ===========================================
    // CATEGORIAS
    // ===========================================
    async listarCategorias(tipo = 'despesa') {
        try {
            const response = await fetch(`${this.baseUrl}/categorias?tipo=${tipo}`, { credentials: 'include' });
            if (!response.ok) throw new Error('Erro ao listar categorias');
            const data = await response.json();
            return data.data || data || [];
        } catch (error) {
            console.error('Erro ao listar categorias:', error);
            return [];
        }
    }
};

// Exportar para uso global
window.FinanceiroAPI = FinanceiroAPI;
