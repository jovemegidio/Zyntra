/**
 * GESTÃO DE ESTOQUE MP - ALUFORCE
 * Controle integrado: 878 materiais PCP + Movimentações de estoque
 * Compras + PCP unidos em uma única interface
 * v2.0 - 2025-06-10
 */

// ============================================
// STATE
// ============================================
const EST = {
    materiais: [],
    selecionados: new Set(),
    pagina: 1,
    total: 0,
    totalPages: 1,
    tipos: [],
    stats: { total: 0, ativos: 0, inativos: 0 },
    tiposPopulados: false,
    seletorTipo: null // 'entrada' | 'saida' | 'ajuste'
};

function getAuthHeaders() {
    const token = localStorage.getItem('token');
    return {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
    };
}

// ============================================
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    // Wait for auth
    if (window.authManager) {
        document.addEventListener('authSuccess', () => carregarEstoque());
        // Fallback
        setTimeout(() => {
            if (EST.materiais.length === 0) carregarEstoque();
        }, 2000);
    } else {
        setTimeout(() => carregarEstoque(), 500);
    }

    // Init user greeting
    inicializarUsuario();
});

function inicializarUsuario() {
    const userData = JSON.parse(localStorage.getItem('userData') || '{}');
    const nome = userData.nome || userData.name || 'Usuário';
    const primeiroNome = nome.split(' ')[0];
    const el = document.getElementById('user-name');
    if (el) el.textContent = primeiroNome;

    const initialEl = document.getElementById('user-initial');
    if (initialEl) initialEl.textContent = primeiroNome.charAt(0).toUpperCase();

    // Greeting
    const hora = new Date().getHours();
    const greet = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
    const greetEl = document.getElementById('greeting-text');
    if (greetEl) greetEl.textContent = greet;
}

// ============================================
// LOAD DATA (from PCP endpoint - all 878 materials)
// ============================================
async function carregarEstoque() {
    const busca = document.getElementById('busca-input')?.value || '';
    const tipo = document.getElementById('filtro-tipo')?.value || '';
    const ativo = document.getElementById('filtro-ativo')?.value || '';
    const vinculado = document.getElementById('filtro-vinculado')?.value || '';
    const porPagina = parseInt(document.getElementById('por-pagina')?.value) || 50;

    const tbody = document.getElementById('materiais-tbody');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:40px;color:#94a3b8;"><i class="fas fa-spinner fa-spin" style="font-size:20px;"></i><div style="margin-top:8px;">Carregando materiais...</div></td></tr>';
    }

    try {
        const params = new URLSearchParams({
            page: EST.pagina,
            limit: porPagina,
            busca,
            tipo,
            ativo
        });

        const resp = await fetch(`/api/compras/estoque/materiais-pcp?${params}`, { headers: getAuthHeaders() });
        if (!resp.ok) throw new Error('Erro ao carregar materiais');
        const data = await resp.json();

        EST.materiais = data.materiais || [];
        EST.total = data.paginacao?.total || 0;
        EST.totalPages = data.paginacao?.totalPages || 1;
        EST.tipos = data.tipos || [];
        EST.stats = data.stats || { total: 0, ativos: 0, inativos: 0 };

        // Apply client-side vinculado filter
        let materiais = EST.materiais;
        if (vinculado === '1') {
            materiais = materiais.filter(m => m.vinculado_estoque);
        } else if (vinculado === '0') {
            materiais = materiais.filter(m => !m.vinculado_estoque);
        }

        // Populate tipos dropdown (once)
        if (!EST.tiposPopulados && EST.tipos.length > 0) {
            const selectTipo = document.getElementById('filtro-tipo');
            if (selectTipo) {
                EST.tipos.forEach(t => {
                    const opt = document.createElement('option');
                    opt.value = t.tipo || 'null';
                    opt.textContent = `${t.tipo || '(Sem tipo)'} (${t.count})`;
                    selectTipo.appendChild(opt);
                });
                EST.tiposPopulados = true;
            }
        }

        // Update stats
        atualizarStats();

        // Render table
        renderizarTabela(materiais);

        // Pagination
        renderizarPaginacao();

        // Update bulk bar
        atualizarBulkBar();

    } catch (err) {
        console.error('Erro ao carregar estoque:', err);
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:40px;color:#ef4444;"><i class="fas fa-exclamation-triangle" style="font-size:24px;margin-bottom:8px;"></i><div>Erro ao carregar: ${err.message}</div></td></tr>`;
        }
    }
}

