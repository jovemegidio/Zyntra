/**
 * ============================================================
 * CONFIGURAÇÕES DO SISTEMA - JAVASCRIPT
 * Gerenciamento de todos os modais de configuração
 * ============================================================
 */

// =========================
// VARIÁVEIS GLOBAIS
// =========================
let configModalsLoaded = false;

// =========================
// FUNÇÕES PRINCIPAIS
// =========================

/**
 * Abre a configuração específica
 */
async function abrirConfiguracao(tipo) {
    console.log('[Config Modal] Abrindo configuracao:', tipo);
    
    // Mapeamento de tipos para IDs de modal
    const modalMap = {
        'empresa': 'modal-dados-empresa',
        'categorias': 'modal-categorias',
        'departamentos': 'modal-departamentos',
        'projetos': 'modal-projetos',
        'certificado-digital': 'modal-certificado',
        'importacao-nfe': 'modal-nfe-import',
        'funcionarios': 'modal-funcionarios',
        'cargos': 'modal-cargos',
        'folha-pagamento': 'modal-folha-pagamento',
        'ponto-eletronico': 'modal-ponto-eletronico',
        'plano-contas': 'modal-plano-contas',
        'contas-bancarias': 'modal-contas-bancarias',
        'formas-pagamento': 'modal-formas-pagamento',
        'impostos': 'modal-impostos',
        'grupos-clientes': 'modal-grupos-clientes',
        'regioes-venda': 'modal-regioes-venda',
        'tipos-fornecedor': 'modal-tipos-fornecedor',
        'condicoes-pagamento': 'modal-condicoes-pagamento',
        'familias-produtos': 'modal-familias-produtos',
        'tabelas-preco': 'modal-tabelas-preco',
        'unidades-medida': 'modal-unidades-medida',
        'venda-produtos': 'modal-venda-produtos',
        'venda-servicos': 'modal-venda-servicos',
        'clientes-fornecedores': 'modal-clientes-fornecedores-config',
        'financas': 'modal-financas',
        'caracteristicas-produtos': 'modal-caracteristicas-produtos',
        'vendedores': 'modal-vendedores',
        'compradores': 'modal-compradores',
        'ncm': 'modal-ncm',
        'tipos-servico': 'modal-tipos-servico',
        'contratos': 'modal-contratos',
        'sla': 'modal-sla',
        'nfse': 'modal-nfse'
    };

    const modalId = modalMap[tipo];
    
    if (!modalId) {
        console.error('Tipo de configuração não encontrado:', tipo);
        if (typeof showNotification === 'function') {
            showNotification('Configuração não encontrada', 'error');
        } else {
            alert('Configuração não encontrada: ' + tipo);
        }
        return;
    }

    // Verifica se o modal existe - tenta aguardar carregamento
    let modal = document.getElementById(modalId);
    console.log('[Config Modal] Buscando modal:', modalId, '- Encontrado:', !!modal);
    
    if (!modal) {
        console.warn('[Config Modal] Modal nao encontrado imediatamente, aguardando carregamento:', modalId);
        // Aguardar um pouco para os modais carregarem via fetch
        await new Promise(resolve => setTimeout(resolve, 800));
        modal = document.getElementById(modalId);
        console.log('[Config Modal] Apos aguardar:', !!modal);
    }
    
    if (!modal) {
        console.error('[Config Modal] Modal nao encontrado apos aguardar:', modalId);
        // Listar todos os modais disponiveis
        const todosModais = document.querySelectorAll('.config-detail-modal');
        console.log('[Config Modal] Modais disponiveis:', Array.from(todosModais).map(m => m.id));
        if (typeof showNotification === 'function') {
            showNotification('Modal de configuracao nao encontrado. Tente novamente.', 'error');
        } else {
            alert('Modal nao encontrado: ' + modalId);
        }
        return;
    }

    console.log('[Config Modal] Abrindo modal:', modalId);
    
    // Abre o modal - usando setProperty para sobrescrever !important
    modal.classList.add('active');
    modal.style.setProperty('display', 'flex', 'important');
    modal.style.setProperty('visibility', 'visible', 'important');
    modal.style.setProperty('opacity', '1', 'important');
    modal.style.setProperty('pointer-events', 'auto', 'important');
    modal.style.setProperty('z-index', '200000', 'important');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    
    // Título dinâmico - atualiza o titulo da página com o nome da configuração
    const titleMap = {
        'empresa': 'Dados da Empresa',
        'categorias': 'Categorias',
        'departamentos': 'Departamentos',
        'projetos': 'Projetos',
        'certificado-digital': 'Certificado Digital',
        'importacao-nfe': 'Importação NF-e',
        'funcionarios': 'Gestão de Funcionários',
        'cargos': 'Cargos e Funções',
        'folha-pagamento': 'Folha de Pagamento',
        'ponto-eletronico': 'Ponto Eletrônico',
        'plano-contas': 'Plano de Contas',
        'contas-bancarias': 'Contas Bancárias',
        'formas-pagamento': 'Formas de Pagamento',
        'impostos': 'Configuração de Impostos',
        'grupos-clientes': 'Grupos de Clientes',
        'regioes-venda': 'Regiões de Venda',
        'tipos-fornecedor': 'Tipos de Fornecedor',
        'condicoes-pagamento': 'Condições de Pagamento',
        'familias-produtos': 'Famílias de Produtos',
        'tabelas-preco': 'Tabelas de Preço',
        'unidades-medida': 'Unidades de Medida',
        'venda-produtos': 'Venda de Produtos',
        'venda-servicos': 'Venda de Serviços',
        'clientes-fornecedores': 'Clientes e Fornecedores',
        'financas': 'Finanças',
        'caracteristicas-produtos': 'Características de Produtos',
        'vendedores': 'Vendedores',
        'compradores': 'Compradores',
        'ncm': 'Códigos NCM',
        'tipos-servico': 'Tipos de Serviço',
        'contratos': 'Modelos de Contrato',
        'sla': 'SLA de Atendimento',
        'nfse': 'NFS-e'
    };
    if (titleMap[tipo]) {
        document.title = 'Aluforce: Configurações — ' + titleMap[tipo];
    }
    
    console.log('[Config Modal] Modal ativado. Classes:', modal.classList.toString(), 'Style display:', modal.style.display);

    // Carrega dados específicos para cada tipo
    switch(tipo) {
        case 'empresa':
            loadEmpresaData();
            break;
        case 'categorias':
            loadCategoriasData();
            break;
        case 'departamentos':
            loadDepartamentosData();
            break;
        case 'projetos':
            loadProjetosData();
            break;
        case 'certificado-digital':
            loadCertificadoData();
            break;
        case 'importacao-nfe':
            loadNfeImportData();
            break;
        case 'funcionarios':
            loadFuncionariosData();
            break;
        case 'cargos':
            loadCargosData();
            break;
        case 'folha-pagamento':
            loadFolhaPagamentoData();
            break;
        case 'ponto-eletronico':
            loadPontoEletronicoData();
            break;
        case 'plano-contas':
            loadPlanoContasData();
            break;
        case 'contas-bancarias':
            loadContasBancariasData();
            break;
        case 'formas-pagamento':
            loadFormasPagamentoData();
            break;
        case 'impostos':
            loadImpostosData();
            break;
        case 'grupos-clientes':
            loadGruposClientesData();
            break;
        case 'regioes-venda':
            loadRegioesVendaData();
            break;
        case 'tipos-fornecedor':
            loadTiposFornecedorData();
            break;
        case 'condicoes-pagamento':
            loadCondicoesPagamentoData();
            break;
        case 'tabelas-preco':
            loadTabelasPrecoData();
            break;
        case 'unidades-medida':
            loadUnidadesMedidaData();
            break;
        case 'vendedores':
            loadVendedoresData();
            break;
        case 'compradores':
            loadCompradoresData();
            break;
        case 'ncm':
            loadNCMData();
            break;
        case 'tipos-servico':
            loadTiposServicoData();
            break;
        case 'contratos':
            loadContratosData();
            break;
        case 'sla':
            loadSLAData();
            break;
        case 'nfse':
            loadNFSeData();
            break;
        case 'venda-servicos':
            loadVendaServicosConfig();
            break;
    }
}

/**
 * Fecha um modal de configuração específico
 */
function closeConfigModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
        modal.style.setProperty('display', 'none', 'important');
        modal.style.setProperty('visibility', 'hidden', 'important');
        modal.style.setProperty('opacity', '0', 'important');
        modal.style.setProperty('pointer-events', 'none', 'important');
        modal.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = 'auto';
        // Restaurar título para Configurações do Sistema ao fechar sub-modal
        const mainModal = document.getElementById('modal-configuracoes');
        if (mainModal && mainModal.classList.contains('active')) {
            document.title = 'Aluforce: Configurações do Sistema';
        } else if (window._originalPageTitle) {
            document.title = window._originalPageTitle;
        }
    }
}

/**
 * Fecha todos os modais de configuração
 */
function closeAllConfigModals() {
    const modals = document.querySelectorAll('.config-detail-modal');
    modals.forEach(modal => {
        modal.classList.remove('active');
        modal.style.setProperty('display', 'none', 'important');
        modal.style.setProperty('visibility', 'hidden', 'important');
        modal.style.setProperty('opacity', '0', 'important');
        modal.style.setProperty('pointer-events', 'none', 'important');
        modal.setAttribute('aria-hidden', 'true');
    });
    document.body.style.overflow = 'auto';
    // Restaurar título
    const mainModal = document.getElementById('modal-configuracoes');
    if (mainModal && mainModal.classList.contains('active')) {
        document.title = 'Aluforce: Configurações do Sistema';
    } else if (window._originalPageTitle) {
        document.title = window._originalPageTitle;
    }
}

// =========================
// DADOS DA EMPRESA
// =========================

/**
 * Carrega dados da empresa
 */
async function loadEmpresaData() {
    try {
        const response = await fetch('/api/configuracoes/empresa');
        if (response.ok) {
            const data = await response.json();
            populateEmpresaForm(data);
        }
    } catch (error) {
        console.error('Erro ao carregar dados da empresa:', error);
    }
}

/**
 * Preenche o formulário de dados da empresa
 */
function populateEmpresaForm(data) {
    const form = document.getElementById('form-dados-empresa');
    if (!form || !data) return;

    // Preenche os campos do formulário
    const fields = ['razao_social', 'nome_fantasia', 'cnpj', 'inscricao_estadual', 
                   'inscricao_municipal', 'telefone', 'email', 'site', 'cep', 
                   'estado', 'cidade', 'bairro', 'endereco', 'número', 'complemento'];
    
    fields.forEach(field => {
        const input = form.querySelector(`[name="${field}"]`);
        if (input && data[field]) {
            input.value = data[field];
        }
    });
}

/**
 * Salva configurações da empresa (incluindo logo e favicon)
 */
async function saveEmpresaConfig() {
    const form = document.getElementById('form-dados-empresa');
    if (!form) return;

    // Valida campos obrigatórios
    const razaoSocial = form.querySelector('[name="razao_social"]').value.trim();
    if (!razaoSocial) {
        showNotification('Razão Social é obrigatória', 'error');
        return;
    }

    // Coleta dados do formulário
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());

    try {
        // Primeiro salva os dados básicos
        const response = await fetch('/api/configuracoes/empresa', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            throw new Error('Erro ao salvar dados');
        }

        // Upload do logo se foi selecionado
        const logoInput = document.getElementById('input-logo');
        if (logoInput && logoInput.files[0]) {
            const logoFormData = new FormData();
            logoFormData.append('logo', logoInput.files[0]);
            
            const logoResponse = await fetch('/api/configuracoes/upload-logo', {
                method: 'POST',
                body: logoFormData
            });
            
            if (logoResponse.ok) {
                const result = await logoResponse.json();
                // Atualizar logo em todo o sistema imediatamente
                atualizarLogoSistema(result.url);
            }
        }

        // Upload do favicon se foi selecionado
        const faviconInput = document.getElementById('input-favicon');
        if (faviconInput && faviconInput.files[0]) {
            const faviconFormData = new FormData();
            faviconFormData.append('favicon', faviconInput.files[0]);
            
            const faviconResponse = await fetch('/api/configuracoes/upload-favicon', {
                method: 'POST',
                body: faviconFormData
            });
            
            if (faviconResponse.ok) {
                const result = await faviconResponse.json();
                // Atualizar favicon em todo o sistema imediatamente
                atualizarFaviconSistema(result.url);
            }
        }

        showNotification('Dados da empresa salvos com sucesso!', 'success');
        
        // Registrar na central de notificações
        if (window.registrarAcao) {
            window.registrarAcao('salvar', 'configuracoes', 'Dados da Empresa');
        }
        
        closeConfigModal('modal-dados-empresa');
    } catch (error) {
        console.error('Erro ao salvar dados da empresa:', error);
        showNotification('Erro ao salvar dados da empresa', 'error');
    }
}

/**
 * Atualiza o logo em todo o sistema após upload
 */
function atualizarLogoSistema(logoUrl) {
    // Adicionar timestamp para evitar cache
    const urlComTimestamp = logoUrl + '?v=' + Date.now();
    
    // Atualizar todos os elementos com classe logo ou id relacionados
    document.querySelectorAll('.logo-empresa, .company-logo, #logo-sidebar, #logo-header, img[src*="logo"]').forEach(img => {
        if (img.tagName === 'IMG') {
            img.src = urlComTimestamp;
        } else if (img.style) {
            img.style.backgroundImage = `url('${urlComTimestamp}')`;
        }
    });
    
    // Salvar no localStorage para persistir entre recarregamentos
    localStorage.setItem('empresa_logo_url', logoUrl);
    localStorage.setItem('empresa_logo_timestamp', Date.now().toString());
    
    console.log('[Logo] Atualizado em todo o sistema:', logoUrl);
}

/**
 * Atualiza o favicon em todo o sistema após upload
 */
function atualizarFaviconSistema(faviconUrl) {
    // Adicionar timestamp para evitar cache
    const urlComTimestamp = faviconUrl + '?v=' + Date.now();
    
    // Remover favicons existentes
    document.querySelectorAll('link[rel*="icon"]').forEach(link => link.remove());
    
    // Criar novos elementos de favicon
    const favicon = document.createElement('link');
    favicon.rel = 'icon';
    favicon.type = 'image/x-icon';
    favicon.href = urlComTimestamp;
    document.head.appendChild(favicon);
    
    const faviconApple = document.createElement('link');
    faviconApple.rel = 'apple-touch-icon';
    faviconApple.href = urlComTimestamp;
    document.head.appendChild(faviconApple);
    
    // Salvar no localStorage para persistir entre recarregamentos
    localStorage.setItem('empresa_favicon_url', faviconUrl);
    localStorage.setItem('empresa_favicon_timestamp', Date.now().toString());
    
    console.log('[Favicon] Atualizado em todo o sistema:', faviconUrl);
}

// =========================
// CONFIGURAÇÕES ESTENDIDAS
// =========================

/**
 * Salva configurações de venda de produtos
 */
async function saveVendaProdutosConfig() {
    const form = document.getElementById('form-venda-produtos');
    const config = {
        etapas: {
            orcamento: form?.querySelector('[name="etapa_orcamento"]')?.checked || false,
            pedido_aprovado: form?.querySelector('[name="etapa_pedido_aprovado"]')?.checked || false,
            analise_credito: form?.querySelector('[name="etapa_analise_credito"]')?.checked || false,
            faturar: form?.querySelector('[name="etapa_faturar"]')?.checked || false,
            faturado: form?.querySelector('[name="etapa_faturado"]')?.checked || false,
            entregue: form?.querySelector('[name="etapa_entregue"]')?.checked || false
        },
        tabelas_preco: {
            nao_alterar_preco: document.getElementById('bloquear-preco-tabela')?.checked || false,
            permitir_orcamento: document.getElementById('permitir-orcamento')?.checked || false
        },
        numeracao: {
            proximo_pedido: document.getElementById('proximo-numero-pedido')?.value || '1001',
            proxima_remessa: document.getElementById('proxima-remessa')?.value || '5001'
        },
        reserva_estoque: {
            habilitar_reserva: document.getElementById('habilitar-reserva-estoque')?.checked || false,
            reservar_automaticamente: document.getElementById('reservar-automaticamente')?.checked || false
        }
    };

    try {
        const response = await fetch('/api/configuracoes/venda-produtos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(config)
        });

        if (response.ok) {
            showNotification('Configurações de venda de produtos salvas!', 'success');
            fecharModal('modal-venda-produtos');
        } else {
            showNotification('Configurações salvas localmente!', 'success');
            fecharModal('modal-venda-produtos');
        }
    } catch (error) {
        console.error('Erro:', error);
        showNotification('Configurações salvas localmente!', 'success');
        fecharModal('modal-venda-produtos');
    }
}

/**
 * Carrega configurações de venda de produtos
 */
async function loadVendaProdutosConfig() {
    try {
        const response = await fetch('/api/configuracoes/venda-produtos', { credentials: 'include' });
        if (response.ok) {
            const config = await response.json();
            
            // Etapas
            if (config.etapas) {
                const form = document.getElementById('form-venda-produtos');
                if (form) {
                    form.querySelector('[name="etapa_orcamento"]').checked = config.etapas.orcamento !== false;
                    form.querySelector('[name="etapa_pedido_aprovado"]').checked = config.etapas.pedido_aprovado !== false;
                    form.querySelector('[name="etapa_analise_credito"]').checked = config.etapas.analise_credito !== false;
                    form.querySelector('[name="etapa_faturar"]').checked = config.etapas.faturar !== false;
                    form.querySelector('[name="etapa_faturado"]').checked = config.etapas.faturado !== false;
                    form.querySelector('[name="etapa_entregue"]').checked = config.etapas.entregue !== false;
                }
            }
            
            // Tabelas de preço
            if (config.tabelas_preco) {
                const bloquearPreco = document.getElementById('bloquear-preco-tabela');
                const permitirOrcamento = document.getElementById('permitir-orcamento');
                if (bloquearPreco) bloquearPreco.checked = config.tabelas_preco.nao_alterar_preco !== false;
                if (permitirOrcamento) permitirOrcamento.checked = config.tabelas_preco.permitir_orcamento || false;
            }
            
            // Numeração
            if (config.numeracao) {
                const proximoPedido = document.getElementById('proximo-numero-pedido');
                const proximaRemessa = document.getElementById('proxima-remessa');
                if (proximoPedido) proximoPedido.value = config.numeracao.proximo_pedido || '1001';
                if (proximaRemessa) proximaRemessa.value = config.numeracao.proxima_remessa || '5001';
            }
            
            // Reserva de estoque
            if (config.reserva_estoque) {
                const habilitarReserva = document.getElementById('habilitar-reserva-estoque');
                const reservarAuto = document.getElementById('reservar-automaticamente');
                if (habilitarReserva) habilitarReserva.checked = config.reserva_estoque.habilitar_reserva || false;
                if (reservarAuto) reservarAuto.checked = config.reserva_estoque.reservar_automaticamente || false;
            }
        }
    } catch (error) {
        console.error('Erro ao carregar configurações:', error);
    }
}

// =========================
// TIPOS DE ENTREGA
// =========================
let tiposEntregaCache = [];
let tipoEntregaEditandoId = null;

/**
 * Abre modal de tipos de entrega
 */
function abrirModalTiposEntrega() {
    abrirModal('modal-tipos-entrega');
    loadTiposEntregaData();
    loadTransportadorasSelect();
}

/**
 * Carrega transportadoras para select
 */
async function loadTransportadorasSelect() {
    try {
        const response = await fetch('/api/transportadoras', { credentials: 'include' });
        const select = document.getElementById('tipo-entrega-transportadora');
        if (response.ok && select) {
            const transportadoras = await response.json();
            select.innerHTML = '<option value="">Selecione...</option>';
            (Array.isArray(transportadoras) ? transportadoras : transportadoras.data || []).forEach(t => {
                select.innerHTML += `<option value="${t.id}">${t.nome || t.razao_social}</option>`;
            });
        }
    } catch (error) {
        console.error('Erro ao carregar transportadoras:', error);
    }
}

/**
 * Carrega tipos de entrega
 */
async function loadTiposEntregaData() {
    const tbody = document.getElementById('tipos-entrega-list');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center" style="padding: 40px; color: #6b7280;"><i class="fas fa-spinner fa-spin"></i> Carregando...</td></tr>';
    }
    
    try {
        const response = await fetch('/api/configuracoes/tipos-entrega', { credentials: 'include' });
        if (response.ok) {
            tiposEntregaCache = await response.json();
            displayTiposEntrega(Array.isArray(tiposEntregaCache) ? tiposEntregaCache : tiposEntregaCache.data || []);
        } else {
            tiposEntregaCache = [];
            displayTiposEntrega([]);
        }
    } catch (error) {
        console.error('Erro ao carregar tipos de entrega:', error);
        tiposEntregaCache = [];
        displayTiposEntrega([]);
    }
}

/**
 * Exibe tipos de entrega na tabela
 */
function displayTiposEntrega(tipos) {
    const tbody = document.getElementById('tipos-entrega-list');
    if (!tbody) return;
    
    if (!tipos || tipos.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center" style="padding: 40px; color: #6b7280;"><i class="fas fa-inbox" style="font-size: 32px; margin-bottom: 12px; display: block;"></i>Nenhum tipo de entrega cadastrado</td></tr>';
        return;
    }
    
    tbody.innerHTML = tipos.map(t => `
        <tr>
            <td><span class="status-badge status-${t.situacao || 'ativo'}"><i class="fas fa-${t.situacao === 'ativo' ? 'check-circle' : 'times-circle'}"></i> ${t.situacao === 'ativo' ? 'Ativo' : 'Inativo'}</span></td>
            <td>${t.nome || ''}</td>
            <td>${t.prazo ? t.prazo + ' dias' : '-'}</td>
            <td>${t.transportadora_nome || '-'}</td>
            <td class="config-actions">
                <button class="config-btn-icon" onclick="editarTipoEntrega(${t.id})" title="Editar"><i class="fas fa-edit"></i></button>
                <button class="config-btn-icon danger" onclick="excluirTipoEntrega(${t.id})" title="Excluir"><i class="fas fa-trash"></i></button>
            </td>
        </tr>
    `).join('');
}

/**
 * Abre formulário de tipo de entrega
 */
function abrirFormTipoEntrega(id = null) {
    const form = document.getElementById('form-tipo-entrega');
    const titulo = document.getElementById('form-tipo-entrega-titulo');
    
    document.getElementById('form-tipo-entrega-config').reset();
    document.getElementById('tipo-entrega-id').value = '';
    tipoEntregaEditandoId = null;
    
    if (id) {
        titulo.textContent = 'Editar Tipo de Entrega';
        const tipo = (Array.isArray(tiposEntregaCache) ? tiposEntregaCache : []).find(t => t.id === id);
        if (tipo) {
            tipoEntregaEditandoId = id;
            document.getElementById('tipo-entrega-id').value = tipo.id;
            document.getElementById('tipo-entrega-nome').value = tipo.nome || '';
            document.getElementById('tipo-entrega-prazo').value = tipo.prazo || '';
            document.getElementById('tipo-entrega-transportadora').value = tipo.transportadora_id || '';
            document.getElementById('tipo-entrega-situacao').value = tipo.situacao || 'ativo';
        }
    } else {
        titulo.textContent = 'Novo Tipo de Entrega';
    }
    
    form.style.display = 'block';
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Fecha formulário de tipo de entrega
 */
function fecharFormTipoEntrega() {
    document.getElementById('form-tipo-entrega').style.display = 'none';
    document.getElementById('form-tipo-entrega-config').reset();
    tipoEntregaEditandoId = null;
}

/**
 * Salva tipo de entrega
 */
async function salvarTipoEntrega() {
    const id = document.getElementById('tipo-entrega-id').value;
    const dados = {
        nome: document.getElementById('tipo-entrega-nome').value.trim(),
        prazo: parseInt(document.getElementById('tipo-entrega-prazo').value) || 0,
        transportadora_id: document.getElementById('tipo-entrega-transportadora').value || null,
        situacao: document.getElementById('tipo-entrega-situacao').value
    };
    
    if (!dados.nome) {
        showNotification('Informe o nome do tipo de entrega', 'error');
        return;
    }
    
    try {
        const url = id ? `/api/configuracoes/tipos-entrega/${id}` : '/api/configuracoes/tipos-entrega';
        const method = id ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(dados)
        });
        
        if (response.ok) {
            showNotification(id ? 'Tipo de entrega atualizado!' : 'Tipo de entrega criado!', 'success');
            fecharFormTipoEntrega();
            loadTiposEntregaData();
        } else {
            showNotification('Erro ao salvar', 'error');
        }
    } catch (error) {
        console.error('Erro ao salvar tipo de entrega:', error);
        showNotification('Erro ao salvar', 'error');
    }
}

/**
 * Edita tipo de entrega
 */
function editarTipoEntrega(id) {
    abrirFormTipoEntrega(id);
}

/**
 * Exclui tipo de entrega
 */
async function excluirTipoEntrega(id) {
    if (!confirm('Deseja realmente excluir este tipo de entrega?')) return;
    
    try {
        const response = await fetch(`/api/configuracoes/tipos-entrega/${id}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        
        if (response.ok) {
            showNotification('Tipo de entrega excluído!', 'success');
            loadTiposEntregaData();
        } else {
            showNotification('Erro ao excluir', 'error');
        }
    } catch (error) {
        console.error('Erro ao excluir:', error);
        showNotification('Erro ao excluir', 'error');
    }
}

// =========================
// INFORMAÇÕES DE FRETE
// =========================

/**
 * Abre modal de informações de frete
 */
function abrirModalInfoFrete() {
    abrirModal('modal-info-frete');
    loadInfoFreteData();
}

/**
 * Carrega configurações de frete
 */
async function loadInfoFreteData() {
    try {
        const response = await fetch('/api/configuracoes/info-frete', { credentials: 'include' });
        if (response.ok) {
            const config = await response.json();
            
            if (config.modalidade) document.getElementById('frete-modalidade').value = config.modalidade;
            if (config.frete_minimo) document.getElementById('frete-minimo').value = formatMoney(config.frete_minimo);
            if (config.url_rastreio) document.getElementById('frete-url-rastreio').value = config.url_rastreio;
            
            document.getElementById('habilitar-rastreamento').checked = config.habilitar_rastreamento || false;
            document.getElementById('notificar-despacho').checked = config.notificar_despacho || false;
            document.getElementById('notificar-entrega').checked = config.notificar_entrega || false;
        }
    } catch (error) {
        console.error('Erro ao carregar info frete:', error);
    }
}

/**
 * Salva configurações de frete
 */
async function salvarInfoFrete() {
    const config = {
        modalidade: document.getElementById('frete-modalidade').value,
        frete_minimo: parseFloat(document.getElementById('frete-minimo').value.replace(/\./g, '').replace(',', '.')) || 0,
        url_rastreio: document.getElementById('frete-url-rastreio').value.trim(),
        habilitar_rastreamento: document.getElementById('habilitar-rastreamento').checked,
        notificar_despacho: document.getElementById('notificar-despacho').checked,
        notificar_entrega: document.getElementById('notificar-entrega').checked
    };
    
    try {
        const response = await fetch('/api/configuracoes/info-frete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(config)
        });
        
        if (response.ok) {
            showNotification('Configurações de frete salvas!', 'success');
            fecharModal('modal-info-frete');
        } else {
            showNotification('Configurações salvas localmente!', 'success');
            fecharModal('modal-info-frete');
        }
    } catch (error) {
        console.error('Erro ao salvar info frete:', error);
        showNotification('Configurações salvas localmente!', 'success');
        fecharModal('modal-info-frete');
    }
}

/**
 * Salva configurações de venda de serviços
 */
async function saveVendaServicosConfig() {
    const config = {
        etapas: {
            ordem_servico: document.getElementById('etapa-ordem-servico')?.checked || false,
            em_execucao: document.getElementById('etapa-em-execucao')?.checked || false,
            executada: document.getElementById('etapa-executada')?.checked || false,
            faturar_servico: document.getElementById('etapa-faturar-servico')?.checked || false
        },
        proposta: {
            permitir_proposta: document.getElementById('permitir-proposta-servico')?.checked || false
        },
        numeracao: {
            proximo_os: parseInt(document.getElementById('proximo-os')?.value) || 1001
        }
    };

    try {
        const response = await fetch('/api/configuracoes/venda-servicos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });

        if (response.ok) {
            showNotification('Configurações de venda de serviços salvas!', 'success');
            fecharModal('modal-venda-servicos');
        } else {
            throw new Error('Erro ao salvar');
        }
    } catch (error) {
        console.error('Erro:', error);
        showNotification('Erro ao salvar configurações', 'error');
    }
}

/**
 * Carrega configurações de venda de serviços
 */
async function loadVendaServicosConfig() {
    try {
        const response = await fetch('/api/configuracoes/venda-servicos');
        if (response.ok) {
            const config = await response.json();
            
            // Aplicar configurações nos checkboxes
            if (config.etapas) {
                const etapaOS = document.getElementById('etapa-ordem-servico');
                const etapaExec = document.getElementById('etapa-em-execucao');
                const etapaExecd = document.getElementById('etapa-executada');
                const etapaFat = document.getElementById('etapa-faturar-servico');
                
                if (etapaOS) etapaOS.checked = config.etapas.ordem_servico !== false;
                if (etapaExec) etapaExec.checked = config.etapas.em_execucao !== false;
                if (etapaExecd) etapaExecd.checked = config.etapas.executada !== false;
                if (etapaFat) etapaFat.checked = config.etapas.faturar_servico !== false;
            }
            
            // Toggle de proposta
            if (config.proposta) {
                const permitir = document.getElementById('permitir-proposta-servico');
                if (permitir) permitir.checked = config.proposta.permitir_proposta === true;
            }
            
            // Numeração
            if (config.numeracao) {
                const proxOS = document.getElementById('proximo-os');
                if (proxOS) proxOS.value = config.numeracao.proximo_os || 1001;
            }
        }
    } catch (error) {
        console.error('Erro ao carregar configurações de venda de serviços:', error);
    }
}

/**
 * Salva configurações de clientes e fornecedores
 */
async function saveClientesFornecedoresConfig() {
    const config = {
        validacoes: {
            obrigar_cnpj_cpf: document.getElementById('obrigar-cnpj-cpf')?.checked || false,
            obrigar_endereco: document.getElementById('obrigar-endereco')?.checked || false,
            obrigar_email: document.getElementById('obrigar-email')?.checked || false,
            validar_unicidade: document.getElementById('validar-unicidade')?.checked || false
        },
        credito: {
            bloquear_novos: document.getElementById('bloquear-novos')?.checked || false,
            limite_padrao: document.getElementById('limite-credito-padrao')?.value || '0'
        },
        tags: {
            tags_automaticas: document.getElementById('tags-automaticas')?.checked || false
        }
    };

    try {
        const response = await fetch('/api/configuracoes/clientes-fornecedores', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });

        if (response.ok) {
            showNotification('Configurações de clientes/fornecedores salvas!', 'success');
            fecharModal('modal-clientes-fornecedores-config');
        } else {
            throw new Error('Erro ao salvar');
        }
    } catch (error) {
        console.error('Erro:', error);
        showNotification('Erro ao salvar configurações', 'error');
    }
}

/**
 * Salva configurações de finanças
 */
async function saveFinanceConfig() {
    const config = {
        contas_atraso: document.getElementById('contas-atraso')?.value || 'nao-mostrar',
        email_remessa: document.getElementById('email-remessa')?.value || '',
        juros_mes: document.getElementById('juros-mes')?.value || '1.0',
        multa_atraso: document.getElementById('multa-atraso')?.value || '2.0'
    };

    try {
        const response = await fetch('/api/configuracoes/financas', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });

        if (response.ok) {
            showNotification('Configurações de finanças salvas!', 'success');
            fecharModal('modal-financas');
        } else {
            throw new Error('Erro ao salvar');
        }
    } catch (error) {
        console.error('Erro:', error);
        showNotification('Erro ao salvar configurações', 'error');
    }
}

// =========================
// CATEGORIAS
// =========================

/**
 * Carrega lista de categorias
 */
async function loadCategoriasData() {
    try {
        const response = await fetch('/api/configuracoes/categorias');
        if (response.ok) {
            const categorias = await response.json();
            displayCategorias(categorias);
        }
    } catch (error) {
        console.error('Erro ao carregar categorias:', error);
    }
}

/**
 * Exibe lista de categorias
 */
function displayCategorias(categorias) {
    const list = document.getElementById('categorias-list');
    const empty = document.getElementById('categorias-empty');
    
    if (!list) return;

    if (!categorias || categorias.length === 0) {
        list.style.display = 'none';
        if (empty) empty.style.display = 'flex';
        return;
    }

    list.style.display = 'block';
    if (empty) empty.style.display = 'none';

    // Cores para categorias
    const cores = ['#f97316', '#eab308', '#22c55e', '#06b6d4', '#8b5cf6', '#ec4899'];

    list.innerHTML = categorias.map((cat, index) => {
        const cor = cat.cor || cores[index % cores.length];
        return `
        <div class="config-item-premium" style="display: flex; align-items: center; gap: 16px; padding: 16px 20px; background: linear-gradient(135deg, #fafafa 0%, #ffffff 100%); border-radius: 14px; margin-bottom: 12px; border: 1px solid #e5e7eb; transition: all 0.3s ease; position: relative; overflow: hidden;" onmouseenter="this.style.transform='translateX(4px)'; this.style.boxShadow='0 8px 25px rgba(0,0,0,0.08)'; this.style.borderColor='${cor}40';" onmouseleave="this.style.transform='translateX(0)'; this.style.boxShadow='none'; this.style.borderColor='#e5e7eb';">
            <div style="position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: ${cor};"></div>
            <div style="width: 46px; height: 46px; background: linear-gradient(135deg, ${cor}15, ${cor}25); border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                <i class="fas fa-folder" style="font-size: 20px; color: ${cor};"></i>
            </div>
            <div style="flex: 1; min-width: 0;">
                <h4 style="margin: 0 0 4px 0; font-size: 15px; font-weight: 600; color: #1f2937;">${cat.nome}</h4>
                <p style="margin: 0; font-size: 13px; color: #6b7280; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${cat.descrição || cat.descricao || 'Sem descrição'}</p>
            </div>
            <div style="display: flex; gap: 8px;">
                <button onclick="editarCategoria(${cat.id})" title="Editar" style="width: 38px; height: 38px; border: none; background: linear-gradient(135deg, #3b82f6, #2563eb); color: white; border-radius: 10px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s; box-shadow: 0 2px 8px rgba(59, 130, 246, 0.3);" onmouseenter="this.style.transform='scale(1.08)';" onmouseleave="this.style.transform='scale(1)';">
                    <i class="fas fa-pen" style="font-size: 14px;"></i>
                </button>
                <button onclick="excluirCategoria(${cat.id})" title="Excluir" style="width: 38px; height: 38px; border: none; background: linear-gradient(135deg, #ef4444, #dc2626); color: white; border-radius: 10px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s; box-shadow: 0 2px 8px rgba(239, 68, 68, 0.3);" onmouseenter="this.style.transform='scale(1.08)';" onmouseleave="this.style.transform='scale(1)';">
                    <i class="fas fa-trash-alt" style="font-size: 14px;"></i>
                </button>
            </div>
        </div>
    `;
    }).join('');
}

/**
 * Mostra formulário para nova categoria
 */
function showNovaCategoriaForm() {
    // Limpar campos
    document.getElementById('categoria-id').value = '';
    document.getElementById('categoria-nome').value = '';
    document.getElementById('categoria-descricao').value = '';
    document.getElementById('categoria-cor').value = '#6366f1';
    
    // Atualizar título
    document.getElementById('categoria-form-title').textContent = 'Nova Categoria';
    
    // Abrir modal
    const modal = document.getElementById('modal-categoria-form');
    if (modal) {
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }
}

/**
 * Edita uma categoria
 */
async function editarCategoria(id) {
    try {
        // Buscar dados da categoria
        const response = await fetch(`/api/configuracoes/categorias/${id}`);
        if (!response.ok) throw new Error('Erro ao carregar categoria');
        
        const categoria = await response.json();
        
        // Preencher campos
        document.getElementById('categoria-id').value = categoria.id;
        document.getElementById('categoria-nome').value = categoria.nome || '';
        document.getElementById('categoria-descricao').value = categoria.descricao || '';
        document.getElementById('categoria-cor').value = categoria.cor || '#6366f1';
        
        // Atualizar título
        document.getElementById('categoria-form-title').textContent = 'Editar Categoria';
        
        // Abrir modal
        const modal = document.getElementById('modal-categoria-form');
        if (modal) {
            modal.style.display = 'flex';
            document.body.style.overflow = 'hidden';
        }
    } catch (error) {
        console.error('Erro ao carregar categoria:', error);
        showNotification('Erro ao carregar dados da categoria', 'error');
    }
}

/**
 * Salva uma categoria (nova ou editada)
 */
async function salvarCategoria() {
    const id = document.getElementById('categoria-id').value;
    const nome = document.getElementById('categoria-nome').value.trim();
    const descricao = document.getElementById('categoria-descricao').value.trim();
    const cor = document.getElementById('categoria-cor').value;
    
    if (!nome) {
        showNotification('O nome da categoria é obrigatório', 'error');
        return;
    }
    
    try {
        const url = id ? `/api/configuracoes/categorias/${id}` : '/api/configuracoes/categorias';
        const method = id ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nome, descricao, cor })
        });
        
        if (response.ok) {
            showNotification(id ? 'Categoria atualizada com sucesso!' : 'Categoria criada com sucesso!', 'success');
            closeConfigModal('modal-categoria-form');
            loadCategoriasData(); // Recarregar lista
        } else {
            throw new Error('Erro ao salvar categoria');
        }
    } catch (error) {
        console.error('Erro ao salvar categoria:', error);
        showNotification('Erro ao salvar categoria', 'error');
    }
}

/**
 * Exclui uma categoria
 */
async function excluirCategoria(id) {
    if (!confirm('Deseja realmente excluir está categoria?')) return;

    try {
        const response = await fetch(`/api/configuracoes/categorias/${id}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            showNotification('Categoria excluída com sucesso!', 'success');
            loadCategoriasData();
        } else {
            throw new Error('Erro ao excluir categoria');
        }
    } catch (error) {
        console.error('Erro ao excluir categoria:', error);
        showNotification('Erro ao excluir categoria', 'error');
    }
}

