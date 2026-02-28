// ============================================================================
// SISTEMA DE UPLOAD E GESTÃO DE ANEXOS - Sistema Financeiro Aluforce
// ============================================================================

class GestorAnexos {
    constructor() {
        this.anexos = [];
        this.maxTamanhoMB = 10;
        this.tiposPermitidos = [
            'application/pdf',
            'image/jpeg',
            'image/png',
            'image/jpg',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
            'application/vnd.ms-excel', // xls
            'application/msword', // doc
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
            'text/plain',
            'text/csv'
        ];
    }

    // ============================================================================
    // INICIALIZAÇÃO
    // ============================================================================

    inicializar(containerId, opções = {}) {
        this.container = document.getElementById(containerId);
        this.opções = {
            entidade: opções.entidade || 'contas_pagar', // contas_pagar, contas_receber, fornecedor, cliente, etc
            entidadeId: opções.entidadeId || null,
            permiteMultiplos: opções.permiteMultiplos !== false,
            onUploadCompleto: opções.onUploadCompleto || null,
            onErro: opções.onErro || null,
            ...opções
        };

        this.renderizarInterface();
        this.carregarAnexos();
    }

    // ============================================================================
    // INTERFACE
    // ============================================================================

    renderizarInterface() {
        this.container.innerHTML = `
            <div class="anexos-container">
                <div class="anexos-header">
                    <h4><i class="fas fa-paperclip"></i> Anexos</h4>
                    <button class="btn-adicionar-anexo" onclick="gestorAnexos.abrirSeletorArquivo()">
                        <i class="fas fa-plus"></i> Adicionar Arquivo
                    </button>
                </div>

                <div class="dropzone" id="dropzone">
                    <input type="file" id="file-input" ${this.opções.permiteMultiplos ? 'multiple' : ''} 
                           style="display: none;" onchange="gestorAnexos.handleFileSelect(event)">
                    <i class="fas fa-cloud-upload-alt"></i>
                    <p>Arraste arquivos aqui ou clique para selecionar</p>
                    <span class="dropzone-info">Máximo ${this.maxTamanhoMB}MB por arquivo</span>
                </div>

                <div class="anexos-lista" id="anexos-lista">
                    <!-- Lista de anexos será inserida aqui -->
                </div>
            </div>

            <style>
                .anexos-container {
                    background: white;
                    border-radius: 8px;
                    padding: 20px;
                    margin: 20px 0;
                }

                .anexos-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 20px;
                    padding-bottom: 15px;
                    border-bottom: 2px solid #e5e7eb;
                }

                .anexos-header h4 {
                    margin: 0;
                    color: #333;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }

                .btn-adicionar-anexo {
                    padding: 8px 16px;
                    background: linear-gradient(135deg, #10b981 0%, #059669 100%);
                    color: white;
                    border: none;
                    border-radius: 6px;
                    cursor: pointer;
                    font-weight: 600;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    transition: all 0.2s;
                }

                .btn-adicionar-anexo:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 4px 8px rgba(16, 185, 129, 0.3);
                }

                .dropzone {
                    border: 2px dashed #ddd;
                    border-radius: 8px;
                    padding: 40px;
                    text-align: center;
                    cursor: pointer;
                    transition: all 0.2s;
                    margin-bottom: 20px;
                }

                .dropzone:hover,
                .dropzone.drag-over {
                    border-color: #10b981;
                    background: #f0fdf4;
                }

                .dropzone i {
                    font-size: 48px;
                    color: #10b981;
                    margin-bottom: 15px;
                    display: block;
                }

                .dropzone p {
                    margin: 0 0 5px 0;
                    color: #333;
                    font-weight: 600;
                }

                .dropzone-info {
                    color: #666;
                    font-size: 13px;
                }

                .anexos-lista {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
                    gap: 15px;
                }

                .anexo-item {
                    background: #f9fafb;
                    border: 1px solid #e5e7eb;
                    border-radius: 8px;
                    padding: 15px;
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                    transition: all 0.2s;
                }

                .anexo-item:hover {
                    border-color: #10b981;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                }

                .anexo-icone {
                    font-size: 48px;
                    color: #10b981;
                    text-align: center;
                }

                .anexo-info {
                    flex: 1;
                }

                .anexo-nome {
                    font-weight: 600;
                    color: #333;
                    margin-bottom: 5px;
                    word-break: break-word;
                }

                .anexo-meta {
                    font-size: 12px;
                    color: #666;
                    display: flex;
                    flex-direction: column;
                    gap: 3px;
                }

                .anexo-acoes {
                    display: flex;
                    gap: 8px;
                    justify-content: flex-end;
                }

                .anexo-acoes button {
                    padding: 6px 12px;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 12px;
                    transition: all 0.2s;
                }

                .btn-baixar {
                    background: #3b82f6;
                    color: white;
                }

                .btn-baixar:hover {
                    background: #2563eb;
                }

                .btn-visualizar {
                    background: #8b5cf6;
                    color: white;
                }

                .btn-visualizar:hover {
                    background: #7c3aed;
                }

                .btn-excluir {
                    background: #ef4444;
                    color: white;
                }

                .btn-excluir:hover {
                    background: #dc2626;
                }

                .upload-progress {
                    background: #e5e7eb;
                    border-radius: 4px;
                    height: 6px;
                    overflow: hidden;
                    margin-top: 8px;
                }

                .upload-progress-bar {
                    background: linear-gradient(90deg, #10b981 0%, #059669 100%);
                    height: 100%;
                    transition: width 0.3s;
                }

                .anexo-item.uploading {
                    opacity: 0.6;
                }

                .anexo-descrição {
                    background: white;
                    padding: 8px;
                    border-radius: 4px;
                    font-size: 13px;
                    color: #666;
                    margin-top: 5px;
                }

                @media (max-width: 768px) {
                    .anexos-lista {
                        grid-template-columns: 1fr;
                    }
                }
            </style>
        `;

        this.configurarDragAndDrop();
    }

