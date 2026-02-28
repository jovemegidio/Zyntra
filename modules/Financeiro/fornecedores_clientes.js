// ===== FORNECEDORES E CLIENTES - ALUFORCE =====
let fornecedores = [];
let clientes = [];
let abaAtual = 'fornecedores';
let entidadeSelecionada = null;

// ===== INICIALIZAÇÃO =====
document.addEventListener('DOMContentLoaded', async function() {
    try {
        await carregarDados();
        configurarEventos();
    } catch (error) {
        console.error('❌ Erro na inicialização:', error);
    }
});

// ===== CARREGAR DADOS =====
async function carregarDados() {
    try {
        const token = localStorage.getItem('token') || sessionStorage.getItem('token');
        const [respFornecedores, respClientes] = await Promise.all([
            fetch('/api/financeiro/fornecedores', { headers: { 'Authorization': `Bearer ${token}` } }),
            fetch('/api/financeiro/clientes', { headers: { 'Authorization': `Bearer ${token}` } })
        ]);
        
        if (respFornecedores.ok) {
            fornecedores = await respFornecedores.json();
        }
        if (respClientes.ok) {
            clientes = await respClientes.json();
        }
        
        renderizarTabela(abaAtual);
        
    } catch (error) {
        console.error('❌ Erro ao carregar dados:', error);
        mostrarAlerta('Erro ao carregar dados', 'error');
    }
}

