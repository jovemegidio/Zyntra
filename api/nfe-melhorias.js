/**
 * API DE MELHORIAS NF-e - ALUFORCE V.2
 * Funcionalidades avançadas para NF-e
 */

const express = require('express');
const router = express.Router();

let pool;
let authenticateToken;

/**
 * GET /api/nfe-melhorias/dashboard
 * Dashboard de NF-e
 */
router.get('/dashboard', async (req, res) => {
    try {
        const dashboard = {
            emitidas_mes: 0,
            valor_total_mes: 0,
            canceladas_mes: 0,
            pendentes: 0,
            ultimas_notas: []
        };

        const mesAtual = new Date().toISOString().slice(0, 7);

        try {
            const [stats] = await pool.query(`
                SELECT 
                    COUNT(*) as emitidas,
                    COALESCE(SUM(valor_total), 0) as valor_total,
                    SUM(CASE WHEN status = 'cancelada' THEN 1 ELSE 0 END) as canceladas
                FROM notas_fiscais
                WHERE DATE_FORMAT(data_emissao, '%Y-%m') = ?
            `, [mesAtual]);
            
            if (stats.length) {
                dashboard.emitidas_mes = stats[0].emitidas || 0;
                dashboard.valor_total_mes = stats[0].valor_total || 0;
                dashboard.canceladas_mes = stats[0].canceladas || 0;
            }
        } catch (e) {}

        try {
            const [pendentes] = await pool.query(`
                SELECT COUNT(*) as total FROM notas_fiscais WHERE status = 'pendente'
            `);
            dashboard.pendentes = pendentes[0]?.total || 0;
        } catch (e) {}

        try {
            const [ultimas] = await pool.query(`
                SELECT id, numero, serie, chave_acesso, valor_total, status, data_emissao
                FROM notas_fiscais
                ORDER BY data_emissao DESC, id DESC
                LIMIT 10
            `);
            dashboard.ultimas_notas = ultimas;
        } catch (e) {}

        res.json({ success: true, data: dashboard });
    } catch (error) {
        console.error('[NF-e] Erro ao gerar dashboard:', error);
        res.status(500).json({ success: false, error: 'Erro ao gerar dashboard' });
    }
});

/**
 * POST /api/nfe-melhorias/validar-destinatario
 * Valida dados do destinatário antes da emissão
 */
router.post('/validar-destinatario', async (req, res) => {
    try {
        const { cnpj_cpf, ie, uf } = req.body;
        const erros = [];
        const avisos = [];

        // Validar CNPJ/CPF
        if (!cnpj_cpf) {
            erros.push('CNPJ/CPF do destinatário é obrigatório');
        } else {
            const doc = cnpj_cpf.replace(/\D/g, '');
            if (doc.length === 11) {
                if (!validarCPF(doc)) {
                    erros.push('CPF do destinatário é inválido');
                }
            } else if (doc.length === 14) {
                if (!validarCNPJ(doc)) {
                    erros.push('CNPJ do destinatário é inválido');
                }
            } else {
                erros.push('Documento do destinatário deve ter 11 (CPF) ou 14 (CNPJ) dígitos');
            }
        }

        // Validar IE
        if (ie && ie.toUpperCase() !== 'ISENTO') {
            if (!/^\d+$/.test(ie.replace(/\D/g, ''))) {
                avisos.push('IE deve conter apenas números');
            }
        }

        // Verificar cliente no cadastro
        try {
            const [cliente] = await pool.query(`
                SELECT id, razao_social, situacao, bloqueado 
                FROM clientes 
                WHERE REPLACE(REPLACE(REPLACE(cnpj_cpf, '.', ''), '-', ''), '/', '') = ?
            `, [cnpj_cpf.replace(/\D/g, '')]);

            if (cliente.length) {
                if (cliente[0].bloqueado) {
                    avisos.push('Cliente está bloqueado no sistema');
                }
                if (cliente[0].situacao === 'inativo') {
                    avisos.push('Cliente está inativo no cadastro');
                }
            } else {
                avisos.push('Cliente não encontrado no cadastro');
            }
        } catch (e) {}

        res.json({
            success: erros.length === 0,
            valido: erros.length === 0,
            erros,
            avisos
        });
    } catch (error) {
        console.error('[NF-e] Erro ao validar destinatário:', error);
        res.status(500).json({ success: false, error: 'Erro ao validar destinatário' });
    }
});