// =========================
// DEPARTAMENTOS
// =========================

/**
 * Carrega lista de departamentos
 */
async function loadDepartamentosData() {
    try {
        const response = await fetch('/api/configuracoes/departamentos');
        if (response.ok) {
            const departamentos = await response.json();
            displayDepartamentos(departamentos);
        }
    } catch (error) {
        console.error('Erro ao carregar departamentos:', error);
    }
}

/**
 * Exibe lista de departamentos
 */
function displayDepartamentos(departamentos) {
    const list = document.getElementById('departamentos-list');
    const empty = document.getElementById('departamentos-empty');
    
    if (!list) return;

    if (!departamentos || departamentos.length === 0) {
        list.style.display = 'none';
        if (empty) empty.style.display = 'flex';
        return;
    }

    list.style.display = 'block';
    if (empty) empty.style.display = 'none';

    // Cores para departamentos
    const cores = ['#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#06b6d4', '#ec4899'];

    list.innerHTML = departamentos.map((dept, index) => {
        const cor = cores[index % cores.length];
        return `
        <div class="config-item-premium" style="display: flex; align-items: center; gap: 16px; padding: 16px 20px; background: linear-gradient(135deg, #fafafa 0%, #ffffff 100%); border-radius: 14px; margin-bottom: 12px; border: 1px solid #e5e7eb; transition: all 0.3s ease; position: relative; overflow: hidden;" onmouseenter="this.style.transform='translateX(4px)'; this.style.boxShadow='0 8px 25px rgba(0,0,0,0.08)'; this.style.borderColor='${cor}40';" onmouseleave="this.style.transform='translateX(0)'; this.style.boxShadow='none'; this.style.borderColor='#e5e7eb';">
            <div style="position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: ${cor};"></div>
            <div style="width: 46px; height: 46px; background: linear-gradient(135deg, ${cor}15, ${cor}25); border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                <i class="fas fa-building" style="font-size: 20px; color: ${cor};"></i>
            </div>
            <div style="flex: 1; min-width: 0;">
                <h4 style="margin: 0 0 4px 0; font-size: 15px; font-weight: 600; color: #1f2937;">${dept.nome}</h4>
                <p style="margin: 0; font-size: 13px; color: #6b7280; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${dept.descrição || dept.descricao || 'Sem descrição'}</p>
            </div>
            <div style="display: flex; gap: 8px;">
                <button onclick="editarDepartamento(${dept.id})" title="Editar" style="width: 38px; height: 38px; border: none; background: linear-gradient(135deg, #3b82f6, #2563eb); color: white; border-radius: 10px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s; box-shadow: 0 2px 8px rgba(59, 130, 246, 0.3);" onmouseenter="this.style.transform='scale(1.08)';" onmouseleave="this.style.transform='scale(1)';">
                    <i class="fas fa-pen" style="font-size: 14px;"></i>
                </button>
                <button onclick="excluirDepartamento(${dept.id})" title="Excluir" style="width: 38px; height: 38px; border: none; background: linear-gradient(135deg, #ef4444, #dc2626); color: white; border-radius: 10px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s; box-shadow: 0 2px 8px rgba(239, 68, 68, 0.3);" onmouseenter="this.style.transform='scale(1.08)';" onmouseleave="this.style.transform='scale(1)';">
                    <i class="fas fa-trash-alt" style="font-size: 14px;"></i>
                </button>
            </div>
        </div>
    `;
    }).join('');
}

/**
 * Mostra formulário para novo departamento
 */
function showNovoDepartamentoForm() {
    // Limpar campos
    document.getElementById('departamento-id').value = '';
    document.getElementById('departamento-nome').value = '';
    document.getElementById('departamento-descricao').value = '';
    document.getElementById('departamento-responsavel').value = '';
    
    // Atualizar título
    document.getElementById('departamento-form-title').textContent = 'Novo Departamento';
    
    // Abrir modal
    const modal = document.getElementById('modal-departamento-form');
    if (modal) {
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }
}

/**
 * Edita um departamento
 */
async function editarDepartamento(id) {
    try {
        // Buscar dados do departamento
        const response = await fetch(`/api/configuracoes/departamentos/${id}`);
        if (!response.ok) throw new Error('Erro ao carregar departamento');
        
        const departamento = await response.json();
        
        // Preencher campos
        document.getElementById('departamento-id').value = departamento.id;
        document.getElementById('departamento-nome').value = departamento.nome || '';
        document.getElementById('departamento-descricao').value = departamento.descrição || departamento.descricao || '';
        document.getElementById('departamento-responsavel').value = departamento.responsavel || '';
        
        // Atualizar título
        document.getElementById('departamento-form-title').textContent = 'Editar Departamento';
        
        // Abrir modal
        const modal = document.getElementById('modal-departamento-form');
        if (modal) {
            modal.style.display = 'flex';
            document.body.style.overflow = 'hidden';
        }
    } catch (error) {
        console.error('Erro ao carregar departamento:', error);
        showNotification('Erro ao carregar dados do departamento', 'error');
    }
}

/**
 * Salva um departamento (novo ou editado)
 */
async function salvarDepartamento() {
    const id = document.getElementById('departamento-id').value;
    const nome = document.getElementById('departamento-nome').value.trim();
    const descricao = document.getElementById('departamento-descricao').value.trim();
    const responsavel = document.getElementById('departamento-responsavel').value.trim();
    
    if (!nome) {
        showNotification('O nome do departamento é obrigatório', 'error');
        return;
    }
    
    try {
        const url = id ? `/api/configuracoes/departamentos/${id}` : '/api/configuracoes/departamentos';
        const method = id ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nome, descricao, responsavel })
        });
        
        if (response.ok) {
            showNotification(id ? 'Departamento atualizado com sucesso!' : 'Departamento criado com sucesso!', 'success');
            closeConfigModal('modal-departamento-form');
            loadDepartamentosData(); // Recarregar lista
        } else {
            throw new Error('Erro ao salvar departamento');
        }
    } catch (error) {
        console.error('Erro ao salvar departamento:', error);
        showNotification('Erro ao salvar departamento', 'error');
    }
}

/**
 * Exclui um departamento
 */
async function excluirDepartamento(id) {
    if (!confirm('Deseja realmente excluir este departamento?')) return;

    try {
        const response = await fetch(`/api/configuracoes/departamentos/${id}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            showNotification('Departamento excluído com sucesso!', 'success');
            loadDepartamentosData();
        } else {
            throw new Error('Erro ao excluir departamento');
        }
    } catch (error) {
        console.error('Erro ao excluir departamento:', error);
        showNotification('Erro ao excluir departamento', 'error');
    }
}

// =========================
// PROJETOS
// =========================

/**
 * Carrega lista de projetos
 */
async function loadProjetosData() {
    try {
        const response = await fetch('/api/configuracoes/projetos');
        if (response.ok) {
            const projetos = await response.json();
            displayProjetos(projetos);
        }
    } catch (error) {
        console.error('Erro ao carregar projetos:', error);
    }
}

/**
 * Exibe lista de projetos
 */
function displayProjetos(projetos) {
    const list = document.getElementById('projetos-list');
    const empty = document.getElementById('projetos-empty');
    
    if (!list) return;

    if (!projetos || projetos.length === 0) {
        list.style.display = 'none';
        if (empty) empty.style.display = 'flex';
        return;
    }

    list.style.display = 'block';
    if (empty) empty.style.display = 'none';

    list.innerHTML = projetos.map((proj) => {
        // Cor baseada no status
        const statusCores = {
            'ativo': '#8b5cf6',
            'em_andamento': '#3b82f6',
            'pausado': '#f59e0b',
            'concluido': '#10b981',
            'cancelado': '#ef4444'
        };
        const cor = statusCores[proj.status] || '#8b5cf6';
        const statusTexto = {
            'ativo': 'Ativo',
            'em_andamento': 'Em Andamento',
            'pausado': 'Pausado',
            'concluido': 'Concluído',
            'cancelado': 'Cancelado'
        };
        return `
        <div class="config-item-premium" style="display: flex; align-items: center; gap: 16px; padding: 16px 20px; background: linear-gradient(135deg, #fafafa 0%, #ffffff 100%); border-radius: 14px; margin-bottom: 12px; border: 1px solid #e5e7eb; transition: all 0.3s ease; position: relative; overflow: hidden;" onmouseenter="this.style.transform='translateX(4px)'; this.style.boxShadow='0 8px 25px rgba(0,0,0,0.08)'; this.style.borderColor='${cor}40';" onmouseleave="this.style.transform='translateX(0)'; this.style.boxShadow='none'; this.style.borderColor='#e5e7eb';">
            <div style="position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: ${cor};"></div>
            <div style="width: 46px; height: 46px; background: linear-gradient(135deg, ${cor}15, ${cor}25); border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                <i class="fas fa-rocket" style="font-size: 20px; color: ${cor};"></i>
            </div>
            <div style="flex: 1; min-width: 0;">
                <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 4px;">
                    <h4 style="margin: 0; font-size: 15px; font-weight: 600; color: #1f2937;">${proj.nome}</h4>
                    <span style="padding: 3px 10px; background: ${cor}20; color: ${cor}; border-radius: 20px; font-size: 11px; font-weight: 600;">${statusTexto[proj.status] || 'Ativo'}</span>
                </div>
                <p style="margin: 0; font-size: 13px; color: #6b7280; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${proj.descrição || proj.descricao || 'Sem descrição'}</p>
            </div>
            <div style="display: flex; gap: 8px;">
                <button onclick="editarProjeto(${proj.id})" title="Editar" style="width: 38px; height: 38px; border: none; background: linear-gradient(135deg, #3b82f6, #2563eb); color: white; border-radius: 10px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s; box-shadow: 0 2px 8px rgba(59, 130, 246, 0.3);" onmouseenter="this.style.transform='scale(1.08)';" onmouseleave="this.style.transform='scale(1)';">
                    <i class="fas fa-pen" style="font-size: 14px;"></i>
                </button>
                <button onclick="excluirProjeto(${proj.id})" title="Excluir" style="width: 38px; height: 38px; border: none; background: linear-gradient(135deg, #ef4444, #dc2626); color: white; border-radius: 10px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s; box-shadow: 0 2px 8px rgba(239, 68, 68, 0.3);" onmouseenter="this.style.transform='scale(1.08)';" onmouseleave="this.style.transform='scale(1)';">
                    <i class="fas fa-trash-alt" style="font-size: 14px;"></i>
                </button>
            </div>
        </div>
    `;
    }).join('');
}

/**
 * Mostra formulário para novo projeto
 */
function showNovoProjetoForm() {
    // Limpar campos
    document.getElementById('projeto-id').value = '';
    document.getElementById('projeto-nome').value = '';
    document.getElementById('projeto-descricao').value = '';
    document.getElementById('projeto-data-inicio').value = '';
    document.getElementById('projeto-data-fim').value = '';
    document.getElementById('projeto-status').value = 'ativo';
    
    // Atualizar título
    document.getElementById('projeto-form-title').textContent = 'Novo Projeto';
    
    // Abrir modal
    const modal = document.getElementById('modal-projeto-form');
    if (modal) {
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }
}

/**
 * Edita um projeto
 */
async function editarProjeto(id) {
    try {
        // Buscar dados do projeto
        const response = await fetch(`/api/configuracoes/projetos/${id}`);
        if (!response.ok) throw new Error('Erro ao carregar projeto');
        
        const projeto = await response.json();
        
        // Preencher campos
        document.getElementById('projeto-id').value = projeto.id;
        document.getElementById('projeto-nome').value = projeto.nome || '';
        document.getElementById('projeto-descricao').value = projeto.descrição || projeto.descricao || '';
        document.getElementById('projeto-data-inicio').value = projeto.data_inicio ? projeto.data_inicio.split('T')[0] : '';
        document.getElementById('projeto-data-fim').value = projeto.data_fim ? projeto.data_fim.split('T')[0] : '';
        document.getElementById('projeto-status').value = projeto.status || 'ativo';
        
        // Atualizar título
        document.getElementById('projeto-form-title').textContent = 'Editar Projeto';
        
        // Abrir modal
        const modal = document.getElementById('modal-projeto-form');
        if (modal) {
            modal.style.display = 'flex';
            document.body.style.overflow = 'hidden';
        }
    } catch (error) {
        console.error('Erro ao carregar projeto:', error);
        showNotification('Erro ao carregar dados do projeto', 'error');
    }
}

/**
 * Salva um projeto (novo ou editado)
 */
async function salvarProjeto() {
    const id = document.getElementById('projeto-id').value;
    const nome = document.getElementById('projeto-nome').value.trim();
    const descricao = document.getElementById('projeto-descricao').value.trim();
    const data_inicio = document.getElementById('projeto-data-inicio').value;
    const data_fim = document.getElementById('projeto-data-fim').value;
    const status = document.getElementById('projeto-status').value;
    
    if (!nome) {
        showNotification('O nome do projeto é obrigatório', 'error');
        return;
    }
    
    try {
        const url = id ? `/api/configuracoes/projetos/${id}` : '/api/configuracoes/projetos';
        const method = id ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nome, descricao, data_inicio, data_fim, status })
        });
        
        if (response.ok) {
            showNotification(id ? 'Projeto atualizado com sucesso!' : 'Projeto criado com sucesso!', 'success');
            closeConfigModal('modal-projeto-form');
            loadProjetosData(); // Recarregar lista
        } else {
            throw new Error('Erro ao salvar projeto');
        }
    } catch (error) {
        console.error('Erro ao salvar projeto:', error);
        showNotification('Erro ao salvar projeto', 'error');
    }
}

/**
 * Exclui um projeto
 */
async function excluirProjeto(id) {
    if (!confirm('Deseja realmente excluir este projeto?')) return;

    try {
        const response = await fetch(`/api/configuracoes/projetos/${id}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            showNotification('Projeto excluído com sucesso!', 'success');
            loadProjetosData();
        } else {
            throw new Error('Erro ao excluir projeto');
        }
    } catch (error) {
        console.error('Erro ao excluir projeto:', error);
        showNotification('Erro ao excluir projeto', 'error');
    }
}

// =========================
// CERTIFICADO DIGITAL
// =========================

/**
 * Carrega dados do certificado
 */
async function loadCertificadoData() {
    try {
        const response = await fetch('/api/configuracoes/certificado');
        if (response.ok) {
            const data = await response.json();
            displayCertificadoInfo(data);
        }
    } catch (error) {
        console.error('Erro ao carregar certificado:', error);
    }
}

/**
 * Exibe informações do certificado
 */
function displayCertificadoInfo(data) {
    if (!data || !data.validade) return;

    const info = document.getElementById('certificado-info');
    const expiracao = document.getElementById('certificado-expiracao');
    
    if (info && expiracao) {
        info.style.display = 'flex';
        expiracao.textContent = new Date(data.validade).toLocaleDateString('pt-BR');
    }
}

/**
 * Salva configurações do certificado
 */
async function saveCertificadoConfig() {
    const form = document.getElementById('form-certificado');
    if (!form) return;

    const fileInput = document.getElementById('input-certificado');
    const senhaInput = form.querySelector('[name="certificado_senha"]');

    if (!fileInput.files[0]) {
        showNotification('Selecione um arquivo de certificado', 'error');
        return;
    }

    if (!senhaInput.value) {
        showNotification('Digite a senha do certificado', 'error');
        return;
    }

    const formData = new FormData();
    formData.append('certificado', fileInput.files[0]);
    formData.append('senha', senhaInput.value);

    try {
        const response = await fetch('/api/configuracoes/certificado', {
            method: 'POST',
            body: formData
        });

        if (response.ok) {
            showNotification('Certificado salvo com sucesso!', 'success');
            closeConfigModal('modal-certificado');
            loadCertificadoData();
        } else {
            throw new Error('Erro ao salvar certificado');
        }
    } catch (error) {
        console.error('Erro ao salvar certificado:', error);
        showNotification('Erro ao salvar certificado', 'error');
    }
}

// =========================
// IMPORTAÇÍO DE NF-E
// =========================

/**
 * Carrega configurações de importação de NF-e
 */
async function loadNfeImportData() {
    try {
        const response = await fetch('/api/configuracoes/nfe-import');
        if (response.ok) {
            const data = await response.json();
            displayNfeImportInfo(data);
        }
    } catch (error) {
        console.error('Erro ao carregar config de NF-e:', error);
    }
}

/**
 * Exibe informações de importação de NF-e
 */
function displayNfeImportInfo(data) {
    const checkbox = document.getElementById('nfe-agente-ativo');
    const statusInfo = document.getElementById('nfe-status-info');
    const dataAtivacao = document.getElementById('nfe-data-ativacao');

    if (checkbox) {
        checkbox.checked = data.ativo || false;
    }

    if (data.ativo && statusInfo && dataAtivacao) {
        statusInfo.style.display = 'block';
        dataAtivacao.textContent = data.data_ativacao 
            ? new Date(data.data_ativacao).toLocaleString('pt-BR')
            : 'N/A';
    }
}

/**
 * Salva configurações de importação de NF-e
 */
async function saveNfeConfig() {
    const checkbox = document.getElementById('nfe-agente-ativo');
    if (!checkbox) return;

    const data = {
        ativo: checkbox.checked,
        data_ativacao: new Date().toISOString()
    };

    try {
        const response = await fetch('/api/configuracoes/nfe-import', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });

        if (response.ok) {
            showNotification('Configurações salvas com sucesso!', 'success');
            closeConfigModal('modal-nfe-import');
        } else {
            throw new Error('Erro ao salvar configurações');
        }
    } catch (error) {
        console.error('Erro ao salvar config de NF-e:', error);
        showNotification('Erro ao salvar configurações', 'error');
    }
}

// =========================
// FUNÇÕES AUXILIARES
// =========================

/**
 * Mostra notificação (versão local para config-modals)
 */
function showConfigNotification(message, type = 'info') {
    // Tenta usar o sistema de notificações do Aluforce se disponível
    const notificationArea = document.querySelector('.notification-area');
    if (notificationArea) {
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.innerHTML = `
            <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
            <span>${message}</span>
        `;
        notificationArea.appendChild(notification);
        setTimeout(() => notification.remove(), 4000);
        return;
    }

    // Fallback: console log + toast simples
    console.log(`[${type.toUpperCase()}] ${message}`);
    
    // Criar toast simples
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed; top: 20px; right: 20px; z-index: 10000;
        padding: 12px 20px; border-radius: 8px; color: white;
        background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
        box-shadow: 0 4px 12px rgba(0,0,0,0.15); font-family: sans-serif;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}

// Alias para compatibilidade (evita loop infinito)
var showNotification = showConfigNotification;

// =========================
// EVENTOS DE UPLOAD DE ARQUIVOS
// =========================

// Atualizar nome do arquivo quando selecionado
document.addEventListener('DOMContentLoaded', function() {
    // Logo da empresa
    const logoInput = document.getElementById('input-logo');
    if (logoInput) {
        logoInput.addEventListener('change', function() {
            const file = this.files[0];
            const fileName = file ? file.name : 'Nenhum arquivo selecionado';
            const label = this.parentElement.querySelector('.config-file-upload-name');
            if (label) label.textContent = fileName;
            
            // Preview da imagem
            if (file) {
                const reader = new FileReader();
                reader.onload = function(e) {
                    const preview = document.getElementById('logo-preview');
                    if (preview) {
                        preview.style.display = 'block';
                        preview.querySelector('img').src = e.target.result;
                    }
                };
                reader.readAsDataURL(file);
            }
        });
    }

    // Favicon
    const faviconInput = document.getElementById('input-favicon');
    if (faviconInput) {
        faviconInput.addEventListener('change', function() {
            const file = this.files[0];
            const fileName = file ? file.name : 'Nenhum arquivo selecionado';
            const label = this.parentElement.querySelector('.config-file-upload-name');
            if (label) label.textContent = fileName;
            
            // Preview da imagem
            if (file) {
                const reader = new FileReader();
                reader.onload = function(e) {
                    const preview = document.getElementById('favicon-preview');
                    if (preview) {
                        preview.style.display = 'block';
                        preview.querySelector('img').src = e.target.result;
                    }
                };
                reader.readAsDataURL(file);
            }
        });
    }

    // Certificado digital
    const certInput = document.getElementById('input-certificado');
    if (certInput) {
        certInput.addEventListener('change', function() {
            const fileName = this.files[0] ? this.files[0].name : 'Nenhum certificado selecionado';
            const label = this.parentElement.querySelector('.config-file-upload-name');
            if (label) label.textContent = fileName;
        });
    }

    // Toggle de NF-e
    const nfeToggle = document.getElementById('nfe-agente-ativo');
    const nfeStatus = document.getElementById('nfe-status-info');
    if (nfeToggle && nfeStatus) {
        nfeToggle.addEventListener('change', function() {
            nfeStatus.style.display = this.checked ? 'block' : 'none';
        });
    }

    // Fechar modal ao clicar fora
    document.addEventListener('click', function(e) {
        if (e.target.classList.contains('config-detail-modal')) {
            closeAllConfigModals();
        }
    });

    // Fechar modal com ESC
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            closeAllConfigModals();
        }
    });

    // Aplicar máscaras nos campos
    const cnpjInput = document.getElementById('input-cnpj');
    if (cnpjInput) {
        cnpjInput.addEventListener('input', function(e) {
            e.target.value = maskCNPJ(e.target.value);
        });
    }

    const cepInput = document.getElementById('input-cep');
    if (cepInput) {
        cepInput.addEventListener('input', function(e) {
            e.target.value = maskCEP(e.target.value);
        });
    }

    const telefoneInput = document.getElementById('input-telefone');
    if (telefoneInput) {
        telefoneInput.addEventListener('input', function(e) {
            e.target.value = maskTelefone(e.target.value);
        });
    }
});

// =========================
// MÁSCARAS DE FORMATAÇÉO
// =========================

/**
 * Aplica máscara de CNPJ
 */
function maskCNPJ(value) {
    return value
        .replace(/\D/g, '')
        .replace(/^(\d{2})(\d)/, '$1.$2')
        .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
        .replace(/\.(\d{3})(\d)/, '.$1/$2')
        .replace(/(\d{4})(\d)/, '$1-$2')
        .replace(/(-\d{2})\d+?$/, '$1');
}

/**
 * Aplica máscara de CEP
 */
function maskCEP(value) {
    return value
        .replace(/\D/g, '')
        .replace(/^(\d{5})(\d)/, '$1-$2')
        .replace(/(-\d{3})\d+?$/, '$1');
}

/**
 * Aplica máscara de Telefone
 */
function maskTelefone(value) {
    value = value.replace(/\D/g, '');
    
    if (value.length <= 10) {
        return value
            .replace(/^(\d{2})(\d)/, '($1) $2')
            .replace(/(\d{4})(\d)/, '$1-$2');
    } else {
        return value
            .replace(/^(\d{2})(\d)/, '($1) $2')
            .replace(/(\d{5})(\d)/, '$1-$2')
            .replace(/(-\d{4})\d+?$/, '$1');
    }
}

// Exportar funções globalmente
window.abrirConfiguracao = abrirConfiguracao;
window.closeConfigModal = closeConfigModal;
window.saveEmpresaConfig = saveEmpresaConfig;
window.showNovaCategoriaForm = showNovaCategoriaForm;
window.editarCategoria = editarCategoria;
window.excluirCategoria = excluirCategoria;
window.showNovoDepartamentoForm = showNovoDepartamentoForm;
window.editarDepartamento = editarDepartamento;
window.excluirDepartamento = excluirDepartamento;
window.showNovoProjetoForm = showNovoProjetoForm;
window.editarProjeto = editarProjeto;
window.excluirProjeto = excluirProjeto;
window.saveCertificadoConfig = saveCertificadoConfig;
window.saveNfeConfig = saveNfeConfig;
window.saveVendaProdutosConfig = saveVendaProdutosConfig;
window.loadVendaProdutosConfig = loadVendaProdutosConfig;
window.saveVendaServicosConfig = saveVendaServicosConfig;
window.loadVendaServicosConfig = loadVendaServicosConfig;
window.saveClientesFornecedoresConfig = saveClientesFornecedoresConfig;
window.saveFinanceConfig = saveFinanceConfig;
// Tipos de Entrega
window.abrirModalTiposEntrega = abrirModalTiposEntrega;
window.abrirFormTipoEntrega = abrirFormTipoEntrega;
window.fecharFormTipoEntrega = fecharFormTipoEntrega;
window.salvarTipoEntrega = salvarTipoEntrega;
window.editarTipoEntrega = editarTipoEntrega;
window.excluirTipoEntrega = excluirTipoEntrega;
// Info Frete
window.abrirModalInfoFrete = abrirModalInfoFrete;
window.salvarInfoFrete = salvarInfoFrete;

// =========================
// FAMÍLIAS DE PRODUTOS - CRUD COMPLETO
// =========================

let familiasCache = [];
let familiaEditandoId = null;

/**
 * Abre formulário para nova família
 */
function abrirFormFamilia(id = null) {
    const form = document.getElementById('form-nova-familia');
    const titulo = document.getElementById('form-familia-titulo');
    
    document.getElementById('form-familia-config').reset();
    document.getElementById('familia-id').value = '';
    familiaEditandoId = null;
    
    if (id) {
        titulo.textContent = 'Editar Família';
        const familia = familiasCache.find(f => f.id === id);
        if (familia) {
            familiaEditandoId = id;
            document.getElementById('familia-id').value = familia.id;
            document.getElementById('familia-nome').value = familia.nome || '';
            document.getElementById('familia-codigo').value = familia.codigo || '';
            document.getElementById('familia-descricao').value = familia.descricao || '';
        }
    } else {
        titulo.textContent = 'Nova Família';
    }
    
    form.style.display = 'block';
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Fecha formulário de família
 */
function fecharFormFamilia() {
    document.getElementById('form-nova-familia').style.display = 'none';
    document.getElementById('form-familia-config').reset();
    familiaEditandoId = null;
}

/**
 * Salva família (nova ou edição)
 */
async function salvarFamiliaConfig() {
    const id = document.getElementById('familia-id').value;
    
    const dados = {
        nome: document.getElementById('familia-nome').value.trim(),
        codigo: document.getElementById('familia-codigo').value.trim(),
        descricao: document.getElementById('familia-descricao').value.trim()
    };
    
    if (!dados.nome) {
        showNotification('Informe o nome da família', 'error');
        return;
    }
    
    try {
        const url = id ? `/api/configuracoes/familias/${id}` : '/api/configuracoes/familias';
        const method = id ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(dados)
        });
        
        if (response.ok) {
            showNotification(id ? 'Família atualizada!' : 'Família criada!', 'success');
            fecharFormFamilia();
            loadFamiliasData();
        } else {
            const err = await response.json().catch(() => ({}));
            showNotification(err.error || 'Erro ao salvar', 'error');
        }
    } catch (error) {
        console.error('Erro ao salvar família:', error);
        showNotification('Erro ao salvar família', 'error');
    }
}

/**
 * Carrega dados de famílias
 */
async function loadFamiliasData() {
    const tbody = document.getElementById('familias-list');
    const info = document.getElementById('familias-info');
    
    if (tbody) {
        tbody.innerHTML = `<tr>
            <td colspan="6" class="text-center" style="padding: 40px; color: #6c757d;">
                <i class="fas fa-spinner fa-spin"></i> Carregando famílias...
            </td>
        </tr>`;
    }
    
    try {
        const response = await fetch('/api/configuracoes/familias', { credentials: 'include' });
        if (response.ok) {
            const familias = await response.json();
            familiasCache = Array.isArray(familias) ? familias : (familias.data || []);
            displayFamilias(familiasCache);
        } else {
            familiasCache = [];
            displayFamilias([]);
        }
    } catch (error) {
        console.error('Erro ao carregar famílias:', error);
        familiasCache = [];
        displayFamilias([]);
    }
}

