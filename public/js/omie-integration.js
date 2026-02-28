/**
 * Componente JavaScript de Integração Omie
 * Para uso em todos os módulos do ALUFORCE
 * 
 * Funcionalidades:
 * - Gerar Boleto
 * - Gerar PIX
 * - Baixar DANFE/XML
 * - Sincronizar dados
 */

const OmieIntegration = {
    // Status da integração
    isConnected: false,
    
    /**
     * Inicializar integração
     */
    async init() {
        try {
            const response = await fetch('/api/omie/status', { credentials: 'include' });
            const data = await response.json();
            this.isConnected = data.configured && data.connected;
            console.log('Omie Integration:', this.isConnected ? '✅ Conectado' : '❌ Desconectado');
            return this.isConnected;
        } catch (error) {
            console.error('Erro ao verificar Omie:', error);
            return false;
        }
    },

    /**
     * Mostrar toast de notificação
     */
    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `omie-toast omie-toast-${type}`;
        toast.innerHTML = `
            <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'times-circle' : 'info-circle'}"></i>
            <span>${message}</span>
        `;
        document.body.appendChild(toast);
        
        setTimeout(() => toast.classList.add('show'), 100);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    },

    // ========================================
    // BOLETOS
    // ========================================

    /**
     * Gerar boleto para conta a receber
     */
    async gerarBoleto(codigoLancamentoOmie) {
        if (!codigoLancamentoOmie) {
            this.showToast('Conta não sincronizada com Omie', 'error');
            return null;
        }

        try {
            this.showToast('Gerando boleto...', 'info');
            
            const response = await fetch(`/api/omie/financeiro/boleto/${codigoLancamentoOmie}`, {
                method: 'POST',
                credentials: 'include'
            });
            
            const data = await response.json();
            
            if (data.success && data.data) {
                this.showToast('Boleto gerado com sucesso!', 'success');
                
                // Se tiver link do boleto, abrir em nova aba
                if (data.data.cLinkBoleto) {
                    window.open(data.data.cLinkBoleto, '_blank');
                }
                
                return data.data;
            } else {
                throw new Error(data.error || 'Erro ao gerar boleto');
            }
        } catch (error) {
            this.showToast('Erro: ' + error.message, 'error');
            return null;
        }
    },

    // ========================================
    // PIX
    // ========================================

    /**
     * Gerar QR Code PIX para conta a receber
     */
    async gerarPix(codigoLancamentoOmie) {
        if (!codigoLancamentoOmie) {
            this.showToast('Conta não sincronizada com Omie', 'error');
            return null;
        }

        try {
            this.showToast('Gerando PIX...', 'info');
            
            const response = await fetch(`/api/omie/financeiro/pix/${codigoLancamentoOmie}`, {
                method: 'POST',
                credentials: 'include'
            });
            
            const data = await response.json();
            
            if (data.success && data.data) {
                this.showToast('PIX gerado com sucesso!', 'success');
                
                // Mostrar modal com QR Code
                this.mostrarModalPix(data.data);
                
                return data.data;
            } else {
                throw new Error(data.error || 'Erro ao gerar PIX');
            }
        } catch (error) {
            this.showToast('Erro: ' + error.message, 'error');
            return null;
        }
    },

    /**
     * Mostrar modal com QR Code PIX
     */
    mostrarModalPix(dadosPix) {
        const modal = document.createElement('div');
        modal.className = 'omie-modal-overlay';
        modal.innerHTML = `
            <div class="omie-modal">
                <div class="omie-modal-header">
                    <h3><i class="fas fa-qrcode"></i> PIX - Copia e Cola</h3>
                    <button class="omie-modal-close" onclick="this.closest('.omie-modal-overlay').remove()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="omie-modal-body" style="text-align: center;">
                    ${dadosPix.cQrCode ? `
                        <img src="data:image/png;base64,${dadosPix.cQrCode}" alt="QR Code PIX" style="max-width: 250px; margin-bottom: 20px;">
                    ` : ''}
                    <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
                        <p style="font-size: 12px; color: #666; margin-bottom: 8px;">Código PIX Copia e Cola:</p>
                        <textarea id="pixCopiaCola" readonly style="width: 100%; height: 80px; font-size: 11px; padding: 10px; border: 1px solid #ddd; border-radius: 4px; resize: none;">${dadosPix.cCopiaCola || 'Código não disponível'}</textarea>
                    </div>
                    <button class="btn btn-primary" onclick="navigator.clipboard.writeText(document.getElementById('pixCopiaCola').value); OmieIntegration.showToast('Código PIX copiado!', 'success');">
                        <i class="fas fa-copy"></i> Copiar Código
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        setTimeout(() => modal.classList.add('active'), 50);
    },

    // ========================================
    // NF-e
    // ========================================

    /**
     * Baixar DANFE (PDF)
     */
    async baixarDanfe(chaveNFe) {
        if (!chaveNFe) {
            this.showToast('Chave NF-e não informada', 'error');
            return null;
        }

        try {
            this.showToast('Buscando DANFE...', 'info');
            
            const response = await fetch(`/api/omie/nfe/${chaveNFe}/pdf`, {
                credentials: 'include'
            });
            
            const data = await response.json();
            
            if (data.success && data.data && data.data.cPdfBase64) {
                // Converter base64 para blob e fazer download
                const byteCharacters = atob(data.data.cPdfBase64);
                const byteNumbers = new Array(byteCharacters.length);
                for (let i = 0; i < byteCharacters.length; i++) {
                    byteNumbers[i] = byteCharacters.charCodeAt(i);
                }
                const byteArray = new Uint8Array(byteNumbers);
                const blob = new Blob([byteArray], { type: 'application/pdf' });
                
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `DANFE_${chaveNFe}.pdf`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
                
                this.showToast('DANFE baixada com sucesso!', 'success');
                return true;
            } else {
                throw new Error(data.error || 'DANFE não disponível');
            }
        } catch (error) {
            this.showToast('Erro: ' + error.message, 'error');
            return null;
        }
    },

    /**
     * Baixar XML da NF-e
     */
    async baixarXml(chaveNFe) {
        if (!chaveNFe) {
            this.showToast('Chave NF-e não informada', 'error');
            return null;
        }

        try {
            this.showToast('Buscando XML...', 'info');
            
            const response = await fetch(`/api/omie/nfe/${chaveNFe}/xml`, {
                credentials: 'include'
            });
            
            const data = await response.json();
            
            if (data.success && data.data && data.data.cXml) {
                // Criar blob e fazer download
                const blob = new Blob([data.data.cXml], { type: 'application/xml' });
                
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `NFe_${chaveNFe}.xml`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
                
                this.showToast('XML baixado com sucesso!', 'success');
                return true;
            } else {
                throw new Error(data.error || 'XML não disponível');
            }
        } catch (error) {
            this.showToast('Erro: ' + error.message, 'error');
            return null;
        }
    },

    // ========================================
    // SINCRONIZAÇÍO
    // ========================================

    /**
     * Sincronizar contas a pagar
     */
    async sincronizarContasPagar() {
        try {
            this.showToast('Sincronizando contas a pagar...', 'info');
            
            const response = await fetch('/api/omie/financeiro/contas-pagar/sincronizar', {
                method: 'POST',
                credentials: 'include'
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.showToast(`Sincronizado! ${data.importados} novos, ${data.atualizados} atualizados`, 'success');
                return data;
            } else {
                throw new Error(data.error);
            }
        } catch (error) {
            this.showToast('Erro: ' + error.message, 'error');
            return null;
        }
    },

    /**
     * Sincronizar contas a receber
     */
    async sincronizarContasReceber() {
        try {
            this.showToast('Sincronizando contas a receber...', 'info');
            
            const response = await fetch('/api/omie/financeiro/contas-receber/sincronizar', {
                method: 'POST',
                credentials: 'include'
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.showToast(`Sincronizado! ${data.importados} novos, ${data.atualizados} atualizados`, 'success');
                return data;
            } else {
                throw new Error(data.error);
            }
        } catch (error) {
            this.showToast('Erro: ' + error.message, 'error');
            return null;
        }
    },

    /**
     * Consultar estoque de produto
     */
    async consultarEstoque(codigoProdutoOmie) {
        try {
            const response = await fetch(`/api/omie/estoque/${codigoProdutoOmie}`, {
                credentials: 'include'
            });
            
            const data = await response.json();
            
            if (data.success) {
                return data.data;
            } else {
                throw new Error(data.error);
            }
        } catch (error) {
            console.error('Erro ao consultar estoque:', error);
            return null;
        }
    },

    /**
     * Listar NF-e do período
     */
    async listarNFe(dataInicio, dataFim) {
        try {
            let url = '/api/omie/nfe?';
            if (dataInicio) url += `data_inicio=${dataInicio}&`;
            if (dataFim) url += `data_fim=${dataFim}`;
            
            const response = await fetch(url, { credentials: 'include' });
            const data = await response.json();
            
            if (data.success) {
                return data.data;
            } else {
                throw new Error(data.error);
            }
        } catch (error) {
            console.error('Erro ao listar NF-e:', error);
            return [];
        }
    },

    /**
     * Listar pedidos de venda
     */
    async listarPedidosVenda(pagina = 1) {
        try {
            const response = await fetch(`/api/omie/pedidos?pagina=${pagina}`, {
                credentials: 'include'
            });
            
            const data = await response.json();
            
            if (data.success) {
                return data;
            } else {
                throw new Error(data.error);
            }
        } catch (error) {
            console.error('Erro ao listar pedidos:', error);
            return { data: [], total_registros: 0 };
        }
    },

    /**
     * Listar ordens de produção
     */
    async listarOrdensProducao(pagina = 1) {
        try {
            const response = await fetch(`/api/omie/pcp/ordens-producao?pagina=${pagina}`, {
                credentials: 'include'
            });
            
            const data = await response.json();
            
            if (data.success) {
                return data;
            } else {
                throw new Error(data.error);
            }
        } catch (error) {
            console.error('Erro ao listar OPs:', error);
            return { data: [], total_registros: 0 };
        }
    },

    /**
     * Criar pedido no Omie
     */
    async criarPedidoOmie(pedidoData) {
        try {
            this.showToast('Enviando pedido para Omie...', 'info');
            
            const response = await fetch('/api/omie/pedidos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(pedidoData)
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.showToast('Pedido criado no Omie!', 'success');
                return data.data;
            } else {
                throw new Error(data.error);
            }
        } catch (error) {
            this.showToast('Erro: ' + error.message, 'error');
            return null;
        }
    }
};

// CSS para toasts e modais
const omieStyles = document.createElement('style');
omieStyles.textContent = `
    .omie-toast {
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: #333;
        color: white;
        padding: 14px 20px;
        border-radius: 10px;
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 14px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        z-index: 100000;
        transform: translateX(120%);
        transition: transform 0.3s ease;
    }
    
    .omie-toast.show {
        transform: translateX(0);
    }
    
    .omie-toast-success {
        background: linear-gradient(135deg, #22c55e, #16a34a);
    }
    
    .omie-toast-error {
        background: linear-gradient(135deg, #ef4444, #dc2626);
    }
    
    .omie-toast-info {
        background: linear-gradient(135deg, #3b82f6, #2563eb);
    }
    
    .omie-modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 100000;
        opacity: 0;
        transition: opacity 0.3s;
    }
    
    .omie-modal-overlay.active {
        opacity: 1;
    }
    
    .omie-modal {
        background: white;
        border-radius: 16px;
        max-width: 450px;
        width: 90%;
        overflow: hidden;
        box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    }
    
    .omie-modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 20px;
        background: linear-gradient(135deg, #6366f1, #4f46e5);
        color: white;
    }
    
    .omie-modal-header h3 {
        margin: 0;
        font-size: 18px;
        display: flex;
        align-items: center;
        gap: 10px;
    }
    
    .omie-modal-close {
        background: none;
        border: none;
        color: white;
        font-size: 20px;
        cursor: pointer;
        opacity: 0.8;
    }
    
    .omie-modal-close:hover {
        opacity: 1;
    }
    
    .omie-modal-body {
        padding: 24px;
    }
    
    .omie-btn-group {
        display: flex;
        gap: 8px;
    }
    
    .omie-btn {
        padding: 8px 16px;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 500;
        border: none;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        transition: all 0.2s;
    }
    
    .omie-btn-boleto {
        background: linear-gradient(135deg, #f59e0b, #d97706);
        color: white;
    }
    
    .omie-btn-boleto:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(245, 158, 11, 0.4);
    }
    
    .omie-btn-pix {
        background: linear-gradient(135deg, #22c55e, #16a34a);
        color: white;
    }
    
    .omie-btn-pix:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(34, 197, 94, 0.4);
    }
    
    .omie-btn-danfe {
        background: linear-gradient(135deg, #ef4444, #dc2626);
        color: white;
    }
    
    .omie-btn-danfe:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(239, 68, 68, 0.4);
    }
    
    .omie-btn-xml {
        background: linear-gradient(135deg, #3b82f6, #2563eb);
        color: white;
    }
    
    .omie-btn-xml:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
    }
    
    .omie-sync-badge {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 8px;
        border-radius: 10px;
        font-size: 11px;
        font-weight: 500;
    }
    
    .omie-sync-badge.synced {
        background: rgba(34, 197, 94, 0.1);
        color: #16a34a;
    }
    
    .omie-sync-badge.not-synced {
        background: rgba(107, 114, 128, 0.1);
        color: #6b7280;
    }
`;
document.head.appendChild(omieStyles);

// Exportar para uso global
window.OmieIntegration = OmieIntegration;

// Inicializar ao carregar
document.addEventListener('DOMContentLoaded', () => {
    OmieIntegration.init();
});