/**
 * POST /api/nfe-melhorias/validar-produtos
 * Valida produtos antes da emissão
 */
router.post('/validar-produtos', async (req, res) => {
    try {
        const { itens } = req.body;
        const erros = [];
        const avisos = [];

        if (!itens || !Array.isArray(itens) || itens.length === 0) {
            return res.json({
                success: false,
                valido: false,
                erros: ['Nenhum item informado']
            });
        }

        for (let i = 0; i < itens.length; i++) {
            const item = itens[i];
            const idx = i + 1;

            if (!item.codigo && !item.produto_id) {
                erros.push(`Item ${idx}: Código do produto é obrigatório`);
            }
            if (!item.quantidade || item.quantidade <= 0) {
                erros.push(`Item ${idx}: Quantidade deve ser maior que zero`);
            }
            if (!item.valor_unitario || item.valor_unitario <= 0) {
                erros.push(`Item ${idx}: Valor unitário deve ser maior que zero`);
            }
            if (!item.ncm || item.ncm.replace(/\D/g, '').length !== 8) {
                erros.push(`Item ${idx}: NCM deve ter 8 dígitos`);
            }
            if (!item.cfop) {
                erros.push(`Item ${idx}: CFOP é obrigatório`);
            }

            // Validar estoque
            if (item.produto_id) {
                try {
                    const [estoque] = await pool.query(`
                        SELECT quantidade_estoque FROM produtos WHERE id = ?
                    `, [item.produto_id]);

                    if (estoque.length && estoque[0].quantidade_estoque < item.quantidade) {
                        avisos.push(`Item ${idx}: Estoque insuficiente (disponível: ${estoque[0].quantidade_estoque})`);
                    }
                } catch (e) {}
            }
        }

        res.json({
            success: erros.length === 0,
            valido: erros.length === 0,
            erros,
            avisos,
            total_itens: itens.length
        });
    } catch (error) {
        console.error('[NF-e] Erro ao validar produtos:', error);
        res.status(500).json({ success: false, error: 'Erro ao validar produtos' });
    }
});

/**
 * GET /api/nfe-melhorias/cfop-sugestao
 * Sugere CFOP baseado na operação
 */
router.get('/cfop-sugestao', async (req, res) => {
    try {
        const { operacao, uf_origem, uf_destino, tipo_produto } = req.query;
        
        const sugestoes = [];
        const mesmoEstado = uf_origem === uf_destino;
        const prefixo = mesmoEstado ? '5' : '6';

        switch (operacao) {
            case 'venda':
                sugestoes.push({
                    cfop: `${prefixo}102`,
                    descricao: 'Venda de mercadoria adquirida ou recebida de terceiros'
                });
                sugestoes.push({
                    cfop: `${prefixo}101`,
                    descricao: 'Venda de produção do estabelecimento'
                });
                break;
            case 'devolucao':
                sugestoes.push({
                    cfop: `${prefixo}202`,
                    descricao: 'Devolução de compra para comercialização'
                });
                sugestoes.push({
                    cfop: `${prefixo}201`,
                    descricao: 'Devolução de compra para industrialização'
                });
                break;
            case 'remessa':
                sugestoes.push({
                    cfop: `${prefixo}949`,
                    descricao: 'Outra saída de mercadoria ou prestação de serviço não especificado'
                });
                sugestoes.push({
                    cfop: `${prefixo}915`,
                    descricao: 'Remessa de mercadoria para conserto ou reparo'
                });
                break;
            case 'transferencia':
                sugestoes.push({
                    cfop: `${prefixo}152`,
                    descricao: 'Transferência de mercadoria adquirida ou recebida de terceiros'
                });
                break;
            default:
                sugestoes.push({
                    cfop: `${prefixo}102`,
                    descricao: 'Venda de mercadoria (padrão)'
                });
        }

        res.json({ success: true, data: sugestoes });
    } catch (error) {
        console.error('[NF-e] Erro ao sugerir CFOP:', error);
        res.status(500).json({ success: false, error: 'Erro ao sugerir CFOP' });
    }
});

