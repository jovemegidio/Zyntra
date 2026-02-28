// ============================================================================
// CONCILIAÇÃO BANCÁRIA - Sistema Financeiro Aluforce
// ============================================================================

// Estado Global
let contaSelecionada = null;
let movimentacoesSistema = [];
let movimentacoesExtrato = [];
let movimentacoesConciliadas = [];
let selecionadasSistema = [];
let selecionadasExtrato = [];

// ============================================================================
// INICIALIZAÇÃO
// ============================================================================

document.addEventListener('DOMContentLoaded', function() {
    // Verificar sistema de autenticação
    if (typeof auth !== 'undefined') {
        // Proteger página - verificar permissão de conciliação
        if (!auth.protegerPagina(['conciliacao.visualizar'])) {
            return;
        }
    }
    
    inicializar();
});

function inicializar() {
    carregarContas();
    configurarEventos();
    definirPeriodoPadrao();
}

function configurarEventos() {
    // Busca em tempo real
    document.getElementById('search-sistema').addEventListener('input', function(e) {
        buscarMovimentacoes(e.target.value, 'sistema');
    });

    document.getElementById('search-extrato').addEventListener('input', function(e) {
        buscarMovimentacoes(e.target.value, 'extrato');
    });

    // Seleção de conta
    document.getElementById('conta-select').addEventListener('change', function(e) {
        contaSelecionada = e.target.value;
        if (contaSelecionada) {
            carregarMovimentacoes();
        }
    });
}

function definirPeriodoPadrao() {
    const hoje = new Date();
    const primeiroDia = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    
    document.getElementById('data-inicio').value = formatarDataInput(primeiroDia);
    document.getElementById('data-fim').value = formatarDataInput(hoje);
}

function formatarDataInput(data) {
    const ano = data.getFullYear();
    const mes = String(data.getMonth() + 1).padStart(2, '0');
    const dia = String(data.getDate()).padStart(2, '0');
    return `${ano}-${mes}-${dia}`;
}

// ============================================================================
// CARREGAMENTO DE DADOS
// ============================================================================

async function carregarContas() {
    try {
        // TODO: Substituir por chamada real à API
        const contas = await buscarContasBancarias();
        
        const select = document.getElementById('conta-select');
        select.innerHTML = '<option value="">Selecione uma conta...</option>';
        
        contas.forEach(conta => {
            const option = document.createElement('option');
            option.value = conta.id;
            option.textContent = `${conta.banco} - ${conta.agencia}/${conta.conta} (${formatarMoeda(conta.saldo)})`;
            select.appendChild(option);
        });
    } catch (error) {
        console.error('Erro ao carregar contas:', error);
        mostrarMensagem('Erro ao carregar contas bancárias', 'error');
    }
}

async function buscarContasBancarias() {
    const token = localStorage.getItem('token') || sessionStorage.getItem('token');
    const response = await fetch('/api/financeiro/contas-bancarias', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!response.ok) throw new Error('Erro ao buscar contas bancárias');
    return await response.json();
}

async function carregarMovimentacoes() {
    if (!contaSelecionada) {
        mostrarMensagem('Selecione uma conta bancária', 'warning');
        return;
    }

    const dataInicio = document.getElementById('data-inicio').value;
    const dataFim = document.getElementById('data-fim').value;

    if (!dataInicio || !dataFim) {
        mostrarMensagem('Selecione o período', 'warning');
        return;
    }

    try {
        // Carregar movimentações do sistema
        movimentacoesSistema = await buscarMovimentacoesSistema(contaSelecionada, dataInicio, dataFim);
        
        // Carregar extrato (se já importado)
        movimentacoesExtrato = await buscarExtratoImportado(contaSelecionada, dataInicio, dataFim);

        // Carregar conciliações já realizadas
        movimentacoesConciliadas = await buscarConciliacoes(contaSelecionada, dataInicio, dataFim);

        // Exibir
        renderizarMovimentacoes();
        atualizarEstatisticas();
        mostrarSaldoSistema();
    } catch (error) {
        console.error('Erro ao carregar movimentações:', error);
        mostrarMensagem('Erro ao carregar movimentações', 'error');
    }
}

