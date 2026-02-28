// Gestão Financeira Completa - JavaScript
const API_BASE = '/api/financeiro';
let abaAtual = 'pagar';
let dadosTabela = [];
let itensSelecionados = new Set();
let paginaAtual = 1;
let totalPaginas = 1;
let ordenarPor = 'data_vencimento';
let ordenarDirecao = 'ASC';

// =============================================================================
// CONTROLE DE ACESSO
// =============================================================================

// Verificar permissões ao carregar a página
document.addEventListener('DOMContentLoaded', function() {
    // Verificar se o sistema de autenticação está disponível
    if (typeof auth === 'undefined') {
        console.error('❌ Sistema de autenticação não carregado. Verifique se auth.js está incluído antes deste script.');
        alert('⚠️ Erro: Sistema de autenticação não disponível. Recarregue a página.');
        return;
    }

    // Proteger a página - apenas quem pode ver contas a pagar ou receber
    if (!auth.protegerPagina(['contas_pagar.visualizar', 'contas_receber.visualizar'])) {
        return; // Para se não tiver permissão
    }

    // Aplicar restrições de interface baseado no perfil
    aplicarRestricoesInterface();
    
    // Inicializar normalmente
    carregarCategorias();
    carregarDados();
});

/**
 * Aplica restrições de interface baseado nas permissões do usuário
 */
function aplicarRestricoesInterface() {
    const usuario = auth.getUsuario();
    
    if (!usuario) return;

    // Se não é admin, aplicar restrições
    if (!auth.isAdmin()) {
        
        // HELLEN - Apenas Contas a Pagar
        if (usuario.perfil === 'contas_pagar') {
            // Ocultar aba de Contas a Receber
            const abaReceber = document.querySelector('[onclick*="trocarAba(\'receber\')"]');
            if (abaReceber) {
                abaReceber.style.display = 'none';
            }

            // Forçar sempre mostrar Contas a Pagar
            abaAtual = 'pagar';
            
            // Adicionar mensagem informativa
            adicionarMensagemRestricao('Você tem acesso apenas a <strong>Contas a Pagar</strong>');
        }
        
        // JUNIOR (ELDIR) - Apenas Contas a Receber
        else if (usuario.perfil === 'contas_receber') {
            // Ocultar aba de Contas a Pagar
            const abaPagar = document.querySelector('[onclick*="trocarAba(\'pagar\')"]');
            if (abaPagar) {
                abaPagar.style.display = 'none';
            }

            // Forçar sempre mostrar Contas a Receber
            abaAtual = 'receber';
            trocarAba('receber');
            
            // Adicionar mensagem informativa
            adicionarMensagemRestricao('Você tem acesso apenas a <strong>Contas a Receber</strong>');
        }
    }

    // Ocultar botões de ações que o usuário não pode executar
    ocultarBotoesNaoPermitidos();
}

/**
 * Adiciona mensagem de restrição no topo da página
 */
function adicionarMensagemRestricao(mensagem) {
    const container = document.querySelector('.filters-container');
    if (container) {
        const aviso = document.createElement('div');
        aviso.style.cssText = 'background: #fff3cd; border: 1px solid #ffc107; border-radius: 8px; padding: 12px 16px; margin-bottom: 16px; color: #856404; font-size: 14px;';
        aviso.innerHTML = `<i class="fas fa-info-circle"></i> ${mensagem}`;
        container.parentNode.insertBefore(aviso, container);
    }
}

/**
 * Oculta botões baseado em permissões
 */
function ocultarBotoesNaoPermitidos() {
    // Botão Novo (criar)
    const btnNovo = document.querySelector('[onclick="abrirModalNovo()"]');
    if (btnNovo) {
        const permissaoNovo = abaAtual === 'pagar' ? 'contas_pagar.criar' : 'contas_receber.criar';
        if (!auth.temPermissao(permissaoNovo)) {
            btnNovo.style.display = 'none';
        }
    }

    // Botões de ação em massa
    const btnExcluirSelecionados = document.querySelector('[onclick="excluirSelecionados()"]');
    if (btnExcluirSelecionados) {
        const permissaoExcluir = abaAtual === 'pagar' ? 'contas_pagar.excluir' : 'contas_receber.excluir';
        if (!auth.temPermissao(permissaoExcluir)) {
            btnExcluirSelecionados.style.display = 'none';
        }
    }
}

// Token
function getToken() {
    return localStorage.getItem('token') || sessionStorage.getItem('token');
}