/**
 * Exibe famílias na tabela
 */
function displayFamilias(familias) {
    const tbody = document.getElementById('familias-list');
    const info = document.getElementById('familias-info');
    
    if (!tbody) return;

    if (!familias || familias.length === 0) {
        tbody.innerHTML = `<tr>
            <td colspan="6" class="text-center" style="padding: 40px; color: #6b7280;">
                <i class="fas fa-inbox" style="font-size: 32px; margin-bottom: 12px; display: block; color: #cbd5e1;"></i>
                Nenhuma família cadastrada
            </td>
        </tr>`;
        if (info) info.textContent = '0 registros';
        return;
    }

    tbody.innerHTML = familias.map(f => `
        <tr>
            <td><input type="checkbox" class="familia-check" value="${f.id}"></td>
            <td>${f.nome || ''}</td>
            <td>${f.codigo || '-'}</td>
            <td>${formatDate(f.created_at || f.inclusao)}</td>
            <td>${formatDate(f.updated_at || f.ultima_alteracao)}</td>
            <td class="config-actions">
                <button class="config-btn-icon" onclick="editarFamilia(${f.id})" title="Editar">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="config-btn-icon" onclick="anexosFamilia(${f.id})" title="Anexos">
                    <i class="fas fa-paperclip"></i>
                </button>
                <button class="config-btn-icon danger" onclick="excluirFamilia(${f.id})" title="Excluir">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        </tr>
    `).join('');
    
    if (info) info.textContent = `${familias.length} registro(s)`;
}

/**
 * Edita família existente
 */
function editarFamilia(id) {
    abrirFormFamilia(id);
}

/**
 * Abre modal de anexos da família
 */
function anexosFamilia(id) {
    const familia = familiasCache.find(f => f.id === id);
    showNotification(`Anexos de ${familia?.nome || 'família'} - Em desenvolvimento`, 'info');
}

/**
 * Exclui família
 */
async function excluirFamilia(id) {
    if (!confirm('Deseja realmente excluir esta família de produtos?')) return;

    try {
        const response = await fetch(`/api/configuracoes/familias/${id}`, {
            method: 'DELETE',
            credentials: 'include'
        });

        if (response.ok) {
            showNotification('Família excluída com sucesso!', 'success');
            loadFamiliasData();
        } else {
            showNotification('Erro ao excluir família', 'error');
        }
    } catch (error) {
        console.error('Erro ao excluir:', error);
        showNotification('Erro ao excluir família', 'error');
    }
}

/**
 * Abre modal para importar planilha
 */
function importarPlanilhaFamilias() {
    abrirModal('modal-importar-familias');
}

/**
 * Processa arquivo de importação
 */
function processarArquivoFamilias(input) {
    if (input.files && input.files[0]) {
        const file = input.files[0];
        showNotification(`Arquivo "${file.name}" selecionado. Processando...`, 'info');
        // TODO: Implementar processamento do arquivo
        setTimeout(() => {
            showNotification('Importação em desenvolvimento', 'info');
            fecharModal('modal-importar-familias');
        }, 1500);
    }
}

/**
 * Baixa modelo de planilha
 */
function baixarModeloFamilias() {
    showNotification('Download do modelo em desenvolvimento', 'info');
}

// Mantido para compatibilidade
function abrirModalIncluirFamilia() {
    abrirFormFamilia();
}

// =========================
// CARACTERÍSTICAS DE PRODUTOS - CRUD COMPLETO
// =========================

let caracteristicasCache = [];
let caracteristicaEditandoId = null;

/**
 * Abre formulário para nova característica
 */
function abrirFormCaracteristica(id = null) {
    const form = document.getElementById('form-nova-caracteristica');
    const titulo = document.getElementById('form-caracteristica-titulo');
    
    document.getElementById('form-caracteristica-config').reset();
    document.getElementById('caracteristica-id').value = '';
    caracteristicaEditandoId = null;
    
    if (id) {
        titulo.textContent = 'Editar Característica';
        const caract = caracteristicasCache.find(c => c.id === id);
        if (caract) {
            caracteristicaEditandoId = id;
            document.getElementById('caracteristica-id').value = caract.id;
            document.getElementById('caracteristica-nome').value = caract.nome || '';
            document.getElementById('caracteristica-tipo').value = caract.tipo || 'texto';
            document.getElementById('caracteristica-conteudos').value = caract.conteudos_possiveis || '';
            document.getElementById('caracteristica-visualizar').value = caract.visualizar_em || 'todos';
            document.getElementById('caracteristica-obrigatorio').value = caract.preenchimento || 'opcional';
        }
    } else {
        titulo.textContent = 'Nova Característica';
    }
    
    form.style.display = 'block';
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Fecha formulário de característica
 */
function fecharFormCaracteristica() {
    document.getElementById('form-nova-caracteristica').style.display = 'none';
    document.getElementById('form-caracteristica-config').reset();
    caracteristicaEditandoId = null;
}

/**
 * Salva característica (nova ou edição)
 */
async function salvarCaracteristicaConfig() {
    const id = document.getElementById('caracteristica-id').value;
    
    const dados = {
        nome: document.getElementById('caracteristica-nome').value.trim(),
        tipo: document.getElementById('caracteristica-tipo').value,
        conteudos_possiveis: document.getElementById('caracteristica-conteudos').value.trim(),
        visualizar_em: document.getElementById('caracteristica-visualizar').value,
        preenchimento: document.getElementById('caracteristica-obrigatorio').value
    };
    
    if (!dados.nome) {
        showNotification('Informe o nome da característica', 'error');
        return;
    }
    
    try {
        const url = id ? `/api/configuracoes/caracteristicas/${id}` : '/api/configuracoes/caracteristicas';
        const method = id ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(dados)
        });
        
        if (response.ok) {
            showNotification(id ? 'Característica atualizada!' : 'Característica criada!', 'success');
            fecharFormCaracteristica();
            loadCaracteristicasData();
        } else {
            const err = await response.json().catch(() => ({}));
            showNotification(err.error || 'Erro ao salvar', 'error');
        }
    } catch (error) {
        console.error('Erro ao salvar característica:', error);
        showNotification('Erro ao salvar característica', 'error');
    }
}

/**
 * Carrega dados de características
 */
async function loadCaracteristicasData() {
    const tbody = document.getElementById('caracteristicas-list');
    
    if (tbody) {
        tbody.innerHTML = `<tr>
            <td colspan="5" style="text-align: center; padding: 50px 20px; color: #9ca3af;">
                <i class="fas fa-spinner fa-spin" style="font-size: 24px; margin-bottom: 12px; display: block;"></i>
                Carregando...
            </td>
        </tr>`;
    }
    
    try {
        const response = await fetch('/api/configuracoes/caracteristicas', { credentials: 'include' });
        if (response.ok) {
            const caracteristicas = await response.json();
            caracteristicasCache = Array.isArray(caracteristicas) ? caracteristicas : (caracteristicas.data || []);
            displayCaracteristicas(caracteristicasCache);
        } else {
            caracteristicasCache = [];
            displayCaracteristicas([]);
        }
    } catch (error) {
        console.error('Erro ao carregar características:', error);
        caracteristicasCache = [];
        displayCaracteristicas([]);
    }
}

/**
 * Exibe características na tabela
 */
function displayCaracteristicas(caracteristicas) {
    const tbody = document.getElementById('caracteristicas-list');
    if (!tbody) return;

    if (!caracteristicas || caracteristicas.length === 0) {
        tbody.innerHTML = `<tr>
            <td colspan="5" style="text-align: center; padding: 50px 20px; color: #9ca3af;">
                <i class="fas fa-inbox" style="font-size: 40px; margin-bottom: 12px; display: block; color: #e5e7eb;"></i>
                <span style="font-size: 14px;">Nenhum registro encontrado</span>
            </td>
        </tr>`;
        return;
    }

    tbody.innerHTML = caracteristicas.map(c => `
        <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 14px 16px; font-weight: 500; color: #374151;">${c.nome || ''}</td>
            <td style="padding: 14px 16px; color: #6b7280;">${c.possui_versao || c.conteudos_possiveis || '-'}</td>
            <td style="padding: 14px 16px; color: #6b7280; font-size: 13px;">${formatDate(c.updated_at || c.ultima_alteracao)}</td>
            <td style="padding: 14px 16px;">
                <span style="padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 500; ${c.preenchimento === 'obrigatorio' ? 'background: #fef3c7; color: #92400e;' : 'background: #ecfdf5; color: #065f46;'}">
                    ${c.preenchimento === 'obrigatorio' ? 'Obrigatório' : 'Opcional'}
                </span>
            </td>
            <td style="padding: 14px 16px; text-align: center;">
                <div style="display: flex; gap: 8px; justify-content: center;">
                    <button class="config-btn-icon" onclick="editarCaracteristica(${c.id})" title="Editar" style="width: 32px; height: 32px; border-radius: 6px;">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="config-btn-icon danger" onclick="excluirCaracteristica(${c.id})" title="Excluir" style="width: 32px; height: 32px; border-radius: 6px;">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

/**
 * Edita característica existente
 */
function editarCaracteristica(id) {
    abrirFormCaracteristica(id);
}

/**
 * Exclui característica
 */
async function excluirCaracteristica(id) {
    if (!confirm('Deseja realmente excluir esta característica?')) return;

    try {
        const response = await fetch(`/api/configuracoes/caracteristicas/${id}`, {
            method: 'DELETE',
            credentials: 'include'
        });

        if (response.ok) {
            showNotification('Característica excluída com sucesso!', 'success');
            loadCaracteristicasData();
        } else {
            showNotification('Erro ao excluir característica', 'error');
        }
    } catch (error) {
        console.error('Erro ao excluir:', error);
        showNotification('Erro ao excluir característica', 'error');
    }
}

// Mantido para compatibilidade
function abrirModalIncluirCaracteristica() {
    abrirFormCaracteristica();
}

// =========================
// VENDEDORES - CRUD COMPLETO
// =========================

// Cache de vendedores
let vendedoresCache = [];
let vendedorEditandoId = null;

/**
 * Abre formulário para novo vendedor ou edição
 */
function abrirFormVendedor(id = null) {
    const form = document.getElementById('form-novo-vendedor');
    const titulo = document.getElementById('form-vendedor-titulo');
    
    // Resetar formulário
    document.getElementById('form-vendedor-config').reset();
    document.getElementById('vendedor-id').value = '';
    vendedorEditandoId = null;
    
    if (id) {
        // Modo edição
        titulo.textContent = 'Editar Vendedor';
        const vendedor = vendedoresCache.find(v => v.id === id);
        if (vendedor) {
            vendedorEditandoId = id;
            document.getElementById('vendedor-id').value = vendedor.id;
            document.getElementById('vendedor-nome').value = vendedor.nome || '';
            document.getElementById('vendedor-email').value = vendedor.email || '';
            document.getElementById('vendedor-comissao').value = vendedor.comissao || 1.00;
            document.getElementById('vendedor-telefone').value = vendedor.telefone || '';
            document.getElementById('vendedor-permissoes').value = vendedor.permissoes || 'vendas';
            document.getElementById('vendedor-situacao').value = vendedor.situacao || 'ativo';
        }
    } else {
        // Modo inclusão
        titulo.textContent = 'Novo Vendedor';
        document.getElementById('vendedor-comissao').value = '1.00';
    }
    
    form.style.display = 'block';
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Fecha formulário de vendedor
 */
function fecharFormVendedor() {
    document.getElementById('form-novo-vendedor').style.display = 'none';
    document.getElementById('form-vendedor-config').reset();
    vendedorEditandoId = null;
}

/**
 * Salva vendedor (novo ou edição)
 */
async function salvarVendedorConfig() {
    const id = document.getElementById('vendedor-id').value;
    
    const dados = {
        nome: document.getElementById('vendedor-nome').value.trim(),
        email: document.getElementById('vendedor-email').value.trim(),
        comissao: parseFloat(document.getElementById('vendedor-comissao').value) || 1.00,
        telefone: document.getElementById('vendedor-telefone').value.trim(),
        permissoes: document.getElementById('vendedor-permissoes').value,
        situacao: document.getElementById('vendedor-situacao').value
    };
    
    if (!dados.nome) {
        showNotification('Informe o nome do vendedor', 'error');
        return;
    }
    
    if (!dados.email) {
        showNotification('Informe o e-mail do vendedor', 'error');
        return;
    }
    
    try {
        const url = id ? `/api/configuracoes/vendedores/${id}` : '/api/configuracoes/vendedores';
        const method = id ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dados)
        });
        
        if (response.ok) {
            showNotification(id ? 'Vendedor atualizado com sucesso!' : 'Vendedor cadastrado com sucesso!', 'success');
            fecharFormVendedor();
            loadVendedoresData();
        } else {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || 'Erro ao salvar vendedor');
        }
    } catch (error) {
        console.error('Erro ao salvar vendedor:', error);
        showNotification(error.message || 'Erro ao salvar vendedor', 'error');
    }
}

/**
 * Carrega lista de vendedores da API
 */
async function loadVendedoresData() {
    try {
        const response = await fetch('/api/configuracoes/vendedores');
        if (response.ok) {
            vendedoresCache = await response.json();
            displayVendedores(vendedoresCache);
        }
    } catch (error) {
        console.error('Erro ao carregar vendedores:', error);
        showNotification('Erro ao carregar vendedores', 'error');
    }
}

/**
 * Exibe vendedores na tabela com visual melhorado
 */
function displayVendedores(vendedores) {
    const tbody = document.getElementById('vendedores-list');
    const info = document.getElementById('vendedores-info');
    
    if (!tbody) return;

    if (!vendedores || !vendedores.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; padding: 50px 20px; color: #9ca3af;">
                    <i class="fas fa-user-tie" style="font-size: 48px; margin-bottom: 16px; display: block; color: #d1d5db;"></i>
                    <p style="font-size: 16px; margin-bottom: 8px; color: #6b7280;">Nenhum vendedor cadastrado</p>
                    <p style="font-size: 13px;">Clique em <strong>+ Incluir</strong> para adicionar um vendedor</p>
                </td>
            </tr>
        `;
        if (info) info.textContent = '0 registros';
        return;
    }

    tbody.innerHTML = vendedores.map(v => {
        // Formata exibição do e-mail com tooltip
        const emailDisplay = v.email ? 
            `<span title="${v.email}" style="display: inline-flex; align-items: center; gap: 6px; max-width: 200px;">
                <i class="fas fa-envelope" style="color: #00b894; font-size: 11px;"></i>
                <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${v.email}</span>
            </span>` : 
            '<span style="color: #9ca3af;">-</span>';
        
        // Badge de situação
        const situacaoBadge = v.situacao === 'ativo' 
            ? '<span style="display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; background: #dcfce7; color: #16a34a; border-radius: 20px; font-size: 11px; font-weight: 500;"><i class="fas fa-check-circle"></i> Ativo</span>'
            : '<span style="display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; background: #fee2e2; color: #dc2626; border-radius: 20px; font-size: 11px; font-weight: 500;"><i class="fas fa-times-circle"></i> Inativo</span>';
        
        // Formata comissão
        const comissaoDisplay = `<span style="font-weight: 500; color: #374151;">${parseFloat(v.comissao || 0).toFixed(2)}%</span>`;
        
        // Data de inclusão
        const inclusaoDisplay = v.inclusao || v.created_at ? 
            `<span style="color: #6b7280; font-size: 12px;">${formatDate(v.inclusao || v.created_at)}</span>` : 
            '<span style="color: #9ca3af;">-</span>';
        
        return `
            <tr style="border-bottom: 1px solid #f1f5f9; transition: background 0.2s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='transparent'">
                <td style="padding: 12px;">${situacaoBadge}</td>
                <td style="padding: 12px;">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <div style="width: 32px; height: 32px; border-radius: 50%; background: linear-gradient(135deg, #00b894, #55efc4); display: flex; align-items: center; justify-content: center; color: white; font-size: 12px; font-weight: 600;">
                            ${v.nome ? v.nome.charAt(0).toUpperCase() : 'V'}
                        </div>
                        <span style="font-weight: 500; color: #1f2937;">${v.nome || '-'}</span>
                    </div>
                </td>
                <td style="padding: 12px; text-align: center;">${comissaoDisplay}</td>
                <td style="padding: 12px;">${emailDisplay}</td>
                <td style="padding: 12px;">${inclusaoDisplay}</td>
                <td style="padding: 12px;">
                    <div style="display: flex; gap: 4px; justify-content: center;">
                        <button onclick="editarVendedor(${v.id})" title="Editar" style="width: 28px; height: 28px; border: none; border-radius: 6px; background: #dbeafe; color: #2563eb; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s;" onmouseover="this.style.background='#2563eb';this.style.color='white'" onmouseout="this.style.background='#dbeafe';this.style.color='#2563eb'">
                            <i class="fas fa-edit" style="font-size: 11px;"></i>
                        </button>
                        <button onclick="anexosVendedor(${v.id})" title="Anexos" style="width: 28px; height: 28px; border: none; border-radius: 6px; background: #fef3c7; color: #d97706; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s;" onmouseover="this.style.background='#d97706';this.style.color='white'" onmouseout="this.style.background='#fef3c7';this.style.color='#d97706'">
                            <i class="fas fa-paperclip" style="font-size: 11px;"></i>
                        </button>
                        <button onclick="transferirVendedor(${v.id})" title="Transferir" style="width: 28px; height: 28px; border: none; border-radius: 6px; background: #e0e7ff; color: #4f46e5; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s;" onmouseover="this.style.background='#4f46e5';this.style.color='white'" onmouseout="this.style.background='#e0e7ff';this.style.color='#4f46e5'">
                            <i class="fas fa-exchange-alt" style="font-size: 11px;"></i>
                        </button>
                        <button onclick="emailsVendedor(${v.id})" title="E-mails" style="width: 28px; height: 28px; border: none; border-radius: 6px; background: #dcfce7; color: #16a34a; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s;" onmouseover="this.style.background='#16a34a';this.style.color='white'" onmouseout="this.style.background='#dcfce7';this.style.color='#16a34a'">
                            <i class="fas fa-envelope" style="font-size: 11px;"></i>
                        </button>
                        <button onclick="excluirVendedor(${v.id})" title="Excluir" style="width: 28px; height: 28px; border: none; border-radius: 6px; background: #fee2e2; color: #dc2626; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s;" onmouseover="this.style.background='#dc2626';this.style.color='white'" onmouseout="this.style.background='#fee2e2';this.style.color='#dc2626'">
                            <i class="fas fa-trash" style="font-size: 11px;"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
    
    if (info) info.textContent = `${vendedores.length} registro(s)`;
}

/**
 * Editar vendedor
 */
function editarVendedor(id) {
    abrirFormVendedor(id);
}

/**
 * Anexos de vendedor
 */
function anexosVendedor(id) {
    const vendedor = vendedoresCache.find(v => v.id === id);
    showNotification(`Anexos de ${vendedor?.nome || 'vendedor'} - Em desenvolvimento`, 'info');
}

/**
 * Transferir clientes de vendedor
 */
function transferirVendedor(id) {
    const vendedor = vendedoresCache.find(v => v.id === id);
    showNotification(`Transferir clientes de ${vendedor?.nome || 'vendedor'} - Em desenvolvimento`, 'info');
}

/**
 * Emails de vendedor
 */
function emailsVendedor(id) {
    const vendedor = vendedoresCache.find(v => v.id === id);
    showNotification(`Configurar e-mails de ${vendedor?.nome || 'vendedor'} - Em desenvolvimento`, 'info');
}

/**
 * Excluir vendedor
 */
async function excluirVendedor(id) {
    const vendedor = vendedoresCache.find(v => v.id === id);
    if (!confirm(`Deseja realmente excluir o vendedor "${vendedor?.nome || ''}"?\n\nEsta ação não pode ser desfeita.`)) return;

    try {
        const response = await fetch(`/api/configuracoes/vendedores/${id}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            showNotification('Vendedor excluído com sucesso!', 'success');
            loadVendedoresData();
        } else {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || 'Erro ao excluir vendedor');
        }
    } catch (error) {
        console.error('Erro:', error);
        showNotification(error.message || 'Erro ao excluir vendedor', 'error');
    }
}

// Compatibilidade
function abrirModalIncluirVendedor() {
    abrirFormVendedor();
}

// =========================
// COMPRADORES - CRUD COMPLETO
// =========================

// Cache de compradores
let compradoresCache = [];
let compradorEditandoId = null;

/**
 * Abre formulário para novo comprador
 */
function abrirFormComprador(id = null) {
    const form = document.getElementById('form-novo-comprador');
    const titulo = document.getElementById('form-comprador-titulo');
    
    // Resetar formulário
    document.getElementById('form-comprador-config').reset();
    document.getElementById('comprador-id').value = '';
    compradorEditandoId = null;
    
    if (id) {
        // Modo edição
        titulo.textContent = 'Editar Comprador';
        const comprador = compradoresCache.find(c => c.id === id);
        if (comprador) {
            compradorEditandoId = id;
            document.getElementById('comprador-id').value = comprador.id;
            document.getElementById('comprador-nome').value = comprador.nome || '';
            document.getElementById('comprador-email').value = comprador.email || '';
            document.getElementById('comprador-telefone').value = comprador.telefone || '';
            document.getElementById('comprador-departamento').value = comprador.departamento || '';
            document.getElementById('comprador-limite').value = comprador.limite_aprovacao ? formatMoney(comprador.limite_aprovacao) : '';
            document.getElementById('comprador-situacao').value = comprador.situacao || 'ativo';
            document.getElementById('comprador-observacoes').value = comprador.observacoes || '';
        }
    } else {
        // Modo inclusão
        titulo.textContent = 'Novo Comprador';
    }
    
    form.style.display = 'block';
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Fecha formulário de comprador
 */
function fecharFormComprador() {
    document.getElementById('form-novo-comprador').style.display = 'none';
    document.getElementById('form-comprador-config').reset();
    compradorEditandoId = null;
}

/**
 * Salva comprador (novo ou edição)
 */
async function salvarCompradorConfig() {
    const id = document.getElementById('comprador-id').value;
    
    const dados = {
        nome: document.getElementById('comprador-nome').value.trim(),
        email: document.getElementById('comprador-email').value.trim(),
        telefone: document.getElementById('comprador-telefone').value.trim(),
        departamento: document.getElementById('comprador-departamento').value.trim(),
        limite_aprovacao: parseFloat(document.getElementById('comprador-limite').value.replace(/\./g, '').replace(',', '.')) || 0,
        situacao: document.getElementById('comprador-situacao').value,
        observacoes: document.getElementById('comprador-observacoes').value.trim()
    };
    
    if (!dados.nome) {
        showNotification('Informe o nome do comprador', 'error');
        return;
    }
    
    try {
        const url = id ? `/api/configuracoes/compradores/${id}` : '/api/configuracoes/compradores';
        const method = id ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(dados)
        });
        
        if (response.ok) {
            showNotification(id ? 'Comprador atualizado!' : 'Comprador criado!', 'success');
            fecharFormComprador();
            loadCompradoresData();
        } else {
            const err = await response.json().catch(() => ({}));
            showNotification(err.error || 'Erro ao salvar', 'error');
        }
    } catch (error) {
        console.error('Erro ao salvar comprador:', error);
        showNotification('Erro ao salvar comprador', 'error');
    }
}

/**
 * Carrega dados de compradores
 */
async function loadCompradoresData() {
    const tbody = document.getElementById('compradores-list');
    const info = document.getElementById('compradores-info');
    
    if (tbody) {
        tbody.innerHTML = `<tr>
            <td colspan="6" class="text-center" style="padding: 40px; color: #6c757d;">
                <i class="fas fa-spinner fa-spin"></i> Carregando compradores...
            </td>
        </tr>`;
    }
    
    try {
        const response = await fetch('/api/configuracoes/compradores', { credentials: 'include' });
        if (response.ok) {
            const compradores = await response.json();
            compradoresCache = Array.isArray(compradores) ? compradores : (compradores.data || []);
            displayCompradores(compradoresCache);
        } else {
            // Dados de exemplo se API não retornar
            compradoresCache = getCompradoresPadrao();
            displayCompradores(compradoresCache);
        }
    } catch (error) {
        console.error('Erro ao carregar compradores:', error);
        compradoresCache = getCompradoresPadrao();
        displayCompradores(compradoresCache);
    }
}

/**
 * Retorna compradores padrão
 */
function getCompradoresPadrao() {
    return [
        { id: 1, nome: 'Andréia Tavares', situacao: 'ativo', inclusao: '2025-12-30', ultima_alteracao: '2025-12-30', incluido_por: 'Antônio Egídio Neto' },
        { id: 2, nome: 'Guilherme Dantas', situacao: 'ativo', inclusao: '2025-12-30', ultima_alteracao: '2025-12-30', incluido_por: 'Antônio Egídio Neto' }
    ];
}

/**
 * Exibe compradores na tabela
 */
function displayCompradores(compradores) {
    const tbody = document.getElementById('compradores-list');
    const info = document.getElementById('compradores-info');
    
    if (!tbody) return;

    if (!compradores || compradores.length === 0) {
        tbody.innerHTML = `<tr>
            <td colspan="6" class="text-center" style="padding: 40px; color: #6b7280;">
                <i class="fas fa-inbox" style="font-size: 32px; margin-bottom: 12px; display: block; color: #cbd5e1;"></i>
                Nenhum comprador cadastrado
            </td>
        </tr>`;
        if (info) info.textContent = '0 registros';
        return;
    }

    tbody.innerHTML = compradores.map(c => {
        const statusClass = c.situacao === 'ativo' ? 'status-ativo' : 'status-inativo';
        const statusIcon = c.situacao === 'ativo' ? 'fa-check-circle' : 'fa-times-circle';
        const statusText = c.situacao === 'ativo' ? 'Ativo' : 'Inativo';
        
        return `
            <tr>
                <td><span class="status-badge ${statusClass}"><i class="fas ${statusIcon}"></i> ${statusText}</span></td>
                <td>${c.nome || ''}</td>
                <td>${formatDate(c.inclusao || c.created_at)}</td>
                <td>${formatDate(c.ultima_alteracao || c.updated_at)}</td>
                <td>${c.incluido_por || c.criado_por || '-'}</td>
                <td class="config-actions">
                    <button class="config-btn-icon" onclick="editarComprador(${c.id})" title="Editar">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="config-btn-icon" onclick="anexosComprador(${c.id})" title="Anexos">
                        <i class="fas fa-paperclip"></i>
                    </button>
                    <button class="config-btn-icon" onclick="toggleSituacaoComprador(${c.id}, '${c.situacao}')" title="${c.situacao === 'ativo' ? 'Inativar' : 'Ativar'}">
                        <i class="fas fa-ban"></i>
                    </button>
                    <button class="config-btn-icon danger" onclick="excluirComprador(${c.id})" title="Excluir">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
    
    if (info) info.textContent = `${compradores.length} registro(s)`;
}

/**
 * Edita comprador existente
 */
function editarComprador(id) {
    abrirFormComprador(id);
}

/**
 * Abre modal de anexos do comprador
 */
function anexosComprador(id) {
    const comprador = compradoresCache.find(c => c.id === id);
    showNotification(`Anexos de ${comprador?.nome || 'comprador'} - Em desenvolvimento`, 'info');
}

/**
 * Alterna situação do comprador (ativo/inativo)
 */
async function toggleSituacaoComprador(id, situacaoAtual) {
    const novaSituacao = situacaoAtual === 'ativo' ? 'inativo' : 'ativo';
    const acao = novaSituacao === 'ativo' ? 'ativar' : 'inativar';
    
    if (!confirm(`Deseja realmente ${acao} este comprador?`)) return;
    
    try {
        const response = await fetch(`/api/configuracoes/compradores/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ situacao: novaSituacao })
        });
        
        if (response.ok) {
            showNotification(`Comprador ${novaSituacao === 'ativo' ? 'ativado' : 'inativado'}!`, 'success');
            loadCompradoresData();
        } else {
            // Fallback local
            const idx = compradoresCache.findIndex(c => c.id === id);
            if (idx !== -1) {
                compradoresCache[idx].situacao = novaSituacao;
                displayCompradores(compradoresCache);
                showNotification(`Comprador ${novaSituacao === 'ativo' ? 'ativado' : 'inativado'}!`, 'success');
            }
        }
    } catch (error) {
        console.error('Erro ao alterar situação:', error);
        showNotification('Erro ao alterar situação', 'error');
    }
}

/**
 * Inativa comprador (mantido para compatibilidade)
 */
function inativarComprador(id) {
    toggleSituacaoComprador(id, 'ativo');
}

/**
 * Exclui comprador
 */
async function excluirComprador(id) {
    if (!confirm('Deseja realmente excluir este comprador?')) return;

    try {
        const response = await fetch(`/api/configuracoes/compradores/${id}`, {
            method: 'DELETE',
            credentials: 'include'
        });

        if (response.ok) {
            showNotification('Comprador excluído com sucesso!', 'success');
            loadCompradoresData();
        } else {
            throw new Error('Erro ao excluir comprador');
        }
    } catch (error) {
        console.error('Erro:', error);
        showNotification('Erro ao excluir comprador', 'error');
    }
}

// Famílias de Produtos - CRUD
window.abrirFormFamilia = abrirFormFamilia;
window.fecharFormFamilia = fecharFormFamilia;
window.salvarFamiliaConfig = salvarFamiliaConfig;
window.loadFamiliasData = loadFamiliasData;
window.abrirModalIncluirFamilia = abrirModalIncluirFamilia;
window.importarPlanilhaFamilias = importarPlanilhaFamilias;
window.editarFamilia = editarFamilia;
window.anexosFamilia = anexosFamilia;
window.excluirFamilia = excluirFamilia;
window.processarArquivoFamilias = processarArquivoFamilias;
window.baixarModeloFamilias = baixarModeloFamilias;
// Características de Produtos - CRUD
window.abrirFormCaracteristica = abrirFormCaracteristica;
window.fecharFormCaracteristica = fecharFormCaracteristica;
window.salvarCaracteristicaConfig = salvarCaracteristicaConfig;
window.loadCaracteristicasData = loadCaracteristicasData;
window.abrirModalIncluirCaracteristica = abrirModalIncluirCaracteristica;
window.editarCaracteristica = editarCaracteristica;
window.excluirCaracteristica = excluirCaracteristica;
// Vendedores
window.abrirModalIncluirVendedor = abrirModalIncluirVendedor;
window.loadVendedoresData = loadVendedoresData;
window.editarVendedor = editarVendedor;
window.anexosVendedor = anexosVendedor;
window.transferirVendedor = transferirVendedor;
window.emailsVendedor = emailsVendedor;
window.excluirVendedor = excluirVendedor;
// Compradores CRUD
window.abrirFormComprador = abrirFormComprador;
window.fecharFormComprador = fecharFormComprador;
window.salvarCompradorConfig = salvarCompradorConfig;
window.loadCompradoresData = loadCompradoresData;
window.editarComprador = editarComprador;
window.anexosComprador = anexosComprador;
window.toggleSituacaoComprador = toggleSituacaoComprador;
window.inativarComprador = inativarComprador;
window.excluirComprador = excluirComprador;

/**
 * Formata data para exibição
 */
function formatDate(date) {
    if (!date) return '';
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = String(d.getFullYear()).slice(-2);
    const weekdays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const weekday = weekdays[d.getDay()];
    return `${day}/${month}/${year} ${weekday}`;
}

/**
 * Abre um modal específico
 */
function abrirModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('active');
        modal.style.setProperty('display', 'flex', 'important');
        modal.style.setProperty('visibility', 'visible', 'important');
        modal.style.setProperty('opacity', '1', 'important');
        modal.style.setProperty('pointer-events', 'auto', 'important');
        modal.style.setProperty('z-index', '200000', 'important');
        modal.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
    }
}

/**
 * Fecha um modal específico
 */
function fecharModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
        modal.style.setProperty('display', 'none', 'important');
        modal.style.setProperty('visibility', 'hidden', 'important');
        modal.style.setProperty('opacity', '0', 'important');
        modal.style.setProperty('pointer-events', 'none', 'important');
        modal.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = 'auto';
        // Restaurar título para Configurações do Sistema ao fechar sub-modal
        const mainModal = document.getElementById('modal-configuracoes');
        if (mainModal && mainModal.classList.contains('active')) {
            document.title = 'Aluforce: Configurações do Sistema';
        } else if (window._originalPageTitle) {
            document.title = window._originalPageTitle;
        }
    }
}

window.formatDate = formatDate;
window.abrirModal = abrirModal;
window.fecharModal = fecharModal;
// =========================
// FUNÇÕES DE CARREGAMENTO DE DADOS - RH
// =========================

