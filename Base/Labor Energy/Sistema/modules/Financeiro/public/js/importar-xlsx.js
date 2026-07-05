/**
 * Módulo de Importação XLSX - Financeiro ALUFORCE
 * Sistema de importação de planilhas Excel para o módulo Financeiro
 * Inclua este arquivo e a biblioteca xlsx.js nas páginas do financeiro
 * v2.1 - 2026-02-18 - Mapeamento completo de headers
 * v2.2 - 2026-03-26 - Aliases novos templates Zyntra (C. a Pagar, FATURAMENTO, Pagamentos)
 * v2.3 - 2026-03-26 - Normalização template Pagamentos: data_pagamento→data_vencimento, status auto-pago
 * v2.4 - 2026-06-06 - Template "Recebimentos" (DT ENTRADA/CONTA FINANCEIRA/HISTORICO/ORIGEM/VALOR BRUTO/CONTA BANCÁRIA): mapeia e marca recebido
 */

// ============================================================
// MAPEAMENTO DE HEADERS SGE/OMIE → CAMPO INTERNO
// Cada entrada: chave = início do header Omie, valor = campo DB
// ============================================================

const HEADER_MAP_CONTAS_PAGAR = {
    // Headers SGE/Omie (parciais, usa startsWith)
    'Código de Integração': 'codigo_integracao',
    'Fornecedor': 'fornecedor_nome',
    'Categoria': 'categoria_nome',
    'Conta Corrente': 'conta_corrente_nome',
    'Valor da Conta': 'valor',
    'Vendedor': 'vendedor',
    'Projeto': 'projeto',
    'Data de Emissão': 'data_emissao',
    'Data de Registro': 'data_registro',
    'Data de Vencimento': 'data_vencimento',
    'Data de Previsão': 'data_previsao',
    'Data do Pagamento': 'data_pagamento',
    'Valor do Pagamento': 'valor_pagamento',
    'Juros': 'juros',
    'Multa': 'multa',
    'Desconto': 'desconto',
    'Data de Conciliação': 'data_conciliacao',
    'Observações': 'observacoes',
    'Tipo de Documento': 'tipo_documento',
    'Número do Documento': 'numero_documento',
    'Parcela': 'parcela_numero',
    'Total de Parcelas': 'total_parcelas',
    'Número do Pedido': 'numero_pedido',
    'Nota Fiscal': 'nota_fiscal',
    'Chave da NF-e': 'chave_nfe',
    'Forma de Pagamento': 'forma_pagamento',
    'Código de Barras do Boleto': 'codigo_barras_boleto',
    '% de Juros ao Mês do Boleto': 'juros_boleto',
    '% de Multa por Atraso do Boleto': 'multa_boleto',
    'Banco da Transferência': 'banco_transferencia',
    'Agência da Transferência': 'agencia_transferencia',
    'Conta Corrente da Transferência': 'conta_transferencia',
    'CNPJ ou CPF do Titular': 'cnpj_cpf_titular',
    'Nome do Titular da Conta': 'nome_titular',
    'Finalidade da Transferência': 'finalidade_transferencia',
    'Chave Pix': 'chave_pix',
    'Valor PIS': 'valor_pis',
    'Reter PIS': 'reter_pis',
    'Valor COFINS': 'valor_cofins',
    'Reter COFINS': 'reter_cofins',
    'Valor CSLL': 'valor_csll',
    'Reter CSLL': 'reter_csll',
    'Valor IR': 'valor_ir',
    'Reter IR': 'reter_ir',
    'Valor ISS': 'valor_iss',
    'Reter ISS': 'reter_iss',
    'Valor INSS': 'valor_inss',
    'Reter INSS': 'reter_inss',
    'Departamento': 'departamento',
    'Número da NF (serviço tomado)': 'nf_servico_numero',
    'Série': 'nf_servico_serie',
    'Código do Serviço (LC116)': 'codigo_servico_lc116',
    'Valor total da NF': 'valor_total_nf',
    'CST do PIS': 'cst_pis',
    'Base de Cálculo - PIS': 'base_calculo_pis',
    'Alíquota do PIS': 'aliquota_pis',
    'CST do COFINS': 'cst_cofins',
    'Base de cálculo - COFINS': 'base_calculo_cofins',
    'Alíquota do COFINS': 'aliquota_cofins',
    // Headers novos: Template Zyntra "C. a Pagar" (Row 7)
    'EMPRESA': 'empresa_nome',
    'DT LANÇAMENTO': 'data_emissao',
    'DT. VCTO': 'data_vencimento',
    'CONTA FINANCEIRA': 'categoria_nome',
    'FAVORECIDO': 'fornecedor_nome',
    'DESCRIÇÃO': 'descricao',
    // Headers novos: Template Zyntra "Pagamentos" (Row 5)
    'DT. PAGTO': 'data_pagamento',
    'HISTORICO': 'descricao',
    'CONTA BANCÁRIA': 'conta_corrente_nome',
    'OBSERVAÇÃO': 'observacoes',
    // Headers internos simples (fallback)
    'Descrição': 'descricao',
    'CNPJ/CPF': 'cnpj_cpf',
    'Valor': 'valor',
    'Data Vencimento': 'data_vencimento',
    'Forma Pagamento': 'forma_pagamento',
    'Status': 'status',
    'Total Parcelas': 'total_parcelas'
};