// ============================================
// STATS
// ============================================
function atualizarStats() {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('stat-total', EST.stats.total || 0);
    set('stat-ativos', EST.stats.ativos || 0);
    set('stat-inativos', EST.stats.inativos || 0);

    // Count vinculados from current page
    const vinculados = EST.materiais.filter(m => m.vinculado_estoque).length;
    set('stat-vinculados', vinculados);
    set('stat-selecionados', EST.selecionados.size);
}

// ============================================
// RENDER TABLE
// ============================================
function renderizarTabela(materiais) {
    const tbody = document.getElementById('materiais-tbody');
    if (!tbody) return;

    materiais = materiais || EST.materiais;

    if (!materiais.length) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:60px 20px;color:#94a3b8;"><i class="fas fa-inbox" style="font-size:40px;opacity:0.5;display:block;margin-bottom:12px;"></i><strong>Nenhum material encontrado</strong><br><span style="font-size:13px;">Tente ajustar os filtros ou adicione novos materiais</span></td></tr>';
        return;
    }

    tbody.innerHTML = materiais.map(m => {
        const checked = EST.selecionados.has(m.id) ? 'checked' : '';
        const selectedClass = EST.selecionados.has(m.id) ? 'row-selected' : '';
        const tipoLabel = m.tipo || '—';
        const tipoClass = m.tipo ? `tipo-${m.tipo.toLowerCase()}` : 'tipo-default';
        const custo = m.custo_unitario ? `R$ ${parseFloat(m.custo_unitario).toFixed(2)}` : '<span style="color:#94a3b8;">—</span>';
        const codigo = m.codigo_material || m.id;
        const desc = (m.descricao || '—').replace(/"/g, '&quot;');

        const ativoHtml = m.ativo
            ? '<span class="estoque-status-badge estoque-status-ativo"><i class="fas fa-check-circle"></i> Ativo</span>'
            : '<span class="estoque-status-badge estoque-status-inativo"><i class="fas fa-ban"></i> Inativo</span>';

        const vincHtml = m.vinculado_estoque
            ? '<span class="vinc-sim"><i class="fas fa-link"></i> Sim</span>'
            : '<span class="vinc-nao">—</span>';

        return `<tr class="${selectedClass}" data-id="${m.id}">
            <td><input type="checkbox" ${checked} onchange="toggleSelect(${m.id})" /></td>
            <td><span style="font-family:monospace;font-size:12px;color:#64748b;">${codigo}</span></td>
            <td><span class="mat-desc" title="${desc}">${m.descricao || '—'}</span></td>
            <td style="text-align:center;"><span class="tipo-badge ${tipoClass}">${tipoLabel}</span></td>
            <td style="text-align:center;font-size:12px;">${m.unidade_medida || '—'}</td>
            <td style="text-align:right;font-size:12px;font-family:monospace;">${custo}</td>
            <td style="text-align:center;">${ativoHtml}</td>
            <td style="text-align:center;">${vincHtml}</td>
            <td>
                <div class="action-buttons">
                    <button class="btn-action-estoque btn-entrada" title="Entrada" onclick="abrirEntrada(${m.id})"><i class="fas fa-arrow-down"></i></button>
                    <button class="btn-action-estoque btn-saida" title="Dar Baixa" onclick="abrirSaida(${m.id})"><i class="fas fa-arrow-up"></i></button>
                    <button class="btn-action-estoque btn-editar" title="Editar" onclick="abrirEditar(${m.id})"><i class="fas fa-edit"></i></button>
                    <button class="btn-action-estoque btn-historico" title="Histórico" onclick="verHistorico(${m.id})"><i class="fas fa-history"></i></button>
                    <button class="btn-action-estoque btn-excluir" title="Excluir" onclick="excluirMaterial(${m.id})"><i class="fas fa-trash"></i></button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

// ============================================
// PAGINATION
// ============================================
function renderizarPaginacao() {
    const info = document.getElementById('pag-info');
    const container = document.getElementById('pag-btns');
    const porPagina = parseInt(document.getElementById('por-pagina')?.value) || 50;
    const inicio = (EST.pagina - 1) * porPagina + 1;
    const fim = Math.min(EST.pagina * porPagina, EST.total);

    if (info) info.textContent = EST.total > 0 ? `Mostrando ${inicio}-${fim} de ${EST.total}` : 'Nenhum registro';
    if (!container) return;

    let btns = '';
    if (EST.pagina > 1) {
        btns += `<button onclick="irPagina(${EST.pagina - 1})">&laquo; Anterior</button>`;
    }

    const maxBtns = 7;
    let start = Math.max(1, EST.pagina - 3);
    let end = Math.min(EST.totalPages, start + maxBtns - 1);
    start = Math.max(1, end - maxBtns + 1);

    for (let i = start; i <= end; i++) {
        btns += `<button onclick="irPagina(${i})" class="${i === EST.pagina ? 'active' : ''}">${i}</button>`;
    }

    if (EST.pagina < EST.totalPages) {
        btns += `<button onclick="irPagina(${EST.pagina + 1})">Próxima &raquo;</button>`;
    }
    container.innerHTML = btns;
}

function irPagina(p) {
    EST.pagina = p;
    carregarEstoque();
}

function filtrarEstoque() {
    EST.pagina = 1;
    carregarEstoque();
}

// ============================================
// SELECTION
// ============================================
function toggleSelect(id) {
    if (EST.selecionados.has(id)) {
        EST.selecionados.delete(id);
    } else {
        EST.selecionados.add(id);
    }
    // Update row highlight
    const row = document.querySelector(`tr[data-id="${id}"]`);
    if (row) row.classList.toggle('row-selected', EST.selecionados.has(id));

    atualizarBulkBar();
}

function toggleSelectAll(master) {
    EST.materiais.forEach(m => {
        if (master.checked) {
            EST.selecionados.add(m.id);
        } else {
            EST.selecionados.delete(m.id);
        }
    });
    // Re-render to update checkboxes
    renderizarTabela();
    atualizarBulkBar();
}

function limparSelecao() {
    EST.selecionados.clear();
    const selectAll = document.getElementById('select-all');
    if (selectAll) selectAll.checked = false;
    renderizarTabela();
    atualizarBulkBar();
}

function atualizarBulkBar() {
    const n = EST.selecionados.size;
    const bar = document.getElementById('bulk-action-bar');
    const text = document.getElementById('bulk-text');
    const statEl = document.getElementById('stat-selecionados');

    if (bar) bar.classList.toggle('active', n > 0);
    if (text) text.textContent = `${n} selecionado${n !== 1 ? 's' : ''}`;
    if (statEl) statEl.textContent = n;
}

// ============================================
// BULK ACTIONS
// ============================================
async function bulkAction(action) {
    const ids = Array.from(EST.selecionados);
    if (!ids.length) return mostrarToast('Selecione materiais primeiro', 'warning');

    const msgs = {
        ativar: `Ativar ${ids.length} material(is)?`,
        desativar: `Desativar ${ids.length} material(is)?`,
        excluir: `EXCLUIR permanentemente ${ids.length} material(is)? Esta ação não pode ser desfeita!`,
        importar: `Importar ${ids.length} material(is) para o Estoque de Matérias-Primas?`
    };

    if (!confirm(msgs[action])) return;

    try {
        let url, body;
        if (action === 'ativar') {
            url = '/api/compras/estoque/materiais-pcp/bulk-toggle';
            body = { ids, ativo: true };
        } else if (action === 'desativar') {
            url = '/api/compras/estoque/materiais-pcp/bulk-toggle';
            body = { ids, ativo: false };
        } else if (action === 'excluir') {
            url = '/api/compras/estoque/materiais-pcp/bulk-delete';
            body = { ids };
        } else if (action === 'importar') {
            url = '/api/compras/estoque/materiais-pcp/importar';
            body = { ids };
        }

        const resp = await fetch(url, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(body)
        });

        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || 'Erro na operação');

        const successMsgs = {
            ativar: `${data.affected || ids.length} material(is) ativado(s)`,
            desativar: `${data.affected || ids.length} material(is) desativado(s)`,
            excluir: `${data.deleted || ids.length} material(is) excluído(s)`,
            importar: `${data.importados || ids.length} material(is) importado(s) para o estoque`
        };

        mostrarToast(successMsgs[action], 'success');
        if (data.duplicados) {
            setTimeout(() => mostrarToast(`${data.duplicados} já estavam vinculados (ignorados)`, 'info'), 500);
        }

        EST.selecionados.clear();
        const selectAll = document.getElementById('select-all');
        if (selectAll) selectAll.checked = false;
        await carregarEstoque();
    } catch (err) {
        mostrarToast(err.message, 'error');
    }
}

// ============================================
// ENTRADA (per material)
// ============================================
function abrirEntrada(id) {
    const m = EST.materiais.find(mat => mat.id === id);
    if (!m) return mostrarToast('Material não encontrado', 'error');

    document.getElementById('entrada-id').value = m.id;
    document.getElementById('entrada-nome').value = m.descricao || '';
    document.getElementById('entrada-estoque-atual').value = `${m.quantidade_atual || 0} ${m.unidade_medida || 'UN'}`;
    document.getElementById('entrada-qtd').value = '';
    document.getElementById('entrada-custo').value = m.custo_unitario || '';
    document.getElementById('entrada-documento').value = '';
    document.getElementById('entrada-obs').value = '';
    abrirModal('modal-entrada');
}

async function confirmarEntrada() {
    const materialId = document.getElementById('entrada-id').value;
    const quantidade = parseFloat(document.getElementById('entrada-qtd').value);
    const custo = parseFloat(document.getElementById('entrada-custo').value);
    const documento = document.getElementById('entrada-documento').value.trim();
    const observacao = document.getElementById('entrada-obs').value.trim();

    if (!materialId || !quantidade || quantidade <= 0) {
        return mostrarToast('Preencha a quantidade corretamente', 'warning');
    }
    if (!custo || custo <= 0) {
        return mostrarToast('Preencha o custo unitário', 'warning');
    }
    if (!documento) {
        return mostrarToast('Preencha a nota fiscal / documento', 'warning');
    }

    try {
        const resp = await fetch('/api/compras/estoque/entrada', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                material_id: materialId,
                quantidade,
                custo_unitario: custo,
                documento,
                observacao
            })
        });

        if (resp.ok) {
            mostrarToast('Entrada registrada com sucesso!', 'success');
            fecharModal('modal-entrada');
            await carregarEstoque();
        } else {
            const error = await resp.json();
            throw new Error(error.message || 'Erro ao registrar entrada');
        }
    } catch (err) {
        mostrarToast(err.message, 'error');
    }
}

// ============================================
// SAÍDA / DAR BAIXA (per material - variation aware)
// ============================================
function abrirSaida(id) {
    const m = EST.materiais.find(mat => mat.id === id);
    if (!m) return mostrarToast('Material não encontrado', 'error');

    document.getElementById('saida-id').value = m.id;
    document.getElementById('saida-nome').value = m.descricao || '';
    document.getElementById('saida-disponivel').value = `${m.quantidade_atual || 0} ${m.unidade_medida || 'UN'}`;
    document.getElementById('saida-qtd').value = '';
    document.getElementById('saida-destino').value = '';
    document.getElementById('saida-documento').value = '';
    document.getElementById('saida-obs').value = '';
    document.getElementById('saida-aviso').style.display = 'none';

    // Show variation info
    const varInfo = document.getElementById('saida-variacao-info');
    if (varInfo) {
        varInfo.textContent = `Código: ${m.codigo_material || m.id} • Tipo: ${m.tipo || 'N/A'} • Unidade: ${m.unidade_medida || 'UN'}`;
    }

    abrirModal('modal-saida');
}

function validarSaida() {
    const qtd = parseFloat(document.getElementById('saida-qtd').value) || 0;
    const disponivelTexto = document.getElementById('saida-disponivel').value;
    const disponivel = parseFloat(disponivelTexto) || 0;
    const aviso = document.getElementById('saida-aviso');
    const btn = document.getElementById('btn-confirmar-saida');

    if (qtd > disponivel && disponivel > 0) {
        aviso.style.display = 'block';
        if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
    } else {
        aviso.style.display = 'none';
        if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
    }
}

async function confirmarSaida() {
    const materialId = document.getElementById('saida-id').value;
    const quantidade = parseFloat(document.getElementById('saida-qtd').value);
    const destino = document.getElementById('saida-destino').value.trim();
    const documento = document.getElementById('saida-documento').value.trim();
    const observacao = document.getElementById('saida-obs').value.trim();

    if (!materialId || !quantidade || quantidade <= 0 || !destino) {
        return mostrarToast('Preencha quantidade e destino', 'warning');
    }

    try {
        const resp = await fetch('/api/compras/estoque/saida', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                material_id: materialId,
                quantidade,
                destino,
                documento,
                observacao
            })
        });

        if (resp.ok) {
            mostrarToast('Saída registrada com sucesso!', 'success');
            fecharModal('modal-saida');
            await carregarEstoque();
        } else {
            const error = await resp.json();
            throw new Error(error.message || 'Erro ao registrar saída');
        }
    } catch (err) {
        mostrarToast(err.message, 'error');
    }
}

// ============================================
// AJUSTE
// ============================================
function calcularDiferencaAjuste() {
    const qtdContada = parseFloat(document.getElementById('ajuste-qtd-contada').value) || 0;
    const estoqueTexto = document.getElementById('ajuste-estoque-sistema').textContent;
    const estoqueSistema = parseFloat(estoqueTexto) || 0;
    const diferenca = qtdContada - estoqueSistema;

    const card = document.getElementById('ajuste-diferenca-card');
    const texto = document.getElementById('ajuste-diferenca-texto');
    const valor = document.getElementById('ajuste-diferenca-valor');
    const btn = document.getElementById('btn-confirmar-ajuste');

    if (qtdContada > 0 || document.getElementById('ajuste-qtd-contada').value !== '') {
        card.style.display = 'block';
        if (diferenca > 0) {
            card.className = 'diferenca-card positivo';
            texto.textContent = 'Será registrada uma ENTRADA';
            valor.textContent = `+${diferenca.toFixed(3)}`;
            valor.style.color = '#16a34a';
        } else if (diferenca < 0) {
            card.className = 'diferenca-card negativo';
            texto.textContent = 'Será registrada uma SAÍDA';
            valor.textContent = diferenca.toFixed(3);
            valor.style.color = '#dc2626';
        } else {
            card.className = 'diferenca-card neutro';
            texto.textContent = 'Estoque já está correto';
            valor.textContent = '0';
            valor.style.color = '#6b7280';
        }
        btn.disabled = diferenca === 0;
        btn.style.opacity = diferenca === 0 ? '0.6' : '1';
    } else {
        card.style.display = 'none';
        btn.disabled = true;
        btn.style.opacity = '0.6';
    }
}

async function confirmarAjuste() {
    const materialId = document.getElementById('ajuste-id').value;
    const qtdContada = parseFloat(document.getElementById('ajuste-qtd-contada').value);
    const motivo = document.getElementById('ajuste-motivo').value;
    const documento = document.getElementById('ajuste-documento').value;
    const observacao = document.getElementById('ajuste-obs').value;

    if (!materialId || qtdContada === undefined || !motivo) {
        return mostrarToast('Preencha todos os campos obrigatórios', 'warning');
    }

    try {
        const resp = await fetch('/api/compras/estoque/ajuste', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                material_id: materialId,
                quantidade_contada: qtdContada,
                motivo,
                documento,
                observacao
            })
        });

        if (resp.ok) {
            mostrarToast('Ajuste realizado com sucesso!', 'success');
            fecharModal('modal-ajuste');
            await carregarEstoque();
        } else {
            const error = await resp.json();
            throw new Error(error.message || 'Erro ao realizar ajuste');
        }
    } catch (err) {
        mostrarToast(err.message, 'error');
    }
}

// ============================================
// EDITAR
// ============================================
function abrirEditar(id) {
    const m = EST.materiais.find(mat => mat.id === id);
    if (!m) return;

    document.getElementById('editar-id').value = m.id;
    document.getElementById('editar-codigo').value = m.codigo_material || m.id;
    document.getElementById('editar-descricao').value = m.descricao || '';
    document.getElementById('editar-tipo').value = (m.tipo || '').toLowerCase();
    document.getElementById('editar-unidade').value = m.unidade_medida || 'UN';
    document.getElementById('editar-custo').value = m.custo_unitario || '';
    document.getElementById('editar-estoque-min').value = m.estoque_minimo || '';
    document.getElementById('editar-ativo').value = m.ativo ? '1' : '0';
    document.getElementById('editar-ncm').value = m.ncm || '';

    // Info card
    document.getElementById('editar-info-codigo').textContent = m.codigo_material || `ID #${m.id}`;
    document.getElementById('editar-info-descricao').textContent = m.descricao || 'Sem descrição';
    document.getElementById('editar-info-status').innerHTML = m.ativo
        ? '<span class="estoque-status-badge estoque-status-ativo"><i class="fas fa-check-circle"></i> Ativo</span>'
        : '<span class="estoque-status-badge estoque-status-inativo"><i class="fas fa-times-circle"></i> Inativo</span>';

    // Estoque info cards
    const qtdEstoque = parseFloat(m.quantidade_estoque) || 0;
    const minEstoque = parseFloat(m.estoque_minimo) || 0;
    document.getElementById('editar-estoque-atual').textContent = qtdEstoque.toLocaleString('pt-BR');
    document.getElementById('editar-estoque-min-info').textContent = minEstoque.toLocaleString('pt-BR');
    document.getElementById('editar-vinculado').innerHTML = m.vinculado_estoque
        ? '<i class="fas fa-link" style="font-size:14px;"></i> Sim'
        : '<i class="fas fa-unlink" style="font-size:14px;"></i> Não';

    abrirModal('modal-editar');
}

async function salvarEdicao() {
    const id = document.getElementById('editar-id').value;
    const dados = {
        codigo_material: document.getElementById('editar-codigo').value.trim(),
        descricao: document.getElementById('editar-descricao').value,
        tipo: document.getElementById('editar-tipo').value,
        unidade_medida: document.getElementById('editar-unidade').value,
        custo_unitario: parseFloat(document.getElementById('editar-custo').value) || null,
        estoque_minimo: parseFloat(document.getElementById('editar-estoque-min').value) || null,
        ativo: parseInt(document.getElementById('editar-ativo').value),
        ncm: document.getElementById('editar-ncm').value.trim() || null
    };

    if (!dados.codigo_material) return mostrarToast('Código é obrigatório', 'warning');
    if (!dados.descricao) return mostrarToast('Descrição é obrigatória', 'warning');

    try {
        const resp = await fetch(`/api/compras/estoque/materiais-pcp/${id}`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify(dados)
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || 'Erro ao salvar');

        mostrarToast('Material atualizado com sucesso', 'success');
        fecharModal('modal-editar');
        await carregarEstoque();
    } catch (err) {
        mostrarToast(err.message, 'error');
    }
}

// ============================================
// EXCLUIR
// ============================================
async function excluirMaterial(id) {
    const m = EST.materiais.find(mat => mat.id === id);
    if (!confirm(`Excluir "${m?.descricao || id}" permanentemente?`)) return;

    try {
        const resp = await fetch('/api/compras/estoque/materiais-pcp/bulk-delete', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ ids: [id] })
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || 'Erro ao excluir');

        EST.selecionados.delete(id);
        mostrarToast('Material excluído', 'success');
        await carregarEstoque();
    } catch (err) {
        mostrarToast(err.message, 'error');
    }
}