/**
 * GET /api/nfe-melhorias/ncm-busca
 * Busca NCM por código ou descrição
 */
router.get('/ncm-busca', async (req, res) => {
    try {
        const { termo, limite = 20 } = req.query;

        if (!termo || termo.length < 2) {
            return res.json({ success: true, data: [] });
        }

        // Primeiro tenta buscar na tabela local
        try {
            const [resultados] = await pool.query(`
                SELECT codigo, descricao 
                FROM ncm 
                WHERE codigo LIKE ? OR descricao LIKE ?
                LIMIT ?
            `, [`${termo}%`, `%${termo}%`, parseInt(limite)]);

            if (resultados.length > 0) {
                return res.json({ success: true, data: resultados });
            }
        } catch (e) {}

        // Se não encontrou, retorna alguns NCMs comuns
        const ncmsComuns = [
            { codigo: '76061200', descricao: 'Chapas e tiras, de ligas de alumínio, de espessura superior a 0,2 mm' },
            { codigo: '76069200', descricao: 'Outras chapas e tiras de ligas de alumínio' },
            { codigo: '76071100', descricao: 'Folhas e tiras, delgadas, de alumínio, sem suporte' },
            { codigo: '76082000', descricao: 'Tubos de ligas de alumínio' },
            { codigo: '76109000', descricao: 'Outras construções e suas partes de alumínio' }
        ].filter(n => 
            n.codigo.includes(termo) || 
            n.descricao.toLowerCase().includes(termo.toLowerCase())
        );

        res.json({ success: true, data: ncmsComuns });
    } catch (error) {
        console.error('[NF-e] Erro ao buscar NCM:', error);
        res.json({ success: true, data: [] });
    }
});

/**
 * POST /api/nfe-melhorias/calcular-impostos
 * Calcula impostos para um item
 */
router.post('/calcular-impostos', async (req, res) => {
    try {
        const {
            valor_produto,
            quantidade,
            uf_origem,
            uf_destino,
            ncm,
            cfop,
            regime_tributario = 1, // 1 = Simples Nacional
            cst_icms,
            cst_pis,
            cst_cofins
        } = req.body;

        const valorTotal = valor_produto * quantidade;
        const impostos = {
            valor_produto: valorTotal,
            icms: { base: 0, aliquota: 0, valor: 0 },
            pis: { base: 0, aliquota: 0, valor: 0 },
            cofins: { base: 0, aliquota: 0, valor: 0 },
            ipi: { base: 0, aliquota: 0, valor: 0 },
            total_impostos: 0
        };

        // Calcular ICMS (simplificado)
        if (regime_tributario !== 1) { // Se não for Simples Nacional
            const mesmoEstado = uf_origem === uf_destino;
            impostos.icms.aliquota = mesmoEstado ? 18 : 12; // Alíquotas padrão
            impostos.icms.base = valorTotal;
            impostos.icms.valor = (valorTotal * impostos.icms.aliquota) / 100;
        }

        // PIS/COFINS (regime cumulativo simplificado)
        if (cst_pis !== '06' && cst_pis !== '07') { // Se não for isento
            impostos.pis.aliquota = 0.65;
            impostos.pis.base = valorTotal;
            impostos.pis.valor = (valorTotal * impostos.pis.aliquota) / 100;
        }

        if (cst_cofins !== '06' && cst_cofins !== '07') { // Se não for isento
            impostos.cofins.aliquota = 3;
            impostos.cofins.base = valorTotal;
            impostos.cofins.valor = (valorTotal * impostos.cofins.aliquota) / 100;
        }

        impostos.total_impostos = 
            impostos.icms.valor + 
            impostos.pis.valor + 
            impostos.cofins.valor + 
            impostos.ipi.valor;

        res.json({ success: true, data: impostos });
    } catch (error) {
        console.error('[NF-e] Erro ao calcular impostos:', error);
        res.status(500).json({ success: false, error: 'Erro ao calcular impostos' });
    }
});