// Formatar moeda
function formatarMoeda(valor) {
    return new Intl.NumberFormat('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(valor || 0);
}

// Formatar data
function formatarData(data) {
    if (!data) return '-';
    return new Date(data).toLocaleDateString('pt-BR');
}

// Trocar aba
function trocarAba(aba, evt) {
    abaAtual = aba;
    
    // Atualizar botões
    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
    
    // Se foi chamado via evento (clique), atualiza o botão clicado
    if (evt && evt.target) {
        evt.target.closest('.tab-button').classList.add('active');
    } else {
        // Se foi chamado via código, encontra o botão correto
        const botões = document.querySelectorAll('.tab-button');
        botões.forEach(btn => {
            if (btn.getAttribute('onclick').includes(`'${aba}'`)) {
                btn.classList.add('active');
            }
        });
    }
    
    // Atualizar título
    const titulos = {
        'pagar': '<i class="fas fa-arrow-up"></i> Contas a Pagar',
        'receber': '<i class="fas fa-arrow-down"></i> Contas a Receber',
        'bancos': '<i class="fas fa-university"></i> Contas Bancárias'
    };
    document.getElementById('tableTitle').innerHTML = titulos[aba];
    
    // Resetar paginação
    paginaAtual = 1;
    itensSelecionados.clear();
    atualizarBulkActions();
    
    // Carregar dados
    carregarDados();
}

// Carregar dados
async function carregarDados() {
    try {
        const token = getToken();
        if (!token) {
            window.location.href = '../../public/login.html';
            return;
        }

        let url = '';
        if (abaAtual === 'pagar') {
            url = `${API_BASE}/contas-pagar`;
        } else if (abaAtual === 'receber') {
            url = `${API_BASE}/contas-receber`;
        } else if (abaAtual === 'bancos') {
            url = `${API_BASE}/bancos`;
        }

        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) throw new Error('Erro ao carregar dados');

        dadosTabela = await response.json();
        aplicarFiltros();

    } catch (error) {
        console.error('❌ Erro ao carregar dados:', error);
        mostrarErro('Erro ao carregar dados');
    }
}

// Aplicar filtros
function aplicarFiltros() {
    const busca = document.getElementById('filterBusca').value.toLowerCase();
    const status = document.getElementById('filterStatus').value;
    const dataInicio = document.getElementById('filterDataInicio').value;
    const dataFim = document.getElementById('filterDataFim').value;
    const categoria = document.getElementById('filterCategoria').value;
    const porPagina = parseInt(document.getElementById('filterPorPagina').value);

    // Filtrar dados
    let dadosFiltrados = dadosTabela.filter(item => {
        // Busca
        if (busca && !item.descrição?.toLowerCase().includes(busca) && 
            !item.fornecedor?.toLowerCase().includes(busca) &&
            !item.cliente?.toLowerCase().includes(busca)) {
            return false;
        }

        // Status
        if (status && item.status !== status) {
            return false;
        }

        // Data
        if (dataInicio && item.data_vencimento < dataInicio) {
            return false;
        }
        if (dataFim && item.data_vencimento > dataFim) {
            return false;
        }

        // Categoria
        if (categoria && item.categoria_id != categoria) {
            return false;
        }

        return true;
    });

    // Ordenar
    dadosFiltrados.sort((a, b) => {
        const valorA = a[ordenarPor];
        const valorB = b[ordenarPor];
        
        if (ordenarDirecao === 'ASC') {
            return valorA > valorB ? 1 : -1;
        } else {
            return valorA < valorB ? 1 : -1;
        }
    });

    // Paginar
    totalPaginas = Math.ceil(dadosFiltrados.length / porPagina);
    const inicio = (paginaAtual - 1) * porPagina;
    const fim = inicio + porPagina;
    const dadosPagina = dadosFiltrados.slice(inicio, fim);

    // Renderizar
    renderizarTabela(dadosPagina);
    renderizarPaginacao(dadosFiltrados.length, porPagina);
}