const HEADER_MAP_CONTAS_RECEBER = {
    // Headers SGE/Omie
    'Código de Integração': 'codigo_integracao',
    'Cliente': 'cliente_nome',
    'Categoria': 'categoria_nome',
    'Conta Corrente': 'conta_corrente_nome',
    'Valor da Conta': 'valor',
    'Vendedor': 'vendedor',
    'Projeto': 'projeto',
    'Data de Emissão': 'data_emissao',
    'Data de Registro': 'data_registro',
    'Data de Vencimento': 'data_vencimento',
    'Data de Previsão': 'data_previsao',
    'Data do Recebimento': 'data_recebimento',
    'Valor do Recebimento': 'valor_recebido',
    'Juros': 'juros',
    'Multa': 'multa',
    'Desconto': 'desconto',
    'Data de Conciliação': 'data_conciliacao',
    'Observações': 'observacoes',
    'Tipo de Documento': 'tipo_documento',
    'Número do Documento': 'numero_documento',
    'Parcela': 'parcela_numero',
    'Total de Parcelas': 'total_parcelas',
    'Número do Pedido': 'numero_pedido',
    'Nota Fiscal': 'nota_fiscal',
    'Chave da NF-e': 'chave_nfe',
    'Código de Barras': 'codigo_barras',
    'Número do Boleto': 'numero_boleto',
    'NSU / TID': 'nsu_tid',
    'Valor PIS': 'valor_pis',
    'Reter PIS': 'reter_pis',
    'Valor COFINS': 'valor_cofins',
    'Reter COFINS': 'reter_cofins',
    'Valor CSLL': 'valor_csll',
    'Reter CSLL': 'reter_csll',
    'Valor IR': 'valor_ir',
    'Reter IR': 'reter_ir',
    'Valor ISS': 'valor_iss',
    'Reter ISS': 'reter_iss',
    'Valor INSS': 'valor_inss',
    'Reter INSS': 'reter_inss',
    'Departamento': 'departamento',
    // Headers novos: Template ALUFORCE "FATURAMENTO" (Row 7)
    'EMPRESA': 'empresa_nome',
    'EMISSÃO': 'data_emissao',
    'TIPO': 'tipo_documento',
    'NFe': 'nota_fiscal',
    'P': 'parcela_numero',
    'CLIENTE': 'cliente_nome',
    'CNPJ': 'cnpj_cpf',
    'VALOR P': 'valor',
    'VCTO': 'data_vencimento',
    'SITUAÇÃO': 'situacao',
    'PORTADOR': 'portador',
    'STATUS': 'status',
    'DIAS': 'dias_atraso',
    'POSIÇÃO': 'posicao',
    'RECOMPRADO': 'dia_recomprado',
    'CARTORIO': 'data_para_cartorio',
    'PROTESTADO': 'data_protestado',
    'DIA RECOMPRADO': 'dia_recomprado',
    'DATA PARA CARTÓRIO': 'data_para_cartorio',
    'DATA CARTÓRIO': 'data_para_cartorio',
    'DATA PROTESTADO': 'data_protestado',
    'DT RECOMPRA': 'dia_recomprado',
    'DT CARTÓRIO': 'data_para_cartorio',
    'DT PROTESTO': 'data_protestado',
    'OBSERVAÇÃO': 'observacoes',
    // Headers novos: Template Zyntra "Recebimentos" (Row 5)
    'DT ENTRADA': 'data_recebimento',
    'CONTA FINANCEIRA': 'categoria_nome',
    'HISTORICO': 'descricao',
    'ORIGEM': 'cliente_nome',
    'VALOR BRUTO': 'valor',
    'CONTA BANCÁRIA': 'conta_corrente_nome',
    // Headers internos simples (fallback)
    'Descrição': 'descricao',
    'Valor': 'valor',
    'Data Vencimento': 'data_vencimento',
    'Forma Recebimento': 'forma_recebimento',
    'Status': 'status',
    'Total Parcelas': 'total_parcelas'
};