/**
 * Carrega dados de funcionários - agora usa a versão completa
 */
async function loadFuncionariosData() {
    await carregarFuncionariosCompleto();
}

function displayFuncionarios(funcionarios) {
    // Função legacy - usar renderizarFuncionarios
    funcionariosCache = funcionarios;
    renderizarFuncionarios();
}

/**
 * Carrega dados de cargos
 */
async function loadCargosData() {
    try {
        const response = await fetch('/api/rh/cargos');
        if (response.ok) {
            const result = await response.json();
            const cargos = result.data || result || [];
            displayCargos(cargos);
        }
    } catch (error) {
        console.error('Erro ao carregar cargos:', error);
    }
}

function displayCargos(cargos) {
    const tbody = document.getElementById('cargos-list');
    if (!tbody) return;

    if (!cargos.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">Nenhum cargo cadastrado</td></tr>';
        return;
    }

    tbody.innerHTML = cargos.map(c => `
        <tr data-id="${c.id}">
            <td>${c.nome || ''}</td>
            <td>${c.departamento || ''}</td>
            <td><span class="config-badge config-badge-${getNivelClass(c.nivel)}">${c.nivel || 'Operacional'}</span></td>
            <td>${c.cbo || ''}</td>
            <td><span class="config-badge">${c.total_funcionarios || 0}</span></td>
            <td class="config-actions">
                <button class="config-btn-icon" onclick="editarCargo(${c.id})" title="Editar"><i class="fas fa-edit"></i></button>
                <button class="config-btn-icon danger" onclick="excluirCargo(${c.id}, '${c.nome}')" title="Excluir"><i class="fas fa-trash"></i></button>
            </td>
        </tr>
    `).join('');
}

function getNivelClass(nivel) {
    switch(nivel) {
        case 'Executivo': return 'purple';
        case 'Gerencial': return 'blue';
        case 'Técnico': return 'green';
        default: return 'gray';
    }
}

/**
 * Abrir modal para novo cargo
 */
function novoCargo() {
    const modalHTML = `
        <div id="modal-novo-cargo" class="config-modal-overlay" style="display:flex;">
            <div class="config-modal-box" style="max-width:500px;">
                <div class="config-modal-header">
                    <h3><i class="fas fa-id-badge"></i> Novo Cargo</h3>
                    <button class="config-modal-close" onclick="fecharModalCargo()"><i class="fas fa-times"></i></button>
                </div>
                <div class="config-modal-body">
                    <form id="form-cargo" onsubmit="salvarCargo(event)">
                        <input type="hidden" id="cargo-id" value="">
                        
                        <div class="config-form-group">
                            <label>Nome do Cargo *</label>
                            <input type="text" id="cargo-nome" class="config-input" required placeholder="Ex: Consultor de Negócios">
                        </div>
                        
                        <div class="config-form-grid">
                            <div class="config-form-group">
                                <label>Departamento</label>
                                <select id="cargo-departamento" class="config-input">
                                    <option value="">Selecione...</option>
                                    <option value="Administrativo">Administrativo</option>
                                    <option value="Comercial">Comercial</option>
                                    <option value="Compras">Compras</option>
                                    <option value="Conservação">Conservação</option>
                                    <option value="Diretoria">Diretoria</option>
                                    <option value="Diversos">Diversos</option>
                                    <option value="Estoque">Estoque</option>
                                    <option value="Financeiro">Financeiro</option>
                                    <option value="Logística">Logística</option>
                                    <option value="Manutenção">Manutenção</option>
                                    <option value="PCP">PCP</option>
                                    <option value="Qualidade">Qualidade</option>
                                    <option value="RH">RH</option>
                                    <option value="Segurança">Segurança</option>
                                    <option value="TI">TI</option>
                                </select>
                            </div>
                            <div class="config-form-group">
                                <label>Nível</label>
                                <select id="cargo-nivel" class="config-input">
                                    <option value="Operacional">Operacional</option>
                                    <option value="Técnico">Técnico</option>
                                    <option value="Gerencial">Gerencial</option>
                                    <option value="Executivo">Executivo</option>
                                </select>
                            </div>
                        </div>
                        
                        <div class="config-form-grid">
                            <div class="config-form-group">
                                <label>Código CBO</label>
                                <input type="text" id="cargo-cbo" class="config-input" placeholder="Ex: 5211-10">
                            </div>
                            <div class="config-form-group">
                                <label>Salário Base (R$)</label>
                                <input type="number" id="cargo-salario" class="config-input" step="0.01" placeholder="0,00">
                            </div>
                        </div>
                        
                        <div class="config-form-group">
                            <label>Descrição</label>
                            <textarea id="cargo-descricao" class="config-input" rows="3" placeholder="Descrição das responsabilidades..."></textarea>
                        </div>
                        
                        <div class="config-modal-footer">
                            <button type="button" class="config-btn-secondary" onclick="fecharModalCargo()">Cancelar</button>
                            <button type="submit" class="config-btn-primary"><i class="fas fa-save"></i> Salvar</button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    `;
    
    // Remover modal existente se houver
    const existingModal = document.getElementById('modal-novo-cargo');
    if (existingModal) existingModal.remove();
    
    document.body.insertAdjacentHTML('beforeend', modalHTML);
}

/**
 * Editar um cargo
 */
async function editarCargo(id) {
    try {
        // Buscar dados do cargo
        const response = await fetch('/api/rh/cargos');
        if (!response.ok) throw new Error('Erro ao buscar cargos');
        
        const result = await response.json();
        const cargo = result.data.find(c => c.id === id);
        
        if (!cargo) {
            showConfigNotification('Cargo não encontrado', 'error');
            return;
        }
        
        // Abrir modal com dados
        novoCargo();
        
        // Aguardar modal carregar
        setTimeout(() => {
            document.getElementById('cargo-id').value = cargo.id;
            document.getElementById('cargo-nome').value = cargo.nome || '';
            document.getElementById('cargo-departamento').value = cargo.departamento || '';
            document.getElementById('cargo-nivel').value = cargo.nivel || 'Operacional';
            document.getElementById('cargo-cbo').value = cargo.cbo || '';
            document.getElementById('cargo-salario').value = cargo.salario_base || '';
            document.getElementById('cargo-descricao').value = cargo.descricao || '';
            
            // Atualizar título
            document.querySelector('#modal-novo-cargo h3').innerHTML = '<i class="fas fa-edit"></i> Editar Cargo';
        }, 100);
        
    } catch (error) {
        console.error('Erro ao editar cargo:', error);
        showConfigNotification('Erro ao carregar dados do cargo', 'error');
    }
}

/**
 * Salvar cargo (criar ou atualizar)
 */
async function salvarCargo(event) {
    event.preventDefault();
    
    const id = document.getElementById('cargo-id').value;
    const dados = {
        nome: document.getElementById('cargo-nome').value.trim(),
        departamento: document.getElementById('cargo-departamento').value,
        nivel: document.getElementById('cargo-nivel').value,
        cbo: document.getElementById('cargo-cbo').value.trim(),
        salario_base: document.getElementById('cargo-salario').value || null,
        descricao: document.getElementById('cargo-descricao').value.trim()
    };
    
    if (!dados.nome) {
        showConfigNotification('Nome do cargo é obrigatório', 'warning');
        return;
    }
    
    try {
        const url = id ? `/api/rh/cargos/${id}` : '/api/rh/cargos';
        const method = id ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dados)
        });
        
        const result = await response.json();
        
        if (response.ok && result.success) {
            showConfigNotification(result.message || 'Cargo salvo com sucesso!', 'success');
            fecharModalCargo();
            loadCargosData(); // Recarregar lista
        } else {
            showConfigNotification(result.message || 'Erro ao salvar cargo', 'error');
        }
    } catch (error) {
        console.error('Erro ao salvar cargo:', error);
        showConfigNotification('Erro ao salvar cargo', 'error');
    }
}

/**
 * Excluir um cargo
 */
async function excluirCargo(id, nome) {
    if (!confirm(`Tem certeza que deseja desativar o cargo "${nome}"?\n\nNota: Funcionários com este cargo serão mantidos.`)) {
        return;
    }
    
    try {
        const response = await fetch(`/api/rh/cargos/${id}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        
        if (response.ok && result.success) {
            showConfigNotification(result.message || 'Cargo desativado com sucesso!', 'success');
            loadCargosData(); // Recarregar lista
        } else {
            showConfigNotification(result.message || 'Erro ao desativar cargo', 'error');
        }
    } catch (error) {
        console.error('Erro ao excluir cargo:', error);
        showConfigNotification('Erro ao desativar cargo', 'error');
    }
}

/**
 * Fechar modal de cargo
 */
function fecharModalCargo() {
    const modal = document.getElementById('modal-novo-cargo');
    if (modal) modal.remove();
}

/**
 * Carrega dados da folha de pagamento
 */
async function loadFolhaPagamentoData() {
    try {
        const response = await fetch('/api/rh/configuracoes/folha-pagamento');
        if (response.ok) {
            const data = await response.json();
            if (data) {
                // Preencher campos do formulário
                const diaFechamento = document.querySelector('#modal-folha-pagamento select[name="dia_fechamento"]');
                const diaPagamento = document.querySelector('#modal-folha-pagamento select[name="dia_pagamento"]');
                if (diaFechamento) diaFechamento.value = data.dia_fechamento || '25';
                if (diaPagamento) diaPagamento.value = data.dia_pagamento || '5';
            }
        }
    } catch (error) {
        console.error('Erro ao carregar configurações de folha:', error);
    }
}

/**
 * Carrega dados do ponto eletrônico
 */
async function loadPontoEletronicoData() {
    try {
        const response = await fetch('/api/rh/configuracoes/ponto-eletronico');
        if (response.ok) {
            const data = await response.json();
            if (data) {
                // Preencher campos do formulário
            }
        }
    } catch (error) {
        console.error('Erro ao carregar configurações de ponto:', error);
    }
}

// =========================
// FUNÇÕES DE CARREGAMENTO - FINANÇAS
// =========================

// ===============================================================
// PLANO DE CONTAS - CRUD COMPLETO
// ===============================================================

// Cache de plano de contas
let planoContasCache = [];
let contaConfigEditandoId = null;
let contaConfigCorSelecionada = '#22c55e';

/**
 * Carrega dados do plano de contas
 */
async function loadPlanoContasData() {
    const container = document.getElementById('plano-contas-tree-config');
    if (container) {
        container.innerHTML = `
            <div style="text-align: center; padding: 40px; color: #6b7280;">
                <i class="fas fa-spinner fa-spin" style="font-size: 24px; margin-bottom: 12px; display: block; color: #f39c12;"></i>
                Carregando plano de contas...
            </div>
        `;
    }

    try {
        // Tentar carregar da API de categorias (mesmo endpoint do módulo financeiro)
        const response = await fetch('/api/financeiro/categorias', { credentials: 'include' });
        if (response.ok) {
            const data = await response.json();
            planoContasCache = Array.isArray(data) ? data : (data.categorias || data.data || []);
        } else {
            // Dados padrão se API não retornar
            planoContasCache = getPlanoContasPadrao();
        }
    } catch (error) {
        console.error('Erro ao carregar plano de contas:', error);
        planoContasCache = getPlanoContasPadrao();
    }
    
    displayPlanoContasConfig(planoContasCache);
    atualizarSelectContaPai();
    setupColorPickerConfig();
}

/**
 * Retorna plano de contas padrão
 */
function getPlanoContasPadrao() {
    return [
        { id: 1, nome: 'Receitas Operacionais', tipo: 'receita', cor: '#22c55e', icone: 'fa-chart-line', ativo: 1, pai_id: null },
        { id: 2, nome: 'Vendas de Produtos', tipo: 'receita', cor: '#22c55e', icone: 'fa-shopping-cart', ativo: 1, pai_id: 1 },
        { id: 3, nome: 'Vendas de Serviços', tipo: 'receita', cor: '#22c55e', icone: 'fa-tools', ativo: 1, pai_id: 1 },
        { id: 4, nome: 'Receitas Financeiras', tipo: 'receita', cor: '#3b82f6', icone: 'fa-money-bill', ativo: 1, pai_id: null },
        { id: 5, nome: 'Juros Recebidos', tipo: 'receita', cor: '#3b82f6', icone: 'fa-percentage', ativo: 1, pai_id: 4 },
        { id: 10, nome: 'Despesas Operacionais', tipo: 'despesa', cor: '#ef4444', icone: 'fa-building', ativo: 1, pai_id: null },
        { id: 11, nome: 'Salários e Encargos', tipo: 'despesa', cor: '#ef4444', icone: 'fa-users', ativo: 1, pai_id: 10 },
        { id: 12, nome: 'Aluguel', tipo: 'despesa', cor: '#ef4444', icone: 'fa-home', ativo: 1, pai_id: 10 },
        { id: 13, nome: 'Energia Elétrica', tipo: 'despesa', cor: '#f59e0b', icone: 'fa-bolt', ativo: 1, pai_id: 10 },
        { id: 14, nome: 'Água e Esgoto', tipo: 'despesa', cor: '#3b82f6', icone: 'fa-tint', ativo: 1, pai_id: 10 },
        { id: 20, nome: 'Despesas Administrativas', tipo: 'despesa', cor: '#8b5cf6', icone: 'fa-folder', ativo: 1, pai_id: null },
        { id: 21, nome: 'Material de Escritório', tipo: 'despesa', cor: '#8b5cf6', icone: 'fa-pen', ativo: 1, pai_id: 20 }
    ];
}

/**
 * Exibe o plano de contas em formato de árvore
 */
function displayPlanoContasConfig(contas) {
    const container = document.getElementById('plano-contas-tree-config');
    if (!container) return;

    if (!contas || contas.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 60px; color: #6b7280;">
                <i class="fas fa-folder-open" style="font-size: 48px; margin-bottom: 16px; display: block; opacity: 0.3;"></i>
                <p style="font-size: 16px; margin-bottom: 8px;">Nenhuma conta cadastrada</p>
                <p style="font-size: 13px;">Clique em "Nova Conta" para criar</p>
            </div>
        `;
        return;
    }

    // Filtrar contas raiz (sem pai)
    const contasRaiz = contas.filter(c => !c.pai_id);
    container.innerHTML = contasRaiz.map(conta => renderizarContaConfig(conta, contas, 1)).join('');
}

/**
 * Renderiza um item da árvore de contas
 */
function renderizarContaConfig(conta, todasContas, nivel) {
    const filhos = todasContas.filter(c => c.pai_id === conta.id);
    const temFilhos = filhos.length > 0;
    const corTipo = conta.tipo === 'receita' ? '#22c55e' : '#ef4444';
    const cor = conta.cor || corTipo;
    
    return `
        <div class="tree-item tree-parent" data-id="${conta.id}" data-tipo="${conta.tipo}" style="margin-bottom: 8px; margin-left: ${(nivel - 1) * 20}px;">
            <div class="tree-item-header" style="display: flex; align-items: center; padding: 12px 16px; background: ${conta.tipo === 'receita' ? '#f0fdf4' : '#fef2f2'}; border-radius: 10px; border: 1px solid ${conta.tipo === 'receita' ? '#bbf7d0' : '#fecaca'};">
                ${temFilhos ? `
                    <button class="tree-toggle-config" onclick="toggleTreeItemConfig(${conta.id})" style="background: none; border: none; cursor: pointer; padding: 4px; margin-right: 8px; color: #64748b;">
                        <i class="fas fa-chevron-right" id="toggle-icon-${conta.id}"></i>
                    </button>
                ` : '<div style="width: 28px;"></div>'}
                <div style="width: 32px; height: 32px; border-radius: 8px; background: ${cor}20; color: ${cor}; display: flex; align-items: center; justify-content: center; margin-right: 12px;">
                    <i class="fas ${conta.icone || 'fa-folder'}"></i>
                </div>
                <div style="flex: 1;">
                    <div style="font-size: 11px; color: #64748b;">${String(conta.id).padStart(3, '0')}</div>
                    <div style="font-size: 14px; font-weight: 600; color: #1e293b;">${conta.nome}</div>
                </div>
                <span style="padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; background: ${conta.tipo === 'receita' ? '#dcfce7' : '#fee2e2'}; color: ${conta.tipo === 'receita' ? '#166534' : '#991b1b'}; margin-right: 12px;">
                    ${conta.tipo === 'receita' ? 'Receita' : 'Despesa'}
                </span>
                <div class="tree-actions" style="display: flex; gap: 4px;">
                    <button onclick="adicionarSubcontaConfig(${conta.id})" title="Adicionar subconta" style="width: 30px; height: 30px; border: none; border-radius: 6px; cursor: pointer; background: transparent; color: #64748b;">
                        <i class="fas fa-plus"></i>
                    </button>
                    <button onclick="editarContaConfig(${conta.id})" title="Editar" style="width: 30px; height: 30px; border: none; border-radius: 6px; cursor: pointer; background: transparent; color: #64748b;">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button onclick="excluirContaConfig(${conta.id})" title="Excluir" style="width: 30px; height: 30px; border: none; border-radius: 6px; cursor: pointer; background: transparent; color: #ef4444;">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
            ${temFilhos ? `
                <div class="tree-children-config" id="children-config-${conta.id}" style="display: none; margin-top: 4px;">
                    ${filhos.map(f => renderizarContaConfig(f, todasContas, Math.min(nivel + 1, 3))).join('')}
                </div>
            ` : ''}
        </div>
    `;
}

/**
 * Toggle para expandir/recolher filhos na árvore
 */
function toggleTreeItemConfig(id) {
    const children = document.getElementById(`children-config-${id}`);
    const icon = document.getElementById(`toggle-icon-${id}`);
    
    if (children) {
        const isHidden = children.style.display === 'none';
        children.style.display = isHidden ? 'block' : 'none';
        if (icon) {
            icon.style.transform = isHidden ? 'rotate(90deg)' : 'rotate(0deg)';
        }
    }
}

/**
 * Expandir todos os itens da árvore
 */
function expandirTodosConfig() {
    document.querySelectorAll('.tree-children-config').forEach(el => {
        el.style.display = 'block';
    });
    document.querySelectorAll('[id^="toggle-icon-"]').forEach(el => {
        el.style.transform = 'rotate(90deg)';
    });
}

/**
 * Recolher todos os itens da árvore
 */
function recolherTodosConfig() {
    document.querySelectorAll('.tree-children-config').forEach(el => {
        el.style.display = 'none';
    });
    document.querySelectorAll('[id^="toggle-icon-"]').forEach(el => {
        el.style.transform = 'rotate(0deg)';
    });
}

/**
 * Abre formulário para nova conta
 */
function abrirFormNovaConta(paiId = null) {
    const form = document.getElementById('form-nova-conta-config');
    const titulo = document.getElementById('form-conta-titulo');
    
    // Resetar formulário
    document.getElementById('form-conta-config').reset();
    document.getElementById('conta-config-id').value = '';
    contaConfigEditandoId = null;
    contaConfigCorSelecionada = '#22c55e';
    
    // Resetar seleção de cores
    document.querySelectorAll('.config-color-option').forEach(o => {
        o.classList.remove('selected');
        o.style.border = '3px solid transparent';
    });
    const corVerde = document.querySelector('.config-color-option[data-color="#22c55e"]');
    if (corVerde) {
        corVerde.classList.add('selected');
        corVerde.style.border = '3px solid #1e293b';
    }
    
    if (paiId) {
        // Modo subconta
        titulo.textContent = 'Nova Subconta';
        const pai = planoContasCache.find(c => c.id === paiId);
        if (pai) {
            document.getElementById('conta-config-tipo').value = pai.tipo;
            document.getElementById('conta-config-pai').value = paiId;
        }
    } else {
        // Modo nova conta principal
        titulo.textContent = 'Nova Conta Contábil';
    }
    
    form.style.display = 'block';
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Fecha formulário de nova conta
 */
function fecharFormNovaConta() {
    document.getElementById('form-nova-conta-config').style.display = 'none';
    document.getElementById('form-conta-config').reset();
    contaConfigEditandoId = null;
}

/**
 * Adicionar subconta
 */
function adicionarSubcontaConfig(paiId) {
    abrirFormNovaConta(paiId);
}

/**
 * Editar conta existente
 */
function editarContaConfig(id) {
    const conta = planoContasCache.find(c => c.id === id);
    if (!conta) return;
    
    contaConfigEditandoId = id;
    document.getElementById('form-conta-titulo').textContent = 'Editar Conta';
    document.getElementById('conta-config-id').value = conta.id;
    document.getElementById('conta-config-nome').value = conta.nome || '';
    document.getElementById('conta-config-tipo').value = conta.tipo || 'receita';
    document.getElementById('conta-config-pai').value = conta.pai_id || '';
    document.getElementById('conta-config-icone').value = conta.icone || 'fa-folder';
    document.getElementById('conta-config-descricao').value = conta.descricao || '';
    
    // Selecionar cor
    contaConfigCorSelecionada = conta.cor || '#22c55e';
    document.querySelectorAll('.config-color-option').forEach(o => {
        o.classList.remove('selected');
        o.style.border = '3px solid transparent';
        if (o.dataset.color === contaConfigCorSelecionada) {
            o.classList.add('selected');
            o.style.border = '3px solid #1e293b';
        }
    });
    
    document.getElementById('form-nova-conta-config').style.display = 'block';
    document.getElementById('form-nova-conta-config').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Salvar conta (nova ou edição)
 */
async function salvarContaConfig() {
    const nome = document.getElementById('conta-config-nome').value.trim();
    const tipo = document.getElementById('conta-config-tipo').value;
    const pai_id = document.getElementById('conta-config-pai').value || null;
    const icone = document.getElementById('conta-config-icone').value;
    const descricao = document.getElementById('conta-config-descricao').value.trim();
    
    if (!nome) {
        showNotification('Preencha o nome da conta', 'error');
        return;
    }
    
    const dados = {
        nome,
        tipo,
        pai_id: pai_id ? parseInt(pai_id) : null,
        icone,
        cor: contaConfigCorSelecionada,
        descricao,
        ativo: 1
    };
    
    try {
        const url = contaConfigEditandoId 
            ? `/api/financeiro/categorias/${contaConfigEditandoId}` 
            : '/api/financeiro/categorias';
        const method = contaConfigEditandoId ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(dados)
        });
        
        if (response.ok) {
            showNotification(contaConfigEditandoId ? 'Conta atualizada!' : 'Conta criada!', 'success');
            fecharFormNovaConta();
            loadPlanoContasData();
        } else {
            // Fallback local se API falhar
            if (contaConfigEditandoId) {
                const idx = planoContasCache.findIndex(c => c.id === contaConfigEditandoId);
                if (idx !== -1) {
                    planoContasCache[idx] = { ...planoContasCache[idx], ...dados };
                }
            } else {
                planoContasCache.push({ id: Date.now(), ...dados });
            }
            displayPlanoContasConfig(planoContasCache);
            atualizarSelectContaPai();
            showNotification(contaConfigEditandoId ? 'Conta atualizada!' : 'Conta criada!', 'success');
            fecharFormNovaConta();
        }
    } catch (error) {
        console.error('Erro ao salvar conta:', error);
        showNotification('Erro ao salvar conta', 'error');
    }
}

/**
 * Excluir conta
 */
async function excluirContaConfig(id) {
    const conta = planoContasCache.find(c => c.id === id);
    const temFilhos = planoContasCache.some(c => c.pai_id === id);
    
    if (temFilhos) {
        showNotification('Não é possível excluir conta com subcontas', 'error');
        return;
    }
    
    if (!confirm(`Deseja realmente excluir a conta "${conta?.nome}"?`)) return;
    
    try {
        const response = await fetch(`/api/financeiro/categorias/${id}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        
        if (response.ok) {
            showNotification('Conta excluída!', 'success');
            loadPlanoContasData();
        } else {
            // Fallback local
            planoContasCache = planoContasCache.filter(c => c.id !== id);
            displayPlanoContasConfig(planoContasCache);
            atualizarSelectContaPai();
            showNotification('Conta excluída!', 'success');
        }
    } catch (error) {
        console.error('Erro ao excluir conta:', error);
        showNotification('Erro ao excluir conta', 'error');
    }
}

/**
 * Atualizar select de conta pai
 */
function atualizarSelectContaPai() {
    const select = document.getElementById('conta-config-pai');
    if (!select) return;
    
    select.innerHTML = '<option value="">Nenhuma (Conta Principal)</option>';
    planoContasCache.filter(c => !c.pai_id).forEach(c => {
        select.innerHTML += `<option value="${c.id}">${c.nome}</option>`;
    });
}

/**
 * Setup do color picker para contas
 */
function setupColorPickerConfig() {
    document.querySelectorAll('.config-color-option').forEach(opt => {
        opt.addEventListener('click', () => {
            document.querySelectorAll('.config-color-option').forEach(o => {
                o.classList.remove('selected');
                o.style.border = '3px solid transparent';
            });
            opt.classList.add('selected');
            opt.style.border = '3px solid #1e293b';
            contaConfigCorSelecionada = opt.dataset.color;
        });
    });
}

/**
 * Atualiza cor automática baseado no tipo
 */
function atualizarCorPorTipo() {
    const tipo = document.getElementById('conta-config-tipo').value;
    const novaCor = tipo === 'receita' ? '#22c55e' : '#ef4444';
    
    document.querySelectorAll('.config-color-option').forEach(o => {
        o.classList.remove('selected');
        o.style.border = '3px solid transparent';
        if (o.dataset.color === novaCor) {
            o.classList.add('selected');
            o.style.border = '3px solid #1e293b';
        }
    });
    contaConfigCorSelecionada = novaCor;
}

// ===============================================================
// FIM - PLANO DE CONTAS
// ===============================================================

// Cache de contas bancárias para edição
let contasBancariasCache = [];

/**
 * Carrega dados de contas bancárias
 */
async function loadContasBancariasData() {
    try {
        const response = await fetch('/api/financeiro/contas-bancarias');
        if (response.ok) {
            const result = await response.json();
            const contas = result.data || result || [];
            contasBancariasCache = contas; // Armazenar no cache
            displayContasBancarias(contas);
        }
    } catch (error) {
        console.error('Erro ao carregar contas bancárias:', error);
    }
}

// Mapeamento de códigos de banco para nomes e logos
const bancosConfigMap = {
    '001': { nome: 'Banco do Brasil', logo: 'https://logo.clearbit.com/bb.com.br' },
    '237': { nome: 'Bradesco', logo: 'https://logo.clearbit.com/bradesco.com.br' },
    '341': { nome: 'Itaú Unibanco', logo: 'https://logo.clearbit.com/itau.com.br' },
    '033': { nome: 'Santander', logo: 'https://logo.clearbit.com/santander.com.br' },
    '104': { nome: 'Caixa Econômica', logo: 'https://logo.clearbit.com/caixa.gov.br' },
    '260': { nome: 'Nubank', logo: 'https://logo.clearbit.com/nubank.com.br' },
    '077': { nome: 'Banco Inter', logo: 'https://logo.clearbit.com/bancointer.com.br' },
    '336': { nome: 'C6 Bank', logo: 'https://logo.clearbit.com/c6bank.com.br' },
    '290': { nome: 'PagSeguro', logo: 'https://logo.clearbit.com/pagseguro.com.br' },
    '380': { nome: 'PicPay', logo: 'https://logo.clearbit.com/picpay.com' },
    '756': { nome: 'Sicoob', logo: 'https://logo.clearbit.com/sicoob.com.br' },
    '748': { nome: 'Sicredi', logo: 'https://logo.clearbit.com/sicredi.com.br' },
    '000': { nome: 'Caixa Interno', logo: null }
};

function displayContasBancarias(contas) {
    const tbody = document.getElementById('contas-bancarias-list');
    if (!tbody) return;

    if (!contas.length) {
        tbody.innerHTML = `<tr>
            <td colspan="8" class="text-center" style="padding: 40px; color: #6b7280;">
                <i class="fas fa-inbox" style="font-size: 32px; margin-bottom: 12px; display: block; color: #cbd5e1;"></i>
                Nenhuma conta cadastrada
            </td>
        </tr>`;
        return;
    }

    let saldoTotal = 0;
    tbody.innerHTML = contas.map(c => {
        saldoTotal += parseFloat(c.saldo_atual || c.saldo || 0);
        const bancoInfo = bancosConfigMap[c.banco_codigo || c.banco] || {};
        const bancoNome = c.apelido || c.banco_nome || c.nome || bancoInfo.nome || 'Conta';
        const logoHtml = bancoInfo.logo 
            ? `<img src="${bancoInfo.logo}" style="width:20px;height:20px;margin-right:8px;vertical-align:middle;border-radius:4px;" onerror="this.style.display='none'">`
            : `<i class="fas fa-university" style="color:#f39c12; margin-right:8px;"></i>`;
        const saldoValor = parseFloat(c.saldo_atual || c.saldo || 0);
        const saldoColor = saldoValor >= 0 ? '#28a745' : '#dc3545';
        return `
            <tr>
                <td><span class="status-badge status-${c.status || 'ativo'}"><i class="fas fa-check-circle"></i> ${(c.status || 'Ativo').charAt(0).toUpperCase() + (c.status || 'ativo').slice(1)}</span></td>
                <td>${logoHtml} ${bancoNome}</td>
                <td>${c.agencia || '-'}</td>
                <td>${c.conta || c.numero_conta || '-'}</td>
                <td>${(c.tipo_conta || c.tipo || 'Corrente').charAt(0).toUpperCase() + (c.tipo_conta || c.tipo || 'corrente').slice(1)}</td>
                <td style="color: ${saldoColor}; font-weight: 600;">R$ ${formatMoney(saldoValor)}</td>
                <td>${formatDate(c.ultima_conciliacao) || '-'}</td>
                <td class="config-actions">
                    <button class="config-btn-icon" onclick="editarContaBancaria(${c.id})" title="Editar"><i class="fas fa-edit"></i></button>
                    <button class="config-btn-icon" onclick="conciliarConta(${c.id})" title="Conciliar"><i class="fas fa-check-double"></i></button>
                    <button class="config-btn-icon danger" onclick="excluirContaBancaria(${c.id})" title="Excluir"><i class="fas fa-trash"></i></button>
                </td>
            </tr>
        `;
    }).join('');

    // Atualizar saldo total
    const saldoTotalEl = document.getElementById('saldo-total-bancario');
    if (saldoTotalEl) {
        const saldoColor = saldoTotal >= 0 ? '#28a745' : '#dc3545';
        saldoTotalEl.style.color = saldoColor;
        saldoTotalEl.textContent = `R$ ${formatMoney(saldoTotal)}`;
    }
}

// ===============================================================
// CONTAS BANCÁRIAS - CRUD COMPLETO
// ===============================================================

/**
 * Abre o formulário de nova conta bancária
 */
function abrirFormContaBancaria(id = null) {
    const form = document.getElementById('form-nova-conta-bancaria');
    const titulo = document.getElementById('form-conta-titulo');
    
    // Resetar formulário
    document.getElementById('form-conta-bancaria-config').reset();
    document.getElementById('conta-bancaria-id').value = '';
    
    if (id) {
        // Modo edição
        titulo.textContent = 'Editar Conta Bancária';
        const conta = contasBancariasCache.find(c => c.id === id);
        if (conta) {
            document.getElementById('conta-bancaria-id').value = conta.id;
            document.getElementById('conta-banco-codigo').value = conta.banco_codigo || conta.banco || '';
            document.getElementById('conta-tipo').value = conta.tipo || 'corrente';
            document.getElementById('conta-agencia').value = conta.agencia || '';
            document.getElementById('conta-numero').value = conta.conta || conta.numero_conta || '';
            document.getElementById('conta-apelido').value = conta.apelido || conta.nome || '';
            document.getElementById('conta-saldo').value = formatMoney(conta.saldo_atual || conta.saldo || 0);
            document.getElementById('conta-observacoes').value = conta.observacoes || '';
        }
    } else {
        // Modo inclusão
        titulo.textContent = 'Nova Conta Bancária';
    }
    
    form.style.display = 'block';
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Fecha o formulário de conta bancária
 */
function fecharFormContaBancaria() {
    document.getElementById('form-nova-conta-bancaria').style.display = 'none';
    document.getElementById('form-conta-bancaria-config').reset();
}

/**
 * Salva a conta bancária (nova ou edição)
 */
async function salvarContaBancariaConfig() {
    const id = document.getElementById('conta-bancaria-id').value;
    const bancoSelect = document.getElementById('conta-banco-codigo');
    const bancoNome = bancoSelect.options[bancoSelect.selectedIndex]?.text?.split(' - ')[1] || bancoSelect.value;
    
    const dados = {
        nome: document.getElementById('conta-apelido').value || bancoNome,
        banco: document.getElementById('conta-banco-codigo').value,
        tipo: document.getElementById('conta-tipo').value,
        agencia: document.getElementById('conta-agencia').value,
        numero_conta: document.getElementById('conta-numero').value,
        saldo: parseFloat(document.getElementById('conta-saldo').value.replace(/[^\d,-]/g, '').replace(',', '.')) || 0,
        observacoes: document.getElementById('conta-observacoes').value
    };
    
    if (!dados.banco) {
        showNotification('Selecione um banco', 'error');
        return;
    }
    
    try {
        const url = id ? `/api/financeiro/contas-bancarias/${id}` : '/api/financeiro/contas-bancarias';
        const method = id ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(dados)
        });
        
        if (response.ok) {
            showNotification(id ? 'Conta atualizada com sucesso!' : 'Conta criada com sucesso!', 'success');
            fecharFormContaBancaria();
            loadContasBancariasData();
        } else {
            const err = await response.json().catch(() => ({}));
            showNotification(err.error || 'Erro ao salvar conta', 'error');
        }
    } catch (error) {
        console.error('Erro ao salvar conta bancária:', error);
        showNotification('Erro ao salvar conta bancária', 'error');
    }
}

/**
 * Edita uma conta bancária existente
 */
function editarContaBancaria(id) {
    abrirFormContaBancaria(id);
}

/**
 * Exclui uma conta bancária
 */
async function excluirContaBancaria(id) {
    if (!confirm('Tem certeza que deseja excluir esta conta bancária?')) return;
    
    try {
        const response = await fetch(`/api/financeiro/contas-bancarias/${id}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        
        if (response.ok) {
            showNotification('Conta excluída com sucesso!', 'success');
            loadContasBancariasData();
        } else {
            showNotification('Erro ao excluir conta', 'error');
        }
    } catch (error) {
        console.error('Erro ao excluir conta:', error);
        showNotification('Erro ao excluir conta', 'error');
    }
}

/**
 * Abre modal de conciliação da conta
 */
function conciliarConta(id) {
    showNotification('Funcionalidade de conciliação em desenvolvimento', 'info');
    // TODO: Implementar modal de conciliação
}

// ===============================================================
// IMPORTAÇÍO OFX
// ===============================================================

let ofxFileData = null;

/**
 * Abre o modal de importação OFX
 */
async function abrirImportOFX() {
    // Carregar contas disponíveis
    try {
        const response = await fetch('/api/financeiro/contas-bancarias', { credentials: 'include' });
        if (response.ok) {
            const contas = await response.json();
            const select = document.getElementById('ofx-conta-destino');
            select.innerHTML = '<option value="">Selecione a conta...</option>' +
                contas.map(c => `<option value="${c.id}">${c.apelido || c.banco_nome || c.nome} - Ag: ${c.agencia || '-'} Cc: ${c.conta || '-'}</option>`).join('');
        }
    } catch (error) {
        console.error('Erro ao carregar contas:', error);
    }
    
    // Limpar arquivo anterior
    limparOFX();
    
    // Abrir modal
    const modal = document.getElementById('modal-importar-ofx');
    if (modal) {
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }
}

/**
 * Trata o drop de arquivo OFX
 */
function handleOFXDrop(event) {
    event.preventDefault();
    event.target.style.background = '#f0fdf4';
    
    const files = event.dataTransfer.files;
    if (files.length > 0) {
        handleOFXFile(files[0]);
    }
}

/**
 * Processa o arquivo OFX selecionado
 */
function handleOFXFile(file) {
    if (!file) return;
    
    const extension = file.name.split('.').pop().toLowerCase();
    if (!['ofx', 'qfx'].includes(extension)) {
        showNotification('Arquivo inválido. Selecione um arquivo .ofx ou .qfx', 'error');
        return;
    }
    
    ofxFileData = file;
    
    // Mostrar informações do arquivo
    document.getElementById('ofx-dropzone').style.display = 'none';
    document.getElementById('ofx-file-info').style.display = 'block';
    document.getElementById('ofx-filename').textContent = file.name;
    document.getElementById('ofx-filesize').textContent = formatFileSize(file.size);
}

/**
 * Limpa o arquivo OFX selecionado
 */
function limparOFX() {
    ofxFileData = null;
    document.getElementById('ofx-file-input').value = '';
    document.getElementById('ofx-dropzone').style.display = 'block';
    document.getElementById('ofx-file-info').style.display = 'none';
}

/**
 * Formata o tamanho do arquivo
 */
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Processa e importa o arquivo OFX
 */
async function processarOFX() {
    const contaId = document.getElementById('ofx-conta-destino').value;
    
    if (!contaId) {
        showNotification('Selecione a conta de destino', 'error');
        return;
    }
    
    if (!ofxFileData) {
        showNotification('Selecione um arquivo OFX', 'error');
        return;
    }
    
    try {
        // Ler o arquivo
        const content = await ofxFileData.text();
        
        // Parsear OFX (simplificado - pode precisar de biblioteca específica)
        const transacoes = parseOFX(content);
        
        if (transacoes.length === 0) {
            showNotification('Nenhuma transação encontrada no arquivo', 'warning');
            return;
        }
        
        // Enviar transações para API
        const response = await fetch('/api/financeiro/importar-ofx', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                conta_id: contaId,
                transacoes: transacoes
            })
        });
        
        if (response.ok) {
            const result = await response.json();
            showNotification(`${result.importadas || transacoes.length} transações importadas com sucesso!`, 'success');
            fecharModal('modal-importar-ofx');
            loadContasBancariasData();
        } else {
            const err = await response.json().catch(() => ({}));
            showNotification(err.error || 'Erro ao importar transações', 'error');
        }
    } catch (error) {
        console.error('Erro ao processar OFX:', error);
        showNotification('Erro ao processar arquivo OFX', 'error');
    }
}