// ===== RENDERIZAÇÃO =====
function renderizarTabela(tipo) {
    const dados = tipo === 'fornecedores' ? fornecedores : clientes;
    const containerId = tipo === 'fornecedores' ? 'tabela-fornecedores' : 'tabela-clientes';
    const container = document.getElementById(containerId);
    
    if (!dados || dados.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-${tipo === 'fornecedores' ? 'truck' : 'user-tie'}"></i>
                <h3>Nenhum ${tipo === 'fornecedores' ? 'fornecedor' : 'cliente'} cadastrado</h3>
                <p>Clique em "Novo ${tipo === 'fornecedores' ? 'Fornecedor' : 'Cliente'}" para começar</p>
                <button class="btn-primary" onclick="${tipo === 'fornecedores' ? 'abrirModalFornecedor' : 'abrirModalCliente'}()">
                    <i class="fas fa-plus"></i> Adicionar ${tipo === 'fornecedores' ? 'Fornecedor' : 'Cliente'}
                </button>
            </div>
        `;
        return;
    }
    
    const html = `
        <table>
            <thead>
                <tr>
                    <th>Código</th>
                    <th>Razão Social / Nome</th>
                    <th>CNPJ/CPF</th>
                    <th>Contato</th>
                    <th>Cidade/UF</th>
                    <th>Status</th>
                    <th style="text-align: center;">Ações</th>
                </tr>
            </thead>
            <tbody>
                ${dados.map(item => `
                    <tr>
                        <td><strong>${item.código}</strong></td>
                        <td>
                            <strong>${item.razao_social}</strong>
                            ${item.nome_fantasia ? `<br><small style="color: #64748b;">${item.nome_fantasia}</small>` : ''}
                        </td>
                        <td>${formatarCNPJ_CPF(item.cnpj_cpf) || '-'}</td>
                        <td>
                            ${item.email || '-'}<br>
                            <small style="color: #64748b;">${item.telefone || '-'}</small>
                        </td>
                        <td>${item.cidade || '-'}${item.estado ? ' / ' + item.estado : ''}</td>
                        <td>
                            <span class="status-badge ${item.ativo ? 'ativo' : 'inativo'}">
                                <i class="fas fa-circle" style="font-size: 8px;"></i>
                                ${item.ativo ? 'Ativo' : 'Inativo'}
                            </span>
                        </td>
                        <td>
                            <div class="action-buttons" style="justify-content: center;">
                                <button class="action-btn view" onclick="verDetalhes(${item.id}, '${tipo}')" title="Ver detalhes">
                                    <i class="fas fa-eye"></i>
                                </button>
                                <button class="action-btn edit" onclick="editar(${item.id}, '${tipo}')" title="Editar">
                                    <i class="fas fa-edit"></i>
                                </button>
                                <button class="action-btn delete" onclick="excluir(${item.id}, '${tipo}')" title="Excluir">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </div>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
    
    container.innerHTML = html;
}

// ===== ABAS =====
function trocarAba(aba, evt) {
    abaAtual = aba;
    
    // Atualizar botões das abas
    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
    if (evt && evt.target) {
        evt.target.classList.add('active');
    }
    
    // Atualizar conteúdo
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    document.getElementById(`tab-${aba}`).classList.add('active');
    
    renderizarTabela(aba);
}

// ===== MODAIS =====
function abrirModalFornecedor() {
    abrirModalEntidade('fornecedor');
}

function abrirModalCliente() {
    abrirModalEntidade('cliente');
}

function abrirModalEntidade(tipo) {
    entidadeSelecionada = null;
    document.getElementById('modal-titulo-entidade').textContent = `Novo ${tipo === 'fornecedor' ? 'Fornecedor' : 'Cliente'}`;
    document.getElementById('form-entidade').reset();
    document.getElementById('entidade-id').value = '';
    document.getElementById('entidade-tipo').value = tipo;
    document.getElementById('entidade-ativa').checked = true;
    
    abrirModal('modal-entidade');
}

function editar(id, tipo) {
    const lista = tipo === 'fornecedores' ? fornecedores : clientes;
    entidadeSelecionada = lista.find(item => item.id === id);
    
    if (!entidadeSelecionada) return;
    
    const tipoSingular = tipo === 'fornecedores' ? 'fornecedor' : 'cliente';
    document.getElementById('modal-titulo-entidade').textContent = `Editar ${tipoSingular === 'fornecedor' ? 'Fornecedor' : 'Cliente'}`;
    document.getElementById('entidade-id').value = entidadeSelecionada.id;
    document.getElementById('entidade-tipo').value = tipoSingular;
    document.getElementById('entidade-tipo-pessoa').value = entidadeSelecionada.tipo_pessoa || 'JURIDICA';
    document.getElementById('entidade-cnpj').value = entidadeSelecionada.cnpj_cpf || '';
    document.getElementById('entidade-razao-social').value = entidadeSelecionada.razao_social || '';
    document.getElementById('entidade-nome-fantasia').value = entidadeSelecionada.nome_fantasia || '';
    document.getElementById('entidade-email').value = entidadeSelecionada.email || '';
    document.getElementById('entidade-telefone').value = entidadeSelecionada.telefone || '';
    document.getElementById('entidade-cep').value = entidadeSelecionada.cep || '';
    document.getElementById('entidade-cidade').value = entidadeSelecionada.cidade || '';
    document.getElementById('entidade-estado').value = entidadeSelecionada.estado || '';
    document.getElementById('entidade-logradouro').value = entidadeSelecionada.logradouro || '';
    document.getElementById('entidade-número').value = entidadeSelecionada.número || '';
    document.getElementById('entidade-limite').value = entidadeSelecionada.limite_credito || 0;
    document.getElementById('entidade-prazo').value = entidadeSelecionada.prazo_pagamento || 30;
    document.getElementById('entidade-pix').value = entidadeSelecionada.pix || '';
    document.getElementById('entidade-observacoes').value = entidadeSelecionada.observacoes || '';
    document.getElementById('entidade-ativa').checked = entidadeSelecionada.ativo !== false;
    
    abrirModal('modal-entidade');
}

async function salvarEntidade(event) {
    event.preventDefault();
    
    const id = document.getElementById('entidade-id').value;
    const tipo = document.getElementById('entidade-tipo').value;
    const isEdicao = !!id;
    
    const dados = {
        tipo_pessoa: document.getElementById('entidade-tipo-pessoa').value,
        cnpj_cpf: document.getElementById('entidade-cnpj').value,
        razao_social: document.getElementById('entidade-razao-social').value,
        nome_fantasia: document.getElementById('entidade-nome-fantasia').value,
        email: document.getElementById('entidade-email').value,
        telefone: document.getElementById('entidade-telefone').value,
        cep: document.getElementById('entidade-cep').value,
        cidade: document.getElementById('entidade-cidade').value,
        estado: document.getElementById('entidade-estado').value,
        logradouro: document.getElementById('entidade-logradouro').value,
        número: document.getElementById('entidade-número').value,
        limite_credito: parseFloat(document.getElementById('entidade-limite').value) || 0,
        prazo_pagamento: parseInt(document.getElementById('entidade-prazo').value) || 30,
        pix: document.getElementById('entidade-pix').value,
        observacoes: document.getElementById('entidade-observacoes').value,
        ativo: document.getElementById('entidade-ativa').checked
    };
    
    try {
        const token = localStorage.getItem('token') || sessionStorage.getItem('token');
        const endpoint = tipo === 'fornecedor' ? 'fornecedores' : 'clientes';
        const url = isEdicao ? `/api/financeiro/${endpoint}/${id}` : `/api/financeiro/${endpoint}`;
        const method = isEdicao ? 'PUT' : 'POST';
        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(dados)
        });
        
        if (!response.ok) throw new Error('Erro ao salvar');
        
        mostrarAlerta(
            isEdicao ? `${tipo === 'fornecedor' ? 'Fornecedor' : 'Cliente'} atualizado com sucesso!` 
                     : `${tipo === 'fornecedor' ? 'Fornecedor' : 'Cliente'} criado com sucesso!`,
            'success'
        );
        
        fecharModal('modal-entidade');
        await carregarDados();
        
    } catch (error) {
        console.error('❌ Erro ao salvar:', error);
        mostrarAlerta('Erro ao salvar registro', 'error');
    }
}

async function excluir(id, tipo) {
    const tipoTexto = tipo === 'fornecedores' ? 'fornecedor' : 'cliente';
    
    if (!confirm(`Deseja realmente excluir este ${tipoTexto}?`)) return;
    
    try {
        const token = localStorage.getItem('token') || sessionStorage.getItem('token');
        const endpoint = tipo === 'fornecedores' ? 'fornecedores' : 'clientes';
        const response = await fetch(`/api/financeiro/${endpoint}/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!response.ok) throw new Error('Erro ao excluir');
        
        mostrarAlerta(`${tipoTexto.charAt(0).toUpperCase() + tipoTexto.slice(1)} excluído com sucesso!`, 'success');
        await carregarDados();
        
    } catch (error) {
        console.error('❌ Erro ao excluir:', error);
        mostrarAlerta('Erro ao excluir registro', 'error');
    }
}

function verDetalhes(id, tipo) {
    const lista = tipo === 'fornecedores' ? fornecedores : clientes;
    const item = lista.find(i => i.id === id);
    
    if (!item) return;
    
    const detalhes = `
        <strong>Código:</strong> ${item.código}<br>
        <strong>Razão Social:</strong> ${item.razao_social}<br>
        <strong>Nome Fantasia:</strong> ${item.nome_fantasia || '-'}<br>
        <strong>CNPJ/CPF:</strong> ${formatarCNPJ_CPF(item.cnpj_cpf) || '-'}<br>
        <strong>Email:</strong> ${item.email || '-'}<br>
        <strong>Telefone:</strong> ${item.telefone || '-'}<br>
        <strong>Cidade/UF:</strong> ${item.cidade || '-'} / ${item.estado || '-'}<br>
        <strong>Limite de Crédito:</strong> R$ ${formatarMoeda(item.limite_credito)}<br>
        <strong>Prazo de Pagamento:</strong> ${item.prazo_pagamento} dias<br>
        <strong>Status:</strong> ${item.ativo ? 'Ativo' : 'Inativo'}
    `;
    
    mostrarAlerta(detalhes, 'info');
}

// ===== FILTROS =====
function aplicarFiltrosFornecedor() {
    const busca = document.getElementById('busca-fornecedor').value.toLowerCase();
    const status = document.getElementById('status-fornecedor').value;
    
    let dadosFiltrados = fornecedores.filter(item => {
        const matchBusca = !busca || 
            item.razao_social?.toLowerCase().includes(busca) ||
            item.nome_fantasia?.toLowerCase().includes(busca) ||
            item.cnpj_cpf?.includes(busca);
        
        const matchStatus = !status || 
            (status === 'ativo' && item.ativo) ||
            (status === 'inativo' && !item.ativo);
        
        return matchBusca && matchStatus;
    });
    
    const container = document.getElementById('tabela-fornecedores');
    renderizarTabelaFiltrada(dadosFiltrados, container, 'fornecedores');
}

function aplicarFiltrosCliente() {
    const busca = document.getElementById('busca-cliente').value.toLowerCase();
    const status = document.getElementById('status-cliente').value;
    
    let dadosFiltrados = clientes.filter(item => {
        const matchBusca = !busca || 
            item.razao_social?.toLowerCase().includes(busca) ||
            item.nome_fantasia?.toLowerCase().includes(busca) ||
            item.cnpj_cpf?.includes(busca);
        
        const matchStatus = !status || 
            (status === 'ativo' && item.ativo) ||
            (status === 'inativo' && !item.ativo);
        
        return matchBusca && matchStatus;
    });
    
    const container = document.getElementById('tabela-clientes');
    renderizarTabelaFiltrada(dadosFiltrados, container, 'clientes');
}

function renderizarTabelaFiltrada(dados, container, tipo) {
    if (!dados || dados.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-search"></i>
                <h3>Nenhum resultado encontrado</h3>
                <p>Tente ajustar os filtros de busca</p>
            </div>
        `;
        return;
    }
    
    const html = `
        <table>
            <thead>
                <tr>
                    <th>Código</th>
                    <th>Razão Social / Nome</th>
                    <th>CNPJ/CPF</th>
                    <th>Contato</th>
                    <th>Cidade/UF</th>
                    <th>Status</th>
                    <th style="text-align: center;">Ações</th>
                </tr>
            </thead>
            <tbody>
                ${dados.map(item => `
                    <tr>
                        <td><strong>${item.código}</strong></td>
                        <td>
                            <strong>${item.razao_social}</strong>
                            ${item.nome_fantasia ? `<br><small style="color: #64748b;">${item.nome_fantasia}</small>` : ''}
                        </td>
                        <td>${formatarCNPJ_CPF(item.cnpj_cpf) || '-'}</td>
                        <td>
                            ${item.email || '-'}<br>
                            <small style="color: #64748b;">${item.telefone || '-'}</small>
                        </td>
                        <td>${item.cidade || '-'}${item.estado ? ' / ' + item.estado : ''}</td>
                        <td>
                            <span class="status-badge ${item.ativo ? 'ativo' : 'inativo'}">
                                <i class="fas fa-circle" style="font-size: 8px;"></i>
                                ${item.ativo ? 'Ativo' : 'Inativo'}
                            </span>
                        </td>
                        <td>
                            <div class="action-buttons" style="justify-content: center;">
                                <button class="action-btn view" onclick="verDetalhes(${item.id}, '${tipo}')" title="Ver detalhes">
                                    <i class="fas fa-eye"></i>
                                </button>
                                <button class="action-btn edit" onclick="editar(${item.id}, '${tipo}')" title="Editar">
                                    <i class="fas fa-edit"></i>
                                </button>
                                <button class="action-btn delete" onclick="excluir(${item.id}, '${tipo}')" title="Excluir">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </div>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
    
    container.innerHTML = html;
}

// ===== EVENTOS =====
function configurarEventos() {
    // Busca ao pressionar Enter
    document.getElementById('busca-fornecedor')?.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') aplicarFiltrosFornecedor();
    });
    
    document.getElementById('busca-cliente')?.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') aplicarFiltrosCliente();
    });
}

// ===== UTILIDADES =====
function formatarCNPJ_CPF(valor) {
    if (!valor) return '';
    
    valor = valor.replace(/\D/g, '');
    
    if (valor.length === 11) {
        // CPF
        return valor.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    } else if (valor.length === 14) {
        // CNPJ
        return valor.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
    }
    
    return valor;
}

function formatarMoeda(valor) {
    return new Intl.NumberFormat('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(valor || 0);
}

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
        max-width: 400px;
        animation: slideIn 0.3s ease;
    `;
    
    const icon = tipo === 'success' ? 'check-circle' : tipo === 'error' ? 'exclamation-circle' : 'info-circle';
    alerta.innerHTML = `<i class="fas fa-${icon}"></i> ${mensagem}`;
    
    document.body.appendChild(alerta);
    
    setTimeout(() => {
        alerta.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => alerta.remove(), 300);
    }, 5000);
}
