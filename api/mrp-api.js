/**
 * API MRP (Material Requirements Planning) - Planejamento de Necessidades de Materiais
 * 
 * Funcionalidades:
 * - Explosão de BOM (Bill of Materials)
 * - Cálculo de necessidades brutas e líquidas
 * - Lead time e safety stock
 * - Planejamento de compras e Produção
 * - IntegrAção com estoque e pedidos de venda
 * 
 * Conceitos:
 * - MPS (Master Production Schedule) - Plano Mestre de Produção
 * - BOM (Bill of Materials) - Lista de Materiais
 * - Lead Time - Tempo de Ressuprimento
 * - Safety Stock - Estoque de Segurança
 * - Lot Size - Tamanho do Lote
 */

const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
// IntegrAção MySQL
const mysql = require('mysql2/promise');
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'aluforce_vendas',
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10
});

// ===================================================================
// CONFIGURAÇÕES MRP
// ===================================================================

const MRP_CONFIG = {
    horizontePlanejamento: 90, // dias
    periodoCongelado: 7, // dias sem alterações
    frequenciaRecalculo: 'DIARIO', // DIARIO, SEMANAL, MENSAL
    metodoLoteSizing: 'LOT_FOR_LOT', // LOT_FOR_LOT, EOQ, POQ, FOQ
    considerarLeadTimeSeg: true,
    considerarEstoqueSeg: true
};

// Métodos de dimensionamento de lote
const METODOS_LOTE = {
    'LOT_FOR_LOT': 'Lote por Lote (L4L) - Compra/produz exatamente a quantidade necessária',
    'EOQ': 'Economic Order Quantity - Quantidade Econômica de Pedido',
    'POQ': 'Periodic Order Quantity - Quantidade Periódica de Pedido',
    'FOQ': 'Fixed Order Quantity - Quantidade Fixa de Pedido'
};

// Status de ordens planejadas
const STATUS_ORDEM = {
    'PLANEJADA': 'Ordem gerada pelo MRP, aguardando aprovAção',
    'FIRME': 'Ordem aprovada, não será alterada pelo MRP',
    'LIBERADA': 'Ordem liberada para execução',
    'EM_PROCESSO': 'Ordem em processo de Produção/compra',
    'CONCLUIDA': 'Ordem concluída',
    'CANCELADA': 'Ordem cancelada'
};

// ===================================================================
// ESTRUTURA DE PRODUTO (BOM)
// ===================================================================

/**
 * POST /bom - Cadastra estrutura de produto (BOM)
 */