async function buscarMovimentacoesSistema(contaId, dataInicio, dataFim) {
    const token = localStorage.getItem('token') || sessionStorage.getItem('token');
    const response = await fetch(`/api/financeiro/contas-bancarias/${contaId}/movimentacoes?inicio=${dataInicio}&fim=${dataFim}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!response.ok) throw new Error('Erro ao buscar movimentações');
    return await response.json();
}

async function buscarExtratoImportado(contaId, dataInicio, dataFim) {
    const token = localStorage.getItem('token') || sessionStorage.getItem('token');
    const response = await fetch(`/api/financeiro/conciliacao?conta=${contaId}&inicio=${dataInicio}&fim=${dataFim}&tipo=extrato`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!response.ok) return [];
    return await response.json();
}

async function buscarConciliacoes(contaId, dataInicio, dataFim) {
    const token = localStorage.getItem('token') || sessionStorage.getItem('token');
    const response = await fetch(`/api/financeiro/conciliacao?conta=${contaId}&inicio=${dataInicio}&fim=${dataFim}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!response.ok) return [];
    return await response.json();
}

function mostrarSaldoSistema() {
    const contaSelect = document.getElementById('conta-select');
    const selectedOption = contaSelect.options[contaSelect.selectedIndex];
    
    if (selectedOption && selectedOption.value) {
        const texto = selectedOption.textContent;
        const saldoMatch = texto.match(/R\$\s*([\d.,]+)/);
        
        if (saldoMatch) {
            document.getElementById('saldo-sistema').textContent = `R$ ${saldoMatch[1]}`;
            document.getElementById('saldo-info').style.display = 'block';
        }
    }
}

// ============================================================================
// RENDERIZAÇÃO
// ============================================================================

function renderizarMovimentacoes() {
    renderizarListaSistema();
    renderizarListaExtrato();
}

function renderizarListaSistema() {
    const lista = document.getElementById('lista-sistema');
    lista.innerHTML = '';

    if (movimentacoesSistema.length === 0) {
        lista.innerHTML = '<p style="text-align: center; color: #999; padding: 20px;">Nenhuma movimentação encontrada</p>';
        return;
    }

    let total = 0;
    movimentacoesSistema.forEach(mov => {
        const conciliada = movimentacoesConciliadas.some(c => c.movimentacao_sistema_id === mov.id);
        const item = criarItemMovimentacao(mov, 'sistema', conciliada);
        lista.appendChild(item);
        total += mov.valor;
    });

    document.getElementById('total-sistema').textContent = formatarMoeda(total);
}

function renderizarListaExtrato() {
    const lista = document.getElementById('lista-extrato');
    lista.innerHTML = '';

    if (movimentacoesExtrato.length === 0) {
        lista.innerHTML = '<p style="text-align: center; color: #999; padding: 20px;">Nenhum extrato importado</p>';
        return;
    }

    let total = 0;
    movimentacoesExtrato.forEach(mov => {
        const conciliada = movimentacoesConciliadas.some(c => c.movimentacao_extrato_id === mov.id);
        const item = criarItemMovimentacao(mov, 'extrato', conciliada);
        lista.appendChild(item);
        total += mov.valor;
    });

    document.getElementById('total-extrato').textContent = formatarMoeda(total);
}

function criarItemMovimentacao(mov, origem, conciliada) {
    const div = document.createElement('div');
    div.className = `movimentacao-item ${origem} ${conciliada ? 'conciliada' : ''}`;
    div.dataset.id = mov.id;
    div.dataset.origem = origem;

    const checkbox = !conciliada ? `
        <input type="checkbox" class="mov-checkbox" 
               onchange="toggleSelecao('${mov.id}', '${origem}', this.checked)">
    ` : '<i class="fas fa-check-circle" style="color: #10b981; margin-right: 10px;"></i>';

    div.innerHTML = `
        ${checkbox}
        <div style="flex: 1;">
            <div class="mov-header">
                <span class="mov-data">${formatarData(mov.data)}</span>
                <span class="mov-valor ${mov.tipo}">${formatarMoeda(mov.valor)}</span>
            </div>
            <div class="mov-descrição">${mov.descrição}</div>
            ${mov.categoria ? `<span class="mov-categoria">${mov.categoria}</span>` : ''}
            ${conciliada ? '<span class="mov-categoria" style="background: #10b981; color: white;">✓ Conciliada</span>' : ''}
        </div>
    `;

    return div;
}

// ============================================================================
// SELEÇÃO E FILTROS
// ============================================================================

function toggleSelecao(id, origem, checked) {
    if (origem === 'sistema') {
        if (checked) {
            if (!selecionadasSistema.includes(id)) {
                selecionadasSistema.push(id);
            }
        } else {
            selecionadasSistema = selecionadasSistema.filter(x => x !== id);
        }
    } else {
        if (checked) {
            if (!selecionadasExtrato.includes(id)) {
                selecionadasExtrato.push(id);
            }
        } else {
            selecionadasExtrato = selecionadasExtrato.filter(x => x !== id);
        }
    }

    atualizarEstatisticas();
}

