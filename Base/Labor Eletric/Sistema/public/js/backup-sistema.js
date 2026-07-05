/**
 * Interface de Backup do Sistema
 * Cliente JavaScript para gestáo de backups
 * @author Aluforce ERP
 * @version 1.0.0
 */

const BackupSistema = {
    
    /**
     * Inicializar módulo
     */
    init() {
        this.carregarBackups();
        this.carregarConfiguracao();
        this.bindEvents();
    },

    /**
     * Bind de eventos
     */
    bindEvents() {
        // Botáo criar backup
        const btnCriar = document.getElementById('btn-criar-backup');
        if (btnCriar) {
            btnCriar.addEventListener('click', () => this.criarBackup());
        }

        // Form configuraçáo
        const formConfig = document.getElementById('form-config-backup');
        if (formConfig) {
            formConfig.addEventListener('submit', (e) => {
                e.preventDefault();
                this.salvarConfiguracao();
            });
        }
    },

    /**
     * Carregar lista de backups
     */
    async carregarBackups() {
        try {
            const response = await fetch('/api/backup/listar');
            const result = await response.json();
            
            if (result.success) {
                this.renderizarBackups(result.data);
            }
        } catch (error) {
            console.error('Erro ao carregar backups:', error);
        }
    },

    /**
     * Renderizar lista de backups
     */
    renderizarBackups(backups) {
        const container = document.getElementById('lista-backups');
        if (!container) return;

        if (backups.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-database"></i>
                    <p>Nenhum backup encontrado</p>
                    <button class="btn btn-primary" onclick="BackupSistema.criarBackup()">
                        <i class="fas fa-plus"></i> Criar Primeiro Backup
                    </button>
                </div>
            `;
            return;
        }

        container.innerHTML = `
            <table class="table table-hover">
                <thead>
                    <tr>
                        <th>Arquivo</th>
                        <th>Tamanho</th>
                        <th>Data</th>
                        <th>Ações</th>
                    </tr>
                </thead>
                <tbody>
                    ${backups.map(b => `
                        <tr>
                            <td>
                                <i class="fas fa-file-archive text-muted"></i>
                                ${b.nome}
                            </td>
                            <td>${b.tamanho_formatado}</td>
                            <td>${new Date(b.criado_em).toLocaleString('pt-BR')}</td>
                            <td>
                                <div class="btn-group btn-group-sm">
                                    <button class="btn btn-outline-primary" 
                                            onclick="BackupSistema.download('${b.nome}')"
                                            title="Download">
                                        <i class="fas fa-download"></i>
                                    </button>
                                    <button class="btn btn-outline-warning" 
                                            onclick="BackupSistema.restaurar('${b.nome}')"
                                            title="Restaurar">
                                        <i class="fas fa-undo"></i>
                                    </button>
                                    <button class="btn btn-outline-danger" 
                                            onclick="BackupSistema.excluir('${b.nome}')"
                                            title="Excluir">
                                        <i class="fas fa-trash"></i>
                                    </button>
                                </div>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    },

    /**
     * Criar novo backup
     */
    async criarBackup() {
        const btn = document.getElementById('btn-criar-backup');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Criando backup...';
        }

        try {
            const response = await fetch('/api/backup/criar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ descricao: 'Backup manual' })
            });
            
            const result = await response.json();
            
            if (result.success) {
                showNotification(`Backup criado: ${result.data.arquivo} (${result.data.tamanho})`, 'success');
                await this.carregarBackups();
            } else {
                showNotification('Erro ao criar backup: ' + result.message, 'error');
            }
        } catch (error) {
            console.error('Erro ao criar backup:', error);
            showNotification('Erro ao criar backup', 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-plus"></i> Criar Backup';
            }
        }
    },

    /**
     * Download de backup
     */
    download(arquivo) {
        window.open(`/api/backup/download/${encodeURIComponent(arquivo)}`, '_blank');
    },

    /**
     * Restaurar backup
     */
    async restaurar(arquivo) {
        const confirmar = prompt(`ATENÇÍO: Esta açáo irá substituir TODOS os dados atuais!\n\nPara confirmar, digite RESTAURAR:`);
        
        if (confirmar !== 'RESTAURAR') {
            showNotification('Restauraçáo cancelada', 'info');
            return;
        }

        try {
            const response = await fetch(`/api/backup/restaurar/${encodeURIComponent(arquivo)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ confirmar: 'RESTAURAR' })
            });
            
            const result = await response.json();
            
            if (result.success) {
                showNotification('Backup restaurado com sucesso!', 'success');
                setTimeout(() => {
                    location.reload();
                }, 2000);
            } else {
                showNotification('Erro ao restaurar: ' + result.message, 'error');
            }
        } catch (error) {
            console.error('Erro ao restaurar:', error);
            showNotification('Erro ao restaurar backup', 'error');
        }
    },

    /**
     * Excluir backup
     */
    async excluir(arquivo) {
        if (!confirm(`Deseja excluir o backup "${arquivo}"?`)) return;

        try {
            const response = await fetch(`/api/backup/excluir/${encodeURIComponent(arquivo)}`, {
                method: 'DELETE'
            });
            
            const result = await response.json();
            
            if (result.success) {
                showNotification('Backup excluído', 'success');
                await this.carregarBackups();
            } else {
                showNotification('Erro ao excluir: ' + result.message, 'error');
            }
        } catch (error) {
            console.error('Erro ao excluir:', error);
        }
    },

    /**
     * Carregar configuraçáo de backup automático
     */
    async carregarConfiguracao() {
        try {
            const response = await fetch('/api/backup/configuracao');
            const result = await response.json();
            
            if (result.success) {
                this.preencherConfiguracao(result.data);
            }
        } catch (error) {
            console.error('Erro ao carregar configuraçáo:', error);
        }
    },

    /**
     * Preencher formulário de configuraçáo
     */
    preencherConfiguracao(config) {
        const form = document.getElementById('form-config-backup');
        if (!form) return;

        document.getElementById('backup-ativo').checked = config.ativo;
        document.getElementById('backup-horario').value = config.horario;
        document.getElementById('backup-manter-dias').value = config.manter_dias;
        document.getElementById('backup-email').value = config.notificar_email || '';

        // Checkboxes dos dias
        const dias = config.dias_semana || [0, 1, 2, 3, 4, 5, 6];
        for (let i = 0; i <= 6; i++) {
            const checkbox = document.getElementById(`dia-${i}`);
            if (checkbox) {
                checkbox.checked = dias.includes(i);
            }
        }
    },

    /**
     * Salvar configuraçáo
     */
    async salvarConfiguracao() {
        const dias_semana = [];
        for (let i = 0; i <= 6; i++) {
            const checkbox = document.getElementById(`dia-${i}`);
            if (checkbox?.checked) {
                dias_semana.push(i);
            }
        }

        const config = {
            ativo: document.getElementById('backup-ativo')?.checked || false,
            horario: document.getElementById('backup-horario')?.value || '03:00',
            dias_semana: dias_semana,
            manter_dias: parseInt(document.getElementById('backup-manter-dias')?.value) || 30,
            notificar_email: document.getElementById('backup-email')?.value || ''
        };

        try {
            const response = await fetch('/api/backup/configuracao', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            });
            
            const result = await response.json();
            
            if (result.success) {
                showNotification('Configuraçáo salva', 'success');
            } else {
                showNotification('Erro ao salvar: ' + result.message, 'error');
            }
        } catch (error) {
            console.error('Erro ao salvar configuraçáo:', error);
        }
    },

    /**
     * Limpar backups antigos
     */
    async limparAntigos() {
        const dias = parseInt(prompt('Excluir backups com mais de quantos dias?', '30'));
        
        if (isNaN(dias) || dias < 1) {
            showNotification('Informe um número válido de dias', 'warning');
            return;
        }

        if (!confirm(`Excluir todos os backups com mais de ${dias} dias?`)) return;

        try {
            const response = await fetch('/api/backup/limpar-antigos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dias })
            });
            
            const result = await response.json();
            
            if (result.success) {
                showNotification(`${result.data.excluidos} backup(s) excluído(s)`, 'success');
                await this.carregarBackups();
            }
        } catch (error) {
            console.error('Erro ao limpar:', error);
        }
    }
};

// Inicializar quando DOM estiver pronto
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('modulo-backup')) {
        BackupSistema.init();
    }
});