// ============================================
// NOVO MATERIAL
// ============================================
function abrirModalNovoMaterial() {
    document.getElementById('novo-material-codigo').value = '';
    document.getElementById('novo-material-descricao').value = '';
    document.getElementById('novo-material-tipo').value = '';
    document.getElementById('novo-material-unidade').value = 'UN';
    document.getElementById('novo-material-custo').value = '';
    document.getElementById('novo-material-minimo').value = '0';
    document.getElementById('novo-material-ativo').value = '1';
    document.getElementById('novo-material-ncm').value = '';
    document.getElementById('novo-material-qtd-estoque').value = '0';
    abrirModal('modal-novo-material');
}

async function salvarNovoMaterial() {
    const codigo = document.getElementById('novo-material-codigo').value.trim();
    const descricao = document.getElementById('novo-material-descricao').value.trim();
    const tipo = document.getElementById('novo-material-tipo').value;
    const unidade = document.getElementById('novo-material-unidade').value;
    const custo = parseFloat(document.getElementById('novo-material-custo').value) || null;
    const minimo = parseFloat(document.getElementById('novo-material-minimo').value) || 0;
    const ativo = parseInt(document.getElementById('novo-material-ativo').value);
    const ncm = document.getElementById('novo-material-ncm').value.trim() || null;
    const qtdEstoque = parseFloat(document.getElementById('novo-material-qtd-estoque').value) || 0;

    if (!codigo || !descricao) {
        return mostrarToast('Preencha código e descrição', 'warning');
    }

    try {
        // Use the PCP edit endpoint with a new create approach
        // For now, we'll use a direct INSERT approach
        const resp = await fetch('/api/compras/estoque/materiais-pcp/criar', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                codigo_material: codigo,
                descricao,
                tipo,
                unidade_medida: unidade,
                custo_unitario: custo,
                estoque_minimo: minimo,
                ativo,
                ncm,
                quantidade_estoque: qtdEstoque
            })
        });

        if (resp.ok) {
            mostrarToast('Material criado com sucesso!', 'success');
            fecharModal('modal-novo-material');
            EST.tiposPopulados = false; // Refresh tipos
            await carregarEstoque();
        } else {
            const data = await resp.json();
            throw new Error(data.error || 'Erro ao criar material');
        }
    } catch (err) {
        mostrarToast(err.message, 'error');
    }
}