const HEADER_MAP_BANCOS = {
    'Nome da Conta': 'nome',
    'Banco': 'banco',
    'Agência': 'agencia',
    'Número Conta': 'numero_conta',
    'Tipo': 'tipo',
    'Saldo Inicial': 'saldo_inicial',
    'Limite Crédito': 'limite_credito',
    'Considera no Fluxo': 'considera_fluxo',
    'Emite Boletos': 'emite_boletos',
    'Observações': 'observacoes'
};

const HEADER_MAP_MOVIMENTACOES = {
    'Data': 'data',
    'Conta Bancária': 'conta_bancaria',
    'Tipo': 'tipo',
    'Valor': 'valor',
    'Cliente/Fornecedor': 'cliente_fornecedor',
    'Categoria': 'categoria',
    'Número Documento': 'numero_documento',
    'Nota Fiscal': 'nota_fiscal',
    'Parcela': 'parcela',
    'Observações': 'observacoes'
};

const HEADER_MAP_FLUXO = {
    'Data Prevista': 'data_prevista',
    'Descrição': 'descricao',
    'Tipo': 'tipo',
    'Valor': 'valor',
    'Conta Bancária': 'conta_bancaria',
    'Categoria': 'categoria',
    'Cliente/Fornecedor': 'cliente_fornecedor',
    'Recorrente': 'recorrente',
    'Observações': 'observacoes'
};

// Configurações de importação por tipo
const IMPORT_CONFIG = {
    'contas-pagar': {
        endpoint: '/api/financeiro/importar/contas-pagar',
        template: '/Financeiro/templates/template_contas_pagar.xlsx',
        headerMap: HEADER_MAP_CONTAS_PAGAR
    },
    'contas-receber': {
        endpoint: '/api/financeiro/importar/contas-receber',
        template: '/Financeiro/templates/template_contas_receber.xlsx',
        headerMap: HEADER_MAP_CONTAS_RECEBER
    },
    'bancos': {
        endpoint: '/api/financeiro/importar/bancos',
        template: '/Financeiro/templates/template_bancos.xlsx',
        headerMap: HEADER_MAP_BANCOS
    },
    'movimentacoes': {
        endpoint: '/api/financeiro/importar/movimentacoes',
        template: '/Financeiro/templates/template_movimentacoes.xlsx',
        headerMap: HEADER_MAP_MOVIMENTACOES
    },
    'fluxo-caixa': {
        endpoint: '/api/financeiro/importar/fluxo-caixa',
        template: '/Financeiro/templates/SGE_Fluxo_Caixa.xlsx',
        headerMap: HEADER_MAP_FLUXO
    }
};