function limparSelecao() {
    selecionadasSistema = [];
    selecionadasExtrato = [];
    
    document.querySelectorAll('.mov-checkbox').forEach(cb => {
        cb.checked = false;
    });

    atualizarEstatisticas();
    mostrarMensagem('Seleção limpa', 'success');
}

function filtrarSistema(tipo, evt) {
    filtrarMovimentacoes('sistema', tipo, evt);
}

function filtrarExtrato(tipo, evt) {
    filtrarMovimentacoes('extrato', tipo, evt);
}

function filtrarMovimentacoes(origem, tipo, evt) {
    const container = origem === 'sistema' ? 'lista-sistema' : 'lista-extrato';
    const items = document.querySelectorAll(`#${container} .movimentacao-item`);

    // Atualizar botões ativos
    const filtros = document.querySelectorAll(`#${container}`).item(0).previousElementSibling;
    filtros.querySelectorAll('button').forEach(btn => btn.classList.remove('active'));
    if (evt && evt.target) {
        evt.target.classList.add('active');
    }

    items.forEach(item => {
        const conciliada = item.classList.contains('conciliada');
        
        let mostrar = false;
        if (tipo === 'todos') mostrar = true;
        else if (tipo === 'pendentes') mostrar = !conciliada;
        else if (tipo === 'conciliadas') mostrar = conciliada;

        item.style.display = mostrar ? 'flex' : 'none';
    });
}

function buscarMovimentacoes(termo, origem) {
    const container = origem === 'sistema' ? 'lista-sistema' : 'lista-extrato';
    const items = document.querySelectorAll(`#${container} .movimentacao-item`);

    termo = termo.toLowerCase();

    items.forEach(item => {
        const texto = item.textContent.toLowerCase();
        item.style.display = texto.includes(termo) ? 'flex' : 'none';
    });
}

// ============================================================================
// CONCILIAÇÃO
// ============================================================================

function conciliarSelecionadas() {
    if (selecionadasSistema.length === 0 && selecionadasExtrato.length === 0) {
        mostrarMensagem('Selecione ao menos uma movimentação', 'warning');
        return;
    }

    // Calcular totais
    let totalSistema = 0;
    selecionadasSistema.forEach(id => {
        const mov = movimentacoesSistema.find(m => m.id == id);
        if (mov) totalSistema += mov.valor;
    });

    let totalExtrato = 0;
    selecionadasExtrato.forEach(id => {
        const mov = movimentacoesExtrato.find(m => m.id == id);
        if (mov) totalExtrato += mov.valor;
    });

    const diferenca = totalSistema - totalExtrato;

    // Preencher modal
    document.getElementById('conciliar-valor-sistema').textContent = formatarMoeda(totalSistema);
    document.getElementById('conciliar-valor-extrato').textContent = formatarMoeda(totalExtrato);
    document.getElementById('conciliar-diferenca').textContent = formatarMoeda(diferenca);
    document.getElementById('conciliar-diferenca').style.color = Math.abs(diferenca) < 0.01 ? '#10b981' : '#ef4444';

    // Mostrar modal
    mostrarModal('modal-conciliar');
}

async function confirmarConciliacao() {
    const observacoes = document.getElementById('conciliar-obs').value;

    try {
        // TODO: Substituir por chamada real à API
        const resultado = await salvarConciliacao({
            conta_id: contaSelecionada,
            movimentacoes_sistema: selecionadasSistema,
            movimentacoes_extrato: selecionadasExtrato,
            observacoes: observacoes,
            data_conciliacao: new Date().toISOString()
        });

        // Atualizar lista de conciliadas
        selecionadasSistema.forEach(idSistema => {
            selecionadasExtrato.forEach(idExtrato => {
                movimentacoesConciliadas.push({
                    movimentacao_sistema_id: idSistema,
                    movimentacao_extrato_id: idExtrato
                });
            });
        });

        // Limpar seleção
        limparSelecao();

        // Recarregar visualização
        renderizarMovimentacoes();
        atualizarEstatisticas();

        fecharModal('modal-conciliar');
        mostrarMensagem('Conciliação realizada com sucesso!', 'success');

    } catch (error) {
        console.error('Erro ao conciliar:', error);
        mostrarMensagem('Erro ao realizar conciliação', 'error');
    }
}