// ============================================
// HISTÓRICO
// ============================================
function verHistorico(id) {
    const m = EST.materiais.find(mat => mat.id === id);
    abrirModal('modal-historico');
    carregarHistoricoMaterial(id, m?.descricao);
}

async function carregarHistoricoMaterial(materialId, nome) {
    const container = document.getElementById('historico-content');
    container.innerHTML = `<div style="text-align:center;padding:40px;color:#64748b;"><i class="fas fa-spinner fa-spin" style="font-size:24px;"></i><div style="margin-top:8px;">Carregando histórico${nome ? ' de ' + nome : ''}...</div></div>`;

    try {
        const resp = await fetch('/api/compras/estoque/movimentacoes', {
            headers: getAuthHeaders()
        });

        if (!resp.ok) throw new Error('Erro ao carregar histórico');
        const data = await resp.json();
        let movimentacoes = data.movimentacoes || [];

        // Filter by material if specified
        if (materialId) {
            movimentacoes = movimentacoes.filter(mov => mov.material_id === materialId);
        }

        if (!movimentacoes.length) {
            container.innerHTML = `<div style="text-align:center;padding:60px 20px;color:#64748b;"><i class="fas fa-inbox" style="font-size:40px;opacity:0.5;display:block;margin-bottom:12px;"></i><strong>Nenhuma movimentação registrada</strong><br><span style="font-size:13px;">${nome ? 'Este material ainda não teve movimentações' : 'Registre entradas ou saídas para ver o histórico'}</span></div>`;
            return;
        }

        container.innerHTML = movimentacoes.map(mov => `
            <div style="padding:14px 20px;border-bottom:1px solid #f1f5f9;display:flex;gap:14px;align-items:flex-start;">
                <div style="width:36px;height:36px;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;
                    background:${mov.tipo === 'ENTRADA' ? '#dcfce7' : mov.tipo === 'SAIDA' ? '#fee2e2' : '#fef3c7'};
                    color:${mov.tipo === 'ENTRADA' ? '#16a34a' : mov.tipo === 'SAIDA' ? '#dc2626' : '#d97706'};">
                    <i class="fas fa-${mov.tipo === 'ENTRADA' ? 'arrow-down' : mov.tipo === 'SAIDA' ? 'arrow-up' : 'sliders-h'}"></i>
                </div>
                <div style="flex:1;">
                    <div style="font-weight:600;color:#1e293b;margin-bottom:3px;">${mov.material_descricao || 'Material'}</div>
                    <div style="font-size:13px;color:#64748b;">
                        <span style="color:${mov.tipo === 'ENTRADA' ? '#16a34a' : '#dc2626'};font-weight:600;">
                            ${mov.tipo === 'ENTRADA' ? '+' : '-'}${mov.quantidade}
                        </span>
                        ${mov.destino ? ` • ${mov.destino}` : ''}
                        ${mov.documento ? ` • ${mov.documento}` : ''}
                    </div>
                    ${mov.observacao ? `<div style="font-size:12px;color:#94a3b8;margin-top:3px;">${mov.observacao}</div>` : ''}
                </div>
                <div style="text-align:right;font-size:12px;color:#94a3b8;">
                    ${new Date(mov.created_at).toLocaleDateString('pt-BR')}<br>
                    ${new Date(mov.created_at).toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'})}
                </div>
            </div>
        `).join('');
    } catch (err) {
        container.innerHTML = `<div style="text-align:center;padding:40px;color:#ef4444;"><i class="fas fa-exclamation-circle" style="font-size:24px;"></i><div style="margin-top:8px;">${err.message}</div></div>`;
    }
}

