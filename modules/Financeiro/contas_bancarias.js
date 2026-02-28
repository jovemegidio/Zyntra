// ===== CONTAS BANCÁRIAS - ALUFORCE =====
let contasBancarias = [];
let contaSelecionada = null;

// ===== INICIALIZAÇÃO =====
document.addEventListener('DOMContentLoaded', async function() {
    try {
        await carregarContasBancarias();
        configurarEventos();
    } catch (error) {
        console.error('❌ Erro na inicialização:', error);
    }
});

// ===== CARREGAR DADOS =====
async function carregarContasBancarias() {
    try {
        const token = localStorage.getItem('token') || sessionStorage.getItem('token');
        const response = await fetch('/api/financeiro/contas-bancarias', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) throw new Error('Erro ao carregar contas');
        contasBancarias = await response.json();
        
        renderizarContas();
        atualizarResumo();
        
    } catch (error) {
        console.error('❌ Erro ao carregar contas:', error);
        mostrarAlerta('Erro ao carregar contas bancárias', 'error');
    }
}

// ===== RENDERIZAÇÃO =====
function renderizarContas() {
    const container = document.getElementById('contas-grid');
    
    if (!contasBancarias || contasBancarias.length === 0) {
        container.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; padding: 60px 20px;">
                <i class="fas fa-university" style="font-size: 64px; color: #cbd5e1; margin-bottom: 20px;"></i>
                <h3 style="color: #64748b; font-size: 18px; margin-bottom: 12px;">Nenhuma conta bancária cadastrada</h3>
                <p style="color: #94a3b8; margin-bottom: 24px;">Adicione sua primeira conta para começar</p>
                <button class="btn-primary" onclick="abrirModalConta()">
                    <i class="fas fa-plus"></i> Adicionar Conta
                </button>
            </div>
        `;
        return;
    }
    
    const html = contasBancarias.map(conta => {
        const saldoDisponivel = conta.saldo_atual + (conta.limite_credito || 0);
        const tipoConta = {
            'CORRENTE': 'Conta Corrente',
            'POUPANCA': 'Poupança',
            'INVESTIMENTO': 'Investimento'
        }[conta.tipo_conta] || conta.tipo_conta;
        
        return `
            <div class="conta-card">
                <span class="conta-status ${conta.ativo ? 'ativo' : 'inativo'}">
                    ${conta.ativo ? 'Ativa' : 'Inativa'}
                </span>
                
                <div class="conta-header">
                    <div class="conta-icon">
                        <i class="fas fa-university"></i>
                    </div>
                    <div class="conta-info">
                        <h3>${conta.banco}</h3>
                        <p>Ag: ${conta.agencia} • Conta: ${conta.número_conta}</p>
                    </div>
                </div>
                
                <div class="conta-saldo">
                    <div class="conta-saldo-label">Saldo Atual</div>
                    <div class="conta-saldo-valor" style="color: ${conta.saldo_atual >= 0 ? '#10b981' : '#ef4444'}">
                        ${formatarMoeda(Math.abs(conta.saldo_atual))}
                    </div>
                </div>
                
                <div class="conta-detalhes">
                    <div class="conta-detalhe-item">
                        <div class="conta-detalhe-label">Tipo</div>
                        <div class="conta-detalhe-valor">${tipoConta}</div>
                    </div>
                    <div class="conta-detalhe-item">
                        <div class="conta-detalhe-label">Código</div>
                        <div class="conta-detalhe-valor">${conta.código}</div>
                    </div>
                    <div class="conta-detalhe-item">
                        <div class="conta-detalhe-label">Limite</div>
                        <div class="conta-detalhe-valor">R$ ${formatarMoeda(conta.limite_credito || 0)}</div>
                    </div>
                    <div class="conta-detalhe-item">
                        <div class="conta-detalhe-label">Disponível</div>
                        <div class="conta-detalhe-valor" style="color: #10b981; font-weight: 700;">
                            R$ ${formatarMoeda(saldoDisponivel)}
                        </div>
                    </div>
                </div>
                
                <div class="conta-actions">
                    <button class="btn-movimentar" onclick="abrirModalMovimentacao(${conta.id})">
                        <i class="fas fa-exchange-alt"></i> Movimentar
                    </button>
                    <button class="btn-editar" onclick="editarConta(${conta.id})">
                        <i class="fas fa-edit"></i> Editar
                    </button>
                </div>
            </div>
        `;
    }).join('');
    
    container.innerHTML = html;
}

function atualizarResumo() {
    const saldoTotal = contasBancarias
        .filter(c => c.ativo)
        .reduce((sum, c) => sum + (c.saldo_atual || 0), 0);
    
    const limiteTotal = contasBancarias
        .filter(c => c.ativo)
        .reduce((sum, c) => sum + (c.limite_credito || 0), 0);
    
    const totalContas = contasBancarias.filter(c => c.ativo).length;
    const saldoDisponivel = saldoTotal + limiteTotal;
    
    document.getElementById('saldo-total').textContent = `R$ ${formatarMoeda(saldoTotal)}`;
    document.getElementById('total-contas').textContent = totalContas;
    document.getElementById('limite-total').textContent = `R$ ${formatarMoeda(limiteTotal)}`;
    document.getElementById('saldo-disponivel').textContent = `R$ ${formatarMoeda(saldoDisponivel)}`;
}

// ===== MODAL CONTA =====
function abrirModalConta() {
    contaSelecionada = null;
    document.getElementById('modal-titulo').textContent = 'Nova Conta Bancária';
    document.getElementById('form-conta').reset();
    document.getElementById('conta-id').value = '';
    document.getElementById('conta-ativa').checked = true;
    
    const hoje = new Date().toISOString().split('T')[0];
    document.getElementById('conta-data-abertura').value = hoje;
    
    abrirModal('modal-conta');
}

function editarConta(id) {
    contaSelecionada = contasBancarias.find(c => c.id === id);
    if (!contaSelecionada) return;
    
    document.getElementById('modal-titulo').textContent = 'Editar Conta Bancária';
    document.getElementById('conta-id').value = contaSelecionada.id;
    document.getElementById('conta-banco').value = contaSelecionada.banco || '';
    document.getElementById('conta-tipo').value = contaSelecionada.tipo_conta || 'CORRENTE';
    document.getElementById('conta-agencia').value = contaSelecionada.agencia || '';
    document.getElementById('conta-número').value = contaSelecionada.número_conta || '';
    document.getElementById('conta-saldo-inicial').value = contaSelecionada.saldo_inicial || 0;
    document.getElementById('conta-limite').value = contaSelecionada.limite_credito || 0;
    document.getElementById('conta-data-abertura').value = contaSelecionada.data_abertura || '';
    document.getElementById('conta-observacoes').value = contaSelecionada.observacoes || '';
    document.getElementById('conta-ativa').checked = contaSelecionada.ativo !== false;
    
    abrirModal('modal-conta');
}

async function salvarConta(event) {
    event.preventDefault();
    
    const id = document.getElementById('conta-id').value;
    const isEdicao = !!id;
    
    const dados = {
        banco: document.getElementById('conta-banco').value,
        tipo_conta: document.getElementById('conta-tipo').value,
        agencia: document.getElementById('conta-agencia').value,
        número_conta: document.getElementById('conta-número').value,
        saldo_inicial: parseFloat(document.getElementById('conta-saldo-inicial').value) || 0,
        limite_credito: parseFloat(document.getElementById('conta-limite').value) || 0,
        data_abertura: document.getElementById('conta-data-abertura').value,
        observacoes: document.getElementById('conta-observacoes').value,
        ativo: document.getElementById('conta-ativa').checked
    };
    
    try {
        const token = localStorage.getItem('token') || sessionStorage.getItem('token');
        const url = isEdicao ? `/api/financeiro/contas-bancarias/${id}` : '/api/financeiro/contas-bancarias';
        const method = isEdicao ? 'PUT' : 'POST';
        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(dados)
        });
        
        if (!response.ok) throw new Error('Erro ao salvar conta');
        
        mostrarAlerta(
            isEdicao ? 'Conta atualizada com sucesso!' : 'Conta criada com sucesso!',
            'success'
        );
        
        fecharModal('modal-conta');
        await carregarContasBancarias();
        
    } catch (error) {
        console.error('❌ Erro ao salvar conta:', error);
        mostrarAlerta('Erro ao salvar conta bancária', 'error');
    }
}

// ===== MODAL MOVIMENTAÇÃO =====
function abrirModalMovimentacao(contaId) {
    const conta = contasBancarias.find(c => c.id === contaId);
    if (!conta) return;
    
    document.getElementById('mov-conta-id').value = contaId;
    document.getElementById('form-movimentacao').reset();
    
    const hoje = new Date().toISOString().split('T')[0];
    document.getElementById('mov-data').value = hoje;
    
    // Carregar lista de contas para transferência
    carregarContasParaTransferencia(contaId);
    
    abrirModal('modal-movimentacao');
}

function carregarContasParaTransferencia(contaOrigemId) {
    const select = document.getElementById('mov-conta-destino');
    const contasDisponiveis = contasBancarias.filter(c => c.id !== contaOrigemId && c.ativo);
    
    select.innerHTML = '<option value="">Selecione...</option>' +
        contasDisponiveis.map(c => `
            <option value="${c.id}">${c.banco} - Ag: ${c.agencia} Conta: ${c.número_conta}</option>
        `).join('');
}

async function salvarMovimentacao(event) {
    event.preventDefault();
    
    const contaId = parseInt(document.getElementById('mov-conta-id').value);
    const tipo = document.getElementById('mov-tipo').value;
    const valor = parseFloat(document.getElementById('mov-valor').value);
    const data = document.getElementById('mov-data').value;
    const descrição = document.getElementById('mov-descrição').value;
    const contaDestinoId = document.getElementById('mov-conta-destino').value;
    
    // Validações
    if (tipo === 'TRANSFERENCIA' && !contaDestinoId) {
        mostrarAlerta('Selecione a conta de destino para transferência', 'error');
        return;
    }
    
    try {
        const token = localStorage.getItem('token') || sessionStorage.getItem('token');
        
        if (tipo === 'TRANSFERENCIA') {
            const response = await fetch('/api/financeiro/transferencia-bancaria', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ conta_origem_id: contaId, conta_destino_id: contaDestinoId, valor, data, descrição })
            });
            if (!response.ok) throw new Error('Erro ao realizar transferência');
        } else {
            const response = await fetch('/api/financeiro/movimentacoes-bancarias', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ conta_bancaria_id: contaId, tipo, valor, data, descrição })
            });
            if (!response.ok) throw new Error('Erro ao registrar movimentação');
        }
        
        mostrarAlerta('Movimentação registrada com sucesso!', 'success');
        
        fecharModal('modal-movimentacao');
        await carregarContasBancarias();
        
    } catch (error) {
        console.error('❌ Erro ao salvar movimentação:', error);
        mostrarAlerta('Erro ao registrar movimentação', 'error');
    }
}

// ===== EVENTOS =====
function configurarEventos() {
    // Mostrar/ocultar campo de conta destino
    document.getElementById('mov-tipo').addEventListener('change', function(e) {
        const grupoDestino = document.getElementById('mov-conta-destino-group');
        if (e.target.value === 'TRANSFERENCIA') {
            grupoDestino.style.display = 'block';
            document.getElementById('mov-conta-destino').required = true;
        } else {
            grupoDestino.style.display = 'none';
            document.getElementById('mov-conta-destino').required = false;
        }
    });
}

// ===== UTILIDADES =====
function abrirModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('show');
        document.body.style.overflow = 'hidden';
    }
}

function fecharModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('show');
        document.body.style.overflow = '';
    }
}

function mostrarAlerta(mensagem, tipo = 'info') {
    const alertaExistente = document.querySelector('.alert');
    if (alertaExistente) alertaExistente.remove();
    
    const alerta = document.createElement('div');
    alerta.className = `alert alert-${tipo}`;
    alerta.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 16px 24px;
        background: ${tipo === 'success' ? '#10b981' : tipo === 'error' ? '#ef4444' : '#3b82f6'};
        color: white;
        border-radius: 12px;
        box-shadow: 0 8px 20px rgba(0,0,0,0.15);
        z-index: 10000;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 12px;
        animation: slideIn 0.3s ease;
    `;
    
    const icon = tipo === 'success' ? 'check-circle' : tipo === 'error' ? 'exclamation-circle' : 'info-circle';
    alerta.innerHTML = `<i class="fas fa-${icon}"></i> ${mensagem}`;
    
    document.body.appendChild(alerta);
    
    setTimeout(() => {
        alerta.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => alerta.remove(), 300);
    }, 4000);
}