async function salvarConciliacao(dados) {
    const token = localStorage.getItem('token') || sessionStorage.getItem('token');
    const response = await fetch('/api/financeiro/conciliacao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(dados)
    });
    if (!response.ok) throw new Error('Erro ao salvar conciliação');
    return await response.json();
}

async function conciliarAutomatica() {
    if (!contaSelecionada) {
        mostrarMensagem('Selecione uma conta', 'warning');
        return;
    }

    mostrarMensagem('Processando conciliação automática...', 'info');

    try {
        let conciliacoesEncontradas = 0;

        // Algoritmo de conciliação automática
        // 1. Buscar por valor e data exatos
        movimentacoesSistema.forEach(movSis => {
            if (movimentacoesConciliadas.some(c => c.movimentacao_sistema_id === movSis.id)) return;

            const movExt = movimentacoesExtrato.find(me => 
                !movimentacoesConciliadas.some(c => c.movimentacao_extrato_id === me.id) &&
                Math.abs(me.valor - movSis.valor) < 0.01 &&
                me.data === movSis.data
            );

            if (movExt) {
                movimentacoesConciliadas.push({
                    movimentacao_sistema_id: movSis.id,
                    movimentacao_extrato_id: movExt.id
                });
                conciliacoesEncontradas++;
            }
        });

        // 2. Buscar por valor igual em +/- 3 dias
        movimentacoesSistema.forEach(movSis => {
            if (movimentacoesConciliadas.some(c => c.movimentacao_sistema_id === movSis.id)) return;

            const dataSis = new Date(movSis.data);
            
            const movExt = movimentacoesExtrato.find(me => {
                if (movimentacoesConciliadas.some(c => c.movimentacao_extrato_id === me.id)) return false;
                
                const dataExt = new Date(me.data);
                const difDias = Math.abs((dataExt - dataSis) / (1000 * 60 * 60 * 24));
                
                return Math.abs(me.valor - movSis.valor) < 0.01 && difDias <= 3;
            });

            if (movExt) {
                movimentacoesConciliadas.push({
                    movimentacao_sistema_id: movSis.id,
                    movimentacao_extrato_id: movExt.id
                });
                conciliacoesEncontradas++;
            }
        });

        // TODO: Salvar conciliações automáticas no servidor
        // await salvarConciliacoesAutomaticas(movimentacoesConciliadas);

        renderizarMovimentacoes();
        atualizarEstatisticas();

        mostrarMensagem(`Conciliação automática concluída! ${conciliacoesEncontradas} movimentações conciliadas.`, 'success');

    } catch (error) {
        console.error('Erro na conciliação automática:', error);
        mostrarMensagem('Erro ao realizar conciliação automática', 'error');
    }
}

// ============================================================================
// IMPORTAÇÃO DE EXTRATO
// ============================================================================

function mostrarModalImportar() {
    mostrarModal('modal-importar');
}

async function processarArquivo(input) {
    const arquivo = input.files[0];
    if (!arquivo) return;

    const extensao = arquivo.name.split('.').pop().toLowerCase();

    mostrarMensagem('Processando arquivo...', 'info');

    try {
        let dados;

        if (extensao === 'ofx') {
            dados = await processarOFX(arquivo);
        } else if (extensao === 'csv') {
            dados = await processarCSV(arquivo);
        } else if (extensao === 'xlsx') {
            dados = await processarXLSX(arquivo);
        } else {
            throw new Error('Formato não suportado');
        }

        // TODO: Enviar para API
        await salvarExtratoImportado({
            conta_id: contaSelecionada,
            arquivo: arquivo.name,
            movimentacoes: dados,
            data_importacao: new Date().toISOString()
        });

        fecharModal('modal-importar');
        carregarMovimentacoes();
        mostrarMensagem(`${dados.length} movimentações importadas com sucesso!`, 'success');

    } catch (error) {
        console.error('Erro ao processar arquivo:', error);
        mostrarMensagem('Erro ao processar arquivo: ' + error.message, 'error');
    }
}

async function processarOFX(arquivo) {
    // TODO: Implementar parser OFX real
    mostrarMensagem('Parser OFX em desenvolvimento', 'warning');
    return [];
}