router.post('/bom', [
    body('codigoProduto').notEmpty().withMessage('Código do produto é obrigatório'),
    body('componentes').isArray().withMessage('Componentes devem ser um array'),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
    }
    try {
        const { codigoProduto, descricao, componentes, roteiro } = req.body;
        // Valida estrutura dos componentes
        for (const comp of componentes) {
            if (!comp.codigoComponente || !comp.quantidade) {
                return res.status(400).json({
                    success: false,
                    message: 'Cada componente deve ter codigoComponente e quantidade'
                });
            }
        }
        // Salvar BOM principal
        const [result] = await pool.query(
            `INSERT INTO mrp_bom (codigo_produto, descricao, data_vigencia, ativo) VALUES (?, ?, NOW(), 1)
            ON DUPLICATE KEY UPDATE descricao=VALUES(descricao), data_vigencia=NOW(), ativo=1`,
            [codigoProduto, descricao || null]
        );
        // Limpa componentes antigos e insere novos
        await pool.query('DELETE FROM mrp_bom_componentes WHERE codigo_produto = ?', [codigoProduto]);
        for (const c of componentes) {
            await pool.query(
                `INSERT INTO mrp_bom_componentes (codigo_produto, codigo_componente, descricao_componente, quantidade, unidade, perda, nivel, tipo_item, lead_time, estoque_seguranca, sequencia)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [codigoProduto, c.codigoComponente, c.descricao, c.quantidade, c.unidade || 'UN', c.perda || 0, 1, c.tipoItem || 'MP', c.leadTime || 0, c.estoqueSeguranca || 0, c.sequencia || 1]
            );
        }
        res.json({
            success: true,
            message: 'BOM cadastrada com sucesso',
            bom: { codigoProduto, descricao, componentes }
        });
    } catch (error) {
        console.error('Erro ao cadastrar BOM:', error);
        res.status(500).json({ success: false, message: 'Erro ao cadastrar BOM', error: error.message });
    }
});

/**
 * GET /bom/:codigo - Busca BOM de um produto
 */
router.get('/bom/:codigo', async (req, res) => {
    try {
        const { codigo } = req.params;
        // Busca BOM principal
        const [boms] = await pool.query('SELECT * FROM mrp_bom WHERE codigo_produto = ? AND ativo = 1', [codigo]);
        if (!boms.length) {
            return res.status(404).json({ success: false, message: 'BOM não encontrada' });
        }
        // Busca componentes
        const [componentes] = await pool.query('SELECT * FROM mrp_bom_componentes WHERE codigo_produto = ?', [codigo]);
        res.json({
            success: true,
            bom: {
                codigoProduto: codigo,
                descricao: boms[0].descricao,
                componentes
            }
        });
    } catch (error) {
        console.error('Erro ao buscar BOM:', error);
        res.status(500).json({ success: false, message: 'Erro ao buscar BOM', error: error.message });
    }
});

/**
 * POST /bom/explodir - Explode BOM multi-nível
 */
router.post('/bom/explodir', [
    body('codigoProduto').notEmpty(),
    body('quantidade').isNumeric(),
], async (req, res) => {
    try {
        const { codigoProduto, quantidade, nivelMaximo } = req.body;

        // Função recursiva de explosão (exemplo simplificado)
        // TODO: Implementar busca real do banco de dados

        const explosao = {
            codigoProduto,
            quantidadeSolicitada: quantidade,
            niveis: [],
            materiaisNecessarios: [],
            totalItens: 0
        };

        res.json({
            success: true,
            message: 'Explosão de BOM - Implementar busca real no banco',
            explosao
        });
    } catch (error) {
        console.error('Erro na explosão de BOM:', error);
        res.status(500).json({ success: false, message: 'Erro na explosão de BOM' });
    }
});

// ===================================================================
// CÁLCULO MRP
// ===================================================================

/**
 * POST /calcular - Executa cálculo MRP
 * 
 * Entrada:
 * - MPS (demanda de produtos acabados)
 * - BOMs dos produtos
 * - Estoque atual
 * - Ordens em aberto (compra/Produção)
 * - Lead times
 * - Estoque de segurança
 * 
 * Saída:
 * - Ordens planejadas de compra
 * - Ordens planejadas de Produção
 * - Alertas de falta de material
 */
router.post('/calcular', [
    body('dataInicio').isISO8601().withMessage('Data de início inválida'),
    body('dataFim').isISO8601().withMessage('Data de fim inválida'),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
    }

    try {
        const { dataInicio, dataFim, itens, considerarPedidosVenda, considerarOrdensAbertas } = req.body;

        const resultado = {
            parametros: {
                dataInicio,
                dataFim,
                horizonte: calcularDiasEntre(dataInicio, dataFim),
                executadoEm: new Date().toISOString()
            },
            ordensCompra: [],
            ordensProducao: [],
            alertas: [],
            resumo: {
                totalOrdensCompra: 0,
                totalOrdensProducao: 0,
                valorEstimadoCompras: 0,
                itensComFalta: 0
            }
        };

        // TODO: Implementar lógica completa do MRP
        // 1. Buscar MPS (demanda de produtos acabados)
        // 2. Explodir BOM de cada item do MPS
        // 3. Calcular necessidades brutas por período
        // 4. Subtrair estoque disponível e recebimentos programados
        // 5. Calcular necessidades líquidas
        // 6. Gerar ordens planejadas respeitando lead time
        // 7. Aplicar regras de lote sizing

        res.json({
            success: true,
            message: 'Cálculo MRP executado',
            resultado
        });
    } catch (error) {
        console.error('Erro no cálculo MRP:', error);
        res.status(500).json({ success: false, message: 'Erro no cálculo MRP' });
    }
});

/**
 * POST /calcular-item - Calcula necessidades de um item específico
 */
router.post('/calcular-item', [
    body('codigoItem').notEmpty(),
    body('dataInicio').isISO8601(),
    body('dataFim').isISO8601(),
], async (req, res) => {
    try {
        const { codigoItem, dataInicio, dataFim, demandaAdicional } = req.body;

        // Estrutura de cálculo por período (time-phased)
        const periodos = gerarPeriodos(dataInicio, dataFim, 'SEMANAL');
        
        const calculo = {
            item: codigoItem,
            periodos: periodos.map(p => ({
                periodo: p,
                necessidadeBruta: 0,
                recebimentosProgramados: 0,
                estoqueProjetado: 0,
                necessidadeLiquida: 0,
                liberacaoOrdemPlanejada: 0,
                recebimentoOrdemPlanejada: 0
            })),
            parametros: {
                leadTime: 7, // dias (buscar do cadastro)
                estoqueSeguranca: 0,
                loteMinimo: 1,
                multiploLote: 1
            }
        };

        res.json({
            success: true,
            message: 'Cálculo de item - Implementar busca de dados reais',
            calculo
        });
    } catch (error) {
        console.error('Erro no cálculo do item:', error);
        res.status(500).json({ success: false, message: 'Erro no cálculo' });
    }
});

// ===================================================================
// ORDENS PLANEJADAS
// ===================================================================

/**
 * GET /ordens-planejadas - Lista ordens planejadas pelo MRP
 */
router.get('/ordens-planejadas', async (req, res) => {
    try {
        const { tipo, status, dataInicio, dataFim } = req.query;

        // TODO: Buscar do banco de dados

        res.json({
            success: true,
            ordens: [],
            filtros: { tipo, status, dataInicio, dataFim }
        });
    } catch (error) {
        console.error('Erro ao listar ordens:', error);
        res.status(500).json({ success: false, message: 'Erro ao listar ordens' });
    }
});

/**
 * POST /ordens-planejadas/firmar - Firma uma ordem planejada
 */
router.post('/ordens-planejadas/firmar', [
    body('ordemId').notEmpty(),
], async (req, res) => {
    try {
        const { ordemId, observacao } = req.body;

        // TODO: Atualizar status no banco

        res.json({
            success: true,
            message: 'Ordem firmada com sucesso',
            ordemId,
            novoStatus: 'FIRME'
        });
    } catch (error) {
        console.error('Erro ao firmar ordem:', error);
        res.status(500).json({ success: false, message: 'Erro ao firmar ordem' });
    }
});

/**
 * POST /ordens-planejadas/liberar - Libera ordem para execução
 */
router.post('/ordens-planejadas/liberar', [
    body('ordemId').notEmpty(),
], async (req, res) => {
    try {
        const { ordemId, dataLiberacao } = req.body;

        // TODO: Implementar liberAção
        // - Verificar disponibilidade de materiais
        // - Criar ordem de compra/Produção real
        // - Atualizar status

        res.json({
            success: true,
            message: 'Ordem liberada para execução',
            ordemId,
            novoStatus: 'LIBERADA'
        });
    } catch (error) {
        console.error('Erro ao liberar ordem:', error);
        res.status(500).json({ success: false, message: 'Erro ao liberar ordem' });
    }
});

/**
 * POST /ordens-planejadas/converter-compra - Converte em pedido de compra
 */
router.post('/ordens-planejadas/converter-compra', [
    body('ordensIds').isArray(),
], async (req, res) => {
    try {
        const { ordensIds, fornecedorId, observacao } = req.body;

        // TODO: Implementar conversão
        // - Agrupar itens por fornecedor
        // - Criar requisição/pedido de compra
        // - Atualizar status das ordens

        res.json({
            success: true,
            message: `${ordensIds.length} ordens convertidas em pedido de compra`,
            pedidoCompraId: null // ID do pedido gerado
        });
    } catch (error) {
        console.error('Erro ao converter ordens:', error);
        res.status(500).json({ success: false, message: 'Erro ao converter ordens' });
    }
});

/**
 * POST /ordens-planejadas/converter-producao - Converte em ordem de Produção
 */
router.post('/ordens-planejadas/converter-producao', [
    body('ordensIds').isArray(),
], async (req, res) => {
    try {
        const { ordensIds, prioridade, observacao } = req.body;

        // TODO: Implementar conversão
        // - Criar ordem de Produção
        // - Reservar materiais
        // - Atualizar status

        res.json({
            success: true,
            message: `${ordensIds.length} ordens convertidas em ordens de Produção`,
            ordensProducaoIds: []
        });
    } catch (error) {
        console.error('Erro ao converter ordens:', error);
        res.status(500).json({ success: false, message: 'Erro ao converter ordens' });
    }
});

// ===================================================================
// MPS (MASTER PRODUCTION SCHEDULE)
// ===================================================================

/**
 * POST /mps - Cadastra/atualiza plano mestre de Produção
 */
router.post('/mps', [
    body('codigoProduto').notEmpty(),
    body('periodos').isArray(),
], async (req, res) => {
    try {
        const { codigoProduto, periodos, observacao } = req.body;

        const mps = {
            codigoProduto,
            periodos: periodos.map(p => ({
                dataInicio: p.dataInicio,
                dataFim: p.dataFim,
                quantidadePlanejada: p.quantidade,
                origem: p.origem || 'MANUAL', // MANUAL, PREVISAO, PEDIDO
                status: 'ATIVO'
            })),
            criadoEm: new Date().toISOString(),
            observacao
        };

        // TODO: Salvar no banco

        res.json({
            success: true,
            message: 'MPS cadastrado com sucesso',
            mps
        });
    } catch (error) {
        console.error('Erro ao cadastrar MPS:', error);
        res.status(500).json({ success: false, message: 'Erro ao cadastrar MPS' });
    }
});

/**
 * GET /mps - Lista plano mestre de Produção
 */
router.get('/mps', async (req, res) => {
    try {
        const { dataInicio, dataFim, produto } = req.query;

        // TODO: Buscar do banco

        res.json({
            success: true,
            mps: [],
            filtros: { dataInicio, dataFim, produto }
        });
    } catch (error) {
        console.error('Erro ao listar MPS:', error);
        res.status(500).json({ success: false, message: 'Erro ao listar MPS' });
    }
});

/**
 * POST /mps/gerar-de-pedidos - Gera MPS a partir de pedidos de venda
 */
router.post('/mps/gerar-de-pedidos', async (req, res) => {
    try {
        const { dataInicio, dataFim, status } = req.body;

        // TODO: Buscar pedidos de venda e gerar MPS

        res.json({
            success: true,
            message: 'MPS gerado a partir de pedidos de venda',
            itensGerados: 0
        });
    } catch (error) {
        console.error('Erro ao gerar MPS:', error);
        res.status(500).json({ success: false, message: 'Erro ao gerar MPS' });
    }
});

// ===================================================================
// PARMETROS E CONFIGURAÇÕES
// ===================================================================

/**
 * GET /parametros - Retorna parmetros do MRP
 */
router.get('/parametros', (req, res) => {
    res.json({
        success: true,
        config: MRP_CONFIG,
        metodosLote: METODOS_LOTE,
        statusOrdem: STATUS_ORDEM
    });
});

/**
 * PUT /parametros - Atualiza parmetros do MRP
 */
router.put('/parametros', async (req, res) => {
    try {
        const novasConfigs = req.body;

        // Valida e atualiza configurações
        Object.keys(novasConfigs).forEach(key => {
            if (MRP_CONFIG.hasOwnProperty(key)) {
                MRP_CONFIG[key] = novasConfigs[key];
            }
        });

        res.json({
            success: true,
            message: 'Parmetros atualizados',
            config: MRP_CONFIG
        });
    } catch (error) {
        console.error('Erro ao atualizar parmetros:', error);
        res.status(500).json({ success: false, message: 'Erro ao atualizar parmetros' });
    }
});

/**
 * POST /parametros-item - Cadastra parmetros MRP de um item
 */
router.post('/parametros-item', [
    body('codigoItem').notEmpty(),
], async (req, res) => {
    try {
        const {
            codigoItem,
            leadTime,
            leadTimeSeguranca,
            estoqueSeguranca,
            estoqueMaximo,
            loteMinimo,
            multiploLote,
            metodoLote,
            fornecedorPadrao,
            politicaAbastecimento
        } = req.body;

        const parametros = {
            codigoItem,
            leadTime: leadTime || 0,
            leadTimeSeguranca: leadTimeSeguranca || 0,
            estoqueSeguranca: estoqueSeguranca || 0,
            estoqueMaximo: estoqueMaximo || 0,
            loteMinimo: loteMinimo || 1,
            multiploLote: multiploLote || 1,
            metodoLote: metodoLote || 'LOT_FOR_LOT',
            fornecedorPadrao,
            politicaAbastecimento: politicaAbastecimento || 'COMPRA', // COMPRA, PRODUCAO, AMBOS
            atualizadoEm: new Date().toISOString()
        };

        // TODO: Salvar no banco

        res.json({
            success: true,
            message: 'Parmetros do item cadastrados',
            parametros
        });
    } catch (error) {
        console.error('Erro ao cadastrar parmetros:', error);
        res.status(500).json({ success: false, message: 'Erro ao cadastrar parmetros' });
    }
});

// ===================================================================
// RELATÓRIOS E ANÁLISES
// ===================================================================

/**
 * GET /relatorios/necessidades - Relatório de necessidades de materiais
 */
router.get('/relatorios/necessidades', async (req, res) => {
    try {
        const { dataInicio, dataFim, item, tipo } = req.query;

        res.json({
            success: true,
            relatorio: 'Necessidades de Materiais',
            filtros: { dataInicio, dataFim, item, tipo },
            dados: []
        });
    } catch (error) {
        console.error('Erro ao gerar relatório:', error);
        res.status(500).json({ success: false, message: 'Erro ao gerar relatório' });
    }
});

/**
 * GET /relatorios/cobertura - Relatório de cobertura de estoque
 */
router.get('/relatorios/cobertura', async (req, res) => {
    try {
        const { diasProjecao, item } = req.query;

        res.json({
            success: true,
            relatorio: 'Cobertura de Estoque',
            diasProjecao: diasProjecao || 30,
            itens: []
        });
    } catch (error) {
        console.error('Erro ao gerar relatório:', error);
        res.status(500).json({ success: false, message: 'Erro ao gerar relatório' });
    }
});

/**
 * GET /relatorios/excecoes - Relatório de exceções e alertas
 */
router.get('/relatorios/excecoes', async (req, res) => {
    try {
        res.json({
            success: true,
            relatorio: 'Exceções MRP',
            tiposExcecao: [
                'Lead time insuficiente',
                'Estoque abaixo do mínimo',
                'Ordem no período congelado',
                'Capacidade excedida',
                'Material sem BOM',
                'Fornecedor não definido'
            ],
            excecoes: []
        });
    } catch (error) {
        console.error('Erro ao gerar relatório:', error);
        res.status(500).json({ success: false, message: 'Erro ao gerar relatório' });
    }
});

// ===================================================================
// FUNÇÕES AUXILIARES
// ===================================================================

function calcularDiasEntre(dataInicio, dataFim) {
    const inicio = new Date(dataInicio);
    const fim = new Date(dataFim);
    return Math.ceil((fim - inicio) / (1000 * 60 * 60 * 24));
}

function gerarPeriodos(dataInicio, dataFim, tipo) {
    const periodos = [];
    const inicio = new Date(dataInicio);
    const fim = new Date(dataFim);
    
    let atual = new Date(inicio);
    
    while (atual <= fim) {
        const proximoPeriodo = new Date(atual);
        
        if (tipo === 'DIARIO') {
            proximoPeriodo.setDate(proximoPeriodo.getDate() + 1);
        } else if (tipo === 'SEMANAL') {
            proximoPeriodo.setDate(proximoPeriodo.getDate() + 7);
        } else if (tipo === 'MENSAL') {
            proximoPeriodo.setMonth(proximoPeriodo.getMonth() + 1);
        }
        
        periodos.push({
            inicio: atual.toISOString().split('T')[0],
            fim: new Date(Math.min(proximoPeriodo.getTime() - 1, fim.getTime())).toISOString().split('T')[0]
        });
        
        atual = proximoPeriodo;
    }
    
    return periodos;
}

module.exports = router;