function verHistoricoGeral() {
    abrirModal('modal-historico');
    carregarHistoricoMaterial(null, null);
}

// ============================================
// ENTRADA / SAÍDA RÁPIDA (via selector)
// ============================================
function abrirEntradaRapida() {
    EST.seletorTipo = 'entrada';
    abrirSeletor('Selecionar Material para Entrada');
}

function abrirSaidaRapida() {
    EST.seletorTipo = 'saida';
    abrirSeletor('Selecionar Material para Dar Baixa');
}

function abrirSeletor(titulo) {
    document.getElementById('seletor-titulo').textContent = titulo;
    document.getElementById('seletor-busca').value = '';
    abrirModal('modal-seletor');
    renderizarSeletor();
}

function renderizarSeletor() {
    const busca = (document.getElementById('seletor-busca')?.value || '').toLowerCase();
    const container = document.getElementById('seletor-lista');

    let materiais = EST.materiais.filter(m => m.ativo);
    if (busca) {
        materiais = materiais.filter(m =>
            (m.descricao || '').toLowerCase().includes(busca) ||
            (m.codigo_material || '').toLowerCase().includes(busca)
        );
    }

    if (!materiais.length) {
        container.innerHTML = '<div style="text-align:center;padding:40px;color:#94a3b8;">Nenhum material encontrado</div>';
        return;
    }

    container.innerHTML = materiais.slice(0, 100).map(m => {
        const tipoClass = m.tipo ? `tipo-${m.tipo.toLowerCase()}` : 'tipo-default';
        return `<div onclick="selecionarMaterial(${m.id})" style="padding:12px 20px;border-bottom:1px solid #f1f5f9;cursor:pointer;display:flex;align-items:center;gap:12px;transition:background .15s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''">
            <div style="flex:1;">
                <div style="font-weight:600;color:#1e293b;font-size:14px;">${m.descricao || '—'}</div>
                <div style="font-size:12px;color:#64748b;margin-top:2px;">
                    <span style="font-family:monospace;">${m.codigo_material || m.id}</span>
                    ${m.tipo ? ` • <span class="tipo-badge ${tipoClass}">${m.tipo}</span>` : ''}
                    • ${m.unidade_medida || 'UN'}
                </div>
            </div>
            <i class="fas fa-chevron-right" style="color:#cbd5e1;"></i>
        </div>`;
    }).join('');

    if (materiais.length > 100) {
        container.innerHTML += `<div style="padding:12px 20px;text-align:center;color:#94a3b8;font-size:13px;">Mostrando 100 de ${materiais.length} — use a busca para refinar</div>`;
    }
}

