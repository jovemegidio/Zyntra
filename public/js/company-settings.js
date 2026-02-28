/**
 * Company Settings Manager
 * Gerenciamento de configurações da empresa
 */

const CompanySettings = {
    currentModal: null,
    empresaData: null,
    categorias: [],
    departamentos: [],
    projetos: [],

    /**
     * Inicialização
     */
    init() {
        this.setupEventListeners();
        this.loadEmpresaData();
    },

    /**
     * Configura event listeners para os cards
     */
    setupEventListeners() {
        // Event listeners para os cards do modal Omie
        document.querySelectorAll('.omie-config-card').forEach((card, index) => {
            card.addEventListener('click', (e) => {
                e.preventDefault();
                this.handleCardClick(index);
            });
        });

        // Fechar modal ao clicar fora
        document.querySelectorAll('.config-detail-modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.closeConfigModal(modal.id);
                }
            });
        });
    },

    /**
     * Manipula clique nos cards
     */
    handleCardClick(cardIndex) {
        const modals = [
            'modal-dados-empresa',
            'modal-categorias',
            'modal-departamentos',
            'modal-projetos',
            'modal-certificado',
            'modal-nfe-import'
        ];

        if (modals[cardIndex]) {
            this.openConfigModal(modals[cardIndex]);
        }
    },

    /**
     * Abre um modal de configuração
     */
    openConfigModal(modalId) {
        const modal = document.getElementById(modalId);
        if (!modal) return;

        // Carrega dados específicos do modal
        switch(modalId) {
            case 'modal-dados-empresa':
                this.loadEmpresaForm();
                break;
            case 'modal-categorias':
                this.loadCategorias();
                break;
            case 'modal-departamentos':
                this.loadDepartamentos();
                break;
            case 'modal-projetos':
                this.loadProjetos();
                break;
            case 'modal-certificado':
                this.loadCertificadoInfo();
                break;
            case 'modal-nfe-import':
                this.loadNfeInfo();
                break;
        }

        modal.classList.add('active');
        this.currentModal = modalId;
    },

    /**
     * Fecha modal de configuração
     */
    closeConfigModal(modalId) {
        const modal = document.getElementById(modalId);
        if (!modal) return;

        modal.classList.remove('active');
        this.currentModal = null;
    },

    /**
     * Carrega dados da empresa da API
     */
    async loadEmpresaData() {
        try {
            // Verifica se o usuário está autenticado
            const userData = localStorage.getItem('userData');
            if (!userData) {
                console.log('[CompanySettings] Usuário não autenticado, pulando carregamento de dados da empresa');
                return;
            }

            const response = await fetch('/api/empresa-config', {
                method: 'GET',
                credentials: 'include'
            });

            if (response.ok) {
                this.empresaData = await response.json();
            } else if (response.status === 401) {
                console.log('[CompanySettings] Não autorizado para acessar configurações da empresa');
            }
        } catch (error) {
            console.error('Erro ao carregar dados da empresa:', error);
        }
    },

    /**
     * Preenche formulário de dados da empresa
     */
    loadEmpresaForm() {
        if (!this.empresaData) return;

        const form = document.getElementById('form-dados-empresa');
        if (!form) return;

        // Preenche cada campo
        const fields = [
            'razao_social', 'nome_fantasia', 'cnpj', 'inscricao_estadual',
            'inscricao_municipal', 'telefone', 'email', 'site', 'cep',
            'estado', 'cidade', 'bairro', 'endereco', 'número', 'complemento'
        ];

        fields.forEach(field => {
            const input = form.querySelector(`[name="${field}"]`);
            if (input && this.empresaData[field]) {
                input.value = this.empresaData[field];
            }
        });

        // Atualiza nome do arquivo favicon
        const faviconName = form.querySelector('.config-file-upload-name');
        if (faviconName && this.empresaData.favicon_path) {
            faviconName.textContent = this.empresaData.favicon_path.split('/').pop();
        }
    },

    /**
     * Salva configurações da empresa
     */
    async saveEmpresaConfig() {
        const form = document.getElementById('form-dados-empresa');
        if (!form) return;

        const formData = new FormData(form);
        const data = Object.fromEntries(formData);

        try {
            const response = await fetch('/api/empresa-config', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify(data)
            });

            if (response.ok) {
                this.showMessage('success', 'Configurações salvas com sucesso!');
                await this.loadEmpresaData();
                setTimeout(() => {
                    this.closeConfigModal('modal-dados-empresa');
                }, 1500);
            } else {
                throw new Error('Erro ao salvar');
            }
        } catch (error) {
            console.error('Erro ao salvar configurações:', error);
            this.showMessage('error', 'Erro ao salvar configurações');
        }
    },

    /**
     * Carrega categorias
     */
    async loadCategorias() {
        try {
            const response = await fetch('/api/categorias', {
                credentials: 'include'
            });

            if (response.ok) {
                this.categorias = await response.json();
                this.renderCategorias();
            }
        } catch (error) {
            console.error('Erro ao carregar categorias:', error);
        }
    },

    /**
     * Renderiza lista de categorias
     */
    renderCategorias() {
        const list = document.getElementById('categorias-list');
        const empty = document.getElementById('categorias-empty');

        if (!list || !empty) return;

        if (this.categorias.length === 0) {
            list.style.display = 'none';
            empty.style.display = 'flex';
            return;
        }

        list.style.display = 'flex';
        list.style.flexDirection = 'column';
        list.style.gap = '12px';
        empty.style.display = 'none';

        // Cores para categorias
        const cores = ['#f97316', '#eab308', '#22c55e', '#06b6d4', '#8b5cf6', '#ec4899'];

        list.innerHTML = this.categorias.map((cat, index) => {
            const cor = cat.cor || cores[index % cores.length];
            return `
            <div style="display: flex; align-items: center; gap: 16px; padding: 16px 20px; background: linear-gradient(135deg, #fafafa 0%, #ffffff 100%); border-radius: 14px; border: 1px solid #e5e7eb; transition: all 0.3s ease; position: relative; overflow: hidden; cursor: pointer;" onmouseenter="this.style.transform='translateX(4px)'; this.style.boxShadow='0 8px 25px rgba(0,0,0,0.08)'; this.style.borderColor='${cor}40';" onmouseleave="this.style.transform='translateX(0)'; this.style.boxShadow='none'; this.style.borderColor='#e5e7eb';">
                <div style="position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: ${cor};"></div>
                <div style="width: 46px; height: 46px; background: linear-gradient(135deg, ${cor}15, ${cor}25); border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                    <i class="fas fa-folder" style="font-size: 20px; color: ${cor};"></i>
                </div>
                <div style="flex: 1; min-width: 0;">
                    <h4 style="margin: 0 0 4px 0; font-size: 15px; font-weight: 600; color: #1f2937;">${cat.nome}</h4>
                    <p style="margin: 0; font-size: 13px; color: #6b7280; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${cat.descrição || cat.descricao || 'Sem descrição'}</p>
                </div>
                <div style="display: flex; gap: 8px;">
                    <button onclick="CompanySettings.editCategoria(${cat.id})" title="Editar" style="width: 38px; height: 38px; border: none; background: linear-gradient(135deg, #3b82f6, #2563eb); color: white; border-radius: 10px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s; box-shadow: 0 2px 8px rgba(59, 130, 246, 0.3);" onmouseenter="this.style.transform='scale(1.08)';" onmouseleave="this.style.transform='scale(1)';">
                        <i class="fas fa-pen" style="font-size: 14px;"></i>
                    </button>
                    <button onclick="CompanySettings.deleteCategoria(${cat.id})" title="Excluir" style="width: 38px; height: 38px; border: none; background: linear-gradient(135deg, #ef4444, #dc2626); color: white; border-radius: 10px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s; box-shadow: 0 2px 8px rgba(239, 68, 68, 0.3);" onmouseenter="this.style.transform='scale(1.08)';" onmouseleave="this.style.transform='scale(1)';">
                        <i class="fas fa-trash-alt" style="font-size: 14px;"></i>
                    </button>
                </div>
            </div>
        `;
        }).join('');
    },

    /**
     * Carrega departamentos
     */
    async loadDepartamentos() {
        try {
            const response = await fetch('/api/departamentos', {
                credentials: 'include'
            });

            if (response.ok) {
                this.departamentos = await response.json();
                this.renderDepartamentos();
            }
        } catch (error) {
            console.error('Erro ao carregar departamentos:', error);
        }
    },

    /**
     * Renderiza lista de departamentos
     */
    renderDepartamentos() {
        const list = document.getElementById('departamentos-list');
        const empty = document.getElementById('departamentos-empty');

        if (!list || !empty) return;

        if (this.departamentos.length === 0) {
            list.style.display = 'none';
            empty.style.display = 'flex';
            return;
        }

        list.style.display = 'flex';
        list.style.flexDirection = 'column';
        list.style.gap = '12px';
        empty.style.display = 'none';

        // Cores para departamentos
        const cores = ['#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#06b6d4', '#ec4899'];

        list.innerHTML = this.departamentos.map((dept, index) => {
            const cor = dept.cor || cores[index % cores.length];
            return `
            <div style="display: flex; align-items: center; gap: 16px; padding: 16px 20px; background: linear-gradient(135deg, #fafafa 0%, #ffffff 100%); border-radius: 14px; border: 1px solid #e5e7eb; transition: all 0.3s ease; position: relative; overflow: hidden; cursor: pointer;" onmouseenter="this.style.transform='translateX(4px)'; this.style.boxShadow='0 8px 25px rgba(0,0,0,0.08)'; this.style.borderColor='${cor}40';" onmouseleave="this.style.transform='translateX(0)'; this.style.boxShadow='none'; this.style.borderColor='#e5e7eb';">
                <div style="position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: ${cor};"></div>
                <div style="width: 46px; height: 46px; background: linear-gradient(135deg, ${cor}15, ${cor}25); border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                    <i class="fas fa-building" style="font-size: 20px; color: ${cor};"></i>
                </div>
                <div style="flex: 1; min-width: 0;">
                    <h4 style="margin: 0 0 4px 0; font-size: 15px; font-weight: 600; color: #1f2937;">${dept.nome} ${dept.sigla ? `<span style="font-weight: 400; color: #6b7280;">(${dept.sigla})</span>` : ''}</h4>
                    <p style="margin: 0; font-size: 13px; color: #6b7280; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${dept.descrição || dept.descricao || (dept.responsavel_nome ? `Responsável: ${dept.responsavel_nome}` : 'Sem descrição')}</p>
                </div>
                <div style="display: flex; gap: 8px;">
                    <button onclick="CompanySettings.editDepartamento(${dept.id})" title="Editar" style="width: 38px; height: 38px; border: none; background: linear-gradient(135deg, #3b82f6, #2563eb); color: white; border-radius: 10px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s; box-shadow: 0 2px 8px rgba(59, 130, 246, 0.3);" onmouseenter="this.style.transform='scale(1.08)';" onmouseleave="this.style.transform='scale(1)';">
                        <i class="fas fa-pen" style="font-size: 14px;"></i>
                    </button>
                    <button onclick="CompanySettings.deleteDepartamento(${dept.id})" title="Excluir" style="width: 38px; height: 38px; border: none; background: linear-gradient(135deg, #ef4444, #dc2626); color: white; border-radius: 10px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s; box-shadow: 0 2px 8px rgba(239, 68, 68, 0.3);" onmouseenter="this.style.transform='scale(1.08)';" onmouseleave="this.style.transform='scale(1)';">
                        <i class="fas fa-trash-alt" style="font-size: 14px;"></i>
                    </button>
                </div>
            </div>
        `;
        }).join('');
    },

    /**
     * Carrega projetos
     */
    async loadProjetos() {
        try {
            const response = await fetch('/api/projetos', {
                credentials: 'include'
            });

            if (response.ok) {
                this.projetos = await response.json();
                this.renderProjetos();
            }
        } catch (error) {
            console.error('Erro ao carregar projetos:', error);
        }
    },

    /**
     * Renderiza lista de projetos
     */
    renderProjetos() {
        const list = document.getElementById('projetos-list');
        const empty = document.getElementById('projetos-empty');

        if (!list || !empty) return;

        if (this.projetos.length === 0) {
            list.style.display = 'none';
            empty.style.display = 'flex';
            return;
        }

        list.style.display = 'flex';
        list.style.flexDirection = 'column';
        list.style.gap = '12px';
        empty.style.display = 'none';

        const statusConfig = {
            'planejamento': { texto: 'Planejamento', cor: '#6366f1' },
            'em_andamento': { texto: 'Em Andamento', cor: '#3b82f6' },
            'ativo': { texto: 'Ativo', cor: '#8b5cf6' },
            'pausado': { texto: 'Pausado', cor: '#f59e0b' },
            'concluido': { texto: 'Concluído', cor: '#10b981' },
            'cancelado': { texto: 'Cancelado', cor: '#ef4444' }
        };

        list.innerHTML = this.projetos.map((proj) => {
            const status = statusConfig[proj.status] || statusConfig['ativo'];
            const cor = proj.cor || status.cor;
            return `
            <div style="display: flex; align-items: center; gap: 16px; padding: 16px 20px; background: linear-gradient(135deg, #fafafa 0%, #ffffff 100%); border-radius: 14px; border: 1px solid #e5e7eb; transition: all 0.3s ease; position: relative; overflow: hidden; cursor: pointer;" onmouseenter="this.style.transform='translateX(4px)'; this.style.boxShadow='0 8px 25px rgba(0,0,0,0.08)'; this.style.borderColor='${cor}40';" onmouseleave="this.style.transform='translateX(0)'; this.style.boxShadow='none'; this.style.borderColor='#e5e7eb';">
                <div style="position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: ${cor};"></div>
                <div style="width: 46px; height: 46px; background: linear-gradient(135deg, ${cor}15, ${cor}25); border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                    <i class="fas fa-rocket" style="font-size: 20px; color: ${cor};"></i>
                </div>
                <div style="flex: 1; min-width: 0;">
                    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 4px;">
                        <h4 style="margin: 0; font-size: 15px; font-weight: 600; color: #1f2937;">${proj.nome}</h4>
                        <span style="padding: 3px 10px; background: ${status.cor}20; color: ${status.cor}; border-radius: 20px; font-size: 11px; font-weight: 600;">${status.texto}</span>
                    </div>
                    <p style="margin: 0; font-size: 13px; color: #6b7280; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${proj.descrição || proj.descricao || (proj.departamento_nome ? proj.departamento_nome : 'Sem descrição')}</p>
                </div>
                <div style="display: flex; gap: 8px;">
                    <button onclick="CompanySettings.editProjeto(${proj.id})" title="Editar" style="width: 38px; height: 38px; border: none; background: linear-gradient(135deg, #3b82f6, #2563eb); color: white; border-radius: 10px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s; box-shadow: 0 2px 8px rgba(59, 130, 246, 0.3);" onmouseenter="this.style.transform='scale(1.08)';" onmouseleave="this.style.transform='scale(1)';">
                        <i class="fas fa-pen" style="font-size: 14px;"></i>
                    </button>
                    <button onclick="CompanySettings.deleteProjeto(${proj.id})" title="Excluir" style="width: 38px; height: 38px; border: none; background: linear-gradient(135deg, #ef4444, #dc2626); color: white; border-radius: 10px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s; box-shadow: 0 2px 8px rgba(239, 68, 68, 0.3);" onmouseenter="this.style.transform='scale(1.08)';" onmouseleave="this.style.transform='scale(1)';">
                        <i class="fas fa-trash-alt" style="font-size: 14px;"></i>
                    </button>
                </div>
            </div>
        `;
        }).join('');
    },

    /**
     * Carrega informações do certificado
     */
    loadCertificadoInfo() {
        if (!this.empresaData) return;

        const form = document.getElementById('form-certificado');
        if (!form) return;

        // Preenche dados do certificado se existirem
        if (this.empresaData.certificado_validade) {
            document.querySelector('[name="certificado_validade"]').value = 
                this.empresaData.certificado_validade;
            
            const info = document.getElementById('certificado-info');
            const expiracao = document.getElementById('certificado-expiracao');
            
            if (info && expiracao) {
                expiracao.textContent = new Date(this.empresaData.certificado_validade)
                    .toLocaleDateString('pt-BR');
                info.style.display = 'flex';
            }
        }

        if (this.empresaData.certificado_a1_path) {
            const fileName = this.empresaData.certificado_a1_path.split('/').pop();
            const fileNameSpan = form.querySelector('.config-file-upload-name');
            if (fileNameSpan) {
                fileNameSpan.textContent = fileName;
            }
        }
    },

    /**
     * Salva configurações do certificado
     */
    async saveCertificadoConfig() {
        const form = document.getElementById('form-certificado');
        if (!form) return;

        const formData = new FormData(form);
        const data = Object.fromEntries(formData);

        try {
            const response = await fetch('/api/empresa-config/certificado', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify(data)
            });

            if (response.ok) {
                this.showMessage('success', 'Certificado salvo com sucesso!');
                await this.loadEmpresaData();
                setTimeout(() => {
                    this.closeConfigModal('modal-certificado');
                }, 1500);
            } else {
                throw new Error('Erro ao salvar');
            }
        } catch (error) {
            console.error('Erro ao salvar certificado:', error);
            this.showMessage('error', 'Erro ao salvar certificado');
        }
    },

    /**
     * Carrega informações do agente NF-e
     */
    loadNfeInfo() {
        if (!this.empresaData) return;

        const checkbox = document.getElementById('nfe-agente-ativo');
        const statusInfo = document.getElementById('nfe-status-info');
        const dataAtivacao = document.getElementById('nfe-data-ativacao');

        if (checkbox) {
            checkbox.checked = this.empresaData.nfe_agente_ativo;
        }

        if (statusInfo && this.empresaData.nfe_agente_ativo) {
            statusInfo.style.display = 'block';
            if (dataAtivacao && this.empresaData.nfe_agente_data_ativacao) {
                dataAtivacao.textContent = new Date(this.empresaData.nfe_agente_data_ativacao)
                    .toLocaleString('pt-BR');
            }
        }
    },

    /**
     * Salva configurações de NF-e
     */
    async saveNfeConfig() {
        const checkbox = document.getElementById('nfe-agente-ativo');
        if (!checkbox) return;

        try {
            const response = await fetch('/api/empresa-config/nfe', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify({
                    nfe_agente_ativo: checkbox.checked
                })
            });

            if (response.ok) {
                this.showMessage('success', 'Configuração salva com sucesso!');
                await this.loadEmpresaData();
                setTimeout(() => {
                    this.closeConfigModal('modal-nfe-import');
                }, 1500);
            } else {
                throw new Error('Erro ao salvar');
            }
        } catch (error) {
            console.error('Erro ao salvar configuração NF-e:', error);
            this.showMessage('error', 'Erro ao salvar configuração');
        }
    },

    /**
     * Mostra mensagem de feedback
     */
    showMessage(type, message) {
        // Implementar toast/notification
        console.log(`[${type}] ${message}`);
    },

    // Métodos auxiliares para edição/exclusão (TODO: implementar)
    editCategoria(id) { console.log('Editar categoria:', id); },
    deleteCategoria(id) { console.log('Deletar categoria:', id); },
    editDepartamento(id) { console.log('Editar departamento:', id); },
    deleteDepartamento(id) { console.log('Deletar departamento:', id); },
    editProjeto(id) { console.log('Editar projeto:', id); },
    deleteProjeto(id) { console.log('Deletar projeto:', id); }
};

// Funções globais para serem chamadas do HTML
function closeConfigModal(modalId) {
    CompanySettings.closeConfigModal(modalId);
}

function saveEmpresaConfig() {
    CompanySettings.saveEmpresaConfig();
}

function saveCertificadoConfig() {
    CompanySettings.saveCertificadoConfig();
}

function saveNfeConfig() {
    CompanySettings.saveNfeConfig();
}

// Inicializa quando o documento estiver pronto
document.addEventListener('DOMContentLoaded', () => {
    // Aguarda um pouco para garantir que outros scripts carregaram
    setTimeout(() => {
        CompanySettings.init();
    }, 500);
});