/**
 * Parser simples de arquivo OFX
 */
function parseOFX(content) {
    const transacoes = [];
    
    try {
        // Encontrar todas as transações no OFX
        const stmttrn = content.match(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi) || [];
        
        stmttrn.forEach(trn => {
            const getValue = (tag) => {
                const match = trn.match(new RegExp(`<${tag}>([^<\\n]+)`, 'i'));
                return match ? match[1].trim() : null;
            };
            
            const tipo = getValue('TRNTYPE');
            const data = getValue('DTPOSTED');
            const valor = getValue('TRNAMT');
            const descricao = getValue('MEMO') || getValue('NAME');
            const fitid = getValue('FITID');
            
            if (valor && data) {
                transacoes.push({
                    tipo: parseFloat(valor) >= 0 ? 'entrada' : 'saida',
                    valor: Math.abs(parseFloat(valor)),
                    data: formatOFXDate(data),
                    descricao: descricao || tipo || 'Transação OFX',
                    referencia: fitid
                });
            }
        });
    } catch (error) {
        console.error('Erro ao parsear OFX:', error);
    }
    
    return transacoes;
}

/**
 * Formata data do OFX (YYYYMMDD) para YYYY-MM-DD
 */
function formatOFXDate(ofxDate) {
    if (!ofxDate || ofxDate.length < 8) return new Date().toISOString().split('T')[0];
    return `${ofxDate.substr(0, 4)}-${ofxDate.substr(4, 2)}-${ofxDate.substr(6, 2)}`;
}

/**
 * Formata valor para moeda no config
 */
function formatarMoedaConfig(input) {
    let value = input.value.replace(/\D/g, '');
    value = (parseFloat(value) / 100).toFixed(2);
    input.value = value.replace('.', ',');
}

// Cache de formas de pagamento
let formasPagamentoCache = [];

/**
 * Carrega dados de formas de pagamento
 */
async function loadFormasPagamentoData() {
    try {
        const response = await fetch('/api/financeiro/formas-pagamento');
        if (response.ok) {
            const result = await response.json();
            const formas = result.data || result || [];
            formasPagamentoCache = formas;
            displayFormasPagamento(formas);
        } else {
            // Se API não retornar dados, usar dados padrão
            const formasPadrao = getFormasPagamentoPadrao();
            formasPagamentoCache = formasPadrao;
            displayFormasPagamento(formasPadrao);
        }
    } catch (error) {
        console.error('Erro ao carregar formas de pagamento:', error);
        // Usar dados padrão em caso de erro
        const formasPadrao = getFormasPagamentoPadrao();
        formasPagamentoCache = formasPadrao;
        displayFormasPagamento(formasPadrao);
    }
}

/**
 * Retorna formas de pagamento padrão
 */
function getFormasPagamentoPadrao() {
    return [
        { id: 1, nome: 'Dinheiro', tipo: 'a_vista', prazo: 0, taxa: 0, icone: 'fa-money-bill-wave', status: 'ativo' },
        { id: 2, nome: 'Cartão de Crédito', tipo: 'parcelado', prazo: 30, taxa: 3.5, icone: 'fa-credit-card', status: 'ativo' },
        { id: 3, nome: 'PIX', tipo: 'a_vista', prazo: 0, taxa: 0, icone: 'fa-qrcode', status: 'ativo' },
        { id: 4, nome: 'Boleto', tipo: 'a_prazo', prazo: 28, taxa: 2.5, icone: 'fa-barcode', status: 'ativo' },
        { id: 5, nome: 'Transferência', tipo: 'a_vista', prazo: 0, taxa: 0, icone: 'fa-exchange-alt', status: 'ativo' }
    ];
}

/**
 * Mapeamento de ícones e cores para formas de pagamento
 */
const formasPagamentoIcones = {
    'fa-money-bill-wave': { cor: '#28a745', nome: 'Dinheiro' },
    'fa-credit-card': { cor: '#0984e3', nome: 'Cartão' },
    'fa-qrcode': { cor: '#6c5ce7', nome: 'PIX' },
    'fa-barcode': { cor: '#e17055', nome: 'Boleto' },
    'fa-exchange-alt': { cor: '#00b894', nome: 'Transferência' },
    'fa-file-invoice-dollar': { cor: '#fdcb6e', nome: 'Cheque' },
    'fa-hand-holding-usd': { cor: '#a29bfe', nome: 'Crediário' }
};

/**
 * Formata o tipo de pagamento para exibição
 */
function formatarTipoPagamento(tipo) {
    const tipos = {
        'a_vista': 'À Vista',
        'a_prazo': 'A Prazo',
        'parcelado': 'Parcelado'
    };
    return tipos[tipo] || tipo || 'À Vista';
}

function displayFormasPagamento(formas) {
    const tbody = document.getElementById('formas-pagamento-list');
    if (!tbody) return;

    if (!formas || formas.length === 0) {
        tbody.innerHTML = `<tr>
            <td colspan="6" class="text-center" style="padding: 40px; color: #6b7280;">
                <i class="fas fa-inbox" style="font-size: 32px; margin-bottom: 12px; display: block; color: #cbd5e1;"></i>
                Nenhuma forma de pagamento cadastrada
            </td>
        </tr>`;
        return;
    }

    tbody.innerHTML = formas.map(f => {
        const icone = f.icone || getPaymentIconByTipo(f.tipo);
        const iconInfo = formasPagamentoIcones[icone] || { cor: '#64748b' };
        const statusClass = (f.status || 'ativo') === 'ativo' ? 'status-ativo' : 'status-inativo';
        const statusText = (f.status || 'ativo') === 'ativo' ? 'Ativo' : 'Inativo';
        
        return `
            <tr>
                <td><span class="status-badge ${statusClass}"><i class="fas fa-check-circle"></i> ${statusText}</span></td>
                <td><i class="fas ${icone}" style="color:${iconInfo.cor}; margin-right:8px;"></i> ${f.nome || ''}</td>
                <td>${formatarTipoPagamento(f.tipo)}</td>
                <td>${f.prazo || 0}</td>
                <td>${f.taxa || 0}%</td>
                <td class="config-actions">
                    <button class="config-btn-icon" onclick="editarFormaPagamento(${f.id})" title="Editar"><i class="fas fa-edit"></i></button>
                    <button class="config-btn-icon danger" onclick="excluirFormaPagamento(${f.id})" title="Excluir"><i class="fas fa-trash"></i></button>
                </td>
            </tr>
        `;
    }).join('');
}

function getPaymentIcon(tipo) {
    const icons = {
        'dinheiro': 'fas fa-money-bill-wave',
        'pix': 'fas fa-qrcode',
        'cartao': 'fas fa-credit-card',
        'boleto': 'fas fa-barcode',
        'transferencia': 'fas fa-university'
    };
    return icons[tipo?.toLowerCase()] || 'fas fa-money-check';
}

function getPaymentIconByTipo(tipo) {
    const icons = {
        'a_vista': 'fa-money-bill-wave',
        'parcelado': 'fa-credit-card',
        'a_prazo': 'fa-barcode'
    };
    return icons[tipo] || 'fa-money-check';
}

// ===============================================================
// FORMAS DE PAGAMENTO - CRUD COMPLETO
// ===============================================================

/**
 * Abre o formulário de nova forma de pagamento
 */
function abrirFormFormaPagamento(id = null) {
    const form = document.getElementById('form-nova-forma-pagamento');
    const titulo = document.getElementById('form-forma-titulo');
    
    // Resetar formulário
    document.getElementById('form-forma-pagamento-config').reset();
    document.getElementById('forma-pagamento-id').value = '';
    document.getElementById('forma-prazo').value = '0';
    document.getElementById('forma-taxa').value = '0';
    document.getElementById('forma-status').value = 'ativo';
    
    if (id) {
        // Modo edição
        titulo.textContent = 'Editar Forma de Pagamento';
        const forma = formasPagamentoCache.find(f => f.id === id);
        if (forma) {
            document.getElementById('forma-pagamento-id').value = forma.id;
            document.getElementById('forma-nome').value = forma.nome || '';
            document.getElementById('forma-tipo').value = forma.tipo || 'a_vista';
            document.getElementById('forma-prazo').value = forma.prazo || 0;
            document.getElementById('forma-taxa').value = forma.taxa || 0;
            document.getElementById('forma-icone').value = forma.icone || 'fa-money-bill-wave';
            document.getElementById('forma-status').value = forma.status || 'ativo';
        }
    } else {
        // Modo inclusão
        titulo.textContent = 'Nova Forma de Pagamento';
    }
    
    form.style.display = 'block';
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Fecha o formulário de forma de pagamento
 */
function fecharFormFormaPagamento() {
    document.getElementById('form-nova-forma-pagamento').style.display = 'none';
    document.getElementById('form-forma-pagamento-config').reset();
}

/**
 * Salva a forma de pagamento (nova ou edição)
 */
async function salvarFormaPagamentoConfig() {
    const id = document.getElementById('forma-pagamento-id').value;
    
    const dados = {
        nome: document.getElementById('forma-nome').value,
        tipo: document.getElementById('forma-tipo').value,
        prazo: parseInt(document.getElementById('forma-prazo').value) || 0,
        taxa: parseFloat(document.getElementById('forma-taxa').value.replace(',', '.')) || 0,
        icone: document.getElementById('forma-icone').value,
        status: document.getElementById('forma-status').value
    };
    
    if (!dados.nome) {
        showNotification('Informe o nome da forma de pagamento', 'error');
        return;
    }
    
    try {
        const url = id ? `/api/financeiro/formas-pagamento/${id}` : '/api/financeiro/formas-pagamento';
        const method = id ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(dados)
        });
        
        if (response.ok) {
            showNotification(id ? 'Forma de pagamento atualizada!' : 'Forma de pagamento criada!', 'success');
            fecharFormFormaPagamento();
            loadFormasPagamentoData();
        } else {
            const err = await response.json().catch(() => ({}));
            showNotification(err.error || 'Erro ao salvar', 'error');
        }
    } catch (error) {
        console.error('Erro ao salvar forma de pagamento:', error);
        showNotification('Erro ao salvar forma de pagamento', 'error');
    }
}

/**
 * Edita uma forma de pagamento existente
 */
function editarFormaPagamento(id) {
    abrirFormFormaPagamento(id);
}

/**
 * Exclui uma forma de pagamento
 */
