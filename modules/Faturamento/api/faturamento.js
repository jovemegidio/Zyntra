const express = require('express');
const router = express.Router();
const path = require('path');

// Serviços
const CalculoTributosService = require('../services/calculo-tributos.service');
const XmlNFeService = require('../services/xml-nfe.service');
const certificadoService = require('../services/certificado.service');
const sefazService = require('../services/sefaz.service');
const danfeService = require('../services/danfe.service');
const FinanceiroIntegracaoService = require('../services/financeiro-integracao.service');
const VendasEstoqueIntegracaoService = require('../services/vendas-estoque-integracao.service');
const PixGatewayService = require('../services/pix-gateway.service');
const ReguaCobrancaService = require('../services/regua-cobranca.service');

/**
 * MÓDULO DE FATURAMENTO NF-e COMPLETO
 * Sistema completo de faturamento com integração NFe, SEFAZ, Financeiro, Vendas e PCP
 */

module.exports = (pool, authenticateToken) => {
    
    // Serviço compartilhado de faturamento (configuração centralizada, numeração, CFOP, admin check)
    const { getFaturamentoSharedService } = require('../../../services/faturamento-shared.service');
    const faturamentoShared = getFaturamentoSharedService(pool);

    // Inicializar serviços de integração
    const financeiroService = new FinanceiroIntegracaoService(pool);
    const vendasEstoqueService = new VendasEstoqueIntegracaoService(pool);
    const pixService = new PixGatewayService(pool);
    const reguaService = new ReguaCobrancaService(pool);

    // Criar tabelas PIX na inicialização
    pixService.criarTabelas().catch(err => console.error('[PIX] Erro ao criar tabelas:', err));
    
    // Criar tabelas e iniciar serviço da Régua
    reguaService.criarTabelas().then(() => {
        reguaService.configurarEmailTransporter();
        reguaService.iniciarServico();
    }).catch(err => console.error('[RÉGUA] Erro ao inicializar:', err));

    // ============================================================
    // GERAR NF-e A PARTIR DE PEDIDO (COMPLETO)
    // ============================================================
    
    router.post('/gerar-nfe', authenticateToken, async (req, res) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const {
                pedido_id,
                gerar_danfe = true,
                enviar_email = false,
                numeroParcelas = 1,
                diaVencimento = 30,
                intervalo = 30,
                autoIntegrarFinanceiro = true,
                autoReservarEstoque = true,
                autoValidarEstoque = true
            } = req.body;
            const usuario_id = req.user.id;
            
            // AUDITORIA ENTERPRISE: RBAC - Geração de NFe requer permissão fiscal
            const rolesPermitidas = ['admin', 'administrador', 'gerente', 'gerente_fiscal', 'faturista', 'fiscal', 'vendedor'];
            const userRole = (req.user.role || req.user.cargo || '').toLowerCase();
            
            if (!rolesPermitidas.includes(userRole)) {
                console.log(`[FATURAMENTO-RBAC] Usuário ${usuario_id} (${userRole}) tentou gerar NF-e sem permissão`);
                return res.status(403).json({
                    success: false,
                    error: 'Acesso negado',
                    message: 'Apenas usuários com permissão de faturamento podem gerar NF-e.'
                });
            }
            
            // VALIDAÇÃO: pedido_id obrigatório e numérico
            if (!pedido_id || isNaN(parseInt(pedido_id))) {
                return res.status(400).json({
                    success: false,
                    message: 'ID do pedido é obrigatório e deve ser numérico'
                });
            }
            
            console.log(`[FATURAMENTO] Usuário ${usuario_id} iniciando geração de NF-e para pedido ${pedido_id}`);

            // Opcional: validar estoque antes de seguir
            if (autoValidarEstoque) {
                const estoqueOk = await vendasEstoqueService.validarEstoqueParaFaturamento(pedido_id);
                if (!estoqueOk.valido) {
                    await connection.rollback();
                    return res.status(400).json({ success: false, message: 'Estoque insuficiente para faturar', ...estoqueOk });
                }
            }

            // 1. Buscar dados do pedido
            const [pedidos] = await connection.query(`
                SELECT 
                    p.*,
                    c.nome as cliente_nome,
                    c.cnpj as cliente_cnpj,
                    c.cpf as cliente_cpf,
                    c.endereco as cliente_endereco,
                    c.cidade as cliente_cidade,
                    c.estado as cliente_estado,
                    c.cep as cliente_cep,
                    c.email as cliente_email
                FROM pedidos p
                INNER JOIN clientes c ON p.cliente_id = c.id
                WHERE p.id = ? AND p.status = 'aprovado'
            `, [pedido_id]);

            if (pedidos.length === 0) {
                throw new Error('Pedido não encontrado ou não está aprovado');
            }

            const pedido = pedidos[0];

            // 2. Verificar se já existe NF-e para este pedido
            const [nfeExistente] = await connection.query(`
                SELECT id, numero_nfe, status FROM nfe WHERE pedido_id = ?
            `, [pedido_id]);

            if (nfeExistente.length > 0) {
                throw new Error(`NF-e já existe para este pedido (Número: ${nfeExistente[0].numero_nfe}, Status: ${nfeExistente[0].status})`);
            }

            // 3. Buscar itens do pedido
            const [itens] = await connection.query(`
                SELECT 
                    pi.*,
                    pr.codigo,
                    pr.descricao,
                    pr.ncm,
                    pr.unidade_medida
                FROM pedido_itens pi
                INNER JOIN produtos pr ON pi.produto_id = pr.id
                WHERE pi.pedido_id = ?
            `, [pedido_id]);

            if (itens.length === 0) {
                throw new Error('Pedido sem itens');
            }

            // 4. Gerar número da NF-e usando serviço compartilhado (série configurável)
            // O serviço verifica MAX entre nfe, pedidos faturamento e pedidos remessa, com FOR UPDATE
            const nfNumero = await faturamentoShared.gerarProximoNumeroNFe(connection);
            const proximoNumero = parseInt(nfNumero.numero);
            const serieConfig = nfNumero.serie;

            // 5. Calcular totais usando CalculoTributosService (aritmética Decimal segura)
            // Buscar dados do emitente para cálculo correto de tributos
            const nfeConfig = require('../config/nfe.config');
            
            // Buscar configurações da empresa emitente
            const [empresaRows] = await connection.query(
                `SELECT * FROM configuracoes WHERE chave = 'empresa_emitente' LIMIT 1`
            ).catch(() => [[]]);
            
            const emitenteConfig = empresaRows.length > 0 
                ? (typeof empresaRows[0].valor === 'string' ? JSON.parse(empresaRows[0].valor) : empresaRows[0].valor)
                : { regimeTributario: 3, uf: 'MG', ie: '', cnpj: '' }; // Fallback: Lucro Real, MG (ALUFORCE)

            const emitente = {
                cnpj: emitenteConfig.cnpj || process.env.EMITENTE_CNPJ || '',
                razaoSocial: emitenteConfig.razaoSocial || process.env.EMITENTE_RAZAO_SOCIAL || 'ALUFORCE INDUSTRIA E COMERCIO LTDA',
                nomeFantasia: emitenteConfig.nomeFantasia || process.env.EMITENTE_NOME_FANTASIA || 'ALUFORCE',
                ie: emitenteConfig.ie || process.env.EMITENTE_IE || '',
                regimeTributario: emitenteConfig.regimeTributario || parseInt(process.env.EMITENTE_REGIME_TRIBUTARIO || '3'),
                uf: emitenteConfig.uf || process.env.EMITENTE_UF || 'MG',
                logradouro: emitenteConfig.logradouro || '',
                numero: emitenteConfig.numero || '',
                complemento: emitenteConfig.complemento || '',
                bairro: emitenteConfig.bairro || '',
                codigoMunicipio: emitenteConfig.codigoMunicipio || '',
                municipio: emitenteConfig.municipio || '',
                cep: emitenteConfig.cep || '',
                telefone: emitenteConfig.telefone || ''
            };

            const destinatario = {
                cnpj: pedido.cliente_cnpj || null,
                cpf: pedido.cliente_cpf || null,
                nome: pedido.cliente_nome,
                ie: pedido.cliente_ie || null,
                uf: pedido.cliente_estado,
                logradouro: pedido.cliente_endereco || '',
                numero: pedido.cliente_numero || 'S/N',
                bairro: pedido.cliente_bairro || '',
                codigoMunicipio: pedido.cliente_codigo_municipio || '',
                municipio: pedido.cliente_cidade || '',
                cep: pedido.cliente_cep || '',
                email: pedido.cliente_email || ''
            };

            // Calcular tributos de cada item usando CalculoTributosService
            const itensCalculados = itens.map((item, index) => {
                const itemParaCalculo = {
                    _index: index + 1,
                    codigo: item.codigo,
                    descricao: item.descricao,
                    ncm: item.ncm || '73269090', // Fallback: Obras de ferro/aço (ALUFORCE) - Deve ser configurado por produto
                    cfop: item.cfop || (emitente.uf === destinatario.uf ? '5102' : '6102'),
                    unidade: item.unidade_medida || 'UN',
                    quantidade: item.quantidade,
                    valorUnitario: item.preco_unitario,
                    desconto: item.desconto || 0,
                    ean: item.ean || 'SEM GTIN',
                    origem: item.origem || '0',
                    cst: item.cst || (emitente.regimeTributario === 1 ? '102' : '00'),
                    csosn: item.csosn || '102',
                    cstPIS: item.cst_pis || '01',
                    cstCOFINS: item.cst_cofins || '01',
                    calcularIPI: item.calcula_ipi || false,
                    aliquotaIPI: item.aliquota_ipi || 0,
                    calcularICMSST: item.calcula_icms_st || false,
                    mva: item.mva || 0,
                    reducaoBC: item.reducao_bc || 0
                };

                return CalculoTributosService.calcularTributosItem(
                    itemParaCalculo, emitente, destinatario, 'Venda de Produtos'
                );
            });

            // Calcular totais da NF-e usando Decimal seguro
            const totaisNFe = CalculoTributosService.calcularTotaisNFe(itensCalculados);

            const frete = parseFloat(pedido.frete) || 0;
            const desconto = parseFloat(pedido.desconto) || 0;
            
            // Usar valores calculados pelo motor de tributos
            const valorProdutos = totaisNFe.valorProdutos;
            const baseICMS = totaisNFe.baseCalculoICMS;
            const valorICMS = totaisNFe.valorICMS;
            const valorIPI = totaisNFe.valorIPI;
            const valorPIS = totaisNFe.valorPIS;
            const valorCOFINS = totaisNFe.valorCOFINS;
            // Aritmética segura: Math.round evita floating point drift
            // Ex: 1234.56 + 0.1 - 0.2 poderia dar 1234.4599999...
            const valorTotal = Math.round((totaisNFe.valorTotal + frete - desconto) * 100) / 100;

            // 6. Criar registro da NF-e
            const [nfe] = await connection.query(`
                INSERT INTO nfe (
                    pedido_id,
                    numero_nfe,
                    serie,
                    modelo,
                    tipo_emissao,
                    finalidade,
                    natureza_operacao,
                    cliente_id,
                    cliente_nome,
                    cliente_cnpj_cpf,
                    cliente_endereco,
                    cliente_cidade,
                    cliente_estado,
                    cliente_cep,
                    valor_produtos,
                    valor_frete,
                    valor_desconto,
                    base_calculo_icms,
                    valor_icms,
                    valor_ipi,
                    valor_pis,
                    valor_cofins,
                    valor_total,
                    status,
                    data_emissao,
                    usuario_id,
                    created_at
                ) VALUES (
                    ?, ?, ?, '55', 1, 1, 'Venda de Produtos',
                    ?, ?, ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?, ?, ?, ?, ?,
                    'pendente', NOW(), ?, NOW()
                )
            `, [
                pedido_id,
                proximoNumero,
                serieConfig,
                pedido.cliente_id,
                pedido.cliente_nome,
                pedido.cliente_cnpj || pedido.cliente_cpf,
                pedido.cliente_endereco,
                pedido.cliente_cidade,
                pedido.cliente_estado,
                pedido.cliente_cep,
                valorProdutos,
                frete,
                desconto,
                baseICMS,
                valorICMS,
                valorIPI,
                valorPIS,
                valorCOFINS,
                valorTotal,
                usuario_id
            ]);

            const nfe_id = nfe.insertId;

            // 7. Inserir itens da NF-e com tributos calculados
            for (let i = 0; i < itens.length; i++) {
                const item = itens[i];
                const itemCalc = itensCalculados[i];
                await connection.query(`
                    INSERT INTO nfe_itens (
                        nfe_id,
                        produto_id,
                        codigo_produto,
                        descricao,
                        ncm,
                        unidade,
                        quantidade,
                        valor_unitario,
                        valor_total,
                        valor_desconto,
                        base_calculo_icms,
                        valor_icms,
                        aliquota_icms,
                        valor_ipi,
                        valor_pis,
                        valor_cofins
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    nfe_id,
                    item.produto_id,
                    item.codigo,
                    item.descricao,
                    item.ncm || '73269090',
                    item.unidade_medida || 'UN',
                    item.quantidade,
                    item.preco_unitario,
                    itemCalc.totais.valorBruto,
                    itemCalc.totais.valorDesconto || 0,
                    itemCalc.icms.baseCalculo || 0,
                    itemCalc.icms.valorICMS || 0,
                    itemCalc.icms.aliquota || 0,
                    itemCalc.ipi.valorIPI || 0,
                    itemCalc.pis.valorPIS || 0,
                    itemCalc.cofins.valorCOFINS || 0
                ]);
            }

            // 7.5. Gerar XML da NF-e usando XmlNFeService
            const codigoUF = nfeConfig.estados[emitente.uf]?.codigo || 35;
            let xmlNfe = null;
            let chaveAcesso = null;
            try {
                const dadosNFe = {
                    codigoUF: codigoUF,
                    naturezaOperacao: 'Venda de Produtos',
                    modelo: '55',
                    serie: String(serieConfig),
                    numeroNFe: proximoNumero,
                    dataEmissao: new Date(),
                    dataSaida: new Date(),
                    tipoOperacao: '1', // Saída
                    tipoEmissao: '1',  // Normal
                    ambiente: nfeConfig.ambiente,
                    finalidade: '1',   // Normal
                    consumidorFinal: destinatario.ie ? '0' : '1',
                    indicadorPresenca: '1', // Presencial
                    emitente,
                    destinatario,
                    itens: itensCalculados,
                    totais: totaisNFe,
                    transporte: {
                        modalidade: pedido.modalidade_frete || '9'
                    },
                    pagamento: [{
                        forma: pedido.forma_pagamento || '01', // Dinheiro
                        valor: valorTotal
                    }],
                    informacoesAdicionais: pedido.observacoes_nfe ? {
                        complementar: pedido.observacoes_nfe
                    } : null
                };

                const resultadoXml = XmlNFeService.gerarXML(dadosNFe);
                xmlNfe = resultadoXml.xml;
                chaveAcesso = resultadoXml.chaveAcesso;

                // Salvar XML e chave de acesso no registro da NF-e
                await connection.query(`
                    UPDATE nfe SET xml_nfe = ?, chave_acesso = ?, emitente_uf = ?, emitente_cnpj = ? WHERE id = ?
                `, [xmlNfe, chaveAcesso, emitente.uf, emitente.cnpj.replace(/\D/g, ''), nfe_id]);

                console.log(`[FATURAMENTO] ✅ XML NF-e gerado com sucesso. Chave: ${chaveAcesso}`);
            } catch (xmlError) {
                console.error(`[FATURAMENTO] ❌ Erro ao gerar XML NF-e: ${xmlError.message}`);
                throw new Error(`Falha na geração do XML da NF-e: ${xmlError.message}. Verifique os dados fiscais (emitente, destinatário, NCM, CFOP) e tente novamente.`);
            }

            // 8. Atualizar pedido com NF-e gerada (status → 'faturado' para logística capturar)
            await connection.query(`
                UPDATE pedidos 
                SET nfe_id = ?, faturado_em = NOW(), status = 'faturado'
                WHERE id = ?
            `, [nfe_id, pedido_id]);

            await connection.commit();
            
            // AUDITORIA ENTERPRISE: Log de geração de NF-e fiscal
            console.log(`[FATURAMENTO-AUDIT] ✅ NF-e ${proximoNumero} gerada por usuário ${usuario_id} para pedido ${pedido_id}. Valor: R$ ${valorTotal.toFixed(2)}`);

            // Integrações pós-emissão
            const integracoes = { financeiro: null, estoque: null, avisos: [] };

            if (autoReservarEstoque && pedido_id) {
                try {
                    integracoes.estoque = await vendasEstoqueService.reservarEstoque(pedido_id, usuario_id);
                } catch (err) {
                    integracoes.avisos.push(`Reserva de estoque não concluída: ${err.message}`);
                }
            }

            if (autoIntegrarFinanceiro) {
                try {
                    integracoes.financeiro = await financeiroService.gerarContasReceber(nfe_id, {
                        numeroParcelas,
                        diaVencimento,
                        intervalo
                    });
                } catch (err) {
                    integracoes.avisos.push(`Integração financeira não concluída: ${err.message}`);
                }
            }

            res.json({
                success: true,
                message: integracoes.avisos.length === 0 ? 'NF-e gerada com sucesso' : 'NF-e gerada com avisos de integração',
                data: {
                    nfe_id,
                    numero_nfe: proximoNumero,
                    serie: 1,
                    chave_acesso: chaveAcesso || null,
                    xml_gerado: !!xmlNfe,
                    valor_total: valorTotal,
                    tributos: {
                        base_icms: baseICMS,
                        valor_icms: valorICMS,
                        valor_ipi: valorIPI,
                        valor_pis: valorPIS,
                        valor_cofins: valorCOFINS,
                        regime_tributario: emitente.regimeTributario === 1 ? 'Simples Nacional' 
                            : emitente.regimeTributario === 2 ? 'Lucro Presumido' : 'Lucro Real'
                    },
                    status: 'pendente',
                    proximos_passos: xmlNfe 
                        ? ['Enviar para SEFAZ (XML já gerado)', 'Gerar DANFE em PDF']
                        : ['Corrigir dados para geração do XML', 'Enviar para SEFAZ', 'Gerar DANFE em PDF'],
                    integracoes
                }
            });

        } catch (error) {
            await connection.rollback();
            console.error('[FATURAMENTO] Erro ao gerar NF-e:', error);
            res.status(500).json({ 
                success: false, 
                message: error.message 
            });
        } finally {
            connection.release();
        }
    });

    // ============================================================
    // LISTAR NF-es
    // ============================================================
    
    router.get('/nfes', authenticateToken, async (req, res) => {
        try {
            const { status, data_inicio, data_fim, cliente_id } = req.query;
            
            let query = `
                SELECT 
                    n.*,
                    c.nome as cliente_nome,
                    p.id as pedido_numero,
                    COUNT(ni.id) as total_itens
                FROM nfe n
                LEFT JOIN clientes c ON n.cliente_id = c.id
                LEFT JOIN pedidos p ON n.pedido_id = p.id
                LEFT JOIN nfe_itens ni ON n.id = ni.nfe_id
                WHERE 1=1
            `;
            
            const params = [];
            
            if (status) {
                query += ' AND n.status = ?';
                params.push(status);
            }
            
            if (data_inicio) {
                query += ' AND DATE(n.data_emissao) >= ?';
                params.push(data_inicio);
            }
            
            if (data_fim) {
                query += ' AND DATE(n.data_emissao) <= ?';
                params.push(data_fim);
            }
            
            if (cliente_id) {
                query += ' AND n.cliente_id = ?';
                params.push(cliente_id);
            }
            
            query += ' GROUP BY n.id ORDER BY n.data_emissao DESC LIMIT 100';
            
            const [nfes] = await pool.query(query, params);
            
            res.json({
                success: true,
                data: nfes
            });
            
        } catch (error) {
            console.error('[FATURAMENTO] Erro ao listar NF-es:', error);
            res.status(500).json({ 
                success: false, 
                message: error.message 
            });
        }
    });

    // ============================================================
    // DETALHES DA NF-e
    // ============================================================
    
    router.get('/nfes/:id', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            
            const [nfes] = await pool.query(`
                SELECT 
                    n.*,
                    c.nome as cliente_nome,
                    c.email as cliente_email,
                    p.id as pedido_id,
                    p.numero_pedido
                FROM nfe n
                LEFT JOIN clientes c ON n.cliente_id = c.id
                LEFT JOIN pedidos p ON n.pedido_id = p.id
                WHERE n.id = ?
            `, [id]);
            
            if (nfes.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'NF-e não encontrada'
                });
            }
            
            const [itens] = await pool.query(`
                SELECT * FROM nfe_itens WHERE nfe_id = ?
            `, [id]);
            
            res.json({
                success: true,
                data: {
                    ...nfes[0],
                    itens
                }
            });
            
        } catch (error) {
            console.error('[FATURAMENTO] Erro ao buscar NF-e:', error);
            res.status(500).json({ 
                success: false, 
                message: error.message 
            });
        }
    });

    // ============================================================
    // CANCELAR NF-e
    // ============================================================
    
    router.post('/nfes/:id/cancelar', authenticateToken, async (req, res) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const { id } = req.params;
            const { motivo } = req.body;
            const usuario_id = req.user.id;
            
            // AUDITORIA ENTERPRISE: RBAC - Apenas gerentes/admin podem cancelar NF-e
            const rolesPermitidas = ['admin', 'administrador', 'gerente', 'gerente_fiscal', 'supervisor_fiscal'];
            const userRole = (req.user.role || req.user.cargo || '').toLowerCase();
            
            if (!rolesPermitidas.includes(userRole)) {
                console.log(`[FATURAMENTO-RBAC] Usuário ${usuario_id} (${userRole}) tentou cancelar NF-e ${id} sem permissão`);
                return res.status(403).json({
                    success: false,
                    error: 'Acesso negado',
                    message: 'Apenas gerentes ou administradores podem cancelar NF-e. Esta ação requer autorização fiscal.'
                });
            }

            // VALIDAÇÃO FISCAL: Motivo deve ter entre 15 e 255 caracteres (SEFAZ)
            if (!motivo || motivo.trim().length < 15) {
                throw new Error('Motivo do cancelamento deve ter no mínimo 15 caracteres');
            }
            if (motivo.length > 255) {
                throw new Error('Motivo do cancelamento excede o limite de 255 caracteres');
            }

            // Buscar NF-e
            const [nfes] = await connection.query(`
                SELECT * FROM nfe WHERE id = ?
            `, [id]);

            if (nfes.length === 0) {
                throw new Error('NF-e não encontrada');
            }

            const nfe = nfes[0];

            if (nfe.status === 'cancelada') {
                throw new Error('NF-e já está cancelada');
            }
            
            // VALIDAÇÃO FISCAL: Verificar prazo de cancelamento (24 horas após autorização)
            if (nfe.data_autorizacao) {
                const horasDesdeAutorizacao = (Date.now() - new Date(nfe.data_autorizacao).getTime()) / (1000 * 60 * 60);
                if (horasDesdeAutorizacao > 24) {
                    console.log(`[FATURAMENTO] Tentativa de cancelar NF-e ${id} após prazo de 24h`);
                    throw new Error(`NF-e não pode ser cancelada após 24 horas da autorização (${Math.floor(horasDesdeAutorizacao)}h decorridas). Use Carta de Correção ou entre em contato com a contabilidade.`);
                }
            }

            // Atualizar status
            await connection.query(`
                UPDATE nfe 
                SET status = 'cancelada',
                    data_cancelamento = NOW(),
                    motivo_cancelamento = ?,
                    cancelado_por = ?
                WHERE id = ?
            `, [motivo, usuario_id, id]);

            // Reverter faturamento do pedido (status volta a 'aprovado')
            if (nfe.pedido_id) {
                await connection.query(`
                    UPDATE pedidos 
                    SET nfe_id = NULL, faturado_em = NULL, status = 'aprovado'
                    WHERE id = ?
                `, [nfe.pedido_id]);
            }

            // FIX: Estorno financeiro e estoque ANTES do commit (dentro da transação)
            // Se falhar, todo o cancelamento é revertido atomicamente
            const integracoes = { financeiro: null, estoque: null, avisos: [] };

            try {
                integracoes.financeiro = await financeiroService.estornarNFeCancelada(id);
            } catch (err) {
                console.warn(`[FATURAMENTO] Aviso estorno financeiro: ${err.message}`);
                integracoes.avisos.push(`Financeiro não estornado: ${err.message}`);
            }

            try {
                integracoes.estoque = await vendasEstoqueService.estornarEstoque(id, usuario_id);
            } catch (err) {
                console.warn(`[FATURAMENTO] Aviso estorno estoque: ${err.message}`);
                integracoes.avisos.push(`Estoque não estornado: ${err.message}`);
            }

            await connection.commit();

            res.json({
                success: true,
                message: integracoes.avisos.length === 0 ? 'NF-e cancelada com sucesso' : 'NF-e cancelada com avisos',
                data: { nfe_id: id, status: 'cancelada', integracoes }
            });

        } catch (error) {
            await connection.rollback();
            console.error('[FATURAMENTO] Erro ao cancelar NF-e:', error);
            res.status(500).json({ 
                success: false, 
                message: error.message 
            });
        } finally {
            connection.release();
        }
    });

    // ============================================================
    // ESTATÍSTICAS
    // ============================================================
    
    router.get('/estatisticas', authenticateToken, async (req, res) => {
        try {
            const [stats] = await pool.query(`
                SELECT 
                    COUNT(*) as total_nfes,
                    SUM(CASE WHEN status = 'autorizada' THEN 1 ELSE 0 END) as autorizadas,
                    SUM(CASE WHEN status = 'pendente' THEN 1 ELSE 0 END) as pendentes,
                    SUM(CASE WHEN status = 'cancelada' THEN 1 ELSE 0 END) as canceladas,
                    SUM(CASE WHEN status = 'autorizada' THEN valor_total ELSE 0 END) as valor_total_faturado,
                    SUM(CASE WHEN status = 'autorizada' AND MONTH(data_emissao) = MONTH(NOW()) THEN valor_total ELSE 0 END) as valor_mes_atual
                FROM nfe
            `);
            
            res.json({
                success: true,
                data: stats[0]
            });
            
        } catch (error) {
            console.error('[FATURAMENTO] Erro ao buscar estatísticas:', error);
            res.status(500).json({ 
                success: false, 
                message: error.message 
            });
        }
    });

    // ============================================================
    // ENVIAR NF-e PARA SEFAZ
    // ============================================================
    
    router.post('/nfes/:id/enviar-sefaz', authenticateToken, async (req, res) => {
        const connection = await pool.getConnection();
        try {
            const { id } = req.params;
            const usuario_id = req.user.id;
            
            // AUDITORIA ENTERPRISE: RBAC - Envio à SEFAZ é operação fiscal crítica
            const rolesPermitidas = ['admin', 'administrador', 'gerente', 'gerente_fiscal', 'faturista', 'fiscal'];
            const userRole = (req.user.role || req.user.cargo || '').toLowerCase();
            
            if (!rolesPermitidas.includes(userRole)) {
                console.log(`[FATURAMENTO-RBAC] Usuário ${usuario_id} (${userRole}) tentou enviar NFe ${id} à SEFAZ sem permissão`);
                return res.status(403).json({
                    success: false,
                    error: 'Acesso negado',
                    message: 'Apenas usuários com permissão fiscal podem enviar NF-e à SEFAZ.'
                });
            }
            
            // Buscar NFe
            const [nfes] = await connection.query(`SELECT * FROM nfe WHERE id = ?`, [id]);
            
            if (nfes.length === 0) {
                return res.status(404).json({ success: false, message: 'NFe não encontrada' });
            }
            
            const nfe = nfes[0];
            
            if (nfe.status !== 'pendente') {
                return res.status(400).json({ 
                    success: false, 
                    message: `NFe não pode ser enviada. Status atual: ${nfe.status}` 
                });
            }
            
            console.log(`[FATURAMENTO-SEFAZ] Usuário ${usuario_id} enviando NFe ${nfe.numero_nfe} à SEFAZ`);

            // Verificar se XML existe
            if (!nfe.xml_nfe) {
                return res.status(400).json({
                    success: false,
                    message: 'XML da NF-e não foi gerado. Regenere a NF-e antes de enviar à SEFAZ.'
                });
            }

            // Assinar XML com certificado digital antes de enviar
            let xmlAssinado = nfe.xml_nfe;
            try {
                xmlAssinado = await certificadoService.assinarXML(nfe.xml_nfe, 'infNFe');
                // Salvar XML assinado
                await connection.query(
                    `UPDATE nfe SET xml_assinado = ? WHERE id = ?`,
                    [xmlAssinado, id]
                );
            } catch (certError) {
                console.warn(`[FATURAMENTO] ⚠ Erro ao assinar XML: ${certError.message}. Enviando XML original.`);
            }
            
            // Enviar para SEFAZ
            const resultado = await sefazService.autorizarNFe(xmlAssinado, nfe.emitente_uf);
            
            if (resultado.autorizado) {
                await connection.beginTransaction();
                
                await connection.query(`
                    UPDATE nfe 
                    SET status = 'autorizada',
                        numero_protocolo = ?,
                        data_autorizacao = NOW(),
                        xml_protocolo = ?,
                        autorizado_por = ?
                    WHERE id = ?
                `, [resultado.numeroProtocolo, resultado.xmlCompleto, usuario_id, id]);

                await connection.commit();
                
                // AUDITORIA ENTERPRISE: Log de autorização SEFAZ
                console.log(`[FATURAMENTO-AUDIT] ✅ NFe ${nfe.numero_nfe} AUTORIZADA pela SEFAZ. Protocolo: ${resultado.numeroProtocolo}. Usuário: ${usuario_id}`);

                // FIX: Baixar estoque efetivamente após autorização SEFAZ
                const integracoesSefaz = { estoque: null, avisos: [] };
                try {
                    integracoesSefaz.estoque = await vendasEstoqueService.baixarEstoque(parseInt(id), usuario_id);
                    console.log(`[FATURAMENTO-AUDIT] ✅ Estoque baixado para NFe ${nfe.numero_nfe}`);
                } catch (estoqueErr) {
                    integracoesSefaz.avisos.push(`Baixa de estoque não concluída: ${estoqueErr.message}`);
                    console.warn(`[FATURAMENTO] ⚠ Estoque não baixado para NFe ${id}: ${estoqueErr.message}`);
                }
                
                res.json({
                    success: true,
                    message: integracoesSefaz.avisos.length === 0 
                        ? 'NFe autorizada pela SEFAZ e estoque baixado' 
                        : 'NFe autorizada pela SEFAZ (com avisos)',
                    protocolo: resultado.numeroProtocolo,
                    chaveAcesso: resultado.chaveAcesso,
                    integracoes: integracoesSefaz
                });
            } else {
                res.status(400).json({
                    success: false,
                    message: 'NFe rejeitada pela SEFAZ',
                    codigo: resultado.codigoStatus,
                    motivo: resultado.motivo
                });
            }
            
        } catch (error) {
            console.error('[FATURAMENTO] Erro ao enviar NFe:', error);
            res.status(500).json({ success: false, message: error.message });
        } finally {
            connection.release();
        }
    });

    // ============================================================
    // GERAR E BAIXAR DANFE
    // ============================================================
    
    router.get('/nfes/:id/danfe', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            
            const [nfes] = await pool.query(`SELECT * FROM nfe WHERE id = ?`, [id]);
            
            if (nfes.length === 0) {
                return res.status(404).json({ success: false, message: 'NFe não encontrada' });
            }
            
            const nfe = nfes[0];
            const caminhoDANFE = path.join(__dirname, '../storage/nfe/danfes', `danfe_${nfe.numero_nfe}.pdf`);
            
            // Gerar DANFE
            await danfeService.gerarDANFE(nfe, caminhoDANFE);
            
            // Enviar arquivo
            res.download(caminhoDANFE, `DANFE_${nfe.numero_nfe}.pdf`);
            
        } catch (error) {
            console.error('[FATURAMENTO] Erro ao gerar DANFE:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    });

    // ============================================================
    // CARTA DE CORREÇÃO
    // ============================================================
    
    router.post('/nfes/:id/carta-correcao', authenticateToken, async (req, res) => {
        const connection = await pool.getConnection();
        try {
            const { id } = req.params;
            const { correcao } = req.body;
            const usuario_id = req.user.id;
            
            // AUDITORIA ENTERPRISE: RBAC - Carta de Correção é evento fiscal
            const rolesPermitidas = ['admin', 'administrador', 'gerente', 'gerente_fiscal', 'faturista', 'fiscal', 'contador'];
            const userRole = (req.user.role || req.user.cargo || '').toLowerCase();
            
            if (!rolesPermitidas.includes(userRole)) {
                console.log(`[FATURAMENTO-RBAC] Usuário ${usuario_id} (${userRole}) tentou emitir CC-e para NFe ${id} sem permissão`);
                return res.status(403).json({
                    success: false,
                    error: 'Acesso negado',
                    message: 'Apenas usuários com permissão fiscal podem emitir Carta de Correção.'
                });
            }
            
            if (!correcao || correcao.length < 15) {
                return res.status(400).json({
                    success: false,
                    message: 'Correção deve ter no mínimo 15 caracteres'
                });
            }
            
            // VALIDAÇÃO FISCAL: Limite máximo de 1000 caracteres
            if (correcao.length > 1000) {
                return res.status(400).json({
                    success: false,
                    message: 'Correção não pode exceder 1000 caracteres conforme regra SEFAZ'
                });
            }
            
            const [nfes] = await connection.query(`SELECT * FROM nfe WHERE id = ?`, [id]);
            
            if (nfes.length === 0) {
                return res.status(404).json({ success: false, message: 'NFe não encontrada' });
            }
            
            const nfe = nfes[0];
            
            if (nfe.status !== 'autorizada') {
                return res.status(400).json({
                    success: false,
                    message: 'Apenas NFe autorizadas podem ter carta de correção'
                });
            }
            
            // Contar sequência de CC-e
            const [cces] = await connection.query(`
                SELECT COUNT(*) as total FROM nfe_eventos 
                WHERE nfe_id = ? AND tipo_evento = '110110'
            `, [id]);
            
            const sequencia = cces[0].total + 1;
            
            // Enviar CC-e
            const resultado = await sefazService.cartaCorrecao(
                nfe.chave_acesso,
                correcao,
                nfe.emitente_uf,
                nfe.emitente_cnpj,
                sequencia
            );
            
            if (resultado.sucesso) {
                await connection.query(`
                    INSERT INTO nfe_eventos (
                        nfe_id, tipo_evento, sequencia, descricao,
                        protocolo, xml_evento, created_at
                    ) VALUES (?, '110110', ?, ?, ?, ?, NOW())
                `, [id, sequencia, correcao, resultado.numeroProtocolo, resultado.xmlCompleto]);
                
                res.json({
                    success: true,
                    message: 'Carta de correção registrada',
                    protocolo: resultado.numeroProtocolo
                });
            } else {
                res.status(400).json({
                    success: false,
                    message: 'CC-e rejeitada',
                    codigo: resultado.codigoStatus
                });
            }
            
        } catch (error) {
            console.error('[FATURAMENTO] Erro na carta de correção:', error);
            res.status(500).json({ success: false, message: error.message });
        } finally {
            connection.release();
        }
    });

    // ============================================================
    // INUTILIZAR NUMERAÇÃO
    // ============================================================
    
    router.post('/inutilizar-numeracao', authenticateToken, async (req, res) => {
        try {
            const { serie, numeroInicial, numeroFinal, justificativa } = req.body;
            const usuario_id = req.user.id;
            
            // AUDITORIA ENTERPRISE: RBAC - Inutilização é operação crítica fiscal
            const rolesPermitidas = ['admin', 'administrador', 'gerente_fiscal', 'contador'];
            const userRole = (req.user.role || req.user.cargo || '').toLowerCase();
            
            if (!rolesPermitidas.includes(userRole)) {
                console.log(`[FATURAMENTO-RBAC] Usuário ${usuario_id} (${userRole}) tentou inutilizar numeração sem permissão`);
                return res.status(403).json({
                    success: false,
                    error: 'Acesso negado',
                    message: 'Inutilização de numeração é uma operação fiscal crítica. Apenas administradores, gerentes fiscais ou contadores podem executar.'
                });
            }
            
            // VALIDAÇÃO FISCAL: Justificativa obrigatória (15-255 caracteres)
            if (!justificativa || justificativa.trim().length < 15) {
                return res.status(400).json({
                    success: false,
                    message: 'Justificativa deve ter no mínimo 15 caracteres conforme exigência SEFAZ'
                });
            }
            if (justificativa.length > 255) {
                return res.status(400).json({
                    success: false,
                    message: 'Justificativa excede o limite de 255 caracteres'
                });
            }
            
            // VALIDAÇÃO: Range de numeração válido
            if (!numeroInicial || !numeroFinal || numeroInicial > numeroFinal) {
                return res.status(400).json({
                    success: false,
                    message: 'Range de numeração inválido. O número inicial deve ser menor ou igual ao final.'
                });
            }
            
            // VALIDAÇÃO: Limite máximo de 1000 números por inutilização
            if ((numeroFinal - numeroInicial) > 1000) {
                return res.status(400).json({
                    success: false,
                    message: 'Não é permitido inutilizar mais de 1000 números por operação'
                });
            }
            
            console.log(`[FATURAMENTO] Usuário ${usuario_id} solicitando inutilização: série ${serie}, ${numeroInicial}-${numeroFinal}`);
            
            const resultado = await sefazService.inutilizarNumeracao({
                ano: new Date().getFullYear().toString().substring(2),
                cnpj: req.user.empresa_cnpj,
                modelo: '55',
                serie,
                numeroInicial,
                numeroFinal,
                justificativa
            }, req.user.empresa_uf);
            
            if (resultado.sucesso) {
                // Registrar inutilização com auditoria
                await pool.query(`
                    INSERT INTO nfe_inutilizacoes (
                        serie, numero_inicial, numero_final, 
                        justificativa, xml_inutilizacao, usuario_id, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, NOW())
                `, [serie, numeroInicial, numeroFinal, justificativa, resultado.xmlCompleto, usuario_id]);
                
                res.json({
                    success: true,
                    message: 'Numeração inutilizada'
                });
            } else {
                res.status(400).json({
                    success: false,
                    message: 'Inutilização rejeitada'
                });
            }
            
        } catch (error) {
            console.error('[FATURAMENTO] Erro ao inutilizar:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    });

    // ============================================================
    // CONSULTAR STATUS SEFAZ
    // ============================================================
    
    router.get('/sefaz/status', authenticateToken, async (req, res) => {
        try {
            const resultado = await sefazService.consultarStatusServico(req.user.empresa_uf);
            
            res.json({
                success: true,
                online: resultado.online,
                mensagem: resultado.motivo
            });
            
        } catch (error) {
            console.error('[FATURAMENTO] Erro ao consultar status:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    });

    // ============================================================
    // INTEGRAÇÃO FINANCEIRO - GERAR CONTAS A RECEBER
    // ============================================================
    
    router.post('/nfes/:id/gerar-financeiro', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const { numeroParcelas, diaVencimento, intervalo } = req.body;
            
            const resultado = await financeiroService.gerarContasReceber(id, {
                numeroParcelas: numeroParcelas || 1,
                diaVencimento: diaVencimento || 30,
                intervalo: intervalo || 30
            });
            
            res.json({
                success: true,
                message: 'Contas a receber geradas',
                ...resultado
            });
            
        } catch (error) {
            console.error('[FATURAMENTO] Erro ao gerar financeiro:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    });

    // ============================================================
    // RELATÓRIO DE FATURAMENTO
    // ============================================================
    
    router.get('/relatorios/faturamento', authenticateToken, async (req, res) => {
        try {
            const { data_inicio, data_fim } = req.query;
            
            const [faturamento] = await pool.query(`
                SELECT 
                    DATE(n.data_emissao) as data,
                    COUNT(*) as total_nfes,
                    SUM(n.valor_total) as valor_total,
                    SUM(n.valor_produtos) as valor_produtos,
                    SUM(n.valor_icms) as total_icms,
                    SUM(n.valor_ipi) as total_ipi,
                    SUM(n.valor_pis) as total_pis,
                    SUM(n.valor_cofins) as total_cofins
                FROM nfe n
                WHERE n.status = 'autorizada'
                AND n.data_emissao >= ?
                AND n.data_emissao <= ?
                GROUP BY DATE(n.data_emissao)
                ORDER BY data DESC
            `, [data_inicio, data_fim]);
            
            res.json({
                success: true,
                data: faturamento
            });
            
        } catch (error) {
            console.error('[FATURAMENTO] Erro no relatório:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    });

    // ============================================================
    // VALIDAR ESTOQUE ANTES DE FATURAR
    // ============================================================
    
    router.get('/pedidos/:id/validar-estoque', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            
            const resultado = await vendasEstoqueService.validarEstoqueParaFaturamento(id);
            
            res.json({
                success: true,
                ...resultado
            });
            
        } catch (error) {
            console.error('[FATURAMENTO] Erro ao validar estoque:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    });

    // ============================================================
    // PRODUTOS MAIS FATURADOS
    // ============================================================
    
    router.get('/relatorios/produtos-mais-faturados', authenticateToken, async (req, res) => {
        try {
            const { data_inicio, data_fim, limite } = req.query;
            
            const produtos = await vendasEstoqueService.relatorioProdutosMaisFaturados({
                data_inicio,
                data_fim,
                limite
            });
            
            res.json({
                success: true,
                data: produtos
            });
            
        } catch (error) {
            console.error('[FATURAMENTO] Erro no relatório:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    });

    // ============================================================
    // CONFIGURAR CERTIFICADO DIGITAL
    // ============================================================
    
    router.post('/configuracao/certificado', authenticateToken, async (req, res) => {
        try {
            const { caminhoArquivo, senha } = req.body;
            const usuario_id = req.user.id;
            
            // AUDITORIA ENTERPRISE: RBAC - Configuração de certificado é operação ultra-crítica
            const rolesPermitidas = ['admin', 'administrador'];
            const userRole = (req.user.role || req.user.cargo || '').toLowerCase();
            
            if (!rolesPermitidas.includes(userRole)) {
                console.log(`[FATURAMENTO-SEGURANÇA] ⚠️ Usuário ${usuario_id} (${userRole}) tentou carregar certificado digital sem permissão!`);
                return res.status(403).json({
                    success: false,
                    error: 'Acesso negado',
                    message: 'Configuração de certificado digital é uma operação de segurança máxima. Apenas administradores podem executar.'
                });
            }
            
            // VALIDAÇÃO: Campos obrigatórios
            if (!caminhoArquivo || !senha) {
                return res.status(400).json({
                    success: false,
                    message: 'Caminho do arquivo e senha são obrigatórios'
                });
            }
            
            // SEGURANÇA: Path traversal protection
            const path = require('path');
            const normalizedPath = path.normalize(caminhoArquivo);
            if (normalizedPath.includes('..') || normalizedPath.includes('//')) {
                console.log(`[FATURAMENTO-SEGURANÇA] ⚠️ Tentativa de path traversal por usuário ${usuario_id}: ${caminhoArquivo}`);
                return res.status(400).json({
                    success: false,
                    message: 'Caminho de arquivo inválido'
                });
            }
            
            console.log(`[FATURAMENTO] Usuário ${usuario_id} carregando certificado digital`);
            
            const resultado = await certificadoService.carregarCertificadoA1(caminhoArquivo, senha);
            
            console.log(`[FATURAMENTO] ✅ Certificado carregado com sucesso por usuário ${usuario_id}. Validade: ${resultado.validade?.fim}`);
            
            res.json({
                success: true,
                message: 'Certificado carregado com sucesso',
                ...resultado
            });
            
        } catch (error) {
            console.error('[FATURAMENTO] Erro ao carregar certificado:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    });

    // ============================================================
    // VERIFICAR VALIDADE DO CERTIFICADO
    // ============================================================
    
    router.get('/configuracao/certificado/validade', authenticateToken, async (req, res) => {
        try {
            const validade = certificadoService.verificarValidade();
            const info = certificadoService.getInfoCertificado();
            
            res.json({
                success: true,
                ...validade,
                ...info
            });
            
        } catch (error) {
            console.error('[FATURAMENTO] Erro ao verificar certificado:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    });

    // ============================================================
    // ============ GATEWAY PIX - COBRANÇAS AUTOMÁTICAS ============
    // ============================================================

    /**
     * Listar provedores PIX disponíveis
     */
    router.get('/pix/provedores', authenticateToken, async (req, res) => {
        try {
            res.json({
                success: true,
                provedores: [
                    { id: 'mercadopago', nome: 'Mercado Pago', logo: '💰' },
                    { id: 'pagseguro', nome: 'PagSeguro', logo: '💳' },
                    { id: 'gerencianet', nome: 'Gerencianet/EfiBank', logo: '🏦' },
                    { id: 'picpay', nome: 'PicPay', logo: '💚' },
                    { id: 'simulacao', nome: 'Simulação (Dev)', logo: '🧪' }
                ]
            });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    });

    /**
     * Obter configuração atual do PIX
     */
    router.get('/pix/config', authenticateToken, async (req, res) => {
        try {
            const [configs] = await pool.query('SELECT id, provedor, ativo, chave_pix, tipo_chave, ambiente, criado_em FROM pix_config');
            const ativo = configs.find(c => c.ativo);
            
            res.json({
                success: true,
                configuracoes: configs,
                ativo: ativo || null
            });
        } catch (error) {
            console.error('[PIX] Erro ao buscar config:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    });

    /**
     * Salvar configuração PIX
     * AUDITORIA ENTERPRISE: Configuração financeira crítica
     */
    router.post('/pix/config', authenticateToken, async (req, res) => {
        try {
            const usuario_id = req.user.id;
            
            // RBAC - Apenas administradores e gerentes financeiros podem configurar PIX
            const rolesPermitidas = ['admin', 'administrador', 'gerente', 'gerente_financeiro'];
            const userRole = (req.user.role || req.user.cargo || '').toLowerCase();
            
            if (!rolesPermitidas.includes(userRole)) {
                console.log(`[PIX-RBAC] Usuário ${usuario_id} (${userRole}) tentou alterar configuração PIX sem permissão`);
                return res.status(403).json({
                    success: false,
                    error: 'Acesso negado',
                    message: 'Apenas administradores ou gerentes financeiros podem configurar gateway PIX.'
                });
            }
            
            console.log(`[PIX] Usuário ${usuario_id} alterando configuração PIX`);
            const resultado = await pixService.salvarConfiguracao(req.body);
            res.json(resultado);
        } catch (error) {
            console.error('[PIX] Erro ao salvar config:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    });

    /**
     * Criar cobrança PIX
     */
    router.post('/pix/cobranca', authenticateToken, async (req, res) => {
        try {
            const resultado = await pixService.criarCobranca(req.body);
            res.json(resultado);
        } catch (error) {
            console.error('[PIX] Erro ao criar cobrança:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    });

    /**
     * Criar cobrança PIX para NF-e
     */
    router.post('/pix/cobranca/nfe/:nfeId', authenticateToken, async (req, res) => {
        try {
            const { nfeId } = req.params;
            
            // Buscar dados da NF-e
            const [nfe] = await pool.query(`
                SELECT n.*, c.nome as cliente_nome, c.cnpj as cliente_cnpj, c.cpf as cliente_cpf, c.email as cliente_email
                FROM nfe n
                LEFT JOIN clientes c ON n.cliente_id = c.id
                WHERE n.id = ?
            `, [nfeId]);

            if (!nfe.length) {
                return res.status(404).json({ success: false, message: 'NF-e não encontrada' });
            }

            const dados = nfe[0];
            const resultado = await pixService.criarCobranca({
                origem_tipo: 'nfe',
                origem_id: nfeId,
                cliente_id: dados.cliente_id,
                cliente_nome: dados.cliente_nome,
                cliente_cpf_cnpj: dados.cliente_cnpj || dados.cliente_cpf,
                email: dados.cliente_email,
                valor: parseFloat(dados.valor_total),
                descricao: `NF-e ${dados.numero_nfe} - ALUFORCE`,
                expiracao: req.body.expiracao || 3600
            });

            res.json(resultado);
        } catch (error) {
            console.error('[PIX] Erro ao criar cobrança NF-e:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    });

    /**
     * Criar cobrança PIX para conta a receber
     */
    router.post('/pix/cobranca/conta/:contaId', authenticateToken, async (req, res) => {
        try {
            const { contaId } = req.params;
            
            const [conta] = await pool.query(`
                SELECT cr.*, c.nome as cliente_nome, c.cnpj, c.cpf, c.email
                FROM contas_receber cr
                LEFT JOIN clientes c ON cr.cliente_id = c.id
                WHERE cr.id = ?
            `, [contaId]);

            if (!conta.length) {
                return res.status(404).json({ success: false, message: 'Conta não encontrada' });
            }

            const dados = conta[0];
            const resultado = await pixService.criarCobranca({
                origem_tipo: 'conta_receber',
                origem_id: contaId,
                cliente_id: dados.cliente_id,
                cliente_nome: dados.cliente_nome,
                cliente_cpf_cnpj: dados.cnpj || dados.cpf,
                email: dados.email,
                valor: parseFloat(dados.valor),
                descricao: dados.descricao || `Cobrança ${contaId} - ALUFORCE`,
                expiracao: req.body.expiracao || 3600
            });

            res.json(resultado);
        } catch (error) {
            console.error('[PIX] Erro ao criar cobrança conta:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    });

    /**
     * Consultar cobrança PIX
     */
    router.get('/pix/cobranca/:txid', authenticateToken, async (req, res) => {
        try {
            const cobranca = await pixService.consultarCobranca(req.params.txid);
            res.json({ success: true, cobranca });
        } catch (error) {
            console.error('[PIX] Erro ao consultar:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    });

    /**
     * Cancelar cobrança PIX
     */
    router.delete('/pix/cobranca/:txid', authenticateToken, async (req, res) => {
        try {
            const resultado = await pixService.cancelarCobranca(req.params.txid);
            res.json(resultado);
        } catch (error) {
            console.error('[PIX] Erro ao cancelar:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    });

    /**
     * Listar cobranças PIX
     */
    router.get('/pix/cobrancas', authenticateToken, async (req, res) => {
        try {
            const cobrancas = await pixService.listarCobrancas(req.query);
            res.json({ success: true, cobrancas });
        } catch (error) {
            console.error('[PIX] Erro ao listar:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    });

    /**
     * Dashboard PIX
     */
    router.get('/pix/dashboard', authenticateToken, async (req, res) => {
        try {
            const dashboard = await pixService.getDashboard(req.query.periodo || 30);
            res.json({ success: true, ...dashboard });
        } catch (error) {
            console.error('[PIX] Erro no dashboard:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    });

    /**
     * Webhook PIX (público - recebe notificações dos provedores)
     * AUDITORIA ENTERPRISE: Validação de assinatura HMAC para segurança
     */
    router.post('/pix/webhook/:provedor', async (req, res) => {
        try {
            const { provedor } = req.params;
            const crypto = require('crypto');
            
            // SEGURANÇA: Validar assinatura HMAC do webhook
            const signature = req.headers['x-webhook-signature'] || req.headers['x-signature'];
            
            // Buscar secret do provedor para validação
            const [configs] = await pool.query(
                'SELECT webhook_secret FROM pix_config WHERE provedor = ? AND ativo = 1', 
                [provedor]
            );
            
            if (configs.length > 0 && configs[0].webhook_secret) {
                const webhookSecret = configs[0].webhook_secret;
                const payload = JSON.stringify(req.body);
                const expectedSignature = crypto
                    .createHmac('sha256', webhookSecret)
                    .update(payload)
                    .digest('hex');
                
                // Validar assinatura (se fornecida)
                if (signature && signature !== expectedSignature && signature !== `sha256=${expectedSignature}`) {
                    console.log(`[PIX] ⚠️ Webhook com assinatura inválida de ${provedor}. IP: ${req.ip}`);
                    return res.status(401).json({ 
                        success: false, 
                        message: 'Assinatura do webhook inválida' 
                    });
                }
            }
            
            // Rate limiting básico - máx 100 webhooks/minuto por provedor
            const rateLimitKey = `pix_webhook_${provedor}`;
            if (!global.pixWebhookRateLimit) global.pixWebhookRateLimit = {};
            const now = Date.now();
            const windowStart = now - 60000; // 1 minuto
            
            if (!global.pixWebhookRateLimit[rateLimitKey]) {
                global.pixWebhookRateLimit[rateLimitKey] = [];
            }
            
            // Limpar registros antigos
            global.pixWebhookRateLimit[rateLimitKey] = global.pixWebhookRateLimit[rateLimitKey].filter(t => t > windowStart);
            
            if (global.pixWebhookRateLimit[rateLimitKey].length >= 100) {
                console.log(`[PIX] ⚠️ Rate limit excedido para webhook ${provedor}. IP: ${req.ip}`);
                return res.status(429).json({ 
                    success: false, 
                    message: 'Limite de requisições excedido' 
                });
            }
            
            global.pixWebhookRateLimit[rateLimitKey].push(now);
            
            console.log(`[PIX] Webhook recebido de ${provedor}:`, JSON.stringify(req.body).substring(0, 500));
            
            const resultado = await pixService.processarWebhook(provedor, req.body);
            res.json(resultado);
        } catch (error) {
            console.error('[PIX] Erro no webhook:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    });

    /**
     * Simular pagamento (apenas para desenvolvimento)
     */
    router.post('/pix/simular-pagamento/:txid', authenticateToken, async (req, res) => {
        try {
            if (process.env.NODE_ENV === 'production') {
                return res.status(403).json({ success: false, message: 'Não disponível em produção' });
            }

            const { txid } = req.params;
            const resultado = await pixService.processarWebhook('simulacao', {
                txid,
                endToEndId: `E${Date.now()}`,
                valor: req.body.valor
            });

            res.json({ success: true, message: 'Pagamento simulado', ...resultado });
        } catch (error) {
            console.error('[PIX] Erro na simulação:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    });

    // ============================================================
    // ========== RÉGUA DE COBRANÇA AUTOMATIZADA ==================
    // ============================================================

    /**
     * Obter configuração da régua
     */
    router.get('/regua/config', authenticateToken, async (req, res) => {
        try {
            const config = await reguaService.getConfig();
            res.json({ success: true, config });
        } catch (error) {
            console.error('[RÉGUA] Erro ao buscar config:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    });

    /**
     * Salvar configuração da régua
     * AUDITORIA ENTERPRISE: Configuração de cobrança automática
     */
    router.post('/regua/config', authenticateToken, async (req, res) => {
        try {
            const usuario_id = req.user.id;
            
            // RBAC - Apenas administradores e gerentes podem configurar régua
            const rolesPermitidas = ['admin', 'administrador', 'gerente', 'gerente_financeiro', 'gerente_vendas'];
            const userRole = (req.user.role || req.user.cargo || '').toLowerCase();
            
            if (!rolesPermitidas.includes(userRole)) {
                console.log(`[RÉGUA-RBAC] Usuário ${usuario_id} (${userRole}) tentou alterar configuração da régua sem permissão`);
                return res.status(403).json({
                    success: false,
                    error: 'Acesso negado',
                    message: 'Apenas administradores ou gerentes podem configurar régua de cobrança.'
                });
            }
            
            console.log(`[RÉGUA] Usuário ${usuario_id} alterando configuração da régua`);
            const resultado = await reguaService.salvarConfig(req.body);
            res.json(resultado);
        } catch (error) {
            console.error('[RÉGUA] Erro ao salvar config:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    });

    /**
     * Listar templates de mensagens
     */
    router.get('/regua/templates', authenticateToken, async (req, res) => {
        try {
            const templates = await reguaService.listarTemplates();
            res.json({ success: true, templates });
        } catch (error) {
            console.error('[RÉGUA] Erro ao listar templates:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    });

    /**
     * Salvar template
     * AUDITORIA ENTERPRISE: Templates afetam comunicação automática com clientes
     */
    router.post('/regua/templates', authenticateToken, async (req, res) => {
        try {
            const usuario_id = req.user.id;
            
            // RBAC - Apenas administradores e gerentes podem alterar templates
            const rolesPermitidas = ['admin', 'administrador', 'gerente', 'gerente_financeiro'];
            const userRole = (req.user.role || req.user.cargo || '').toLowerCase();
            
            if (!rolesPermitidas.includes(userRole)) {
                console.log(`[RÉGUA-RBAC] Usuário ${usuario_id} (${userRole}) tentou alterar template sem permissão`);
                return res.status(403).json({
                    success: false,
                    error: 'Acesso negado',
                    message: 'Apenas administradores ou gerentes podem alterar templates de cobrança.'
                });
            }
            
            console.log(`[RÉGUA] Usuário ${usuario_id} alterando template`);
            const resultado = await reguaService.salvarTemplate(req.body);
            res.json(resultado);
        } catch (error) {
            console.error('[RÉGUA] Erro ao salvar template:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    });

    /**
     * Executar régua manualmente
     */
    router.post('/regua/executar', authenticateToken, async (req, res) => {
        try {
            const resultado = await reguaService.executarRegua();
            res.json({ success: true, ...resultado });
        } catch (error) {
            console.error('[RÉGUA] Erro ao executar:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    });

    /**
     * Histórico de cobranças enviadas
     */
    router.get('/regua/historico', authenticateToken, async (req, res) => {
        try {
            const historico = await reguaService.getHistorico(req.query);
            res.json({ success: true, historico });
        } catch (error) {
            console.error('[RÉGUA] Erro ao buscar histórico:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    });

    /**
     * Dashboard da régua
     */
    router.get('/regua/dashboard', authenticateToken, async (req, res) => {
        try {
            const dashboard = await reguaService.getDashboard(req.query.periodo || 30);
            res.json({ success: true, ...dashboard });
        } catch (error) {
            console.error('[RÉGUA] Erro no dashboard:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    });

    /**
     * Enviar cobrança individual manualmente
     */
    router.post('/regua/enviar/:contaId', authenticateToken, async (req, res) => {
        try {
            const { contaId } = req.params;
            const { tipo = 'dia', dias = 0 } = req.body;
            
            // Buscar conta
            const [contas] = await pool.query(`
                SELECT cr.*, c.nome as cliente_nome, c.email as cliente_email, c.telefone as cliente_telefone
                FROM contas_receber cr
                LEFT JOIN clientes c ON cr.cliente_id = c.id
                WHERE cr.id = ?
            `, [contaId]);

            if (!contas.length) {
                return res.status(404).json({ success: false, message: 'Conta não encontrada' });
            }

            const config = await reguaService.getConfig();
            const resultado = await reguaService.enviarCobranca(contas[0], tipo, dias, config);
            
            res.json({ success: true, ...resultado });
        } catch (error) {
            console.error('[RÉGUA] Erro ao enviar cobrança:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    });

    // ============================================================
    // CONFIGURAÇÕES DE FATURAMENTO (Centralizadas)
    // ============================================================

    // GET /api/faturamento/config - Obter configurações atuais
    router.get('/config', authenticateToken, async (req, res) => {
        try {
            const config = await faturamentoShared.getConfigForAPI();
            res.json({ success: true, config });
        } catch (error) {
            console.error('[FATURAMENTO_CONFIG] Erro ao obter config:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    });

    // PUT /api/faturamento/config - Atualizar configurações (admin only)
    router.put('/config', authenticateToken, async (req, res) => {
        try {
            const isAdmin = faturamentoShared.isAdmin(req.user);
            if (!isAdmin) {
                return res.status(403).json({ success: false, message: 'Apenas administradores podem alterar configurações de faturamento' });
            }
            const resultado = await faturamentoShared.updateConfig(req.body);
            res.json({ success: true, message: 'Configurações atualizadas', config: resultado });
        } catch (error) {
            console.error('[FATURAMENTO_CONFIG] Erro ao atualizar config:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    });

    return router;
};