// Renderizar tabela
function renderizarTabela(dados) {
    const container = document.getElementById('tableContainer');

    if (!dados || dados.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-inbox"></i>
                <p style="font-size: 16px; font-weight: 600; margin-bottom: 8px;">
                    Nenhum registro encontrado
                </p>
                <p>Altere os filtros ou adicione novos registros</p>
            </div>
        `;
        return;
    }

    let html = '<table><thead><tr>';
    
    // Checkbox para selecionar todos
    html += `<th style="width: 40px;">
        <input type="checkbox" class="checkbox-all" onchange="selecionarTodos(this.checked)" />
    </th>`;

    // Colunas conforme a aba
    if (abaAtual === 'pagar' || abaAtual === 'receber') {
        html += `
            <th onclick="ordenar('descrição')">Descrição <i class="fas fa-sort"></i></th>
            <th onclick="ordenar('${abaAtual === 'pagar' ? 'fornecedor' : 'cliente'}')">
                ${abaAtual === 'pagar' ? 'Fornecedor' : 'Cliente'} <i class="fas fa-sort"></i>
            </th>
            <th onclick="ordenar('valor')">Valor <i class="fas fa-sort"></i></th>
            <th onclick="ordenar('data_vencimento')">Vencimento <i class="fas fa-sort"></i></th>
            <th onclick="ordenar('status')">Status <i class="fas fa-sort"></i></th>
            <th style="width: 200px; text-align: center;">Ações</th>
        `;
    } else {
        html += `
            <th onclick="ordenar('banco')">Banco <i class="fas fa-sort"></i></th>
            <th onclick="ordenar('agencia')">Agência <i class="fas fa-sort"></i></th>
            <th onclick="ordenar('conta')">Conta <i class="fas fa-sort"></i></th>
            <th onclick="ordenar('saldo_atual')">Saldo Atual <i class="fas fa-sort"></i></th>
            <th style="width: 150px; text-align: center;">Ações</th>
        `;
    }

    html += '</tr></thead><tbody>';

    // Linhas de dados
    dados.forEach(item => {
        const isChecked = itensSelecionados.has(item.id);
        html += `<tr>`;
        
        // Checkbox
        html += `<td>
            <input 
                type="checkbox" 
                class="row-checkbox" 
                ${isChecked ? 'checked' : ''}
                onchange="toggleSelecao(${item.id}, this.checked)"
            />
        </td>`;

        if (abaAtual === 'pagar' || abaAtual === 'receber') {
            // Descrição
            html += `<td><strong>${item.descrição || '-'}</strong></td>`;
            
            // Fornecedor/Cliente
            html += `<td>${item.fornecedor || item.cliente || '-'}</td>`;
            
            // Valor
            const valorClass = abaAtual === 'receber' ? 'valor-positivo' : 'valor-negativo';
            html += `<td class="${valorClass}">R$ ${formatarMoeda(item.valor)}</td>`;
            
            // Vencimento
            html += `<td>${formatarData(item.data_vencimento)}</td>`;
            
            // Status
            const statusBadge = getStatusBadge(item.status);
            html += `<td>${statusBadge}</td>`;
            
            // Ações
            html += `<td style="text-align: center;">`;
            
            if (item.status === 'pendente') {
                html += `
                    <button class="btn-table success" onclick="marcarPago(${item.id})">
                        <i class="fas fa-check"></i> ${abaAtual === 'pagar' ? 'Pagar' : 'Receber'}
                    </button>
                    <button class="btn-table info" onclick="abrirModalParcelamento(${item.id})">
                        <i class="fas fa-credit-card"></i> Parcelar
                    </button>
                `;
            } else {
                html += `<span style="color: #10b981; font-weight: 600;">✅ ${item.status === 'pago' ? 'Pago' : 'Recebido'}</span>`;
            }
            
            html += `</td>`;
            
        } else {
            // Banco
            html += `<td><strong>${item.banco || '-'}</strong></td>`;
            html += `<td>${item.agencia || '-'}</td>`;
            html += `<td>${item.conta || '-'}</td>`;
            
            // Saldo
            const saldoClass = item.saldo_atual >= 0 ? 'valor-positivo' : 'valor-negativo';
            html += `<td class="${saldoClass}">R$ ${formatarMoeda(item.saldo_atual)}</td>`;
            
            // Ações
            html += `<td style="text-align: center;">
                <button class="btn-table info" onclick="verExtrato(${item.id})">
                    <i class="fas fa-file-alt"></i> Extrato
                </button>
            </td>`;
        }

        html += '</tr>';
    });

    html += '</tbody></table>';
    container.innerHTML = html;
}

// Get status badge
function getStatusBadge(status) {
    const badges = {
        'pendente': '<span class="status-badge pendente">⏳ Pendente</span>',
        'pago': '<span class="status-badge pago">✅ Pago</span>',
        'recebido': '<span class="status-badge recebido">✅ Recebido</span>',
        'vencido': '<span class="status-badge vencido">❌ Vencido</span>'
    };
    return badges[status] || status;
}

// Renderizar paginação
function renderizarPaginacao(total, porPagina) {
    const info = document.getElementById('paginationInfo');
    const buttons = document.getElementById('paginationButtons');

    const inicio = (paginaAtual - 1) * porPagina + 1;
    const fim = Math.min(paginaAtual * porPagina, total);

    info.textContent = `Mostrando ${inicio} a ${fim} de ${total} registros`;

    let html = `
        <button class="btn-pagination" onclick="irParaPagina(${paginaAtual - 1})" ${paginaAtual === 1 ? 'disabled' : ''}>
            <i class="fas fa-chevron-left"></i> Anterior
        </button>
    `;

    // Páginas
    for (let i = 1; i <= totalPaginas; i++) {
        if (i === 1 || i === totalPaginas || (i >= paginaAtual - 2 && i <= paginaAtual + 2)) {
            html += `
                <button 
                    class="btn-pagination ${i === paginaAtual ? 'active' : ''}" 
                    onclick="irParaPagina(${i})"
                >
                    ${i}
                </button>
            `;
        } else if (i === paginaAtual - 3 || i === paginaAtual + 3) {
            html += '<span style="padding: 0 8px; color: #94a3b8;">...</span>';
        }
    }

    html += `
        <button class="btn-pagination" onclick="irParaPagina(${paginaAtual + 1})" ${paginaAtual === totalPaginas ? 'disabled' : ''}>
            Próxima <i class="fas fa-chevron-right"></i>
        </button>
    `;

    buttons.innerHTML = html;
}

// Ir para página
function irParaPagina(pagina) {
    if (pagina < 1 || pagina > totalPaginas) return;
    paginaAtual = pagina;
    aplicarFiltros();
}

// Ordenar
function ordenar(campo) {
    if (ordenarPor === campo) {
        ordenarDirecao = ordenarDirecao === 'ASC' ? 'DESC' : 'ASC';
    } else {
        ordenarPor = campo;
        ordenarDirecao = 'ASC';
    }
    aplicarFiltros();
}

// Selecionar todos
function selecionarTodos(checked) {
    itensSelecionados.clear();
    
    if (checked) {
        dadosTabela.forEach(item => itensSelecionados.add(item.id));
    }
    
    document.querySelectorAll('.row-checkbox').forEach(cb => cb.checked = checked);
    atualizarBulkActions();
}

// Toggle seleção
function toggleSelecao(id, checked) {
    if (checked) {
        itensSelecionados.add(id);
    } else {
        itensSelecionados.delete(id);
    }
    atualizarBulkActions();
}

// Atualizar ações em lote
function atualizarBulkActions() {
    const count = itensSelecionados.size;
    document.getElementById('bulkCount').textContent = count;
    
    if (count > 0) {
        document.getElementById('bulkActions').classList.add('show');
    } else {
        document.getElementById('bulkActions').classList.remove('show');
    }
}

// Desmarcar todos
function desmarcarTodos() {
    itensSelecionados.clear();
    document.querySelectorAll('.row-checkbox').forEach(cb => cb.checked = false);
    document.querySelector('.checkbox-all').checked = false;
    atualizarBulkActions();
}

// Pagar em lote
async function pagarEmLote() {
    // Verificar permissão
    const permissao = abaAtual === 'pagar' ? 'contas_pagar.pagar' : 'contas_receber.receber';
    if (!auth.temPermissao(permissao)) {
        alert('❌ Você não tem permissão para realizar esta ação');
        return;
    }

    if (itensSelecionados.size === 0) return;
    
    if (!confirm(`Deseja marcar ${itensSelecionados.size} contas como pagas?`)) return;
    
    try {
        const token = getToken();
        const ids = Array.from(itensSelecionados);
        
        const response = await fetch(`${API_BASE}/contas-${abaAtual}/lote/pagar`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                ids: ids,
                data_pagamento: new Date().toISOString().split('T')[0]
            })
        });
        
        if (!response.ok) throw new Error('Erro ao pagar em lote');
        
        alert('✅ Contas pagas com sucesso!');
        desmarcarTodos();
        carregarDados();
        
    } catch (error) {
        console.error('❌ Erro:', error);
        alert('Erro ao pagar contas: ' + error.message);
    }
}

// Marcar como pago
async function marcarPago(id) {
    // Verificar permissão
    const permissao = abaAtual === 'pagar' ? 'contas_pagar.pagar' : 'contas_receber.receber';
    if (!auth.temPermissao(permissao)) {
        alert('❌ Você não tem permissão para realizar esta ação');
        auth.registrarLog('acesso_negado', `Tentativa de marcar como pago sem permissão: ${permissao}`);
        return;
    }

    if (!confirm('Deseja marcar esta conta como paga?')) return;
    
    try {
        const token = getToken();
        const response = await fetch(`${API_BASE}/contas-${abaAtual}/${id}/${abaAtual === 'pagar' ? 'pagar' : 'receber'}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                [`data_${abaAtual === 'pagar' ? 'pagamento' : 'recebimento'}`]: new Date().toISOString().split('T')[0]
            })
        });
        
        if (!response.ok) throw new Error('Erro ao atualizar');
        
        alert('✅ Conta atualizada com sucesso!');
        carregarDados();
        
    } catch (error) {
        console.error('❌ Erro:', error);
        alert('Erro: ' + error.message);
    }
}