    configurarDragAndDrop() {
        const dropzone = document.getElementById('dropzone');

        dropzone.addEventListener('click', () => this.abrirSeletorArquivo());

        dropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropzone.classList.add('drag-over');
        });

        dropzone.addEventListener('dragleave', () => {
            dropzone.classList.remove('drag-over');
        });

        dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropzone.classList.remove('drag-over');
            this.handleFiles(e.dataTransfer.files);
        });
    }

    abrirSeletorArquivo() {
        document.getElementById('file-input').click();
    }

    handleFileSelect(event) {
        this.handleFiles(event.target.files);
    }

    // ============================================================================
    // UPLOAD DE ARQUIVOS
    // ============================================================================

    async handleFiles(files) {
        const arquivos = Array.from(files);

        for (const arquivo of arquivos) {
            // Validações
            if (!this.validarArquivo(arquivo)) {
                continue;
            }

            // Adicionar à lista temporariamente
            const anexoTemp = {
                id: 'temp_' + Date.now(),
                nome: arquivo.name,
                tamanho: arquivo.tamanho,
                tipo: arquivo.type,
                uploading: true,
                progresso: 0
            };

            this.anexos.push(anexoTemp);
            this.renderizarLista();

            // Fazer upload
            try {
                const resultado = await this.uploadArquivo(arquivo, anexoTemp.id);
                
                // Atualizar com dados reais
                const index = this.anexos.findIndex(a => a.id === anexoTemp.id);
                if (index !== -1) {
                    this.anexos[index] = resultado;
                }

                this.renderizarLista();

                if (this.opções.onUploadCompleto) {
                    this.opções.onUploadCompleto(resultado);
                }

            } catch (error) {
                console.error('Erro no upload:', error);
                
                // Remover arquivo com erro
                this.anexos = this.anexos.filter(a => a.id !== anexoTemp.id);
                this.renderizarLista();

                if (this.opções.onErro) {
                    this.opções.onErro(error);
                }

                this.mostrarErro('Erro ao fazer upload: ' + arquivo.name);
            }
        }
    }

    validarArquivo(arquivo) {
        // Validar tamanho
        const tamanhoMB = arquivo.size / (1024 * 1024);
        if (tamanhoMB > this.maxTamanhoMB) {
            this.mostrarErro(`Arquivo muito grande: ${arquivo.name}. Máximo ${this.maxTamanhoMB}MB.`);
            return false;
        }

        // Validar tipo
        if (!this.tiposPermitidos.includes(arquivo.type)) {
            this.mostrarErro(`Tipo de arquivo não permitido: ${arquivo.name}`);
            return false;
        }

        return true;
    }

    async uploadArquivo(arquivo, tempId) {
        const formData = new FormData();
        formData.append('arquivo', arquivo);
        formData.append('entidade', this.opções.entidade);
        formData.append('entidade_id', this.opções.entidadeId);

        const token = localStorage.getItem('token') || sessionStorage.getItem('token');
        
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable) {
                    const progresso = (e.loaded / e.total) * 100;
                    this.atualizarProgresso(tempId, progresso);
                }
            });
            xhr.addEventListener('load', () => {
                if (xhr.status === 200) {
                    try {
                        const resultado = JSON.parse(xhr.responseText);
                        resolve(resultado);
                    } catch(e) {
                        resolve({
                            id: Date.now().toString(),
                            nome: arquivo.name,
                            tamanho: arquivo.size,
                            tipo: arquivo.type,
                            url: URL.createObjectURL(arquivo),
                            data_upload: new Date().toISOString()
                        });
                    }
                } else {
                    reject(new Error('Erro no upload'));
                }
            });
            xhr.addEventListener('error', () => reject(new Error('Erro de rede')));
            xhr.open('POST', '/api/financeiro/anexar-comprovante');
            xhr.setRequestHeader('Authorization', `Bearer ${token}`);
            xhr.send(formData);
        });
    }

    atualizarProgresso(anexoId, progresso) {
        const anexo = this.anexos.find(a => a.id === anexoId);
        if (anexo) {
            anexo.progresso = progresso;
            
            const elemento = document.querySelector(`[data-anexo-id="${anexoId}"] .upload-progress-bar`);
            if (elemento) {
                elemento.style.width = progresso + '%';
            }
        }
    }

    // ============================================================================
    // CARREGAMENTO DE ANEXOS EXISTENTES
    // ============================================================================

    async carregarAnexos() {
        if (!this.opções.entidadeId) return;

        try {
            // TODO: Substituir por chamada real à API
            const anexos = await this.buscarAnexos();
            this.anexos = anexos;
            this.renderizarLista();
        } catch (error) {
            console.error('Erro ao carregar anexos:', error);
        }
    }

    async buscarAnexos() {
        const token = localStorage.getItem('token') || sessionStorage.getItem('token');
        const response = await fetch(`/api/financeiro/anexar-comprovante?entidade=${this.opções.entidade}&entidade_id=${this.opções.entidadeId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) return [];
        return await response.json();
    }

    // ============================================================================
    // RENDERIZAÇÃO DA LISTA
    // ============================================================================

    renderizarLista() {
        const lista = document.getElementById('anexos-lista');

        if (this.anexos.length === 0) {
            lista.innerHTML = '<p style="text-align: center; color: #999; padding: 20px;">Nenhum anexo adicionado</p>';
            return;
        }

        lista.innerHTML = this.anexos.map(anexo => this.renderizarAnexo(anexo)).join('');
    }

    renderizarAnexo(anexo) {
        const icone = this.obterIcone(anexo.tipo);
        const tamanhoFormatado = this.formatarTamanho(anexo.tamanho);
        const dataFormatada = anexo.data_upload ? this.formatarData(anexo.data_upload) : '';

        return `
            <div class="anexo-item ${anexo.uploading ? 'uploading' : ''}" data-anexo-id="${anexo.id}">
                <div class="anexo-icone">
                    <i class="fas ${icone}"></i>
                </div>
                <div class="anexo-info">
                    <div class="anexo-nome">${anexo.nome}</div>
                    <div class="anexo-meta">
                        <span><i class="fas fa-hdd"></i> ${tamanhoFormatado}</span>
                        ${dataFormatada ? `<span><i class="fas fa-calendar"></i> ${dataFormatada}</span>` : ''}
                        ${anexo.usuario ? `<span><i class="fas fa-user"></i> ${anexo.usuario}</span>` : ''}
                    </div>
                    ${anexo.descrição ? `<div class="anexo-descrição">${anexo.descrição}</div>` : ''}
                    ${anexo.uploading ? `
                        <div class="upload-progress">
                            <div class="upload-progress-bar" style="width: ${anexo.progresso || 0}%"></div>
                        </div>
                    ` : ''}
                </div>
                ${!anexo.uploading ? `
                    <div class="anexo-acoes">
                        ${this.podeVisualizar(anexo.tipo) ? `
                            <button class="btn-visualizar" onclick="gestorAnexos.visualizar('${anexo.id}')">
                                <i class="fas fa-eye"></i>
                            </button>
                        ` : ''}
                        <button class="btn-baixar" onclick="gestorAnexos.baixar('${anexo.id}')">
                            <i class="fas fa-download"></i>
                        </button>
                        <button class="btn-excluir" onclick="gestorAnexos.excluir('${anexo.id}')">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                ` : ''}
            </div>
        `;
    }

    obterIcone(tipo) {
        if (tipo.includes('pdf')) return 'fa-file-pdf';
        if (tipo.includes('image')) return 'fa-file-image';
        if (tipo.includes('spreadsheet') || tipo.includes('excel')) return 'fa-file-excel';
        if (tipo.includes('word') || tipo.includes('document')) return 'fa-file-word';
        if (tipo.includes('text')) return 'fa-file-alt';
        return 'fa-file';
    }

    podeVisualizar(tipo) {
        return tipo.includes('pdf') || tipo.includes('image');
    }

    // ============================================================================
    // AÇÕES COM ANEXOS
    // ============================================================================

    async visualizar(anexoId) {
        const anexo = this.anexos.find(a => a.id === anexoId);
        if (!anexo) return;

        // TODO: Implementar visualizador inline ou abrir em nova aba
        if (anexo.url) {
            window.open(anexo.url, '_blank');
        } else {
            // Buscar URL da API
            const url = await this.obterUrlAnexo(anexoId);
            window.open(url, '_blank');
        }
    }

    async baixar(anexoId) {
        const anexo = this.anexos.find(a => a.id === anexoId);
        if (!anexo) return;

        try {
            // TODO: Substituir por chamada real à API
            const url = anexo.url || await this.obterUrlAnexo(anexoId);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = anexo.nome;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);

        } catch (error) {
            console.error('Erro ao baixar anexo:', error);
            this.mostrarErro('Erro ao baixar arquivo');
        }
    }

    async excluir(anexoId) {
        if (!confirm('Deseja realmente excluir este anexo?')) return;

        try {
            // TODO: Substituir por chamada real à API
            await this.excluirAnexo(anexoId);
            
            this.anexos = this.anexos.filter(a => a.id !== anexoId);
            this.renderizarLista();

            this.mostrarSucesso('Anexo excluído com sucesso');

        } catch (error) {
            console.error('Erro ao excluir anexo:', error);
            this.mostrarErro('Erro ao excluir anexo');
        }
    }

    async obterUrlAnexo(anexoId) {
        // TODO: Substituir por chamada real à API
        // return await fetch(`/api/financeiro/anexos/${anexoId}/url`).then(r => r.json()).then(data => data.url);
        return '#';
    }

    async excluirAnexo(anexoId) {
        // TODO: Substituir por chamada real à API
        // return await fetch(`/api/financeiro/anexos/${anexoId}`, { method: 'DELETE' }).then(r => r.json());
        return { success: true };
    }

    // ============================================================================
    // UTILITÁRIOS
    // ============================================================================

    formatarTamanho(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    formatarData(dataISO) {
        const data = new Date(dataISO);
        return data.toLocaleDateString('pt-BR') + ' ' + data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }

    mostrarErro(mensagem) {
        console.error(mensagem);
        alert('❌ ' + mensagem);
    }

    mostrarSucesso(mensagem) {
        console.log(mensagem);
        alert('✅ ' + mensagem);
    }

    // ============================================================================
    // API PÚBLICA
    // ============================================================================

    obterAnexos() {
        return this.anexos.filter(a => !a.uploading);
    }

    limpar() {
        this.anexos = [];
        this.renderizarLista();
    }
}

// Instância global
const gestorAnexos = new GestorAnexos();