function formatarMoeda(valor) {
    return new Intl.NumberFormat('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(valor || 0);
}

// Adicionar animações CSS
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }
    
    .modal-overlay {
        display: none;
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        z-index: 9999;
        align-items: center;
        justify-content: center;
        backdrop-filter: blur(4px);
    }
    
    .modal-overlay.show {
        display: flex;
    }
    
    .modal-content {
        background: white;
        border-radius: 16px;
        width: 90%;
        max-width: 600px;
        max-height: 90vh;
        overflow-y: auto;
        box-shadow: 0 20px 40px rgba(0,0,0,0.2);
    }
    
    .modal-header {
        padding: 24px 28px;
        border-bottom: 1px solid #e5e7eb;
        display: flex;
        justify-content: space-between;
        align-items: center;
    }
    
    .modal-header h2 {
        margin: 0;
        font-size: 20px;
        font-weight: 700;
        color: #1f2937;
    }
    
    .modal-close {
        background: none;
        border: none;
        font-size: 28px;
        color: #9ca3af;
        cursor: pointer;
        padding: 0;
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 8px;
        transition: all 0.2s;
    }
    
    .modal-close:hover {
        background: #f3f4f6;
        color: #1f2937;
    }
    
    .modal-body {
        padding: 28px;
    }
    
    .modal-footer {
        padding: 20px 28px;
        border-top: 1px solid #e5e7eb;
        display: flex;
        justify-content: flex-end;
        gap: 12px;
    }
    
    .form-group {
        margin-bottom: 20px;
    }
    
    .form-group label {
        display: block;
        font-size: 14px;
        font-weight: 600;
        color: #374151;
        margin-bottom: 8px;
    }
    
    .form-input, .form-select, .form-textarea {
        width: 100%;
        padding: 12px 16px;
        border: 1px solid #d1d5db;
        border-radius: 8px;
        font-size: 14px;
        transition: all 0.2s;
    }
    
    .form-input:focus, .form-select:focus, .form-textarea:focus {
        outline: none;
        border-color: #3b82f6;
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
    }
    
    .form-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
    }
    
    .required {
        color: #ef4444;
    }
    
    .checkbox-label {
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
    }
    
    .btn-primary, .btn-secondary {
        padding: 12px 24px;
        border: none;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
        display: inline-flex;
        align-items: center;
        gap: 8px;
    }
    
    .btn-primary {
        background: #3b82f6;
        color: white;
    }
    
    .btn-primary:hover {
        background: #2563eb;
    }
    
    .btn-secondary {
        background: #f3f4f6;
        color: #374151;
    }
    
    .btn-secondary:hover {
        background: #e5e7eb;
    }
`;
document.head.appendChild(style);