/**
 * Normaliza um header para comparação
 * Remove asteriscos, espaços extras, e pega só a parte antes do parêntese
 */
function normalizeHeader(h) {
    if (!h || typeof h !== 'string') return '';
    return h
        .replace(/\s*\*\s*/g, '')           // remove *
        .replace(/\s*\(.*?\)\s*/g, '')      // remove (...)
        .replace(/\s+/g, ' ')               // normaliza espaços
        .trim();
}

/**
 * Faz match inteligente entre header da planilha e headerMap
 * Suporta: match exato, match por startsWith, match normalizado
 */
function matchHeader(rawHeader, headerMap) {
    if (!rawHeader || typeof rawHeader !== 'string') return null;
    
    const clean = rawHeader.trim();
    const normalized = normalizeHeader(clean);
    
    // 1. Match exato
    if (headerMap[clean]) return headerMap[clean];
    
    // 2. Match exato normalizado
    for (const [key, campo] of Object.entries(headerMap)) {
        if (normalizeHeader(key) === normalized) return campo;
    }
    
    // 3. Match por startsWith (para headers Omie longos)
    for (const [key, campo] of Object.entries(headerMap)) {
        const normKey = normalizeHeader(key);
        if (normKey.length > 0 && normalized.length > 0 && 
            (normalized.startsWith(normKey) || normKey.startsWith(normalized))) {
            return campo;
        }
    }
    
    // 4. Match parcial (contains) - só para strings longas
    for (const [key, campo] of Object.entries(headerMap)) {
        const normKey = normalizeHeader(key).toLowerCase();
        const normH = normalized.toLowerCase();
        if (normH.length > 4 && normKey.length > 4) {
            if (normH.includes(normKey) || normKey.includes(normH)) {
                return campo;
            }
        }
    }
    
    return null;
}

/**
 * Detecta a linha do header na planilha
 * Procura por linha que contém campos com * (obrigatórios Omie)
 * ou headers conhecidos
 */
function detectHeaderRow(rawData, headerMap) {
    const knownHeaders = Object.keys(headerMap).map(k => normalizeHeader(k).toLowerCase());
    
    for (let r = 0; r < Math.min(rawData.length, 15); r++) {
        const row = rawData[r];
        if (!row || row.length < 3) continue;
        
        // Verificar se tem asteriscos (padrão Omie)
        const hasAsterisks = row.some(cell => typeof cell === 'string' && cell.includes('*'));
        
        // Verificar se tem headers conhecidos
        let matchCount = 0;
        for (const cell of row) {
            if (typeof cell === 'string' && cell.trim() !== '') {
                const norm = normalizeHeader(cell).toLowerCase();
                if (norm.length > 0 && knownHeaders.some(kh => 
                    kh.length > 0 && (norm.startsWith(kh) || kh.startsWith(norm))
                )) {
                    matchCount++;
                }
            }
        }
        
        if (hasAsterisks && matchCount >= 2) return r;
        if (matchCount >= 3) return r;
    }
    
    return 0; // fallback: primeira linha
}

// Baixar template
function baixarTemplate(tipo) {
    const config = IMPORT_CONFIG[tipo];
    if (!config) {
        console.error('Tipo de importação não encontrado:', tipo);
        return;
    }
    const link = document.createElement('a');
    link.href = config.template;
    link.download = config.template.split('/').pop();
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    if (typeof mostrarToastFinanceiro === 'function') {
        mostrarToastFinanceiro('Template baixado com sucesso!', 'success');
    } else if (typeof showToast === 'function') {
        showToast('Template baixado com sucesso!', 'success');
    }
}