function filtrarSeletor() {
    renderizarSeletor();
}

function selecionarMaterial(id) {
    fecharModal('modal-seletor');
    if (EST.seletorTipo === 'entrada') {
        abrirEntrada(id);
    } else if (EST.seletorTipo === 'saida') {
        abrirSaida(id);
    }
}

// ============================================
// MODAL HELPERS
// ============================================
function abrirModal(id) {
    const modal = document.getElementById(id);
    if (modal) {
        modal.style.display = '';
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
}

function fecharModal(id) {
    const modal = document.getElementById(id);
    if (modal) {
        modal.classList.remove('active');
        modal.style.display = 'none';
        document.body.style.overflow = '';
    }
}

// ============================================
// TOAST
// ============================================
function mostrarToast(mensagem, tipo = 'info') {
    const cores = {
        success: '#22c55e',
        error: '#ef4444',
        warning: '#f97316',
        info: '#6366f1'
    };
    const icones = {
        success: 'check-circle',
        error: 'times-circle',
        warning: 'exclamation-triangle',
        info: 'info-circle'
    };

    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed; bottom: 20px; right: 20px; padding: 14px 22px;
        background: ${cores[tipo]}; color: white; border-radius: 10px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.2); z-index: 10001;
        display: flex; align-items: center; gap: 10px;
        font-size: 14px; font-weight: 500; animation: slideInToast 0.3s ease;
        max-width: 400px;
    `;
    toast.innerHTML = `<i class="fas fa-${icones[tipo]}"></i> ${mensagem}`;

    if (!document.getElementById('toast-anim-style')) {
        const style = document.createElement('style');
        style.id = 'toast-anim-style';
        style.textContent = `
            @keyframes slideInToast { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        `;
        document.head.appendChild(style);
    }

    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = 'slideInToast 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ============================================
// TOOLTIPS
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('tooltip-styles')) {
        const style = document.createElement('style');
        style.id = 'tooltip-styles';
        style.textContent = `
            [data-tooltip] { position: relative; }
            [data-tooltip]::before, [data-tooltip]::after {
                position: absolute; opacity: 0; visibility: hidden;
                transition: all 0.2s ease; z-index: 10000; pointer-events: none;
            }
            [data-tooltip]::before {
                content: attr(data-tooltip); bottom: calc(100% + 8px);
                left: 50%; transform: translateX(-50%); padding: 6px 10px;
                background: #1e293b; color: white; font-size: 11px; font-weight: 500;
                border-radius: 6px; white-space: nowrap; box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            }
            [data-tooltip]::after {
                content: ''; bottom: calc(100% + 2px); left: 50%;
                transform: translateX(-50%); border: 5px solid transparent; border-top-color: #1e293b;
            }
            [data-tooltip]:hover::before, [data-tooltip]:hover::after { opacity: 1; visibility: visible; }
        `;
        document.head.appendChild(style);
    }

    // Convert title to data-tooltip
    setTimeout(() => {
        document.querySelectorAll('.btn-action-estoque[title]').forEach(btn => {
            if (btn.title && !btn.dataset.tooltip) {
                btn.dataset.tooltip = btn.title;
            }
        });
    }, 2000);
});