/**
 * GET /api/nfe-melhorias/eventos/:chave
 * Lista eventos de uma NF-e
 */
router.get('/eventos/:chave', async (req, res) => {
    try {
        const { chave } = req.params;

        const [eventos] = await pool.query(`
            SELECT * FROM nfe_eventos 
            WHERE chave_acesso = ?
            ORDER BY data_evento DESC
        `, [chave]);

        res.json({ success: true, data: eventos });
    } catch (error) {
        res.json({ success: true, data: [] });
    }
});

/**
 * GET /api/nfe-melhorias/relatorio-mensal
 * Relatório mensal de NF-e
 */
router.get('/relatorio-mensal', async (req, res) => {
    try {
        const { mes, ano } = req.query;
        const periodo = mes && ano ? `${ano}-${mes.padStart(2, '0')}` : new Date().toISOString().slice(0, 7);

        const [dados] = await pool.query(`
            SELECT 
                DATE_FORMAT(data_emissao, '%Y-%m-%d') as data,
                COUNT(*) as quantidade,
                SUM(valor_total) as valor_total,
                SUM(CASE WHEN status = 'autorizada' THEN 1 ELSE 0 END) as autorizadas,
                SUM(CASE WHEN status = 'cancelada' THEN 1 ELSE 0 END) as canceladas
            FROM notas_fiscais
            WHERE DATE_FORMAT(data_emissao, '%Y-%m') = ?
            GROUP BY DATE_FORMAT(data_emissao, '%Y-%m-%d')
            ORDER BY data
        `, [periodo]);

        res.json({ success: true, data: dados, periodo });
    } catch (error) {
        res.json({ success: true, data: [], periodo: '' });
    }
});

// Funções auxiliares de validação
function validarCPF(cpf) {
    if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
    let soma = 0;
    for (let i = 0; i < 9; i++) soma += parseInt(cpf[i]) * (10 - i);
    let resto = (soma * 10) % 11;
    if (resto === 10 || resto === 11) resto = 0;
    if (resto !== parseInt(cpf[9])) return false;
    soma = 0;
    for (let i = 0; i < 10; i++) soma += parseInt(cpf[i]) * (11 - i);
    resto = (soma * 10) % 11;
    if (resto === 10 || resto === 11) resto = 0;
    return resto === parseInt(cpf[10]);
}

function validarCNPJ(cnpj) {
    if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
    let tamanho = cnpj.length - 2;
    let numeros = cnpj.substring(0, tamanho);
    let digitos = cnpj.substring(tamanho);
    let soma = 0;
    let pos = tamanho - 7;
    for (let i = tamanho; i >= 1; i--) {
        soma += numeros.charAt(tamanho - i) * pos--;
        if (pos < 2) pos = 9;
    }
    let resultado = soma % 11 < 2 ? 0 : 11 - soma % 11;
    if (resultado !== parseInt(digitos.charAt(0))) return false;
    tamanho = tamanho + 1;
    numeros = cnpj.substring(0, tamanho);
    soma = 0;
    pos = tamanho - 7;
    for (let i = tamanho; i >= 1; i--) {
        soma += numeros.charAt(tamanho - i) * pos--;
        if (pos < 2) pos = 9;
    }
    resultado = soma % 11 < 2 ? 0 : 11 - soma % 11;
    return resultado === parseInt(digitos.charAt(1));
}

// Criar tabela de eventos se não existir
async function ensureTable() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS nfe_eventos (
                id INT AUTO_INCREMENT PRIMARY KEY,
                nfe_id INT,
                chave_acesso VARCHAR(44),
                tipo_evento VARCHAR(50),
                codigo_evento VARCHAR(10),
                descricao TEXT,
                protocolo VARCHAR(50),
                data_evento DATETIME,
                xml_evento LONGTEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_chave (chave_acesso),
                INDEX idx_nfe (nfe_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('[NF-e MELHORIAS] ✅ Tabela nfe_eventos verificada/criada');
    } catch (error) {
        console.error('[NF-e MELHORIAS] Erro ao criar tabela:', error.message);
    }
}

module.exports = function(deps) {
    pool = deps.pool;
    authenticateToken = deps.authenticateToken;
    ensureTable();
    return router;
};