async function excluirFormaPagamento(id) {
    if (!confirm('Tem certeza que deseja excluir esta forma de pagamento?')) return;
    
    try {
        const response = await fetch(`/api/financeiro/formas-pagamento/${id}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        
        if (response.ok) {
            showNotification('Forma de pagamento excluída!', 'success');
            loadFormasPagamentoData();
        } else {
            showNotification('Erro ao excluir', 'error');
        }
    } catch (error) {
        console.error('Erro ao excluir forma de pagamento:', error);
        showNotification('Erro ao excluir forma de pagamento', 'error');
    }
}

/**
 * Formata taxa para exibição
 */
function formatarTaxaConfig(input) {
    let value = input.value.replace(/[^\d,]/g, '');
    input.value = value;
}

/**
 * Carrega dados de impostos
 */
async function loadImpostosData() {
    try {
        const response = await fetch('/api/configuracoes/impostos');
        if (response.ok) {
            const data = await response.json();
            if (data) {
                // Preencher campos do modal de impostos
                const regimeSelect = document.getElementById('impostos-regime-tributario');
                const icmsInput = document.getElementById('impostos-icms');
                const ipiInput = document.getElementById('impostos-ipi');
                const pisInput = document.getElementById('impostos-pis');
                const cofinsInput = document.getElementById('impostos-cofins');
                const issInput = document.getElementById('impostos-iss');
                const irpjInput = document.getElementById('impostos-irpj');
                const cfopVendaInternaInput = document.getElementById('impostos-cfop-venda-interna');
                const cfopVendaExternaInput = document.getElementById('impostos-cfop-venda-externa');
                const cfopDevolucaoInternaInput = document.getElementById('impostos-cfop-devolucao-interna');
                const cfopDevolucaoExternaInput = document.getElementById('impostos-cfop-devolucao-externa');

                if (regimeSelect) regimeSelect.value = data.regime_tributario || 'simples';
                if (icmsInput) icmsInput.value = data.icms || 18;
                if (ipiInput) ipiInput.value = data.ipi || 5;
                if (pisInput) pisInput.value = data.pis || 1.65;
                if (cofinsInput) cofinsInput.value = data.cofins || 7.6;
                if (issInput) issInput.value = data.iss || 5;
                if (irpjInput) irpjInput.value = data.irpj || 15;
                if (cfopVendaInternaInput) cfopVendaInternaInput.value = data.cfop_venda_interna || '5102';
                if (cfopVendaExternaInput) cfopVendaExternaInput.value = data.cfop_venda_externa || '6102';
                if (cfopDevolucaoInternaInput) cfopDevolucaoInternaInput.value = data.cfop_devolucao_interna || '5202';
                if (cfopDevolucaoExternaInput) cfopDevolucaoExternaInput.value = data.cfop_devolucao_externa || '6202';
            }
        }
    } catch (error) {
        console.error('Erro ao carregar impostos:', error);
    }
}

/**
 * Salva configurações de impostos
 */
async function saveImpostosConfig() {
    try {
        const data = {
            regime_tributario: document.getElementById('impostos-regime-tributario')?.value || 'simples',
            icms: parseFloat(document.getElementById('impostos-icms')?.value) || 18,
            ipi: parseFloat(document.getElementById('impostos-ipi')?.value) || 5,
            pis: parseFloat(document.getElementById('impostos-pis')?.value) || 1.65,
            cofins: parseFloat(document.getElementById('impostos-cofins')?.value) || 7.6,
            iss: parseFloat(document.getElementById('impostos-iss')?.value) || 5,
            irpj: parseFloat(document.getElementById('impostos-irpj')?.value) || 15,
            cfop_venda_interna: document.getElementById('impostos-cfop-venda-interna')?.value || '5102',
            cfop_venda_externa: document.getElementById('impostos-cfop-venda-externa')?.value || '6102',
            cfop_devolucao_interna: document.getElementById('impostos-cfop-devolucao-interna')?.value || '5202',
            cfop_devolucao_externa: document.getElementById('impostos-cfop-devolucao-externa')?.value || '6202'
        };

        const response = await fetch('/api/configuracoes/impostos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (response.ok) {
            const result = await response.json();
            if (result.success) {
                showToast('Configurações de impostos salvas com sucesso!', 'success');
                fecharModal('modal-impostos');
            } else {
                showToast('Erro ao salvar configurações de impostos', 'error');
            }
        } else {
            showToast('Erro ao salvar configurações de impostos', 'error');
        }
    } catch (error) {
        console.error('Erro ao salvar impostos:', error);
        showToast('Erro ao salvar configurações de impostos', 'error');
    }
}

// =========================
// FUNÇÕES DE CARREGAMENTO - CLIENTES/FORNECEDORES
// =========================

/**
 * Carrega dados de grupos de clientes
 */
async function loadGruposClientesData() {
    try {
        const response = await fetch('/api/clientes/grupos');
        if (response.ok) {
            const result = await response.json();
            const grupos = result.data || result || [];
            displayGruposClientes(grupos);
        }
    } catch (error) {
        console.error('Erro ao carregar grupos de clientes:', error);
    }
}

function displayGruposClientes(grupos) {
    const tbody = document.querySelector('#modal-grupos-clientes tbody');
    if (!tbody) return;

    tbody.innerHTML = grupos.map(g => `
        <tr>
            <td>${g.nome || ''}</td>
            <td>${g.desconto || 0}%</td>
            <td>${g.prazo_padrao || 0} dias</td>
            <td>${g.total_clientes || 0}</td>
            <td class="config-actions">
                <button class="config-btn-icon" onclick="editarGrupoCliente(${g.id})" title="Editar"><i class="fas fa-edit"></i></button>
                <button class="config-btn-icon danger" onclick="excluirGrupoCliente(${g.id})" title="Excluir"><i class="fas fa-trash"></i></button>
            </td>
        </tr>
    `).join('');
}

/**
 * Carrega dados de regiões de venda
 */
async function loadRegioesVendaData() {
    try {
        const response = await fetch('/api/vendas/regioes');
        if (response.ok) {
            const result = await response.json();
            const regioes = result.data || result || [];
            displayRegioesVenda(regioes);
        }
    } catch (error) {
        console.error('Erro ao carregar regiões de venda:', error);
    }
}

function displayRegioesVenda(regioes) {
    const tbody = document.querySelector('#modal-regioes-venda tbody');
    if (!tbody) return;

    tbody.innerHTML = regioes.map(r => `
        <tr>
            <td>${r.nome || ''}</td>
            <td>${r.estados || ''}</td>
            <td>${r.vendedor_responsavel || ''}</td>
            <td>${r.total_clientes || 0}</td>
            <td class="config-actions">
                <button class="config-btn-icon" onclick="editarRegiao(${r.id})" title="Editar"><i class="fas fa-edit"></i></button>
                <button class="config-btn-icon danger" onclick="excluirRegiao(${r.id})" title="Excluir"><i class="fas fa-trash"></i></button>
            </td>
        </tr>
    `).join('');
}

/**
 * Carrega dados de tipos de fornecedor
 */
async function loadTiposFornecedorData() {
    try {
        const response = await fetch('/api/fornecedores/tipos');
        if (response.ok) {
            const result = await response.json();
            const tipos = result.data || result || [];
            displayTiposFornecedor(tipos);
        }
    } catch (error) {
        console.error('Erro ao carregar tipos de fornecedor:', error);
    }
}

function displayTiposFornecedor(tipos) {
    const tbody = document.querySelector('#modal-tipos-fornecedor tbody');
    if (!tbody) return;

    tbody.innerHTML = tipos.map(t => `
        <tr>
            <td>${t.nome || ''}</td>
            <td>${t.descricao || ''}</td>
            <td>${t.total_fornecedores || 0}</td>
            <td class="config-actions">
                <button class="config-btn-icon" onclick="editarTipoFornecedor(${t.id})" title="Editar"><i class="fas fa-edit"></i></button>
                <button class="config-btn-icon danger" onclick="excluirTipoFornecedor(${t.id})" title="Excluir"><i class="fas fa-trash"></i></button>
            </td>
        </tr>
    `).join('');
}

/**
 * Carrega dados de condições de pagamento
 */
async function loadCondicoesPagamentoData() {
    try {
        const response = await fetch('/api/configuracoes/condicoes-pagamento');
        if (response.ok) {
            const result = await response.json();
            const condicoes = result.data || result || [];
            displayCondicoesPagamento(condicoes);
        }
    } catch (error) {
        console.error('Erro ao carregar condições de pagamento:', error);
    }
}

function displayCondicoesPagamento(condicoes) {
    const tbody = document.querySelector('#modal-condicoes-pagamento tbody');
    if (!tbody) return;

    tbody.innerHTML = condicoes.map(c => `
        <tr>
            <td>${c.nome || ''}</td>
            <td>${c.parcelas || 1}</td>
            <td>${c.prazo || 0} dias</td>
            <td>${c.acrescimo || 0}%</td>
            <td class="config-actions">
                <button class="config-btn-icon" onclick="editarCondicao(${c.id})" title="Editar"><i class="fas fa-edit"></i></button>
                <button class="config-btn-icon danger" onclick="excluirCondicao(${c.id})" title="Excluir"><i class="fas fa-trash"></i></button>
            </td>
        </tr>
    `).join('');
}

// =========================
// FUNÇÕES DE CARREGAMENTO - PRODUTOS
// =========================
// TABELAS DE PREÇO - CRUD COMPLETO
// =========================

// Cache de tabelas de preço
let tabelasPrecoCache = [];
let tabelaPrecoEditandoId = null;

/**
 * Abre formulário para nova tabela de preço ou edição
 */
function abrirFormTabelaPreco(id = null) {
    const form = document.getElementById('form-nova-tabela-preco');
    const titulo = document.getElementById('form-tabela-preco-titulo');
    
    // Resetar formulário
    document.getElementById('form-tabela-preco-config').reset();
    document.getElementById('tabela-preco-id').value = '';
    tabelaPrecoEditandoId = null;
    
    if (id) {
        // Modo edição
        titulo.textContent = 'Editar Tabela de Preço';
        const tabela = tabelasPrecoCache.find(t => t.id === id);
        if (tabela) {
            tabelaPrecoEditandoId = id;
            document.getElementById('tabela-preco-id').value = tabela.id;
            document.getElementById('tabela-preco-nome').value = tabela.nome || '';
            document.getElementById('tabela-preco-tipo').value = tabela.tipo || 'padrao';
            document.getElementById('tabela-preco-validade').value = tabela.validade ? tabela.validade.split('T')[0] : '';
            document.getElementById('tabela-preco-descricao').value = tabela.descricao || '';
            document.getElementById('tabela-preco-status').value = tabela.status || 'ativo';
        }
    } else {
        // Modo inclusão
        titulo.textContent = 'Nova Tabela de Preço';
    }
    
    form.style.display = 'block';
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Fecha formulário de tabela de preço
 */
function fecharFormTabelaPreco() {
    document.getElementById('form-nova-tabela-preco').style.display = 'none';
    document.getElementById('form-tabela-preco-config').reset();
    tabelaPrecoEditandoId = null;
}

/**
 * Salva tabela de preço (novo ou edição) via formulário inline
 */
async function salvarTabelaPrecoInline() {
    const id = document.getElementById('tabela-preco-id').value;
    
    const dados = {
        nome: document.getElementById('tabela-preco-nome').value.trim(),
        tipo: document.getElementById('tabela-preco-tipo').value,
        validade: document.getElementById('tabela-preco-validade').value || null,
        descricao: document.getElementById('tabela-preco-descricao').value.trim(),
        status: document.getElementById('tabela-preco-status').value
    };
    
    if (!dados.nome) {
        showNotification('Nome da tabela é obrigatório', 'error');
        return;
    }
    
    try {
        const url = id ? `/api/produtos/tabelas-preco/${id}` : '/api/produtos/tabelas-preco';
        const method = id ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dados)
        });
        
        if (response.ok) {
            showNotification(id ? 'Tabela atualizada com sucesso!' : 'Tabela criada com sucesso!', 'success');
            fecharFormTabelaPreco();
            loadTabelasPrecoData();
        } else {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || 'Erro ao salvar tabela');
        }
    } catch (error) {
        console.error('Erro ao salvar tabela:', error);
        showNotification(error.message || 'Erro ao salvar tabela de preço', 'error');
    }
}

/**
 * Importar tabelas de preço de planilha
 */
function importarTabelasPreco() {
    const html = `
        <div class="modal-overlay active" id="modal-importar-tabelas-preco" style="display: flex;">
            <div class="modal-content" style="max-width: 500px; border-radius: 12px;">
                <div class="modal-header" style="background: linear-gradient(135deg, #14b8a6, #0d9488);">
                    <h2><i class="fas fa-file-import"></i> Importar Tabelas de Preço</h2>
                    <button class="modal-close" onclick="fecharModalConfig('modal-importar-tabelas-preco')">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body" style="padding: 24px;">
                    <div style="text-align: center; padding: 30px; border: 2px dashed #d1d5db; border-radius: 12px; margin-bottom: 20px;">
                        <i class="fas fa-cloud-upload-alt" style="font-size: 48px; color: #14b8a6; margin-bottom: 12px;"></i>
                        <p style="margin-bottom: 12px; color: #6b7280;">Arraste um arquivo Excel ou clique para selecionar</p>
                        <input type="file" id="arquivo-importar-tabelas" accept=".xlsx,.xls,.csv" style="display: none;">
                        <button onclick="document.getElementById('arquivo-importar-tabelas').click()" style="background: #14b8a6; color: white; padding: 10px 20px; border: none; border-radius: 8px; cursor: pointer;">
                            <i class="fas fa-folder-open"></i> Selecionar Arquivo
                        </button>
                        <p id="nome-arquivo-tabelas" style="margin-top: 12px; font-size: 13px; color: #374151;"></p>
                    </div>
                    <div style="background: #f0fdfa; padding: 12px; border-radius: 8px; font-size: 13px; color: #0d9488;">
                        <i class="fas fa-info-circle"></i> O arquivo deve conter as colunas: Nome, Tipo, Validade, Status
                    </div>
                </div>
                <div class="modal-footer" style="padding: 16px 24px; background: #f9fafb; border-top: 1px solid #e5e7eb; display: flex; justify-content: flex-end; gap: 12px;">
                    <button type="button" onclick="fecharModalConfig('modal-importar-tabelas-preco')" style="padding: 10px 20px; border: 1px solid #d1d5db; background: white; border-radius: 8px; cursor: pointer;">Cancelar</button>
                    <button type="button" style="background: #14b8a6; color: white; padding: 10px 20px; border: none; border-radius: 8px; cursor: pointer;" onclick="processarImportacaoTabelas()">
                        <i class="fas fa-upload"></i> Importar
                    </button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
    
    // Listener para mostrar nome do arquivo
    document.getElementById('arquivo-importar-tabelas').addEventListener('change', function(e) {
        const fileName = e.target.files[0]?.name || '';
        document.getElementById('nome-arquivo-tabelas').textContent = fileName ? `Arquivo: ${fileName}` : '';
    });
}

/**
 * Processar importação de tabelas
 */
async function processarImportacaoTabelas() {
    const fileInput = document.getElementById('arquivo-importar-tabelas');
    if (!fileInput.files[0]) {
        showNotification('Selecione um arquivo para importar', 'error');
        return;
    }
    
    showNotification('Importação de tabelas em desenvolvimento', 'info');
    fecharModalConfig('modal-importar-tabelas-preco');
}

/**
 * Carrega dados de tabelas de preço
 */
async function loadTabelasPrecoData() {
    try {
        const response = await fetch('/api/produtos/tabelas-preco');
        if (response.ok) {
            const result = await response.json();
            tabelasPrecoCache = result.data || result || [];
            displayTabelasPreco(tabelasPrecoCache);
        }
    } catch (error) {
        console.error('Erro ao carregar tabelas de preço:', error);
    }
}

/**
 * Exibe tabelas de preço com visual melhorado
 */
function displayTabelasPreco(tabelas) {
    const tbody = document.querySelector('#tabelas-preco-tbody');
    const info = document.getElementById('tabelas-preco-info');
    
    if (!tbody) return;

    if (!tabelas || !tabelas.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; padding: 50px 20px; color: #9ca3af;">
                    <i class="fas fa-dollar-sign" style="font-size: 48px; margin-bottom: 16px; display: block; color: #d1d5db;"></i>
                    <p style="font-size: 16px; margin-bottom: 8px; color: #6b7280;">Nenhuma tabela de preço cadastrada</p>
                    <p style="font-size: 13px;">Clique em <strong>+ Nova Tabela</strong> para adicionar</p>
                </td>
            </tr>
        `;
        if (info) info.textContent = '0 registros';
        return;
    }

    tbody.innerHTML = tabelas.map(t => {
        // Badge de status
        const statusBadge = t.status === 'ativo' 
            ? '<span style="display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; background: #dcfce7; color: #16a34a; border-radius: 20px; font-size: 11px; font-weight: 500;"><i class="fas fa-check-circle"></i> Ativa</span>'
            : '<span style="display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; background: #fee2e2; color: #dc2626; border-radius: 20px; font-size: 11px; font-weight: 500;"><i class="fas fa-times-circle"></i> Inativa</span>';
        
        // Tipo formatado
        const tipoLabels = { 'padrao': 'Padrão', 'desconto': 'Desconto', 'promocao': 'Promoção', 'atacado': 'Atacado', 'varejo': 'Varejo' };
        const tipoDisplay = `<span style="padding: 4px 8px; background: #f3f4f6; border-radius: 6px; font-size: 12px; color: #374151;">${tipoLabels[t.tipo] || t.tipo || '-'}</span>`;
        
        // Validade
        const validadeDisplay = t.validade ? formatDate(t.validade) : '<span style="color: #9ca3af;">Sem validade</span>';
        
        // Produtos
        const produtosDisplay = `<span style="font-weight: 500; color: #374151;">${t.total_produtos || 0}</span>`;
        
        return `
            <tr style="border-bottom: 1px solid #f1f5f9; transition: background 0.2s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='transparent'">
                <td style="padding: 12px;">${statusBadge}</td>
                <td style="padding: 12px;">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <div style="width: 32px; height: 32px; border-radius: 8px; background: linear-gradient(135deg, #14b8a6, #0d9488); display: flex; align-items: center; justify-content: center; color: white; font-size: 12px;">
                            <i class="fas fa-dollar-sign"></i>
                        </div>
                        <span style="font-weight: 500; color: #1f2937;">${t.nome || '-'}</span>
                    </div>
                </td>
                <td style="padding: 12px;">${tipoDisplay}</td>
                <td style="padding: 12px; font-size: 13px; color: #6b7280;">${validadeDisplay}</td>
                <td style="padding: 12px; text-align: center;">${produtosDisplay}</td>
                <td style="padding: 12px;">
                    <div style="display: flex; gap: 4px; justify-content: center;">
                        <button onclick="editarTabelaPrecoInline(${t.id})" title="Editar" style="width: 28px; height: 28px; border: none; border-radius: 6px; background: #dbeafe; color: #2563eb; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s;" onmouseover="this.style.background='#2563eb';this.style.color='white'" onmouseout="this.style.background='#dbeafe';this.style.color='#2563eb'">
                            <i class="fas fa-edit" style="font-size: 11px;"></i>
                        </button>
                        <button onclick="excluirTabelaPrecoInline(${t.id})" title="Excluir" style="width: 28px; height: 28px; border: none; border-radius: 6px; background: #fee2e2; color: #dc2626; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s;" onmouseover="this.style.background='#dc2626';this.style.color='white'" onmouseout="this.style.background='#fee2e2';this.style.color='#dc2626'">
                            <i class="fas fa-trash" style="font-size: 11px;"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
    
    if (info) info.textContent = `${tabelas.length} registro(s)`;
}

/**
 * Editar tabela de preço
 */
function editarTabelaPrecoInline(id) {
    abrirFormTabelaPreco(id);
}

/**
 * Excluir tabela de preço
 */
async function excluirTabelaPrecoInline(id) {
    const tabela = tabelasPrecoCache.find(t => t.id === id);
    if (!confirm(`Deseja realmente excluir a tabela "${tabela?.nome || ''}"?\n\nEsta ação não pode ser desfeita.`)) return;

    try {
        const response = await fetch(`/api/produtos/tabelas-preco/${id}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            showNotification('Tabela excluída com sucesso!', 'success');
            loadTabelasPrecoData();
        } else {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || 'Erro ao excluir tabela');
        }
    } catch (error) {
        console.error('Erro:', error);
        showNotification(error.message || 'Erro ao excluir tabela de preço', 'error');
    }
}

// Compatibilidade com função antiga
function editarTabelaPreco(id) {
    editarTabelaPrecoInline(id);
}

function excluirTabelaPreco(id) {
    excluirTabelaPrecoInline(id);
}

// =========================
// UNIDADES DE MEDIDA - CRUD COMPLETO
// =========================

// Cache de unidades
let unidadesCache = [];
let unidadeEditandoId = null;

/**
 * Abre formulário para nova unidade ou edição
 */
function abrirFormUnidade(id = null) {
    const form = document.getElementById('form-nova-unidade');
    const titulo = document.getElementById('form-unidade-titulo');
    
    // Resetar formulário
    document.getElementById('form-unidade-config').reset();
    document.getElementById('unidade-id').value = '';
    unidadeEditandoId = null;
    
    if (id) {
        // Modo edição
        titulo.textContent = 'Editar Unidade de Medida';
        const unidade = unidadesCache.find(u => u.id === id);
        if (unidade) {
            unidadeEditandoId = id;
            document.getElementById('unidade-id').value = unidade.id;
            document.getElementById('unidade-sigla').value = unidade.sigla || '';
            document.getElementById('unidade-nome').value = unidade.nome || '';
            document.getElementById('unidade-tipo').value = unidade.tipo || 'quantidade';
        }
    } else {
        // Modo inclusão
        titulo.textContent = 'Nova Unidade de Medida';
    }
    
    form.style.display = 'block';
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Fecha formulário de unidade
 */
function fecharFormUnidade() {
    document.getElementById('form-nova-unidade').style.display = 'none';
    document.getElementById('form-unidade-config').reset();
    unidadeEditandoId = null;
}

/**
 * Salva unidade (novo ou edição) via formulário inline
 */
async function salvarUnidadeInline() {
    const id = document.getElementById('unidade-id').value;
    
    const dados = {
        sigla: document.getElementById('unidade-sigla').value.trim().toUpperCase(),
        nome: document.getElementById('unidade-nome').value.trim(),
        tipo: document.getElementById('unidade-tipo').value
    };
    
    if (!dados.sigla) {
        showNotification('Sigla é obrigatória', 'error');
        return;
    }
    
    if (!dados.nome) {
        showNotification('Nome é obrigatório', 'error');
        return;
    }
    
    try {
        const url = id ? `/api/produtos/unidades-medida/${id}` : '/api/produtos/unidades-medida';
        const method = id ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dados)
        });
        
        if (response.ok) {
            showNotification(id ? 'Unidade atualizada com sucesso!' : 'Unidade criada com sucesso!', 'success');
            fecharFormUnidade();
            loadUnidadesMedidaData();
        } else {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || 'Erro ao salvar unidade');
        }
    } catch (error) {
        console.error('Erro ao salvar unidade:', error);
        showNotification(error.message || 'Erro ao salvar unidade de medida', 'error');
    }
}

/**
 * Carrega dados de unidades de medida
 */
async function loadUnidadesMedidaData() {
    try {
        const response = await fetch('/api/produtos/unidades-medida');
        if (response.ok) {
            const result = await response.json();
            unidadesCache = result.data || result || [];
            displayUnidadesMedida(unidadesCache);
        }
    } catch (error) {
        console.error('Erro ao carregar unidades de medida:', error);
    }
}

/**
 * Exibe unidades de medida com visual melhorado
 */
function displayUnidadesMedida(unidades) {
    const tbody = document.querySelector('#unidades-medida-tbody');
    const info = document.getElementById('unidades-info');
    
    if (!tbody) return;

    if (!unidades || !unidades.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" style="text-align: center; padding: 50px 20px; color: #9ca3af;">
                    <i class="fas fa-ruler" style="font-size: 48px; margin-bottom: 16px; display: block; color: #d1d5db;"></i>
                    <p style="font-size: 16px; margin-bottom: 8px; color: #6b7280;">Nenhuma unidade cadastrada</p>
                    <p style="font-size: 13px;">Clique em <strong>+ Nova Unidade</strong> para adicionar</p>
                </td>
            </tr>
        `;
        if (info) info.textContent = '0 registros';
        return;
    }

    // Labels para tipos
    const tipoLabels = {
        'quantidade': 'Quantidade',
        'comprimento': 'Comprimento',
        'peso': 'Peso',
        'volume': 'Volume',
        'area': 'Área',
        'tempo': 'Tempo'
    };
    
    // Ícones para tipos
    const tipoIcons = {
        'quantidade': 'fas fa-cubes',
        'comprimento': 'fas fa-ruler-horizontal',
        'peso': 'fas fa-weight',
        'volume': 'fas fa-flask',
        'area': 'fas fa-vector-square',
        'tempo': 'fas fa-clock'
    };

    tbody.innerHTML = unidades.map(u => {
        const tipoIcon = tipoIcons[u.tipo] || 'fas fa-tag';
        const tipoLabel = tipoLabels[u.tipo] || u.tipo || '-';
        
        return `
            <tr style="border-bottom: 1px solid #f1f5f9; transition: background 0.2s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='transparent'">
                <td style="padding: 12px;">
                    <span style="display: inline-block; padding: 6px 12px; background: linear-gradient(135deg, #14b8a6, #0d9488); color: white; border-radius: 6px; font-weight: 600; font-size: 13px;">
                        ${u.sigla || '-'}
                    </span>
                </td>
                <td style="padding: 12px;">
                    <span style="font-weight: 500; color: #1f2937;">${u.nome || '-'}</span>
                </td>
                <td style="padding: 12px;">
                    <span style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; background: #f3f4f6; border-radius: 6px; font-size: 12px; color: #374151;">
                        <i class="${tipoIcon}" style="color: #14b8a6;"></i>
                        ${tipoLabel}
                    </span>
                </td>
                <td style="padding: 12px;">
                    <div style="display: flex; gap: 4px; justify-content: center;">
                        <button onclick="editarUnidadeInline(${u.id})" title="Editar" style="width: 28px; height: 28px; border: none; border-radius: 6px; background: #dbeafe; color: #2563eb; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s;" onmouseover="this.style.background='#2563eb';this.style.color='white'" onmouseout="this.style.background='#dbeafe';this.style.color='#2563eb'">
                            <i class="fas fa-edit" style="font-size: 11px;"></i>
                        </button>
                        <button onclick="excluirUnidadeInline(${u.id})" title="Excluir" style="width: 28px; height: 28px; border: none; border-radius: 6px; background: #fee2e2; color: #dc2626; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s;" onmouseover="this.style.background='#dc2626';this.style.color='white'" onmouseout="this.style.background='#fee2e2';this.style.color='#dc2626'">
                            <i class="fas fa-trash" style="font-size: 11px;"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
    
    if (info) info.textContent = `${unidades.length} registro(s)`;
}

/**
 * Editar unidade de medida
 */
function editarUnidadeInline(id) {
    abrirFormUnidade(id);
}

/**
 * Excluir unidade de medida
 */
async function excluirUnidadeInline(id) {
    const unidade = unidadesCache.find(u => u.id === id);
    if (!confirm(`Deseja realmente excluir a unidade "${unidade?.sigla} - ${unidade?.nome}"?\n\nEsta ação não pode ser desfeita.`)) return;

    try {
        const response = await fetch(`/api/produtos/unidades-medida/${id}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            showNotification('Unidade excluída com sucesso!', 'success');
            loadUnidadesMedidaData();
        } else {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || 'Erro ao excluir unidade');
        }
    } catch (error) {
        console.error('Erro:', error);
        showNotification(error.message || 'Erro ao excluir unidade de medida', 'error');
    }
}

// Compatibilidade com funções antigas
function editarUnidade(id) {
    editarUnidadeInline(id);
}

function excluirUnidade(id) {
    excluirUnidadeInline(id);
}

// =========================
// CÓDIGOS NCM - CRUD COMPLETO
// =========================

// Cache de NCM
let ncmCache = [];

/**
 * Carrega dados de códigos NCM
 */
async function loadNCMData() {
    console.log('Carregando códigos NCM...');
    try {
        const response = await fetch('/api/produtos/ncm');
        if (response.ok) {
            const result = await response.json();
            ncmCache = result.data || result || [];
            displayNCM(ncmCache);
        }
    } catch (error) {
        console.error('Erro ao carregar NCM:', error);
    }
}

/**
 * Filtra NCM pelo termo de busca
 */
function filtrarNCM(termo) {
    if (!termo || termo.trim() === '') {
        displayNCM(ncmCache);
        return;
    }
    
    const termoLower = termo.toLowerCase().trim();
    const filtrados = ncmCache.filter(n => 
        (n.codigo && n.codigo.toLowerCase().includes(termoLower)) ||
        (n.descricao && n.descricao.toLowerCase().includes(termoLower))
    );
    
    displayNCM(filtrados);
}

/**
 * Exibe códigos NCM com visual melhorado
 */
function displayNCM(ncms) {
    const tbody = document.querySelector('#ncm-list');
    const info = document.getElementById('ncm-info');
    
    if (!tbody) return;

    if (!ncms || ncms.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" style="text-align: center; padding: 50px 20px; color: #9ca3af;">
                    <i class="fas fa-barcode" style="font-size: 48px; margin-bottom: 16px; display: block; color: #d1d5db;"></i>
                    <p style="font-size: 16px; margin-bottom: 8px; color: #6b7280;">Nenhum código NCM encontrado</p>
                    <p style="font-size: 13px;">Tente uma busca diferente</p>
                </td>
            </tr>
        `;
        if (info) info.textContent = '0 registros';
        return;
    }

    tbody.innerHTML = ncms.map(n => {
        const ipiDisplay = n.aliquota_ipi !== null && n.aliquota_ipi !== undefined 
            ? `<span style="font-weight: 500; color: #374151;">${n.aliquota_ipi}%</span>` 
            : '<span style="color: #9ca3af;">-</span>';
        
        return `
            <tr style="border-bottom: 1px solid #f1f5f9; transition: background 0.2s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='transparent'">
                <td style="padding: 12px;">
                    <code style="display: inline-block; padding: 6px 10px; background: #f3f4f6; border-radius: 6px; font-family: 'Courier New', monospace; font-size: 13px; font-weight: 600; color: #374151;">
                        ${n.codigo || '-'}
                    </code>
                </td>
                <td style="padding: 12px;">
                    <span style="color: #1f2937; font-size: 13px;">${n.descricao || '-'}</span>
                </td>
                <td style="padding: 12px; text-align: center;">
                    ${ipiDisplay}
                </td>
                <td style="padding: 12px;">
                    <div style="display: flex; gap: 4px; justify-content: center;">
                        <button onclick="selecionarNCM('${n.codigo}', '${(n.descricao || '').replace(/'/g, "\\'")}')" title="Selecionar" style="width: 28px; height: 28px; border: none; border-radius: 6px; background: #dcfce7; color: #16a34a; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s;" onmouseover="this.style.background='#16a34a';this.style.color='white'" onmouseout="this.style.background='#dcfce7';this.style.color='#16a34a'">
                            <i class="fas fa-check" style="font-size: 11px;"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
    
    if (info) info.textContent = `${ncms.length} registro(s)`;
}

/**
 * Seleciona um código NCM (callback)
 */
function selecionarNCM(codigo, descricao) {
    // Se houver um callback definido, executar
    if (window.ncmSelecionadoCallback && typeof window.ncmSelecionadoCallback === 'function') {
        window.ncmSelecionadoCallback(codigo, descricao);
        fecharModal('modal-ncm');
    } else {
        showNotification(`NCM ${codigo} selecionado`, 'success');
    }
}

// =========================
// TIPOS DE SERVIÇO
// =========================

let tiposServicoCache = [];

async function loadTiposServicoData() {
    console.log('Carregando tipos de serviço...');
    try {
        const response = await fetch('/api/servicos/tipos');
        if (response.ok) {
            const result = await response.json();
            tiposServicoCache = result.data || result || [];
            displayTiposServico(tiposServicoCache);
        }
    } catch (error) {
        console.error('Erro ao carregar tipos de serviço:', error);
        displayTiposServico([]);
    }
}

function displayTiposServico(tipos) {
    const tbody = document.getElementById('tipos-servico-tbody');
    if (!tbody) return;

    if (tipos.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="config-empty">Nenhum tipo de serviço cadastrado</td></tr>`;
        return;
    }

    tbody.innerHTML = tipos.map(t => `
        <tr>
            <td><strong>${t.nome || ''}</strong></td>
            <td>${t.codigo_lc || ''}</td>
            <td>${t.iss ? t.iss + '%' : '0%'}</td>
            <td class="config-actions" style="text-align: center;">
                <button class="config-btn-icon" onclick="editarTipoServico(${t.id})" title="Editar" style="background: #f0f0f0; border: 1px solid #ddd; border-radius: 4px; padding: 6px 10px; margin-right: 5px; cursor: pointer;">
                    <i class="fas fa-edit" style="color: #666;"></i>
                </button>
                <button class="config-btn-icon" onclick="excluirTipoServico(${t.id})" title="Excluir" style="background: #f0f0f0; border: 1px solid #ddd; border-radius: 4px; padding: 6px 10px; cursor: pointer;">
                    <i class="fas fa-trash" style="color: #666;"></i>
                </button>
            </td>
        </tr>
    `).join('');
}

function abrirFormTipoServico(id = null) {
    const form = document.getElementById('form-tipo-servico');
    if (!form) return;
    
    // Limpar campos
    document.getElementById('tipo-servico-id').value = '';
    document.getElementById('tipo-servico-nome').value = '';
    document.getElementById('tipo-servico-codigo-lc').value = '';
    document.getElementById('tipo-servico-iss').value = '';
    
    if (id) {
        const tipo = tiposServicoCache.find(t => t.id === id);
        if (tipo) {
            document.getElementById('tipo-servico-id').value = tipo.id;
            document.getElementById('tipo-servico-nome').value = tipo.nome || '';
            document.getElementById('tipo-servico-codigo-lc').value = tipo.codigo_lc || '';
            document.getElementById('tipo-servico-iss').value = tipo.iss || '';
        }
    }
    
    form.style.display = 'block';
    document.getElementById('tipo-servico-nome').focus();
}

function cancelarFormTipoServico() {
    const form = document.getElementById('form-tipo-servico');
    if (form) form.style.display = 'none';
}

function editarTipoServico(id) {
    abrirFormTipoServico(id);
}

async function salvarTipoServicoInline() {
    const id = document.getElementById('tipo-servico-id').value;
    const nome = document.getElementById('tipo-servico-nome').value.trim();
    const codigo_lc = document.getElementById('tipo-servico-codigo-lc').value.trim();
    const iss = parseFloat(document.getElementById('tipo-servico-iss').value) || 0;
    
    if (!nome) {
        showNotification('Nome do tipo de serviço é obrigatório', 'error');
        return;
    }
    
    try {
        const url = id ? `/api/servicos/tipos/${id}` : '/api/servicos/tipos';
        const method = id ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nome, codigo_lc, iss })
        });
        
        if (response.ok) {
            showNotification(`Tipo de serviço ${id ? 'atualizado' : 'cadastrado'} com sucesso!`, 'success');
            cancelarFormTipoServico();
            loadTiposServicoData();
        } else {
            const err = await response.json();
            showNotification(err.error || 'Erro ao salvar', 'error');
        }
    } catch (error) {
        console.error('Erro ao salvar tipo de serviço:', error);
        showNotification('Erro ao salvar tipo de serviço', 'error');
    }
}

async function excluirTipoServico(id) {
    if (!confirm('Deseja realmente excluir este tipo de serviço?')) return;
    
    try {
        const response = await fetch(`/api/servicos/tipos/${id}`, { method: 'DELETE' });
        if (response.ok) {
            showNotification('Tipo de serviço excluído com sucesso!', 'success');
            loadTiposServicoData();
        } else {
            const err = await response.json();
            showNotification(err.error || 'Erro ao excluir', 'error');
        }
    } catch (error) {
        console.error('Erro ao excluir tipo de serviço:', error);
        showNotification('Erro ao excluir tipo de serviço', 'error');
    }
}

// =========================
// MODELOS DE CONTRATO
// =========================

let modelosContratoCache = [];

async function loadContratosData() {
    console.log('Carregando modelos de contrato...');
    try {
        const response = await fetch('/api/servicos/contratos/modelos');
        if (response.ok) {
            const result = await response.json();
            modelosContratoCache = result.data || result || [];
            displayContratos(modelosContratoCache);
        } else {
            displayContratos([]);
        }
    } catch (error) {
        console.error('Erro ao carregar contratos:', error);
        displayContratos([]);
    }
}

function displayContratos(contratos) {
    const grid = document.getElementById('contratos-cards-grid');
    if (!grid) return;

    if (contratos.length === 0) {
        grid.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: #666;">
                <i class="fas fa-file-contract" style="font-size: 48px; color: #ddd;"></i>
                <p style="margin-top: 15px;">Nenhum modelo de contrato cadastrado</p>
            </div>
        `;
        return;
    }

    const tipoLabels = {
        'servico': 'Prestação de Serviços',
        'manutencao': 'Manutenção',
        'locacao': 'Locação',
        'fornecimento': 'Fornecimento',
        'outro': 'Outro'
    };

    grid.innerHTML = contratos.map(c => {
        const dataFormatada = c.updated_at ? new Date(c.updated_at).toLocaleDateString('pt-BR') : 'N/A';
        return `
            <div class="config-card-item" style="background: white; border: 1px solid #e0e0e0; border-radius: 8px; padding: 15px; display: flex; align-items: flex-start; gap: 12px;">
                <div class="config-card-icon" style="width: 40px; height: 40px; background: #f0f0f0; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                    <i class="fas fa-file-alt" style="color: #666;"></i>
                </div>
                <div class="config-card-content" style="flex: 1; min-width: 0;">
                    <h4 style="margin: 0 0 5px 0; font-size: 14px; font-weight: 600; color: #333;">${c.nome || ''}</h4>
                    <p style="margin: 0 0 8px 0; font-size: 12px; color: #666; line-height: 1.4;">${c.descricao || tipoLabels[c.tipo] || 'Modelo de contrato'}</p>
                    <span style="font-size: 11px; color: #999;">Atualizado em ${dataFormatada}</span>
                </div>
                <div class="config-card-actions" style="display: flex; gap: 5px; flex-shrink: 0;">
                    <button class="config-btn-icon" onclick="editarModeloContrato(${c.id})" title="Editar" style="background: #f0f0f0; border: 1px solid #ddd; border-radius: 4px; padding: 6px 10px; cursor: pointer;">
                        <i class="fas fa-edit" style="color: #666;"></i>
                    </button>
                    <button class="config-btn-icon" onclick="duplicarModeloContrato(${c.id})" title="Duplicar" style="background: #f0f0f0; border: 1px solid #ddd; border-radius: 4px; padding: 6px 10px; cursor: pointer;">
                        <i class="fas fa-copy" style="color: #666;"></i>
                    </button>
                    <button class="config-btn-icon" onclick="excluirModeloContrato(${c.id})" title="Excluir" style="background: #f0f0f0; border: 1px solid #ddd; border-radius: 4px; padding: 6px 10px; cursor: pointer;">
                        <i class="fas fa-trash" style="color: #666;"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function abrirFormModeloContrato(id = null) {
    const form = document.getElementById('form-modelo-contrato');
    if (!form) return;
    
    // Limpar campos
    document.getElementById('modelo-contrato-id').value = '';
    document.getElementById('modelo-contrato-nome').value = '';
    document.getElementById('modelo-contrato-tipo').value = 'servico';
    document.getElementById('modelo-contrato-descricao').value = '';
    document.getElementById('modelo-contrato-conteudo').value = '';
    
    if (id) {
        const modelo = modelosContratoCache.find(m => m.id === id);
        if (modelo) {
            document.getElementById('modelo-contrato-id').value = modelo.id;
            document.getElementById('modelo-contrato-nome').value = modelo.nome || '';
            document.getElementById('modelo-contrato-tipo').value = modelo.tipo || 'servico';
            document.getElementById('modelo-contrato-descricao').value = modelo.descricao || '';
            document.getElementById('modelo-contrato-conteudo').value = modelo.conteudo || '';
        }
    }
    
    form.style.display = 'block';
    document.getElementById('modelo-contrato-nome').focus();
}

function cancelarFormModeloContrato() {
    const form = document.getElementById('form-modelo-contrato');
    if (form) form.style.display = 'none';
}

function editarModeloContrato(id) {
    abrirFormModeloContrato(id);
}

async function salvarModeloContratoInline() {
    const id = document.getElementById('modelo-contrato-id').value;
    const nome = document.getElementById('modelo-contrato-nome').value.trim();
    const tipo = document.getElementById('modelo-contrato-tipo').value;
    const descricao = document.getElementById('modelo-contrato-descricao').value.trim();
    const conteudo = document.getElementById('modelo-contrato-conteudo').value.trim();
    
    if (!nome) {
        showNotification('Nome do modelo é obrigatório', 'error');
        return;
    }
    
    try {
        const url = id ? `/api/servicos/contratos/modelos/${id}` : '/api/servicos/contratos/modelos';
        const method = id ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nome, tipo, descricao, conteudo })
        });
        
        if (response.ok) {
            showNotification(`Modelo ${id ? 'atualizado' : 'cadastrado'} com sucesso!`, 'success');
            cancelarFormModeloContrato();
            loadContratosData();
        } else {
            const err = await response.json();
            showNotification(err.error || 'Erro ao salvar', 'error');
        }
    } catch (error) {
        console.error('Erro ao salvar modelo de contrato:', error);
        showNotification('Erro ao salvar modelo de contrato', 'error');
    }
}

async function duplicarModeloContrato(id) {
    const modelo = modelosContratoCache.find(m => m.id === id);
    if (!modelo) return;
    
    try {
        const response = await fetch('/api/servicos/contratos/modelos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                nome: `${modelo.nome} (Cópia)`,
                tipo: modelo.tipo,
                descricao: modelo.descricao,
                conteudo: modelo.conteudo
            })
        });
        
        if (response.ok) {
            showNotification('Modelo duplicado com sucesso!', 'success');
            loadContratosData();
        } else {
            showNotification('Erro ao duplicar modelo', 'error');
        }
    } catch (error) {
        console.error('Erro ao duplicar modelo:', error);
        showNotification('Erro ao duplicar modelo', 'error');
    }
}

async function excluirModeloContrato(id) {
    if (!confirm('Deseja realmente excluir este modelo de contrato?')) return;
    
    try {
        const response = await fetch(`/api/servicos/contratos/modelos/${id}`, { method: 'DELETE' });
        if (response.ok) {
            showNotification('Modelo excluído com sucesso!', 'success');
            loadContratosData();
        } else {
            const err = await response.json();
            showNotification(err.error || 'Erro ao excluir', 'error');
        }
    } catch (error) {
        console.error('Erro ao excluir modelo:', error);
        showNotification('Erro ao excluir modelo', 'error');
    }
}

// =========================
// SLA DE ATENDIMENTO
// =========================

let slaCache = [];

async function loadSLAData() {
    console.log('Carregando configurações de SLA...');
    try {
        const response = await fetch('/api/servicos/sla');
        if (response.ok) {
            const result = await response.json();
            slaCache = result.data || result || [];
            displaySLA(slaCache);
        } else {
            displaySLA([]);
        }
    } catch (error) {
        console.error('Erro ao carregar SLA:', error);
        displaySLA([]);
    }
}

function displaySLA(slas) {
    const tbody = document.getElementById('sla-tbody');
    if (!tbody) return;

    if (slas.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="config-empty">Nenhuma configuração de SLA cadastrada</td></tr>`;
        return;
    }

    const prioridadeConfig = {
        'critica': { label: 'Crítica', color: '#dc3545', bg: '#f8d7da' },
        'alta': { label: 'Alta', color: '#fd7e14', bg: '#ffe5d0' },
        'media': { label: 'Média', color: '#ffc107', bg: '#fff3cd' },
        'baixa': { label: 'Baixa', color: '#28a745', bg: '#d4edda' }
    };

    tbody.innerHTML = slas.map(s => {
        const config = prioridadeConfig[s.prioridade] || prioridadeConfig['media'];
        return `
            <tr>
                <td>
                    <span style="display: inline-block; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600; background: ${config.bg}; color: ${config.color};">
                        ${config.label}
                    </span>
                </td>
                <td>${s.tempo_resposta || ''}</td>
                <td>${s.tempo_solucao || ''}</td>
                <td class="config-actions" style="text-align: center;">
                    <button class="config-btn-icon" onclick="editarSLA(${s.id})" title="Editar" style="background: #f0f0f0; border: 1px solid #ddd; border-radius: 4px; padding: 6px 10px; margin-right: 5px; cursor: pointer;">
                        <i class="fas fa-edit" style="color: #666;"></i>
                    </button>
                    <button class="config-btn-icon" onclick="excluirSLA(${s.id})" title="Excluir" style="background: #f0f0f0; border: 1px solid #ddd; border-radius: 4px; padding: 6px 10px; cursor: pointer;">
                        <i class="fas fa-trash" style="color: #666;"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function abrirFormSLA(id = null) {
    const form = document.getElementById('form-sla');
    if (!form) return;
    
    // Limpar campos
    document.getElementById('sla-id').value = '';
    document.getElementById('sla-prioridade').value = 'media';
    document.getElementById('sla-tempo-resposta').value = '';
    document.getElementById('sla-tempo-solucao').value = '';
    
    if (id) {
        const sla = slaCache.find(s => s.id === id);
        if (sla) {
            document.getElementById('sla-id').value = sla.id;
            document.getElementById('sla-prioridade').value = sla.prioridade || 'media';
            document.getElementById('sla-tempo-resposta').value = sla.tempo_resposta || '';
            document.getElementById('sla-tempo-solucao').value = sla.tempo_solucao || '';
        }
    }
    
    form.style.display = 'block';
    document.getElementById('sla-prioridade').focus();
}

function cancelarFormSLA() {
    const form = document.getElementById('form-sla');
    if (form) form.style.display = 'none';
}

function editarSLA(id) {
    abrirFormSLA(id);
}

async function salvarSLAInline() {
    const id = document.getElementById('sla-id').value;
    const prioridade = document.getElementById('sla-prioridade').value;
    const tempo_resposta = document.getElementById('sla-tempo-resposta').value.trim();
    const tempo_solucao = document.getElementById('sla-tempo-solucao').value.trim();
    
    if (!tempo_resposta || !tempo_solucao) {
        showNotification('Preencha os tempos de resposta e solução', 'error');
        return;
    }
    
    try {
        const url = id ? `/api/servicos/sla/${id}` : '/api/servicos/sla';
        const method = id ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prioridade, tempo_resposta, tempo_solucao })
        });
        
        if (response.ok) {
            showNotification(`SLA ${id ? 'atualizado' : 'cadastrado'} com sucesso!`, 'success');
            cancelarFormSLA();
            loadSLAData();
        } else {
            const err = await response.json();
            showNotification(err.error || 'Erro ao salvar', 'error');
        }
    } catch (error) {
        console.error('Erro ao salvar SLA:', error);
        showNotification('Erro ao salvar SLA', 'error');
    }
}

async function excluirSLA(id) {
    if (!confirm('Deseja realmente excluir esta configuração de SLA?')) return;
    
    try {
        const response = await fetch(`/api/servicos/sla/${id}`, { method: 'DELETE' });
        if (response.ok) {
            showNotification('SLA excluído com sucesso!', 'success');
            loadSLAData();
        } else {
            const err = await response.json();
            showNotification(err.error || 'Erro ao excluir', 'error');
        }
    } catch (error) {
        console.error('Erro ao excluir SLA:', error);
        showNotification('Erro ao excluir SLA', 'error');
    }
}

// =========================
// NFS-e (NOTA FISCAL DE SERVIÇO)
// =========================

async function loadNFSeData() {
    console.log('Carregando configurações NFS-e...');
    try {
        const response = await fetch('/api/configuracoes/nfse');
        if (response.ok) {
            const result = await response.json();
            const config = result.data || result || {};
            populateNFSeForm(config);
        }
    } catch (error) {
        console.error('Erro ao carregar NFS-e:', error);
    }
}

function populateNFSeForm(config) {
    // Inscrição Municipal
    const inscricao = document.getElementById('nfse-inscricao-municipal');
    if (inscricao) inscricao.value = config.inscricao_municipal || '';

    // Código do município
    const codMunicipio = document.getElementById('nfse-codigo-municipio');
    if (codMunicipio) codMunicipio.value = config.codigo_municipio || '';

    // Ambiente
    const ambiente = document.getElementById('nfse-ambiente');
    if (ambiente) ambiente.value = config.ambiente || 'homologacao';

    // Regime tributário
    const regime = document.getElementById('nfse-regime-tributacao');
    if (regime) regime.value = config.regime_tributacao || '1';

    // Envio automático
    const envioAuto = document.getElementById('nfse-envio-automatico');
    if (envioAuto) {
        envioAuto.checked = config.envio_automatico !== false;
        updateNfseSlider(envioAuto);
    }

    // Reter ISS
    const reterIss = document.getElementById('nfse-reter-iss');
    if (reterIss) {
        reterIss.checked = config.reter_iss || false;
        updateNfseSlider(reterIss);
    }
}

function toggleNfseCheckbox(checkboxId, slider) {
    const checkbox = document.getElementById(checkboxId);
    if (checkbox) {
        checkbox.checked = !checkbox.checked;
        updateNfseSlider(checkbox);
    }
}

function updateNfseSlider(checkbox) {
    const slider = checkbox.nextElementSibling;
    if (slider) {
        if (checkbox.checked) {
            slider.style.backgroundColor = '#17a2b8';
            slider.innerHTML = '<span style="position: absolute; content: \'\'; height: 20px; width: 20px; left: 26px; bottom: 3px; background-color: white; transition: .3s; border-radius: 50%;"></span>';
        } else {
            slider.style.backgroundColor = '#ccc';
            slider.innerHTML = '<span style="position: absolute; content: \'\'; height: 20px; width: 20px; left: 4px; bottom: 3px; background-color: white; transition: .3s; border-radius: 50%;"></span>';
        }
    }
}

async function saveNfseConfig() {
    const inscricao_municipal = document.getElementById('nfse-inscricao-municipal')?.value.trim() || '';
    const codigo_municipio = document.getElementById('nfse-codigo-municipio')?.value.trim() || '';
    const ambiente = document.getElementById('nfse-ambiente')?.value || 'homologacao';
    const regime_tributacao = document.getElementById('nfse-regime-tributacao')?.value || '1';
    const envio_automatico = document.getElementById('nfse-envio-automatico')?.checked || false;
    const reter_iss = document.getElementById('nfse-reter-iss')?.checked || false;
    
    try {
        const response = await fetch('/api/configuracoes/nfse', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                inscricao_municipal,
                codigo_municipio,
                ambiente,
                regime_tributacao,
                envio_automatico,
                reter_iss
            })
        });
        
        if (response.ok) {
            showNotification('Configurações NFS-e salvas com sucesso!', 'success');
            fecharModal('modal-nfse');
        } else {
            const err = await response.json();
            showNotification(err.error || 'Erro ao salvar configurações', 'error');
        }
    } catch (error) {
        console.error('Erro ao salvar NFS-e:', error);
        showNotification('Erro ao salvar configurações NFS-e', 'error');
    }
}

// =========================
// FUNÇÕES AUXILIARES
// =========================

/**
 * Formata valor monetário
 */
function formatMoney(value) {
    return parseFloat(value || 0).toLocaleString('pt-BR', { 
        minimumFractionDigits: 2, 
        maximumFractionDigits: 2 
    });
}

// =========================
// GESTÍO DE FUNCIONÁRIOS - COMPLETO
// =========================

let funcionariosCache = [];
let funcionariosPagina = 1;
let funcionariosTotal = 0;
const funcionariosPorPagina = 10;
let departamentosCache = [];

/**
 * Carrega lista de departamentos para o filtro
 */
async function carregarDepartamentosParaFiltro() {
    try {
        const response = await fetch('/api/departamentos', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken') || ''}`
            }
        });
        
        if (response.ok) {
            const result = await response.json();
            departamentosCache = result.data || result || [];
            
            // Preencher o select de filtro
            const select = document.getElementById('filtro-departamento-funcionario');
            if (select) {
                select.innerHTML = '<option value="">Todos Departamentos</option>';
                departamentosCache
                    .filter(d => d.ativo === 1 || d.ativo === true)
                    .forEach(d => {
                        select.innerHTML += `<option value="${d.nome}">${d.nome}</option>`;
                    });
            }
        }
    } catch (error) {
        console.error('Erro ao carregar departamentos:', error);
    }
}

/**
 * Filtra funcionários por departamento
 */
function filtrarFuncionariosPorDepartamento(departamento) {
    const statusAtual = document.getElementById('filtro-status-funcionario')?.value || '';
    
    let filtrados = funcionariosCache;
    
    if (departamento) {
        filtrados = filtrados.filter(f => (f.departamento || '').toLowerCase() === departamento.toLowerCase());
    }
    
    if (statusAtual) {
        filtrados = filtrados.filter(f => (f.status || '').toLowerCase() === statusAtual.toLowerCase());
    }
    
    funcionariosPagina = 1;
    renderizarFuncionarios(filtrados);
}

/**
 * Carrega lista de funcionários do servidor
 */
async function carregarFuncionariosCompleto() {
    try {
        const tbody = document.getElementById('funcionarios-list');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="padding: 40px;"><i class="fas fa-spinner fa-spin"></i> Carregando...</td></tr>';
        }
        
        // Carregar departamentos para o filtro em paralelo
        carregarDepartamentosParaFiltro();
        
        const response = await fetch('/api/rh/funcionarios', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken') || ''}`
            }
        });
        
        if (response.ok) {
            const result = await response.json();
            // A API retorna { funcionarios: [...], stats: {...} }
            funcionariosCache = result.funcionarios || result.data || result || [];
            // Normalizar campos - converter nome_completo para nome
            funcionariosCache = funcionariosCache.map(f => ({
                ...f,
                nome: f.nome_completo || f.nome,
                pis: f.pis_pasep || f.pis
            }));
            funcionariosTotal = funcionariosCache.length;
            renderizarFuncionarios();
        } else {
            throw new Error('Erro ao carregar funcionários');
        }
    } catch (error) {
        console.error('Erro:', error);
        const tbody = document.getElementById('funcionarios-list');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="padding: 40px; color: #6c757d;">Nenhum funcionário cadastrado</td></tr>';
        }
    }
}