// Excluir selecionados
async function excluirSelecionados() {
    // Verificar permissão
    const permissao = abaAtual === 'pagar' ? 'contas_pagar.excluir' : 'contas_receber.excluir';
    if (!auth.temPermissao(permissao)) {
        alert('❌ Você não tem permissão para excluir');
        auth.registrarLog('acesso_negado', `Tentativa de exclusão sem permissão: ${permissao}`);
        return;
    }

    if (itensSelecionados.size === 0) {
        alert('Selecione ao menos um item para excluir');
        return;
    }
    
    if (!confirm(`Deseja realmente excluir ${itensSelecionados.size} item(ns) selecionado(s)?`)) return;
    
    try {
        const token = getToken();
        const ids = Array.from(itensSelecionados);
        
        const response = await fetch(`${API_BASE}/contas-${abaAtual}/lote/excluir`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ ids })
        });
        
        if (!response.ok) throw new Error('Erro ao excluir');
        
        alert('✅ Itens excluídos com sucesso!');
        auth.registrarLog('exclusao_lote', `Excluiu ${ids.length} itens de ${abaAtual}`);
        desmarcarTodos();
        carregarDados();
        
    } catch (error) {
        console.error('❌ Erro:', error);
        alert('Erro ao excluir: ' + error.message);
    }
}