// Abrir modal de importação
function abrirModalImportar(tipo) {
    const config = IMPORT_CONFIG[tipo];
    if (!config) {
        console.error('Tipo de importação não encontrado:', tipo);
        return;
    }
    
    // Gerar opções de meses (12 meses para trás + 3 para frente)
    const hoje = new Date();
    let mesesOpts = '<option value="">Detectar automaticamente pela data</option>';
    for (let offset = -12; offset <= 3; offset++) {
        const d = new Date(hoje.getFullYear(), hoje.getMonth() + offset, 1);
        const val = d.toISOString().slice(0, 7); // YYYY-MM
        const label = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
        const labelCap = label.charAt(0).toUpperCase() + label.slice(1);
        const selected = offset === 0 ? ' selected' : '';
        mesesOpts += `<option value="${val}"${selected}>${labelCap}</option>`;
    }
    
    // Criar modal se não existir
    let modal = document.getElementById('modal-importar-xlsx');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'modal-importar-xlsx';
        modal.className = 'modal-overlay';
    }
    
    modal.innerHTML = `
        <div class="modal-container" style="max-width: 650px;">
            <div class="modal-header">
                <h2><i class="fas fa-file-excel"></i> Importar Dados via Excel</h2>
                <button class="modal-close" onclick="fecharModalImportar()">&times;</button>
            </div>
            <div class="modal-body" style="padding: 24px;">
                <div style="text-align: center; padding: 20px;">
                    <div style="margin-bottom: 20px;">
                        <i class="fas fa-file-upload" style="font-size: 48px; color: #10b981;"></i>
                    </div>
                    
                    <h3 style="margin-bottom: 16px; color: #1f2937;">Importar via planilha Excel</h3>
                    
                    <p style="color: #6b7280; margin-bottom: 20px;">
                        Selecione o mês de referência, baixe o template, preencha os dados e faça o upload.
                    </p>
                    
                    <!-- Seletor de Mês de Referência -->
                    <div style="margin-bottom: 20px; text-align: left; max-width: 350px; margin-left: auto; margin-right: auto;">
                        <label style="display: block; font-size: 13px; font-weight: 600; color: #374151; margin-bottom: 6px;">
                            <i class="fas fa-calendar-alt" style="margin-right: 6px; color: #3b82f6;"></i> Mês de Referência
                        </label>
                        <select id="import-mes-referencia" style="width: 100%; padding: 10px 14px; border: 2px solid #e2e8f0; border-radius: 10px; font-size: 14px; color: #1e293b; background: white; cursor: pointer;">
                            ${mesesOpts}
                        </select>
                        <p style="font-size: 11px; color: #9ca3af; margin-top: 4px;">
                            Os dados importados serão organizados por este mês. Se não selecionar, será detectado pela data de vencimento.
                        </p>
                    </div>
                    
                    <div style="display: flex; gap: 12px; justify-content: center; margin-bottom: 24px;">
                        <button class="btn-secondary" onclick="baixarTemplate('${tipo}')" style="display: flex; align-items: center; gap: 8px;">
                            <i class="fas fa-download"></i> Baixar Template
                        </button>
                    </div>
                    
                    <div style="border: 2px dashed #d1d5db; border-radius: 12px; padding: 40px 20px; background: #f9fafb; cursor: pointer;" 
                         id="drop-zone-xlsx"
                         onclick="document.getElementById('input-xlsx-file').click()">
                        <input type="file" id="input-xlsx-file" accept=".xlsx,.xls" style="display: none;" 
                               onchange="processarArquivoXLSX(this.files[0], '${tipo}')">
                        <i class="fas fa-cloud-upload-alt" style="font-size: 36px; color: #9ca3af; margin-bottom: 12px;"></i>
                        <p style="color: #6b7280; margin: 0;">
                            <strong>Clique para selecionar</strong> ou arraste o arquivo aqui
                        </p>
                        <p style="color: #9ca3af; font-size: 12px; margin-top: 8px;">
                            Arquivos aceitos: .xlsx, .xls
                        </p>
                    </div>
                    
                    <div id="import-preview" style="margin-top: 16px; display: none;"></div>
                    
                    <div id="import-status" style="margin-top: 20px; display: none;">
                        <div class="loading-spinner" style="margin: 0 auto;"></div>
                        <p style="color: #6b7280; margin-top: 12px;">Processando arquivo...</p>
                    </div>
                    
                    <div id="import-result" style="margin-top: 20px; display: none;"></div>
                </div>
            </div>
        </div>
    `;
    
    if (!modal.parentElement) {
        document.body.appendChild(modal);
    }
    
    // Adicionar drag & drop
    {
        const dropZone = document.getElementById('drop-zone-xlsx');
        if (dropZone) {
            dropZone.addEventListener('dragover', (e) => {
                e.preventDefault();
                dropZone.style.borderColor = '#10b981';
                dropZone.style.background = '#ecfdf5';
            });
            dropZone.addEventListener('dragleave', () => {
                dropZone.style.borderColor = '#d1d5db';
                dropZone.style.background = '#f9fafb';
            });
            dropZone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropZone.style.borderColor = '#d1d5db';
                dropZone.style.background = '#f9fafb';
                const file = e.dataTransfer.files[0];
                if (file) processarArquivoXLSX(file, tipo);
            });
        }
    }
    
    // Resetar estado
    document.getElementById('import-status').style.display = 'none';
    document.getElementById('import-result').style.display = 'none';
    document.getElementById('import-preview').style.display = 'none';
    document.getElementById('input-xlsx-file').value = '';
    
    modal.classList.add('active');
}