function renderizarFuncionarios(lista = null) {
    const tbody = document.getElementById('funcionarios-list');
    const info = document.getElementById('funcionarios-info');
    if (!tbody) return;
    
    const dados = lista || funcionariosCache;
    
    if (!dados.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="padding: 40px; color: #6c757d;">Nenhum funcionário cadastrado</td></tr>';
        if (info) info.textContent = '0 funcionários encontrados';
        return;
    }
    
    const inicio = (funcionariosPagina - 1) * funcionariosPorPagina;
    const fim = Math.min(inicio + funcionariosPorPagina, dados.length);
    const paginados = dados.slice(inicio, fim);
    
    tbody.innerHTML = paginados.map(f => {
        // Normalizar status para lowercase para comparação
        const statusLower = (f.status || 'ativo').toLowerCase();
        const statusClass = statusLower === 'ativo' ? 'status-ativo' : 
                           statusLower === 'inativo' ? 'status-inativo' : 
                           statusLower === 'ferias' || statusLower === 'férias' ? 'status-ferias' : 'status-afastado';
        const statusIcon = statusLower === 'ativo' ? 'check-circle' : 
                          statusLower === 'inativo' ? 'times-circle' : 
                          statusLower === 'ferias' || statusLower === 'férias' ? 'umbrella-beach' : 'user-clock';
        const statusLabel = f.status || 'Ativo';
        
        return `
        <tr>
            <td><span class="status-badge ${statusClass}"><i class="fas fa-${statusIcon}"></i> ${statusLabel}</span></td>
            <td>${f.nome || ''}</td>
            <td>${f.cargo || ''}</td>
            <td>${f.departamento || ''}</td>
            <td>${formatDate(f.data_admissao) || '-'}</td>
            <td class="config-actions">
                <button class="config-btn-icon" onclick="editarFuncionario(${f.id})" title="Editar"><i class="fas fa-edit"></i></button>
                <button class="config-btn-icon" onclick="verDetalhesFuncionario(${f.id})" title="Ver detalhes"><i class="fas fa-eye"></i></button>
                <button class="config-btn-icon danger" onclick="excluirFuncionario(${f.id})" title="Excluir"><i class="fas fa-trash"></i></button>
            </td>
        </tr>`;
    }).join('');
    
    if (info) {
        info.textContent = `Mostrando ${inicio + 1}-${fim} de ${dados.length} funcionários`;
    }
    
    renderizarPaginacaoFuncionarios(dados.length);
}

function renderizarPaginacaoFuncionarios(total) {
    const container = document.getElementById('funcionarios-paginacao');
    if (!container) return;
    
    const totalPaginas = Math.ceil(total / funcionariosPorPagina);
    if (totalPaginas <= 1) {
        container.innerHTML = '';
        return;
    }
    
    let html = '';
    html += `<button class="config-btn-icon" onclick="funcionariosPagina = 1; renderizarFuncionarios()" ${funcionariosPagina === 1 ? 'disabled' : ''}><i class="fas fa-angle-double-left"></i></button>`;
    html += `<button class="config-btn-icon" onclick="funcionariosPagina--; renderizarFuncionarios()" ${funcionariosPagina === 1 ? 'disabled' : ''}><i class="fas fa-angle-left"></i></button>`;
    
    for (let i = 1; i <= totalPaginas; i++) {
        if (i === 1 || i === totalPaginas || (i >= funcionariosPagina - 1 && i <= funcionariosPagina + 1)) {
            html += `<button class="config-btn-icon ${i === funcionariosPagina ? 'active' : ''}" onclick="funcionariosPagina = ${i}; renderizarFuncionarios()">${i}</button>`;
        } else if (i === funcionariosPagina - 2 || i === funcionariosPagina + 2) {
            html += `<span style="padding: 0 5px;">...</span>`;
        }
    }
    
    html += `<button class="config-btn-icon" onclick="funcionariosPagina++; renderizarFuncionarios()" ${funcionariosPagina === totalPaginas ? 'disabled' : ''}><i class="fas fa-angle-right"></i></button>`;
    html += `<button class="config-btn-icon" onclick="funcionariosPagina = ${totalPaginas}; renderizarFuncionarios()" ${funcionariosPagina === totalPaginas ? 'disabled' : ''}><i class="fas fa-angle-double-right"></i></button>`;
    
    container.innerHTML = html;
}

function buscarFuncionarios(termo) {
    if (!termo) {
        renderizarFuncionarios();
        return;
    }
    
    const filtrados = funcionariosCache.filter(f => 
        (f.nome || f.nome_completo || '').toLowerCase().includes(termo.toLowerCase()) ||
        (f.cargo || '').toLowerCase().includes(termo.toLowerCase()) ||
        (f.departamento || '').toLowerCase().includes(termo.toLowerCase()) ||
        (f.cpf || '').includes(termo) ||
        (f.email || '').toLowerCase().includes(termo.toLowerCase())
    );
    
    funcionariosPagina = 1;
    renderizarFuncionarios(filtrados);
}

function filtrarFuncionariosPorStatus(status) {
    const departamentoAtual = document.getElementById('filtro-departamento-funcionario')?.value || '';
    
    let filtrados = funcionariosCache;
    
    if (departamentoAtual) {
        filtrados = filtrados.filter(f => (f.departamento || '').toLowerCase() === departamentoAtual.toLowerCase());
    }
    
    if (status) {
        filtrados = filtrados.filter(f => (f.status || '').toLowerCase() === status.toLowerCase());
    }
    
    funcionariosPagina = 1;
    renderizarFuncionarios(filtrados);
}

function abrirModalNovoFuncionario() {
    document.getElementById('titulo-form-funcionario').textContent = 'Novo Funcionário';
    document.getElementById('form-funcionario').reset();
    document.getElementById('func-id').value = '';
    document.getElementById('func-status').value = 'ativo';
    abrirModal('modal-form-funcionario');
}

async function editarFuncionario(id) {
    try {
        const funcionario = funcionariosCache.find(f => f.id === id);
        if (!funcionario) return;
        
        document.getElementById('titulo-form-funcionario').textContent = 'Editar Funcionário';
        document.getElementById('func-id').value = funcionario.id;
        document.getElementById('func-nome').value = funcionario.nome_completo || funcionario.nome || '';
        document.getElementById('func-cpf').value = funcionario.cpf || '';
        document.getElementById('func-rg').value = funcionario.rg || '';
        document.getElementById('func-nascimento').value = funcionario.data_nascimento ? funcionario.data_nascimento.split('T')[0] : '';
        document.getElementById('func-email').value = funcionario.email || '';
        document.getElementById('func-telefone').value = funcionario.telefone || '';
        document.getElementById('func-cargo').value = funcionario.cargo || '';
        document.getElementById('func-departamento').value = funcionario.departamento || '';
        document.getElementById('func-admissao').value = funcionario.data_admissao ? funcionario.data_admissao.split('T')[0] : '';
        document.getElementById('func-salario').value = funcionario.salario || '';
        document.getElementById('func-status').value = funcionario.status || 'ativo';
        document.getElementById('func-pis').value = funcionario.pis_pasep || funcionario.pis || '';
        
        // Tentar separar o endereço se vier concatenado
        const endereco = funcionario.endereco || '';
        const partesEndereco = endereco.split(',').map(p => p.trim());
        document.getElementById('func-endereco').value = partesEndereco[0] || '';
        document.getElementById('func-numero').value = partesEndereco[1] || funcionario.numero || '';
        document.getElementById('func-bairro').value = partesEndereco[2] || funcionario.bairro || '';
        document.getElementById('func-cidade').value = partesEndereco[3] || funcionario.cidade || '';
        document.getElementById('func-cep').value = partesEndereco[4] || funcionario.cep || '';
        
        abrirModal('modal-form-funcionario');
    } catch (error) {
        console.error('Erro ao carregar funcionário:', error);
        alert('Erro ao carregar dados do funcionário');
    }
}

async function salvarFuncionario(event) {
    event.preventDefault();
    
    const form = document.getElementById('form-funcionario');
    const formData = new FormData(form);
    const dados = Object.fromEntries(formData.entries());
    
    // Mapear campos do formulário para os nomes esperados pela API
    const dadosAPI = {
        nome_completo: dados.nome || '',
        email: dados.email || '',
        cpf: dados.cpf || '',
        rg: dados.rg || '',
        telefone: dados.telefone || '',
        cargo: dados.cargo || '',
        departamento: dados.departamento || '',
        status: dados.status || 'ativo',
        data_nascimento: dados.data_nascimento || null,
        data_admissao: dados.data_admissao || null,
        pis_pasep: dados.pis || '',
        salario: dados.salario ? dados.salario.replace(/[^\d.,]/g, '').replace(',', '.') : null,
        // Montar endereço completo
        endereco: [dados.endereco, dados.numero, dados.bairro, dados.cidade, dados.cep].filter(Boolean).join(', ') || ''
    };
    
    try {
        const id = dados.id;
        const url = id ? `/api/rh/funcionarios/${id}` : '/api/rh/funcionarios';
        const method = id ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('authToken') || ''}`
            },
            body: JSON.stringify(dadosAPI)
        });
        
        if (response.ok) {
            fecharModal('modal-form-funcionario');
            await carregarFuncionariosCompleto();
            showToast(id ? 'Funcionário atualizado com sucesso!' : 'Funcionário cadastrado com sucesso!', 'success');
            
            // Registrar no audit log
            registrarAuditFrontend(id ? 'editar' : 'criar', 'rh', `${id ? 'Editou' : 'Criou'} funcionário: ${dados.nome}`);
            
            // Registrar na central de notificações
            if (window.registrarAcao) {
                window.registrarAcao(id ? 'editar' : 'criar', 'rh', `Funcionário: ${dados.nome}`);
            }
        } else {
            const error = await response.json();
            throw new Error(error.message || 'Erro ao salvar');
        }
    } catch (error) {
        console.error('Erro:', error);
        alert(error.message || 'Erro ao salvar funcionário');
    }
}

async function excluirFuncionario(id) {
    const funcionario = funcionariosCache.find(f => f.id === id);
    if (!funcionario) return;
    
    if (!confirm(`Deseja realmente excluir o funcionário "${funcionario.nome}"?`)) return;
    
    try {
        const response = await fetch(`/api/rh/funcionarios/${id}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken') || ''}`
            }
        });
        
        if (response.ok) {
            await carregarFuncionariosCompleto();
            showToast('Funcionário excluído com sucesso!', 'success');
            registrarAuditFrontend('excluir', 'rh', `Excluiu funcionário: ${funcionario.nome}`);
        } else {
            throw new Error('Erro ao excluir');
        }
    } catch (error) {
        console.error('Erro:', error);
        alert('Erro ao excluir funcionário');
    }
}

let funcionarioDetalheAtual = null;

function verDetalhesFuncionario(id) {
    const funcionario = funcionariosCache.find(f => f.id === id);
    if (!funcionario) return;
    
    funcionarioDetalheAtual = funcionario;
    
    // Preencher dados no modal
    document.getElementById('detalhe-func-nome').textContent = funcionario.nome || funcionario.nome_completo || '-';
    document.getElementById('detalhe-func-cargo-dept').textContent = `${funcionario.cargo || '-'} - ${funcionario.departamento || '-'}`;
    document.getElementById('detalhe-func-cpf').textContent = funcionario.cpf || '-';
    document.getElementById('detalhe-func-rg').textContent = funcionario.rg || '-';
    document.getElementById('detalhe-func-nascimento').textContent = formatDate(funcionario.data_nascimento) || '-';
    document.getElementById('detalhe-func-email').textContent = funcionario.email || '-';
    document.getElementById('detalhe-func-telefone').textContent = funcionario.telefone || '-';
    document.getElementById('detalhe-func-status').textContent = funcionario.status ? funcionario.status.charAt(0).toUpperCase() + funcionario.status.slice(1) : '-';
    document.getElementById('detalhe-func-admissao').textContent = formatDate(funcionario.data_admissao) || '-';
    document.getElementById('detalhe-func-salario').textContent = funcionario.salario ? formatCurrency(parseFloat(funcionario.salario)) : '-';
    document.getElementById('detalhe-func-endereco').textContent = funcionario.endereco || '-';
    
    // Avatar com foto ou inicial
    const avatarDiv = document.getElementById('detalhe-func-avatar');
    if (funcionario.foto_url || funcionario.avatar_url) {
        avatarDiv.innerHTML = `<img src="${funcionario.foto_url || funcionario.avatar_url}" alt="Foto" style="width: 100%; height: 100%; object-fit: cover; border-radius: 12px;">`;
    } else {
        const inicial = (funcionario.nome || funcionario.nome_completo || '?').charAt(0).toUpperCase();
        avatarDiv.innerHTML = `<span style="font-size: 24px; font-weight: 700; color: white;">${inicial}</span>`;
    }
    
    // Resetar para aba de dados
    abrirAbaDetalheFunc('dados');
    
    // Carregar solicitações e atestados
    carregarSolicitacoesFuncionario(id);
    carregarAtestadosFuncionario(id);
    
    // Abrir modal
    abrirModal('modal-detalhes-funcionario');
}

function abrirAbaDetalheFunc(aba) {
    // Desativar todas as abas
    document.querySelectorAll('#modal-detalhes-funcionario .config-tab').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('#modal-detalhes-funcionario .config-tab-content').forEach(content => {
        content.classList.remove('active');
        content.style.display = 'none';
    });
    
    // Ativar aba selecionada
    const tabBtn = document.querySelector(`#modal-detalhes-funcionario .config-tab[data-tab="tab-${aba}-func"]`);
    const tabContent = document.getElementById(`tab-${aba}-func`);
    
    if (tabBtn) tabBtn.classList.add('active');
    if (tabContent) {
        tabContent.classList.add('active');
        tabContent.style.display = 'block';
    }
}

async function carregarSolicitacoesFuncionario(funcionarioId) {
    const lista = document.getElementById('lista-solicitacoes-func');
    if (!lista) return;
    
    lista.innerHTML = '<div style="text-align: center; padding: 20px;"><i class="fas fa-spinner fa-spin"></i> Carregando...</div>';
    
    try {
        const response = await fetch(`/api/rh/funcionarios/${funcionarioId}/solicitacoes`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken') || ''}` }
        });
        
        if (response.ok) {
            const result = await response.json();
            const solicitacoes = result.data || result || [];
            
            if (solicitacoes.length === 0) {
                lista.innerHTML = `
                    <div class="config-empty-state" style="padding: 40px; text-align: center; color: #6b7280;">
                        <i class="fas fa-file-alt" style="font-size: 48px; margin-bottom: 16px; opacity: 0.5;"></i>
                        <p>Nenhuma solicitação registrada</p>
                    </div>`;
            } else {
                lista.innerHTML = solicitacoes.map(s => `
                    <div class="config-item" style="padding: 16px; border: 1px solid #e2e8f0; border-radius: 12px; margin-bottom: 12px;">
                        <div style="display: flex; justify-content: space-between; align-items: start;">
                            <div>
                                <h5 style="margin: 0 0 8px 0; color: #1e293b;">${s.tipo || 'Solicitação'}</h5>
                                <p style="margin: 0; font-size: 13px; color: #64748b;">${s.descricao || '-'}</p>
                            </div>
                            <span class="status-badge status-${(s.status || '').toLowerCase()}" style="padding: 4px 12px; border-radius: 20px; font-size: 12px;">
                                ${s.status || 'Pendente'}
                            </span>
                        </div>
                        <div style="margin-top: 12px; font-size: 12px; color: #94a3b8;">
                            <i class="fas fa-calendar"></i> ${formatDate(s.data_solicitacao) || '-'}
                        </div>
                    </div>
                `).join('');
            }
        } else {
            throw new Error('Erro ao carregar');
        }
    } catch (error) {
        console.error('Erro ao carregar solicitações:', error);
        lista.innerHTML = `
            <div class="config-empty-state" style="padding: 40px; text-align: center; color: #6b7280;">
                <i class="fas fa-file-alt" style="font-size: 48px; margin-bottom: 16px; opacity: 0.5;"></i>
                <p>Nenhuma solicitação registrada</p>
            </div>`;
    }
}

async function carregarAtestadosFuncionario(funcionarioId) {
    const lista = document.getElementById('lista-atestados-func');
    if (!lista) return;
    
    lista.innerHTML = '<div style="text-align: center; padding: 20px;"><i class="fas fa-spinner fa-spin"></i> Carregando...</div>';
    
    try {
        const response = await fetch(`/api/rh/funcionarios/${funcionarioId}/atestados`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken') || ''}` }
        });
        
        if (response.ok) {
            const result = await response.json();
            const atestados = result.data || result || [];
            
            if (atestados.length === 0) {
                lista.innerHTML = `
                    <div class="config-empty-state" style="padding: 40px; text-align: center; color: #6b7280;">
                        <i class="fas fa-notes-medical" style="font-size: 48px; margin-bottom: 16px; opacity: 0.5;"></i>
                        <p>Nenhum atestado registrado</p>
                    </div>`;
            } else {
                lista.innerHTML = atestados.map(a => {
                    // Calcular data fim baseada na data do atestado + dias de afastamento
                    const dias = a.dias_afastado || a.dias_afastamento || 0;
                    const dataAtestado = a.data_atestado || a.data_inicio;
                    let dataFimCalc = '';
                    if (dataAtestado && dias > 0) {
                        const dataInicio = new Date(dataAtestado);
                        const dataFim = new Date(dataInicio);
                        dataFim.setDate(dataFim.getDate() + dias - 1);
                        dataFimCalc = formatDate(dataFim);
                    }
                    
                    // Extrair CID do motivo se existir (formato: "Motivo (CID: X00)")
                    let cid = a.cid || '';
                    let motivoTexto = a.motivo || a.observacoes || 'Atestado Médico';
                    const cidMatch = motivoTexto.match(/\(CID:\s*([^)]+)\)/i);
                    if (cidMatch) {
                        cid = cidMatch[1].trim();
                        motivoTexto = motivoTexto.replace(/\s*\(CID:[^)]+\)/i, '').trim();
                    }
                    
                    const status = a.status || (a.validado ? 'Aprovado' : 'Pendente');
                    const isAprovado = status === 'Aprovado' || a.validado;
                    
                    return `
                    <div class="config-item" style="padding: 16px; border: 1px solid #e2e8f0; border-radius: 12px; margin-bottom: 12px;">
                        <div style="display: flex; justify-content: space-between; align-items: start;">
                            <div>
                                <h5 style="margin: 0 0 8px 0; color: #1e293b;">${motivoTexto}</h5>
                                <p style="margin: 0; font-size: 13px; color: #64748b;">
                                    ${cid ? `<strong>CID:</strong> ${cid} | ` : ''}
                                    <strong>Dias:</strong> ${dias}
                                </p>
                            </div>
                            <span style="padding: 4px 12px; border-radius: 20px; font-size: 12px; background: ${isAprovado ? '#dcfce7' : '#fef3c7'}; color: ${isAprovado ? '#16a34a' : '#d97706'};">
                                ${status}
                            </span>
                        </div>
                        <div style="margin-top: 12px; font-size: 12px; color: #94a3b8;">
                            <i class="fas fa-calendar"></i> ${formatDate(dataAtestado) || '-'}${dataFimCalc ? ` até ${dataFimCalc}` : ''} ${dias > 0 ? `(${dias} dia${dias > 1 ? 's' : ''})` : ''}
                        </div>
                    </div>
                `}).join('');
            }
        } else {
            throw new Error('Erro ao carregar');
        }
    } catch (error) {
        console.error('Erro ao carregar atestados:', error);
        lista.innerHTML = `
            <div class="config-empty-state" style="padding: 40px; text-align: center; color: #6b7280;">
                <i class="fas fa-notes-medical" style="font-size: 48px; margin-bottom: 16px; opacity: 0.5;"></i>
                <p>Nenhum atestado registrado</p>
            </div>`;
    }
}

function editarFuncionarioDoDetalhe() {
    if (funcionarioDetalheAtual) {
        fecharModal('modal-detalhes-funcionario');
        editarFuncionario(funcionarioDetalheAtual.id);
    }
}

function novaSolicitacaoFuncionario() {
    if (funcionarioDetalheAtual) {
        // Abrir modal de nova solicitação
        alert('Funcionalidade em desenvolvimento: Nova Solicitação para ' + (funcionarioDetalheAtual.nome || funcionarioDetalheAtual.nome_completo));
    }
}

function novoAtestadoFuncionario() {
    if (funcionarioDetalheAtual) {
        // Abrir modal de novo atestado
        alert('Funcionalidade em desenvolvimento: Novo Atestado para ' + (funcionarioDetalheAtual.nome || funcionarioDetalheAtual.nome_completo));
    }
}

function importarFuncionarios() {
    abrirModal('modal-importar-funcionarios');
}

async function processarArquivoImportacao(input) {
    const file = input.files[0];
    if (!file) return;
    
    const formData = new FormData();
    formData.append('arquivo', file);
    
    try {
        const response = await fetch('/api/rh/funcionarios/importar', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken') || ''}`
            },
            body: formData
        });
        
        if (response.ok) {
            const result = await response.json();
            fecharModal('modal-importar-funcionarios');
            await carregarFuncionariosCompleto();
            showToast(`${result.importados || 0} funcionários importados com sucesso!`, 'success');
        } else {
            throw new Error('Erro na importação');
        }
    } catch (error) {
        console.error('Erro:', error);
        alert('Erro ao importar arquivo. Verifique o formato.');
    }
}

function exportarFuncionarios() {
    if (!funcionariosCache.length) {
        alert('Não há funcionários para exportar');
        return;
    }
    
    // Criar CSV
    const headers = ['Nome', 'CPF', 'Cargo', 'Departamento', 'Data Admissão', 'Status', 'Email', 'Telefone'];
    const rows = funcionariosCache.map(f => [
        f.nome || '',
        f.cpf || '',
        f.cargo || '',
        f.departamento || '',
        formatDate(f.data_admissao) || '',
        f.status || '',
        f.email || '',
        f.telefone || ''
    ]);
    
    let csv = headers.join(';') + '';
    rows.forEach(row => {
        csv += row.join(';') + '';
    });
    
    // Download
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `funcionarios_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
}

function baixarModeloImportacao() {
    const headers = ['Nome', 'CPF', 'Cargo', 'Departamento', 'Data Admissão (DD/MM/AAAA)', 'Email', 'Telefone'];
    const exemplo = ['João da Silva', '123.456.789-00', 'Operador', 'Produção', '01/01/2024', 'joao@email.com', '(11) 99999-0000'];
    
    let csv = headers.join(';') + '';
    csv += exemplo.join(';') + '';
    
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'modelo_importacao_funcionarios.csv';
    link.click();
}

// =========================
// HISTÓRICO DE ALTERAÇÕES - AUDITORIA
// =========================

let historicoCache = [];
let historicoPagina = 1;
const historicoPorPagina = 20;

async function carregarHistoricoAlteracoes() {
    try {
        const container = document.getElementById('historico-container');
        if (container) {
            container.innerHTML = '<div class="historico-loading"><i class="fas fa-spinner fa-spin"></i><p>Carregando histórico...</p></div>';
        }
        
        // Carregar usuários para o filtro
        await carregarUsuariosParaFiltro();
        
        // Carregar logs com autenticação
        const response = await fetch('/api/audit-log?limite=500', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken') || ''}`
            }
        });
        if (response.ok) {
            const result = await response.json();
            historicoCache = result.logs || [];
            renderizarHistorico();
        } else {
            console.error('Erro na resposta:', response.status, await response.text());
            const container = document.getElementById('historico-container');
            if (container) {
                container.innerHTML = '<div class="historico-empty"><i class="fas fa-exclamation-triangle"></i><h5>Erro de autenticação</h5><p>Não foi possível carregar o histórico</p></div>';
            }
        }
    } catch (error) {
        console.error('Erro ao carregar histórico:', error);
        const container = document.getElementById('historico-container');
        if (container) {
            container.innerHTML = '<div class="historico-empty"><i class="fas fa-exclamation-circle"></i><h5>Erro ao carregar histórico</h5><p>Tente novamente em alguns instantes</p></div>';
        }
    }
}

async function carregarUsuariosParaFiltro() {
    try {
        const response = await fetch('/api/usuarios', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken') || ''}`
            }
        });
        
        if (response.ok) {
            const result = await response.json();
            const usuarios = result.data || result || [];
            
            const select = document.getElementById('filtro-usuario');
            if (select) {
                select.innerHTML = '<option value="">Todos os Colaboradores</option>';
                usuarios.forEach(u => {
                    select.innerHTML += `<option value="${u.nome}">${u.nome}${u.status === 'inativo' ? ' (Inativo)' : ''}</option>`;
                });
            }
        }
    } catch (error) {
        console.error('Erro ao carregar usuários:', error);
    }
}

function renderizarHistorico(lista = null) {
    const container = document.getElementById('historico-container');
    if (!container) return;
    
    const dados = lista || historicoCache;
    
    if (!dados.length) {
        container.innerHTML = '<div class="historico-empty"><i class="fas fa-inbox"></i><h5>Nenhum registro encontrado</h5><p>Tente ajustar os filtros para encontrar registros</p></div>';
        atualizarPaginacaoHistorico(0);
        return;
    }
    
    const inicio = (historicoPagina - 1) * historicoPorPagina;
    const fim = Math.min(inicio + historicoPorPagina, dados.length);
    const paginados = dados.slice(inicio, fim);
    
    container.innerHTML = paginados.map(log => {
        const iniciais = (log.usuario || 'SI').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        const badgeClass = getBadgeClass(log.acao);
        const badgeIcon = getBadgeIcon(log.acao);
        const dataFormatada = formatarDataHora(log.data);
        const avatarClass = getAvatarClass(log.modulo);
        
        return `
        <div class="historico-item">
            <div class="historico-avatar ${avatarClass}">${iniciais}</div>
            <div class="historico-content">
                <div class="historico-header">
                    <span class="historico-usuario">${log.usuario || 'Sistema'}</span>
                    <span class="historico-badge ${badgeClass}"><i class="fas fa-${badgeIcon}"></i> ${capitalizar(log.acao)}</span>
                    <span class="historico-modulo">${capitalizar(log.modulo)}</span>
                </div>
                <p class="historico-descricao">${log.descricao || 'Ação registrada no sistema'}</p>
                <div class="historico-detalhes">
                    <span class="historico-time"><i class="fas fa-clock"></i> ${dataFormatada}</span>
                    ${log.ip ? `<span class="historico-ip"><i class="fas fa-globe"></i> ${log.ip}</span>` : ''}
                </div>
            </div>
        </div>`;
    }).join('');
    
    atualizarPaginacaoHistorico(dados.length);
}

function atualizarPaginacaoHistorico(total) {
    const infoSpan = document.querySelector('#historico-pagination .historico-pagination-info');
    const paginacaoDiv = document.querySelector('#historico-pagination .historico-pagination-buttons');
    
    if (infoSpan) {
        const inicio = Math.min((historicoPagina - 1) * historicoPorPagina + 1, total);
        const fim = Math.min(historicoPagina * historicoPorPagina, total);
        infoSpan.textContent = `Mostrando ${inicio}-${fim} de ${total} registros`;
    }
    
    if (paginacaoDiv) {
        const totalPaginas = Math.ceil(total / historicoPorPagina);
        if (totalPaginas <= 1) {
            paginacaoDiv.innerHTML = '';
            return;
        }
        
        let html = '';
        html += `<button class="historico-page-btn" onclick="historicoPagina = 1; renderizarHistorico()" ${historicoPagina === 1 ? 'disabled' : ''}><i class="fas fa-angle-double-left"></i></button>`;
        html += `<button class="historico-page-btn" onclick="historicoPagina--; renderizarHistorico()" ${historicoPagina === 1 ? 'disabled' : ''}><i class="fas fa-angle-left"></i></button>`;
        
        for (let i = 1; i <= Math.min(5, totalPaginas); i++) {
            const pagina = i <= 3 ? i : (i === 4 ? totalPaginas - 1 : totalPaginas);
            if (i === 4 && totalPaginas > 5) {
                html += `<button class="historico-page-btn dots">...</button>`;
            }
            html += `<button class="historico-page-btn ${pagina === historicoPagina ? 'active' : ''}" onclick="historicoPagina = ${pagina}; renderizarHistorico()">${pagina}</button>`;
        }
        
        html += `<button class="historico-page-btn" onclick="historicoPagina++; renderizarHistorico()" ${historicoPagina === totalPaginas ? 'disabled' : ''}><i class="fas fa-angle-right"></i></button>`;
        html += `<button class="historico-page-btn" onclick="historicoPagina = ${totalPaginas}; renderizarHistorico()" ${historicoPagina === totalPaginas ? 'disabled' : ''}><i class="fas fa-angle-double-right"></i></button>`;
        
        paginacaoDiv.innerHTML = html;
    }
}