async function processarCSV(arquivo) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        
        reader.onload = function(e) {
            try {
                const texto = e.target.result;
                const linhas = texto.split('');
                const dados = [];

                // Pular cabeçalho
                for (let i = 1; i < linhas.length; i++) {
                    const linha = linhas[i].trim();
                    if (!linha) continue;

                    const colunas = linha.split(',');
                    if (colunas.length < 3) continue;

                    dados.push({
                        data: colunas[0].trim(),
                        descrição: colunas[1].trim(),
                        valor: parseFloat(colunas[2].trim()),
                        tipo: parseFloat(colunas[2].trim()) >= 0 ? 'entrada' : 'saida'
                    });
                }

                resolve(dados);
            } catch (error) {
                reject(error);
            }
        };

        reader.onerror = () => reject(new Error('Erro ao ler arquivo'));
        reader.readAsText(arquivo);
    });
}

async function processarXLSX(arquivo) {
    // TODO: Implementar parser XLSX (necessita biblioteca como SheetJS)
    mostrarMensagem('Parser XLSX em desenvolvimento. Use CSV temporariamente.', 'warning');
    return [];
}

async function salvarExtratoImportado(dados) {
    const token = localStorage.getItem('token') || sessionStorage.getItem('token');
    const response = await fetch('/api/financeiro/conciliacao/importar-ofx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(dados)
    });
    if (!response.ok) throw new Error('Erro ao importar extrato');
    return await response.json();
}

// ============================================================================
// ESTATÍSTICAS
// ============================================================================

function atualizarEstatisticas() {
    const totalConciliadas = movimentacoesConciliadas.length;
    const totalSistema = movimentacoesSistema.length;
    const totalExtrato = movimentacoesExtrato.length;
    const pendentes = Math.max(totalSistema, totalExtrato) - totalConciliadas;

    // Calcular divergências (movimentações que não têm par)
    const divergentes = Math.abs(totalSistema - totalExtrato);

    // Calcular diferença de valores
    let valorSistema = 0;
    movimentacoesSistema.forEach(m => valorSistema += m.valor);
    
    let valorExtrato = 0;
    movimentacoesExtrato.forEach(m => valorExtrato += m.valor);
    
    const diferenca = valorSistema - valorExtrato;

    document.getElementById('count-conciliadas').textContent = totalConciliadas;
    document.getElementById('count-pendentes').textContent = pendentes;
    document.getElementById('count-divergentes').textContent = divergentes;
    document.getElementById('diferenca-total').textContent = formatarMoeda(diferenca);
    document.getElementById('diferenca-total').style.color = Math.abs(diferenca) < 0.01 ? '#10b981' : '#ef4444';
}

// ============================================================================
// UTILITÁRIOS
// ============================================================================

function formatarMoeda(valor) {
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    }).format(valor);
}

function formatarData(data) {
    if (!data) return '';
    try {
        const d = new Date(data);
        if (!isNaN(d.getTime())) {
            return d.toLocaleDateString('pt-BR');
        }
        const d2 = new Date(data + 'T00:00:00');
        if (!isNaN(d2.getTime())) {
            return d2.toLocaleDateString('pt-BR');
        }
        return '-';
    } catch (e) {
        return '-';
    }
}

function mostrarModal(modalId) {
    document.getElementById(modalId).classList.add('active');
}

function fecharModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

function mostrarMensagem(mensagem, tipo) {
    console.log(`[${tipo.toUpperCase()}] ${mensagem}`);
    
    if (typeof window.mostrarToastFinanceiro === 'function') {
        window.mostrarToastFinanceiro(mensagem, tipo);
    } else {
        // Fallback toast
        const colors = { success: '#10b981', error: '#ef4444', warning: '#f59e0b', info: '#3b82f6' };
        const icons = { success: 'fa-check-circle', error: 'fa-times-circle', warning: 'fa-exclamation-triangle', info: 'fa-info-circle' };
        const existing = document.querySelector('.toast-conciliacao');
        if (existing) existing.remove();
        const toast = document.createElement('div');
        toast.className = 'toast-conciliacao';
        toast.innerHTML = `<i class="fas ${icons[tipo] || icons.info}"></i> ${mensagem}`;
        Object.assign(toast.style, {
            position: 'fixed', bottom: '20px', right: '20px', zIndex: '99999',
            background: colors[tipo] || colors.info, color: '#fff', padding: '14px 22px', borderRadius: '10px',
            fontSize: '13px', fontFamily: 'Inter, sans-serif', fontWeight: '500',
            boxShadow: '0 4px 16px rgba(0,0,0,0.2)', display: 'flex', alignItems: 'center',
            gap: '10px', animation: 'slideInRight 0.3s ease'
        });
        document.body.appendChild(toast);
        setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateX(100px)'; toast.style.transition = 'all 0.3s ease'; setTimeout(() => toast.remove(), 300); }, 4000);
    }
}