function fecharModalImportar() {
    const modal = document.getElementById('modal-importar-xlsx');
    if (modal) {
        modal.classList.remove('active');
    }
}

// Processar arquivo XLSX
async function processarArquivoXLSX(file, tipo) {
    if (!file) return;
    
    const config = IMPORT_CONFIG[tipo];
    if (!config) {
        alert('Configuração de importação não encontrada');
        return;
    }
    
    const statusEl = document.getElementById('import-status');
    const resultEl = document.getElementById('import-result');
    const previewEl = document.getElementById('import-preview');
    
    statusEl.style.display = 'block';
    resultEl.style.display = 'none';
    previewEl.style.display = 'none';
    
    try {
        // Ler arquivo Excel
        const data = await file.arrayBuffer();
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, dateNF: 'dd/mm/yyyy' });
        
        if (!rawData || rawData.length < 2) {
            throw new Error('Arquivo vazio ou sem dados');
        }
        
        // Detectar linha de header automaticamente
        const headerRowIndex = detectHeaderRow(rawData, config.headerMap);

        const headers = rawData[headerRowIndex];
        if (!headers || headers.length < 2) {
            throw new Error('Não foi possível detectar os cabeçalhos da planilha');
        }
        
        // Mapear headers
        const fieldMapping = []; // [{colIdx, campo, headerOriginal}]
        let mappedCount = 0;
        
        for (let idx = 0; idx < headers.length; idx++) {
            const header = headers[idx];
            const campo = matchHeader(header, config.headerMap);
            if (campo) {
                fieldMapping.push({ colIdx: idx, campo, headerOriginal: String(header).substring(0, 50) });
                mappedCount++;
            }
        }
        

        console.log('[IMPORT] Mapeamento:', fieldMapping.map(f => `${f.headerOriginal} → ${f.campo}`));
        
        if (mappedCount === 0) {
            throw new Error('Nenhum campo reconhecido no arquivo. Verifique se o template está correto.');
        }
        
        // Extrair dados (pular linhas antes do header e o header)
        const dados = [];
        for (let i = headerRowIndex + 1; i < rawData.length; i++) {
            const row = rawData[i];
            if (!row || row.length === 0 || row.every(cell => !cell && cell !== 0)) continue;
            
            const obj = {};
            let hasData = false;
            
            for (const { colIdx, campo } of fieldMapping) {
                const val = row[colIdx];
                if (val !== undefined && val !== null && val !== '') {
                    obj[campo] = val;
                    hasData = true;
                }
            }
            
            if (hasData) {
                // Normalização de campos de data: DD/MM/YYYY → YYYY-MM-DD
                const DATE_FIELDS = [
                    'data_emissao', 'data_registro', 'data_vencimento', 'data_previsao',
                    'data_pagamento', 'data_recebimento', 'data_conciliacao',
                    'dia_recomprado', 'data_para_cartorio', 'data_protestado'
                ];
                for (const df of DATE_FIELDS) {
                    if (obj[df]) {
                        const v = String(obj[df]).trim();
                        // DD/MM/YYYY → YYYY-MM-DD
                        const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
                        if (m) {
                            obj[df] = `${m[3]}-${m[2]}-${m[1]}`;
                        } else if (/^\d{4}-\d{2}-\d{2}/.test(v)) {
                            obj[df] = v.slice(0, 10);
                        } else if (typeof obj[df] === 'number') {
                            // Serial Excel → Date
                            const d = new Date(Math.round((obj[df] - 25569) * 86400 * 1000));
                            obj[df] = d.toISOString().slice(0, 10);
                        }
                    }
                }
                // Normalização para template de Pagamentos efetuados (DT. PAGTO como data_vencimento fallback)
                if (obj.data_pagamento && !obj.data_vencimento) {
                    obj.data_vencimento = obj.data_pagamento;
                }
                // Definir status 'pago' quando observação = PAGO ou quando há data_pagamento
                if (!obj.status) {
                    const obs = (obj.observacoes || '').trim().toUpperCase();
                    if (obs === 'PAGO' || obs.startsWith('PAGO')) {
                        obj.status = 'pago';
                    } else if (obj.data_pagamento) {
                        obj.status = 'pago';
                    }
                }
                // Propagar valor → valor_pagamento quando pago
                if (obj.data_pagamento && !obj.valor_pagamento && obj.valor) {
                    obj.valor_pagamento = obj.valor;
                }
                // Template "Recebimentos" (DT ENTRADA): usa a entrada como vencimento e marca recebido
                if (obj.data_recebimento && !obj.data_vencimento) {
                    obj.data_vencimento = obj.data_recebimento;
                }
                if (!obj.status && obj.data_recebimento) {
                    obj.status = 'recebido';
                }
                if (obj.data_recebimento && !obj.valor_recebido && obj.valor) {
                    obj.valor_recebido = obj.valor;
                }
                dados.push(obj);
            }
        }
        
        if (dados.length === 0) {
            throw new Error('Nenhum dado válido encontrado no arquivo');
        }
        
        // Mostrar preview
        previewEl.style.display = 'block';
        previewEl.innerHTML = `
            <div style="background: #f0f9ff; border: 1px solid #0ea5e9; border-radius: 8px; padding: 12px; text-align: left;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="color: #0369a1; font-weight: 600;">
                        <i class="fas fa-table"></i> ${dados.length} registros encontrados
                    </span>
                    <span style="color: #6b7280; font-size: 12px;">
                        ${mappedCount} campos mapeados de ${headers.length}
                    </span>
                </div>
                <div style="margin-top: 8px; font-size: 12px; color: #6b7280; max-height: 60px; overflow-y: auto;">
                    Campos: ${fieldMapping.map(f => f.campo).join(', ')}
                </div>
            </div>
        `;
        
        statusEl.innerHTML = `
            <div class="loading-spinner" style="margin: 0 auto;"></div>
            <p style="color: #6b7280; margin-top: 12px;">Enviando ${dados.length} registros para o servidor...</p>
        `;
        

        // Enviar para API - incluir mes_referencia do seletor
        const mesReferenciaSelect = document.getElementById('import-mes-referencia');
        const mesReferenciaForced = mesReferenciaSelect ? mesReferenciaSelect.value : '';
        
        // Se um mês foi selecionado, sobrescrever mes_referencia em todos os registros
        if (mesReferenciaForced) {
            dados.forEach(d => { d.mes_referencia = mesReferenciaForced; });
        }
        
        const response = await fetch(config.endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({ dados })
        });
        
        if (!response.ok) throw new Error(`Erro do servidor: ${response.status}`);
        const result = await response.json();
        
        statusEl.style.display = 'none';
        resultEl.style.display = 'block';
        
        if (result.success) {
            resultEl.innerHTML = `
                <div style="background: #ecfdf5; border: 1px solid #10b981; border-radius: 8px; padding: 16px;">
                    <div style="display: flex; align-items: center; gap: 12px; color: #059669;">
                        <i class="fas fa-check-circle" style="font-size: 24px;"></i>
                        <div>
                            <strong>Importação concluída!</strong>
                            <p style="margin: 4px 0 0 0; font-size: 14px;">
                                ${result.importados} de ${result.total} registros importados com sucesso
                            </p>
                        </div>
                    </div>
                    ${result.erros && result.erros.length > 0 ? `
                        <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #a7f3d0;">
                            <strong style="color: #dc2626; font-size: 13px;">
                                <i class="fas fa-exclamation-triangle"></i> ${result.erros.length} erros:
                            </strong>
                            <ul style="margin: 8px 0 0 0; padding-left: 20px; font-size: 12px; color: #dc2626; max-height: 100px; overflow-y: auto;">
                                ${result.erros.slice(0, 10).map(e => `<li>Linha ${e.linha}: ${e.erro}</li>`).join('')}
                                ${result.erros.length > 10 ? `<li>... e mais ${result.erros.length - 10} erros</li>` : ''}
                            </ul>
                        </div>
                    ` : ''}
                </div>
                <button class="btn-primary" onclick="fecharModalImportar(); location.reload();" style="margin-top: 16px;">
                    <i class="fas fa-sync"></i> Atualizar Página
                </button>
            `;
        } else {
            throw new Error(result.error || 'Erro ao importar dados');
        }
        
    } catch (err) {
        console.error('[IMPORT] Erro:', err);
        statusEl.style.display = 'none';
        resultEl.style.display = 'block';
        resultEl.innerHTML = `
            <div style="background: #fef2f2; border: 1px solid #ef4444; border-radius: 8px; padding: 16px;">
                <div style="display: flex; align-items: center; gap: 12px; color: #dc2626;">
                    <i class="fas fa-times-circle" style="font-size: 24px;"></i>
                    <div>
                        <strong>Erro na importação</strong>
                        <p style="margin: 4px 0 0 0; font-size: 14px;">${err.message}</p>
                    </div>
                </div>
            </div>
        `;
    }
}