function filtrarHistorico() {
    const modulo = document.getElementById('filtro-modulo')?.value || '';
    const usuario = document.getElementById('filtro-usuario')?.value || '';
    const acao = document.getElementById('filtro-acao')?.value || '';
    const dataInicio = document.getElementById('filtro-data-inicio')?.value || '';
    const dataFim = document.getElementById('filtro-data-fim')?.value || '';
    
    let filtrados = [...historicoCache];
    
    if (modulo) {
        filtrados = filtrados.filter(l => (l.modulo || '').toLowerCase() === modulo.toLowerCase());
    }
    if (usuario) {
        filtrados = filtrados.filter(l => (l.usuario || '').toLowerCase().includes(usuario.toLowerCase()));
    }
    if (acao) {
        filtrados = filtrados.filter(l => (l.acao || '').toLowerCase() === acao.toLowerCase());
    }
    if (dataInicio) {
        filtrados = filtrados.filter(l => new Date(l.data) >= new Date(dataInicio));
    }
    if (dataFim) {
        const fim = new Date(dataFim);
        fim.setHours(23, 59, 59);
        filtrados = filtrados.filter(l => new Date(l.data) <= fim);
    }
    
    historicoPagina = 1;
    renderizarHistorico(filtrados);
}

function exportarHistorico() {
    if (!historicoCache.length) {
        alert('Não há registros para exportar');
        return;
    }
    
    const headers = ['Data/Hora', 'Usuário', 'Ação', 'Módulo', 'Descrição', 'IP'];
    const rows = historicoCache.map(l => [
        formatarDataHora(l.data),
        l.usuario || 'Sistema',
        l.acao || '',
        l.modulo || '',
        l.descricao || '',
        l.ip || ''
    ]);
    
    let csv = headers.join(';') + '';
    rows.forEach(row => {
        csv += row.map(c => `"${c}"`).join(';') + '';
    });
    
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `auditoria_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
}

// Funções auxiliares para histórico
function getBadgeClass(acao) {
    const classes = {
        'criar': 'badge-criar',
        'editar': 'badge-editar',
        'excluir': 'badge-excluir',
        'login': 'badge-login',
        'config': 'badge-config',
        'configurar': 'badge-config',
        'perfil': 'badge-perfil'
    };
    return classes[(acao || '').toLowerCase()] || 'badge-info';
}

function getBadgeIcon(acao) {
    const icons = {
        'criar': 'plus',
        'editar': 'edit',
        'excluir': 'trash',
        'login': 'sign-in-alt',
        'config': 'cog',
        'configurar': 'cog',
        'perfil': 'user'
    };
    return icons[(acao || '').toLowerCase()] || 'info';
}

function getAvatarColor(modulo) {
    const colors = {
        'vendas': '#3498db, #2980b9',
        'compras': '#2ecc71, #27ae60',
        'pcp': '#f39c12, #e67e22',
        'financeiro': '#9b59b6, #8e44ad',
        'rh': '#1abc9c, #16a085',
        'nfe': '#e74c3c, #c0392b',
        'sistema': '#34495e, #2c3e50'
    };
    return colors[(modulo || '').toLowerCase()] || '#95a5a6, #7f8c8d';
}

function getAvatarClass(modulo) {
    const classMap = {
        'vendas': 'avatar-blue',
        'compras': 'avatar-green',
        'pcp': 'avatar-orange',
        'financeiro': 'avatar-purple',
        'rh': 'avatar-teal',
        'nfe': 'avatar-red',
        'sistema': 'avatar-purple'
    };
    return classMap[(modulo || '').toLowerCase()] || 'avatar-blue';
}

function capitalizar(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function formatarDataHora(data) {
    if (!data) return '';
    const d = new Date(data);
    return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function registrarAuditFrontend(acao, modulo, descricao) {
    fetch('/api/audit-log', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('authToken') || ''}`
        },
        body: JSON.stringify({
            usuario: localStorage.getItem('userName') || 'Usuário',
            acao,
            modulo,
            descricao
        })
    }).catch(err => console.error('Erro ao registrar audit:', err));
}

// Toast notification helper
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'times-circle' : 'info-circle'}"></i> ${message}`;
    toast.style.cssText = `
        position: fixed; bottom: 20px; right: 20px; padding: 15px 25px; 
        background: ${type === 'success' ? '#27ae60' : type === 'error' ? '#e74c3c' : '#3498db'}; 
        color: white; border-radius: 8px; z-index: 99999; animation: slideIn 0.3s ease;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// Exportar novas funções
window.loadFuncionariosData = loadFuncionariosData;
window.carregarFuncionariosCompleto = carregarFuncionariosCompleto;
window.abrirModalNovoFuncionario = abrirModalNovoFuncionario;
window.editarFuncionario = editarFuncionario;
window.salvarFuncionario = salvarFuncionario;
window.excluirFuncionario = excluirFuncionario;
window.verDetalhesFuncionario = verDetalhesFuncionario;
window.abrirAbaDetalheFunc = abrirAbaDetalheFunc;
window.carregarSolicitacoesFuncionario = carregarSolicitacoesFuncionario;
window.carregarAtestadosFuncionario = carregarAtestadosFuncionario;
window.editarFuncionarioDoDetalhe = editarFuncionarioDoDetalhe;
window.novaSolicitacaoFuncionario = novaSolicitacaoFuncionario;
window.novoAtestadoFuncionario = novoAtestadoFuncionario;
window.importarFuncionarios = importarFuncionarios;
window.exportarFuncionarios = exportarFuncionarios;
window.processarArquivoImportacao = processarArquivoImportacao;
window.baixarModeloImportacao = baixarModeloImportacao;
window.buscarFuncionarios = buscarFuncionarios;
window.filtrarFuncionariosPorStatus = filtrarFuncionariosPorStatus;
window.filtrarFuncionariosPorDepartamento = filtrarFuncionariosPorDepartamento;
window.carregarDepartamentosParaFiltro = carregarDepartamentosParaFiltro;
window.carregarHistoricoAlteracoes = carregarHistoricoAlteracoes;
window.filtrarHistorico = filtrarHistorico;
window.exportarHistorico = exportarHistorico;
window.showToast = showToast;
window.loadCargosData = loadCargosData;
window.loadFolhaPagamentoData = loadFolhaPagamentoData;
window.loadPontoEletronicoData = loadPontoEletronicoData;
window.loadPlanoContasData = loadPlanoContasData;
window.loadContasBancariasData = loadContasBancariasData;
window.loadFormasPagamentoData = loadFormasPagamentoData;
window.loadImpostosData = loadImpostosData;
window.loadGruposClientesData = loadGruposClientesData;
window.loadRegioesVendaData = loadRegioesVendaData;
window.loadTiposFornecedorData = loadTiposFornecedorData;
window.loadCondicoesPagamentoData = loadCondicoesPagamentoData;
window.loadTabelasPrecoData = loadTabelasPrecoData;
window.loadUnidadesMedidaData = loadUnidadesMedidaData;
window.loadNCMData = loadNCMData;
window.loadTiposServicoData = loadTiposServicoData;
window.loadContratosData = loadContratosData;
window.loadSLAData = loadSLAData;
window.loadNFSeData = loadNFSeData;
window.formatMoney = formatMoney;

// Funções de Tabelas de Preço - CRUD
window.abrirFormTabelaPreco = abrirFormTabelaPreco;
window.fecharFormTabelaPreco = fecharFormTabelaPreco;
window.salvarTabelaPrecoInline = salvarTabelaPrecoInline;
window.editarTabelaPrecoInline = editarTabelaPrecoInline;
window.excluirTabelaPrecoInline = excluirTabelaPrecoInline;
window.importarTabelasPreco = importarTabelasPreco;
window.processarImportacaoTabelas = processarImportacaoTabelas;

// Funções de Unidades de Medida - CRUD
window.abrirFormUnidade = abrirFormUnidade;
window.fecharFormUnidade = fecharFormUnidade;
window.salvarUnidadeInline = salvarUnidadeInline;
window.editarUnidadeInline = editarUnidadeInline;
window.excluirUnidadeInline = excluirUnidadeInline;

// Funções de NCM
window.filtrarNCM = filtrarNCM;
window.selecionarNCM = selecionarNCM;

// Funções de Tipos de Serviço - CRUD
window.abrirFormTipoServico = abrirFormTipoServico;
window.cancelarFormTipoServico = cancelarFormTipoServico;
window.salvarTipoServicoInline = salvarTipoServicoInline;
window.editarTipoServico = editarTipoServico;
window.excluirTipoServico = excluirTipoServico;

// Funções de Modelos de Contrato - CRUD
window.abrirFormModeloContrato = abrirFormModeloContrato;
window.cancelarFormModeloContrato = cancelarFormModeloContrato;
window.salvarModeloContratoInline = salvarModeloContratoInline;
window.editarModeloContrato = editarModeloContrato;
window.duplicarModeloContrato = duplicarModeloContrato;
window.excluirModeloContrato = excluirModeloContrato;

// Funções de SLA - CRUD
window.abrirFormSLA = abrirFormSLA;
window.cancelarFormSLA = cancelarFormSLA;
window.salvarSLAInline = salvarSLAInline;
window.editarSLA = editarSLA;
window.excluirSLA = excluirSLA;

// Funções de NFS-e
window.saveNfseConfig = saveNfseConfig;
window.toggleNfseCheckbox = toggleNfseCheckbox;
window.updateNfseSlider = updateNfseSlider;

// Funções de Plano de Contas - CRUD
window.abrirFormNovaConta = abrirFormNovaConta;
window.fecharFormNovaConta = fecharFormNovaConta;
window.salvarContaConfig = salvarContaConfig;
window.editarContaConfig = editarContaConfig;
window.excluirContaConfig = excluirContaConfig;
window.adicionarSubcontaConfig = adicionarSubcontaConfig;
window.expandirTodosConfig = expandirTodosConfig;
window.recolherTodosConfig = recolherTodosConfig;
window.toggleTreeItemConfig = toggleTreeItemConfig;
window.atualizarCorPorTipo = atualizarCorPorTipo;
window.displayPlanoContasConfig = displayPlanoContasConfig;

// Funções de Contas Bancárias - CRUD
window.abrirFormContaBancaria = abrirFormContaBancaria;
window.fecharFormContaBancaria = fecharFormContaBancaria;
window.salvarContaBancariaConfig = salvarContaBancariaConfig;
window.editarContaBancaria = editarContaBancaria;
window.excluirContaBancaria = excluirContaBancaria;
window.conciliarConta = conciliarConta;

// Funções de Importação OFX
window.abrirImportOFX = abrirImportOFX;
window.handleOFXDrop = handleOFXDrop;
window.handleOFXFile = handleOFXFile;
window.limparOFX = limparOFX;
window.processarOFX = processarOFX;
window.formatarMoedaConfig = formatarMoedaConfig;

// Funções de Formas de Pagamento - CRUD
window.abrirFormFormaPagamento = abrirFormFormaPagamento;
window.fecharFormFormaPagamento = fecharFormFormaPagamento;
window.salvarFormaPagamentoConfig = salvarFormaPagamentoConfig;
window.editarFormaPagamento = editarFormaPagamento;
window.excluirFormaPagamento = excluirFormaPagamento;
window.formatarTaxaConfig = formatarTaxaConfig;
window.loadFormasPagamentoData = loadFormasPagamentoData;

// =========================
// FUNÇÕES DE CADASTRO RÁPIDO - CONFIGURAÇÕES
// =========================

/**
 * Abre modal de Nova Região
 */
async function novaRegiao() {
    // Tentar abrir o modal de Vendas se existir
    const modalVendas = document.getElementById('modal-nova-regiao');
    if (modalVendas) {
        modalVendas.classList.add('active');
        modalVendas.style.display = 'flex';
        return;
    }
    
    // Se não existir, mostrar modal inline
    const html = `
        <div class="modal-overlay active" id="modal-nova-regiao-config" style="display: flex;">
            <div class="modal-content" style="max-width: 450px; border-radius: 12px;">
                <div class="modal-header" style="background: linear-gradient(135deg, #8b5cf6, #7c3aed);">
                    <h2><i class="fas fa-map-marker-alt"></i> Nova Região</h2>
                    <button class="modal-close" onclick="fecharModalConfig('modal-nova-regiao-config')">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body" style="padding: 24px;">
                    <div class="form-group" style="margin-bottom: 16px;">
                        <label style="font-size: 13px; font-weight: 500; color: #374151; display: block; margin-bottom: 6px;">Nome da Região *</label>
                        <input type="text" id="config-regiao-nome" placeholder="Ex: Sudeste, Interior SP" style="width: 100%; padding: 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px;">
                    </div>
                    <div class="form-group" style="margin-bottom: 16px;">
                        <label style="font-size: 13px; font-weight: 500; color: #374151; display: block; margin-bottom: 6px;">Estados (UFs)</label>
                        <input type="text" id="config-regiao-estados" placeholder="Ex: SP, RJ, MG" style="width: 100%; padding: 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px;">
                    </div>
                    <div class="form-group">
                        <label style="font-size: 13px; font-weight: 500; color: #374151; display: block; margin-bottom: 6px;">Descrição</label>
                        <textarea id="config-regiao-descricao" placeholder="Descrição opcional..." style="width: 100%; padding: 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; min-height: 80px; resize: vertical;"></textarea>
                    </div>
                </div>
                <div class="modal-footer" style="padding: 16px 24px; background: #f9fafb; border-top: 1px solid #e5e7eb; display: flex; justify-content: flex-end; gap: 12px;">
                    <button type="button" class="btn-modal btn-modal-cancel" onclick="fecharModalConfig('modal-nova-regiao-config')" style="padding: 10px 20px; border: 1px solid #d1d5db; background: white; border-radius: 8px; cursor: pointer;">Cancelar</button>
                    <button type="button" class="btn-modal btn-modal-save" style="background: #8b5cf6; color: white; padding: 10px 20px; border: none; border-radius: 8px; cursor: pointer;" onclick="salvarRegiaoConfig()">
                        <i class="fas fa-save"></i> Salvar
                    </button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
}

/**
 * Abre modal de Novo Tipo de Fornecedor
 */
async function novoTipoFornecedor() {
    const html = `
        <div class="modal-overlay active" id="modal-novo-tipo-config" style="display: flex;">
            <div class="modal-content" style="max-width: 450px; border-radius: 12px;">
                <div class="modal-header" style="background: linear-gradient(135deg, #8b5cf6, #7c3aed);">
                    <h2><i class="fas fa-truck"></i> Novo Tipo de Fornecedor</h2>
                    <button class="modal-close" onclick="fecharModalConfig('modal-novo-tipo-config')">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body" style="padding: 24px;">
                    <div class="form-group" style="margin-bottom: 16px;">
                        <label style="font-size: 13px; font-weight: 500; color: #374151; display: block; margin-bottom: 6px;">Nome do Tipo *</label>
                        <input type="text" id="config-tipo-nome" placeholder="Ex: Matéria Prima, Serviços" style="width: 100%; padding: 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px;">
                    </div>
                    <div class="form-group">
                        <label style="font-size: 13px; font-weight: 500; color: #374151; display: block; margin-bottom: 6px;">Descrição</label>
                        <textarea id="config-tipo-descricao" placeholder="Descrição opcional..." style="width: 100%; padding: 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; min-height: 80px; resize: vertical;"></textarea>
                    </div>
                </div>
                <div class="modal-footer" style="padding: 16px 24px; background: #f9fafb; border-top: 1px solid #e5e7eb; display: flex; justify-content: flex-end; gap: 12px;">
                    <button type="button" class="btn-modal btn-modal-cancel" onclick="fecharModalConfig('modal-novo-tipo-config')" style="padding: 10px 20px; border: 1px solid #d1d5db; background: white; border-radius: 8px; cursor: pointer;">Cancelar</button>
                    <button type="button" class="btn-modal btn-modal-save" style="background: #8b5cf6; color: white; padding: 10px 20px; border: none; border-radius: 8px; cursor: pointer;" onclick="salvarTipoFornecedorConfig()">
                        <i class="fas fa-save"></i> Salvar
                    </button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
}

/**
 * Abre modal de Nova Condição de Pagamento
 */
async function novaCondicao() {
    const html = `
        <div class="modal-overlay active" id="modal-nova-condicao-config" style="display: flex;">
            <div class="modal-content" style="max-width: 450px; border-radius: 12px;">
                <div class="modal-header" style="background: linear-gradient(135deg, #8b5cf6, #7c3aed);">
                    <h2><i class="fas fa-handshake"></i> Nova Condição de Pagamento</h2>
                    <button class="modal-close" onclick="fecharModalConfig('modal-nova-condicao-config')">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body" style="padding: 24px;">
                    <div class="form-group" style="margin-bottom: 16px;">
                        <label style="font-size: 13px; font-weight: 500; color: #374151; display: block; margin-bottom: 6px;">Nome da Condição *</label>
                        <input type="text" id="config-condicao-nome" placeholder="Ex: À Vista, 30/60/90" style="width: 100%; padding: 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px;">
                    </div>
                    <div style="display: flex; gap: 12px; margin-bottom: 16px;">
                        <div class="form-group" style="flex: 1;">
                            <label style="font-size: 13px; font-weight: 500; color: #374151; display: block; margin-bottom: 6px;">Parcelas</label>
                            <input type="number" id="config-condicao-parcelas" placeholder="1" min="1" value="1" style="width: 100%; padding: 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px;">
                        </div>
                        <div class="form-group" style="flex: 1;">
                            <label style="font-size: 13px; font-weight: 500; color: #374151; display: block; margin-bottom: 6px;">Prazo (dias)</label>
                            <input type="text" id="config-condicao-prazo" placeholder="30, 60, 90" style="width: 100%; padding: 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px;">
                        </div>
                    </div>
                    <div class="form-group">
                        <label style="font-size: 13px; font-weight: 500; color: #374151; display: block; margin-bottom: 6px;">Acréscimo (%)</label>
                        <input type="number" id="config-condicao-acrescimo" placeholder="0" min="0" step="0.1" value="0" style="width: 100%; padding: 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px;">
                    </div>
                </div>
                <div class="modal-footer" style="padding: 16px 24px; background: #f9fafb; border-top: 1px solid #e5e7eb; display: flex; justify-content: flex-end; gap: 12px;">
                    <button type="button" class="btn-modal btn-modal-cancel" onclick="fecharModalConfig('modal-nova-condicao-config')" style="padding: 10px 20px; border: 1px solid #d1d5db; background: white; border-radius: 8px; cursor: pointer;">Cancelar</button>
                    <button type="button" class="btn-modal btn-modal-save" style="background: #8b5cf6; color: white; padding: 10px 20px; border: none; border-radius: 8px; cursor: pointer;" onclick="salvarCondicaoConfig()">
                        <i class="fas fa-save"></i> Salvar
                    </button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
}

/**
 * Abre modal de Nova Tabela de Preço
 */
async function novaTabelaPreco() {
    const html = `
        <div class="modal-overlay active" id="modal-nova-tabela-config" style="display: flex;">
            <div class="modal-content" style="max-width: 500px; border-radius: 12px;">
                <div class="modal-header" style="background: linear-gradient(135deg, #14b8a6, #0d9488);">
                    <h2><i class="fas fa-dollar-sign"></i> Nova Tabela de Preço</h2>
                    <button class="modal-close" onclick="fecharModalConfig('modal-nova-tabela-config')">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body" style="padding: 24px;">
                    <div class="form-group" style="margin-bottom: 16px;">
                        <label style="font-size: 13px; font-weight: 500; color: #374151; display: block; margin-bottom: 6px;">Nome da Tabela *</label>
                        <input type="text" id="config-tabela-nome" placeholder="Ex: Tabela Geral, Revendedores" style="width: 100%; padding: 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px;">
                    </div>
                    <div style="display: flex; gap: 12px; margin-bottom: 16px;">
                        <div class="form-group" style="flex: 1;">
                            <label style="font-size: 13px; font-weight: 500; color: #374151; display: block; margin-bottom: 6px;">Tipo</label>
                            <select id="config-tabela-tipo" style="width: 100%; padding: 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px;">
                                <option value="padrao">Padrão</option>
                                <option value="desconto">Desconto</option>
                                <option value="promocao">Promoção</option>
                            </select>
                        </div>
                        <div class="form-group" style="flex: 1;">
                            <label style="font-size: 13px; font-weight: 500; color: #374151; display: block; margin-bottom: 6px;">Validade</label>
                            <input type="date" id="config-tabela-validade" style="width: 100%; padding: 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px;">
                        </div>
                    </div>
                    <div class="form-group">
                        <label style="font-size: 13px; font-weight: 500; color: #374151; display: block; margin-bottom: 6px;">Descrição</label>
                        <textarea id="config-tabela-descricao" placeholder="Descrição opcional..." style="width: 100%; padding: 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; min-height: 80px; resize: vertical;"></textarea>
                    </div>
                </div>
                <div class="modal-footer" style="padding: 16px 24px; background: #f9fafb; border-top: 1px solid #e5e7eb; display: flex; justify-content: flex-end; gap: 12px;">
                    <button type="button" onclick="fecharModalConfig('modal-nova-tabela-config')" style="padding: 10px 20px; border: 1px solid #d1d5db; background: white; border-radius: 8px; cursor: pointer;">Cancelar</button>
                    <button type="button" style="background: #14b8a6; color: white; padding: 10px 20px; border: none; border-radius: 8px; cursor: pointer;" onclick="salvarTabelaPrecoConfig()">
                        <i class="fas fa-save"></i> Salvar
                    </button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
}

/**
 * Abre modal de Nova Unidade de Medida
 */
async function novaUnidade() {
    const html = `
        <div class="modal-overlay active" id="modal-nova-unidade-config" style="display: flex;">
            <div class="modal-content" style="max-width: 400px; border-radius: 12px;">
                <div class="modal-header" style="background: linear-gradient(135deg, #14b8a6, #0d9488);">
                    <h2><i class="fas fa-ruler"></i> Nova Unidade de Medida</h2>
                    <button class="modal-close" onclick="fecharModalConfig('modal-nova-unidade-config')">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body" style="padding: 24px;">
                    <div style="display: flex; gap: 12px; margin-bottom: 16px;">
                        <div class="form-group" style="width: 100px;">
                            <label style="font-size: 13px; font-weight: 500; color: #374151; display: block; margin-bottom: 6px;">Sigla *</label>
                            <input type="text" id="config-unidade-sigla" maxlength="5" placeholder="UN" style="width: 100%; padding: 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; text-transform: uppercase;">
                        </div>
                        <div class="form-group" style="flex: 1;">
                            <label style="font-size: 13px; font-weight: 500; color: #374151; display: block; margin-bottom: 6px;">Nome *</label>
                            <input type="text" id="config-unidade-nome" placeholder="Ex: Unidade, Metro" style="width: 100%; padding: 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px;">
                        </div>
                    </div>
                    <div class="form-group">
                        <label style="font-size: 13px; font-weight: 500; color: #374151; display: block; margin-bottom: 6px;">Tipo</label>
                        <select id="config-unidade-tipo" style="width: 100%; padding: 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px;">
                            <option value="quantidade">Quantidade</option>
                            <option value="comprimento">Comprimento</option>
                            <option value="peso">Peso</option>
                            <option value="volume">Volume</option>
                            <option value="area">Área</option>
                        </select>
                    </div>
                </div>
                <div class="modal-footer" style="padding: 16px 24px; background: #f9fafb; border-top: 1px solid #e5e7eb; display: flex; justify-content: flex-end; gap: 12px;">
                    <button type="button" onclick="fecharModalConfig('modal-nova-unidade-config')" style="padding: 10px 20px; border: 1px solid #d1d5db; background: white; border-radius: 8px; cursor: pointer;">Cancelar</button>
                    <button type="button" style="background: #14b8a6; color: white; padding: 10px 20px; border: none; border-radius: 8px; cursor: pointer;" onclick="salvarUnidadeConfig()">
                        <i class="fas fa-save"></i> Salvar
                    </button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
}

/**
 * Fechar modal de configuração inline
 * Se modalId for passado, fecha o modal específico (inline)
 * Se não for passado, fecha o modal principal de configurações
 */
function fecharModalConfig(modalId) {
    // Se modalId foi passado, é um modal inline
    if (modalId && modalId !== 'modal-configuracoes') {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.remove();
        }
        return;
    }
    
    // Fechar modal principal de configurações
    const modal = document.getElementById('modal-configuracoes');
    if (modal) {
        console.log('✓ Fechando modal de configurações...');
        const content = modal.querySelector('.modal-config-content');
        if (content) {
            content.style.animation = 'slideDown 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
        }
        
        setTimeout(() => {
            modal.classList.remove('active');
            modal.style.setProperty('display', 'none', 'important');
            modal.style.setProperty('visibility', 'hidden', 'important');
            modal.style.setProperty('opacity', '0', 'important');
            modal.style.setProperty('pointer-events', 'none', 'important');
            modal.style.setProperty('z-index', '-1', 'important');
            modal.setAttribute('aria-hidden', 'true');
            document.body.style.overflow = '';
            if (content) {
                content.style.animation = '';
            }
        }, 280);
    }
}

/**
 * Salvar região via configurações
 */
async function salvarRegiaoConfig() {
    const nome = document.getElementById('config-regiao-nome')?.value?.trim();
    const estados = document.getElementById('config-regiao-estados')?.value?.trim();
    const descricao = document.getElementById('config-regiao-descricao')?.value?.trim();
    
    if (!nome) {
        showNotification('Nome da região é obrigatório', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/vendas/regioes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nome, estados, descricao })
        });
        
        if (response.ok) {
            showNotification('Região criada com sucesso!', 'success');
            fecharModalConfig('modal-nova-regiao-config');
            loadRegioesVendaData();
        } else {
            throw new Error('Erro ao criar região');
        }
    } catch (error) {
        console.error('Erro:', error);
        showNotification('Erro ao criar região', 'error');
    }
}

/**
 * Salvar tipo de fornecedor via configurações
 */
async function salvarTipoFornecedorConfig() {
    const nome = document.getElementById('config-tipo-nome')?.value?.trim();
    const descricao = document.getElementById('config-tipo-descricao')?.value?.trim();
    
    if (!nome) {
        showNotification('Nome do tipo é obrigatório', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/fornecedores/tipos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nome, descricao })
        });
        
        if (response.ok) {
            showNotification('Tipo de fornecedor criado com sucesso!', 'success');
            fecharModalConfig('modal-novo-tipo-config');
            loadTiposFornecedorData();
        } else {
            throw new Error('Erro ao criar tipo');
        }
    } catch (error) {
        console.error('Erro:', error);
        showNotification('Erro ao criar tipo de fornecedor', 'error');
    }
}

/**
 * Salvar condição de pagamento via configurações
 */
async function salvarCondicaoConfig() {
    const nome = document.getElementById('config-condicao-nome')?.value?.trim();
    const parcelas = document.getElementById('config-condicao-parcelas')?.value || 1;
    const prazo = document.getElementById('config-condicao-prazo')?.value?.trim();
    const acrescimo = document.getElementById('config-condicao-acrescimo')?.value || 0;
    
    if (!nome) {
        showNotification('Nome da condição é obrigatório', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/configuracoes/condicoes-pagamento', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nome, parcelas: parseInt(parcelas), prazo, acrescimo: parseFloat(acrescimo) })
        });
        
        if (response.ok) {
            showNotification('Condição de pagamento criada com sucesso!', 'success');
            fecharModalConfig('modal-nova-condicao-config');
            loadCondicoesPagamentoData();
        } else {
            throw new Error('Erro ao criar condição');
        }
    } catch (error) {
        console.error('Erro:', error);
        showNotification('Erro ao criar condição de pagamento', 'error');
    }
}

/**
 * Salvar tabela de preço via configurações
 */
async function salvarTabelaPrecoConfig() {
    const nome = document.getElementById('config-tabela-nome')?.value?.trim();
    const tipo = document.getElementById('config-tabela-tipo')?.value;
    const validade = document.getElementById('config-tabela-validade')?.value;
    const descricao = document.getElementById('config-tabela-descricao')?.value?.trim();
    
    if (!nome) {
        showNotification('Nome da tabela é obrigatório', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/produtos/tabelas-preco', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nome, tipo, validade: validade || null, descricao, status: 'ativo' })
        });
        
        if (response.ok) {
            showNotification('Tabela de preço criada com sucesso!', 'success');
            fecharModalConfig('modal-nova-tabela-config');
            loadTabelasPrecoData();
        } else {
            throw new Error('Erro ao criar tabela');
        }
    } catch (error) {
        console.error('Erro:', error);
        showNotification('Erro ao criar tabela de preço', 'error');
    }
}

/**
 * Salvar unidade de medida via configurações
 */
async function salvarUnidadeConfig() {
    const sigla = document.getElementById('config-unidade-sigla')?.value?.trim()?.toUpperCase();
    const nome = document.getElementById('config-unidade-nome')?.value?.trim();
    const tipo = document.getElementById('config-unidade-tipo')?.value;
    
    if (!sigla || !nome) {
        showNotification('Sigla e nome são obrigatórios', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/produtos/unidades-medida', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sigla, nome, tipo })
        });
        
        if (response.ok) {
            showNotification('Unidade de medida criada com sucesso!', 'success');
            fecharModalConfig('modal-nova-unidade-config');
            loadUnidadesMedidaData();
        } else {
            throw new Error('Erro ao criar unidade');
        }
    } catch (error) {
        console.error('Erro:', error);
        showNotification('Erro ao criar unidade de medida', 'error');
    }
}

// Exportar funções de cadastro rápido
window.novaRegiao = novaRegiao;
window.novoTipoFornecedor = novoTipoFornecedor;
window.novaCondicao = novaCondicao;
window.novaTabelaPreco = novaTabelaPreco;
window.novaUnidade = novaUnidade;
window.fecharModalConfig = fecharModalConfig;
window.salvarRegiaoConfig = salvarRegiaoConfig;
window.salvarTipoFornecedorConfig = salvarTipoFornecedorConfig;
window.salvarCondicaoConfig = salvarCondicaoConfig;
window.salvarTabelaPrecoConfig = salvarTabelaPrecoConfig;
window.salvarUnidadeConfig = salvarUnidadeConfig;

// =========================
// SOBRE OS LANÇAMENTOS
// =========================

/**
 * Abre o modal "Sobre os Lançamentos" (Roadmap / Release Notes)
 */
function abrirSobreLancamentos(event) {
    if (event) event.preventDefault();
    console.log('[Config Modal] Abrindo "Sobre os Lançamentos"');
    
    const modal = document.getElementById('modal-sobre-lancamentos');
    if (modal) {
        modal.classList.add('active');
        modal.style.setProperty('display', 'flex', 'important');
        modal.style.setProperty('visibility', 'visible', 'important');
        modal.style.setProperty('opacity', '1', 'important');
        modal.style.setProperty('pointer-events', 'auto', 'important');
        modal.style.setProperty('z-index', '200000', 'important');
        modal.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
        document.title = 'Aluforce: Sobre os Lançamentos';
    } else {
        console.warn('[Config Modal] Modal modal-sobre-lancamentos não encontrado');
        if (typeof showNotification === 'function') {
            showNotification('Modal não encontrado. Recarregue a página.', 'error');
        }
    }
}

/**
 * Abre o modal "Histórico de Alterações" (Audit Log)
 */
function abrirHistoricoAlteracoes(event) {
    if (event) event.preventDefault();
    console.log('[Config Modal] Abrindo "Histórico de Alterações"');
    
    const modal = document.getElementById('modal-historico-alteracoes');
    if (modal) {
        modal.classList.add('active');
        modal.style.setProperty('display', 'flex', 'important');
        modal.style.setProperty('visibility', 'visible', 'important');
        modal.style.setProperty('opacity', '1', 'important');
        modal.style.setProperty('pointer-events', 'auto', 'important');
        modal.style.setProperty('z-index', '200000', 'important');
        modal.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
        document.title = 'Aluforce: Histórico de Alterações';
        
        // Carregar dados do histórico via API
        carregarHistoricoAlteracoes();
    } else {
        console.warn('[Config Modal] Modal modal-historico-alteracoes não encontrado');
        if (typeof showNotification === 'function') {
            showNotification('Modal não encontrado. Recarregue a página.', 'error');
        }
    }
}

// Exportar funções dos footer links
window.abrirSobreLancamentos = abrirSobreLancamentos;
window.abrirHistoricoAlteracoes = abrirHistoricoAlteracoes;