// Abrir nova conta
function abrirNovaConta() {
    // Verificar permissão
    const permissao = abaAtual === 'pagar' ? 'contas_pagar.criar' : abaAtual === 'receber' ? 'contas_receber.criar' : 'contas_bancarias.criar';
    if (!auth.temPermissao(permissao)) {
        alert('❌ Você não tem permissão para criar novos registros');
        auth.registrarLog('acesso_negado', `Tentativa de criação sem permissão: ${permissao}`);
        return;
    }
    
    alert('Função de nova conta em desenvolvimento');
}

// Abrir modal de parcelamento
function abrirModalParcelamento(id) {
    // Buscar o item nos dados da tabela
    const item = dadosTabela.find(i => i.id === id);
    if (!item) {
        alert('Item não encontrado');
        return;
    }
    
    // Verificar se o sistema de parcelamento está disponível
    if (typeof SistemaParcelamento === 'undefined') {
        alert('⚠️ Sistema de parcelamento não carregado. Verifique se o arquivo parcelamento.js está incluído.');
        return;
    }
    
    // Criar instância do sistema de parcelamento
    const sistemaParcelamento = new SistemaParcelamento();
    
    // Abrir modal com os dados da conta
    sistemaParcelamento.abrirModal({
        descrição: item.descrição,
        valor: item.valor,
        tipo: abaAtual, // 'pagar' ou 'receber'
        callback: (parcelas) => {
            console.log('Parcelas geradas:', parcelas);
            alert(`✅ ${parcelas.length} parcelas geradas com sucesso!`);
            // TODO: Salvar parcelas no backend
        }
    });
}

// Ver extrato
function verExtrato(id) {
    alert('Extrato bancário em desenvolvimento');
}

// Limpar filtros
function limparFiltros() {
    document.getElementById('filterBusca').value = '';
    document.getElementById('filterStatus').value = '';
    document.getElementById('filterDataInicio').value = '';
    document.getElementById('filterDataFim').value = '';
    document.getElementById('filterCategoria').value = '';
    document.getElementById('filterPorPagina').value = '50';
    
    paginaAtual = 1;
    aplicarFiltros();
}

// Mostrar erro
function mostrarErro(mensagem) {
    alert(mensagem);
}

// Carregar categorias no filtro
async function carregarCategorias() {
    try {
        const token = getToken();
        const response = await fetch(`${API_BASE}/categorias`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const categorias = await response.json();
        const select = document.getElementById('filterCategoria');
        
        categorias.forEach(cat => {
            const option = document.createElement('option');
            option.value = cat.id;
            option.textContent = cat.nome;
            select.appendChild(option);
        });
    } catch (error) {
        console.error('❌ Erro ao carregar categorias:', error);
    }
}

// Inicializar - REMOVIDO (já foi movido para o início do arquivo)
// A inicialização agora acontece no event listener DOMContentLoaded
// que foi adicionado no início do arquivo com as verificações de permissão