// Estilos adicionais para o modal
const importStyles = document.createElement('style');
importStyles.textContent = `
    .modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        display: none;
        justify-content: center;
        align-items: center;
        z-index: 10000;
    }
    .modal-overlay.active {
        display: flex;
    }
    .modal-container {
        background: white;
        border-radius: 16px;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
        width: 90%;
        max-height: 90vh;
        overflow: auto;
    }
    .modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 20px 24px;
        border-bottom: 1px solid #e5e7eb;
    }
    .modal-header h2 {
        margin: 0;
        font-size: 20px;
        color: #1f2937;
        display: flex;
        align-items: center;
        gap: 10px;
    }
    .modal-header h2 i {
        color: #10b981;
    }
    .modal-close {
        background: none;
        border: none;
        font-size: 28px;
        color: #9ca3af;
        cursor: pointer;
        padding: 0;
        line-height: 1;
    }
    .modal-close:hover {
        color: #374151;
    }
    .btn-secondary {
        background: #f3f4f6;
        color: #374151;
        border: 1px solid #d1d5db;
        padding: 10px 20px;
        border-radius: 8px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
    }
    .btn-secondary:hover {
        background: #e5e7eb;
    }
    .loading-spinner {
        width: 32px;
        height: 32px;
        border: 3px solid #e5e7eb;
        border-top-color: #3b82f6;
        border-radius: 50%;
        animation: spin 1s linear infinite;
    }
    @keyframes spin {
        to { transform: rotate(360deg); }
    }
`;
document.head.appendChild(importStyles);

console.log('✅ Módulo de Importação XLSX v2.4 carregado (compatível SGE/Omie + Zyntra: Pagamentos + Recebimentos)');
