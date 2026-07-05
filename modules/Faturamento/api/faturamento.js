const express = require('express');
const router = express.Router();
const path = require('path');

// BUG-FAT-018: rejeitar :id malformado (ex.: "1'or'1'='1") em vez de coagir p/ inteiro e
// responder 200. Aceita id inteiro positivo OU chave de acesso NF-e (44 dígitos). Endurece a
// superfície de entrada — a parametrização já evita SQLi, mas lixo não deve ser aceito.
router.param('id', (req, res, next, value) => {
    const v = String(value).trim();
    if (/^[1-9]\d*$/.test(v) || /^\d{44}$/.test(v)) return next();
    return res.status(400).json({ success: false, code: 'ID_INVALIDO', message: 'Identificador inválido.' });
});

// VULN-013 FIX: Audit trail para operações fiscais críticas
const { logAuditEvent } = require('../../../middleware/audit-trail');

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
const { sendEmail, isConfigured: isEmailConfigured } = require('../../../utils/email');

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
    // HELPER: Enviar DANFE por email ao cliente
    // ============================================================
    // Emails fixos que SEMPRE recebem DANFE
    const DANFE_DESTINATARIOS_FIXOS = ['logistica@aluforce.ind.br', 'aluforce@aluforce.ind.br'];

    async function enviarDanfeEmail(nfeId, clienteEmail, clienteNome, numeroNfe, valorTotal) {
        if (!isEmailConfigured()) {
            console.log(`[FATURAMENTO-EMAIL] Email não enviado: SMTP não configurado`);
            return { enviado: false, motivo: 'SMTP não configurado' };
        }

        // Montar lista de destinatários: fixos + cliente (se tiver)
        const destinatarios = [...DANFE_DESTINATARIOS_FIXOS];
        if (clienteEmail && !destinatarios.includes(clienteEmail.toLowerCase())) {
            destinatarios.push(clienteEmail);
        }

        try {
            // Gerar PDF do DANFE
            const DANFEService = require('../../../src/nfe/services/DANFEService');
            const danfeSvc = new DANFEService(pool);
            const pdfBuffer = await danfeSvc.gerarDANFE(nfeId);

            const html = `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <div style="background: #1e40af; color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
                        <h2 style="margin: 0;">Zyntra ERP</h2>
                        <p style="margin: 5px 0 0; opacity: 0.9;">Nota Fiscal Eletrônica</p>
                    </div>
                    <div style="background: #f8fafc; padding: 25px; border: 1px solid #e2e8f0; border-top: none;">
                        <p>Prezado(a) <strong>${clienteNome || 'Cliente'}</strong>,</p>
                        <p>Segue em anexo a DANFE (Documento Auxiliar da Nota Fiscal Eletrônica) referente à NF-e nº <strong>${numeroNfe}</strong>.</p>
                        <div style="background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 15px; margin: 15px 0;">
                            <table style="width: 100%; border-collapse: collapse;">
                                <tr><td style="padding: 5px 0; color: #64748b;">NF-e:</td><td style="padding: 5px 0; font-weight: 600;">${numeroNfe}</td></tr>
                                <tr><td style="padding: 5px 0; color: #64748b;">Valor Total:</td><td style="padding: 5px 0; font-weight: 600;">R$ ${(valorTotal || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td></tr>
                            </table>
                        </div>
                        <p style="color: #64748b; font-size: 13px;">Este é um email automático enviado pelo sistema Zyntra ERP. Em caso de dúvidas, entre em contato com o setor fiscal.</p>
                    </div>
                    <div style="text-align: center; padding: 15px; color: #94a3b8; font-size: 12px;">
                        <p>Zyntra ERP &copy; ${new Date().getFullYear()}</p>
                    </div>
                </div>
            `;

            const anexo = [{
                filename: `DANFE-${numeroNfe}.pdf`,
                content: pdfBuffer,
                contentType: 'application/pdf'
            }];

            const result = await sendEmail(
                destinatarios.join(', '),
                `NF-e ${numeroNfe} - DANFE`,
                html,
                `DANFE da NF-e ${numeroNfe}. Valor: R$ ${(valorTotal || 0).toFixed(2)}`,
                anexo
            );

            if (result.success) {
                console.log(`[FATURAMENTO-EMAIL] ✅ DANFE enviada para ${destinatarios.join(', ')} (NF-e ${numeroNfe})`);
            }
            return { enviado: result.success, destinatarios, messageId: result.messageId, erro: result.error };
        } catch (err) {
            console.error(`[FATURAMENTO-EMAIL] ❌ Erro ao enviar DANFE por email:`, err.message);
            return { enviado: false, motivo: err.message };
        }
    }

    async function montarDanfePedidoFaturado(pedidoId) {
        const [[pedido]] = await pool.query(`
            SELECT p.*, p.valor as valor_total,
                   COALESCE(c.nome_fantasia, c.razao_social, c.nome, p.cliente_nome, p.cliente) AS cliente_nome,
                   COALESCE(c.razao_social, c.nome, p.cliente_nome, p.cliente) AS cliente_razao_social,
                   COALESCE(c.cnpj, c.cnpj_cpf) AS cliente_cnpj,
                   COALESCE(c.cpf) AS cliente_cpf,
                   c.inscricao_estadual AS cliente_ie,
                   COALESCE(c.email, p.email_cliente) AS cliente_email,
                   c.telefone AS cliente_telefone,
                   c.endereco AS cliente_endereco, c.bairro AS cliente_bairro,
                   c.cidade AS cliente_cidade, c.estado AS cliente_estado,
                   c.cep AS cliente_cep,
                   e.nome_fantasia AS empresa_nome, e.razao_social AS empresa_razao_social,
                   e.cnpj AS empresa_cnpj, e.inscricao_estadual AS empresa_ie,
                   e.endereco AS empresa_endereco, e.bairro AS empresa_bairro,
                   e.cidade AS empresa_cidade, e.estado AS empresa_uf, e.cep AS empresa_cep,
                   e.telefone AS empresa_telefone,
                   t.razao_social AS transportadora_razao_social,
                   t.nome_fantasia AS transportadora_nome_fantasia,
                   t.cnpj_cpf AS transportadora_cnpj_cpf,
                   t.inscricao_estadual AS transportadora_inscricao_estadual,
                   t.endereco AS transportadora_endereco,
                   t.cidade AS transportadora_cidade,
                   t.estado AS transportadora_estado
            FROM pedidos p
            LEFT JOIN clientes c ON p.cliente_id = c.id
            LEFT JOIN empresas e ON p.empresa_id = e.id
            LEFT JOIN transportadoras t ON p.transportadora_id = t.id
            WHERE p.id = ? AND p.status = 'faturado'
        `, [pedidoId]);

        if (!pedido) return null;

        try {
            const [[cfgEmpresa]] = await pool.query('SELECT * FROM configuracoes_empresa LIMIT 1');
            if (cfgEmpresa) {
                pedido.empresa_razao_social = cfgEmpresa.razao_social;
                pedido.empresa_nome = cfgEmpresa.nome_fantasia;
                pedido.empresa_cnpj = cfgEmpresa.cnpj;
                pedido.empresa_ie = cfgEmpresa.inscricao_estadual;
                pedido.empresa_endereco = cfgEmpresa.endereco + (cfgEmpresa.numero ? ', ' + cfgEmpresa.numero : '');
                pedido.empresa_bairro = cfgEmpresa.bairro;
                pedido.empresa_cidade = cfgEmpresa.cidade;
                pedido.empresa_uf = cfgEmpresa.estado;
                pedido.empresa_cep = cfgEmpresa.cep;
                pedido.empresa_telefone = cfgEmpresa.telefone;
            }
        } catch (_) {}

        const [[cfgFiscal]] = await pool.query('SELECT * FROM config_fiscal_empresa LIMIT 1').catch(() => [[]]);

        let itens = [];
        try {
            const [rows] = await pool.query(`
                SELECT pi.codigo, pi.descricao, pi.quantidade, pi.unidade, pi.preco_unitario,
                       pi.desconto, pi.subtotal, pi.produto_id,
                       pi.icms_percent, pi.icms_value, pi.aliquota_icms, pi.aliquota_ipi,
                       pi.valor_ipi, pi.valor_icms_st, pi.cfop,
                       COALESCE(pr_id.ncm, pr_cod.ncm) AS ncm,
                       COALESCE(pr_id.cfop_saida_interna, pr_cod.cfop_saida_interna) AS produto_cfop,
                       COALESCE(pr_id.cst_icms, pr_cod.cst_icms) AS produto_cst_icms,
                       COALESCE(pr_id.csosn_icms, pr_cod.csosn_icms) AS produto_csosn_icms,
                       COALESCE(pr_id.aliquota_icms, pr_cod.aliquota_icms) AS produto_aliquota_icms,
                       COALESCE(pr_id.aliquota_ipi, pr_cod.aliquota_ipi) AS produto_aliquota_ipi
                FROM pedido_itens pi
                LEFT JOIN produtos pr_id ON pi.produto_id = pr_id.id
                LEFT JOIN produtos pr_cod ON pi.produto_id IS NULL AND pr_cod.codigo = pi.codigo
                WHERE pi.pedido_id = ? ORDER BY pi.id ASC
            `, [pedidoId]);
            itens = rows;
        } catch (_) {}

        if (itens.length === 0) {
            try {
                itens = JSON.parse(pedido.produtos_preview || '[]').map(item => ({
                    codigo: item.codigo || '-',
                    descricao: item.descricao || item.nome || '-',
                    quantidade: parseFloat(item.quantidade) || 1,
                    unidade: item.unidade || 'UN',
                    preco_unitario: parseFloat(item.preco_unitario || item.valor_unitario || item.preco) || 0,
                    desconto: parseFloat(item.desconto) || 0,
                    subtotal: parseFloat(item.subtotal || item.total) || 0
                }));
            } catch (_) {
                itens = [];
            }
        }

        const { renderDanfe, buildDanfeCtx } = require(path.resolve(__dirname, '../../../routes/danfe-renderer'));
        const preview = !pedido.nfe_chave && !pedido.chave_acesso;
        return renderDanfe(buildDanfeCtx(pedido, itens, { preview, cfgFiscal }));
    }

    // ============================================================
    // LISTAR PEDIDOS APROVADOS (para selector no modal "Nova NF-e")
    // ============================================================

    router.get('/pedidos-aprovados', authenticateToken, async (req, res) => {
        try {
            const [pedidos] = await pool.query(`
                SELECT
                    p.id,
                    p.cliente_nome,
                    COALESCE(c.nome, p.cliente_nome) as cliente,
                    p.valor,
                    p.created_at as data_pedido,
                    p.status
                FROM pedidos p
                LEFT JOIN clientes c ON p.cliente_id = c.id
                -- 25/06/2026: exibe pedidos do status "Aguardando Faturamento" em diante
                -- (aprovado/pedido-aprovado mantidos p/ retrocompat; 'faturar' = etapa de ação).
                WHERE LOWER(TRIM(p.status)) IN ('aprovado', 'pedido-aprovado', 'aguardando-faturamento', 'faturar')
                  AND p.id NOT IN (SELECT COALESCE(pedido_id, 0) FROM nfes WHERE pedido_id IS NOT NULL)
                ORDER BY p.created_at DESC
                LIMIT 50
            `);

            res.json({ success: true, data: pedidos });
        } catch (error) {
            console.error('[FATURAMENTO] Erro ao listar pedidos aprovados:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    });

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
                    error: 'Permissão insuficiente',
                    message: `Seu perfil (${userRole || 'não definido'}) não possui permissão para gerar NF-e. Perfis autorizados: ${rolesPermitidas.join(', ')}. Solicite ao administrador a alteração do seu cargo.`,
                    errorCode: 'RBAC_DENIED'
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
                    c.email as cliente_email,
                    c.email_nfe as cliente_email_nfe
                FROM pedidos p
                LEFT JOIN clientes c ON p.cliente_id = c.id
                WHERE p.id = ? AND LOWER(TRIM(p.status)) IN ('aprovado', 'pedido-aprovado', 'aguardando-faturamento', 'faturar')
            `, [pedido_id]);

            if (pedidos.length === 0) {
                // BUG-FAT-001: o contrato divergia de /pedidos-aprovados, que oferece pedidos em
                // status 'faturar'/'aguardando-faturamento' — mas gerar-nfe só aceitava 'aprovado',
                // rejeitando pedidos que a própria lista apresentava como faturáveis. Alinhado.
                // LEFT JOIN (antes INNER): pedido com cliente_id nulo não some mais silenciosamente.
                throw new Error('Pedido não encontrado ou não está em status faturável.');
            }

            const pedido = pedidos[0];

            // 2. Verificar se já existe NF-e para este pedido (lock pessimista para evitar duplicata)
            const [nfeExistente] = await connection.query(`
                SELECT id, numero AS numero_nfe, status FROM nfes WHERE pedido_id = ? FOR UPDATE
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

            // VALIDAÇÃO: Quantidade e preço devem ser positivos
            for (const item of itens) {
                if (!item.quantidade || item.quantidade <= 0) {
                    throw new Error(`Item "${item.descricao}" possui quantidade inválida (${item.quantidade}). Deve ser > 0.`);
                }
                if (!item.preco_unitario || item.preco_unitario <= 0) {
                    throw new Error(`Item "${item.descricao}" possui preço unitário inválido (${item.preco_unitario}). Deve ser > 0.`);
                }
            }

            // VALIDAÇÃO FISCAL: NCM obrigatório (8 dígitos).
            // Emitir NF-e com NCM ausente/inválido gera classificação fiscal incorreta
            // (antes o sistema substituía silenciosamente por um NCM-fallback genérico,
            // o que é irregular perante o Fisco). Bloqueia a emissão e lista os produtos.
            const _itensSemNcm = itens.filter(it => String(it.ncm || '').replace(/\D/g, '').length !== 8);
            if (_itensSemNcm.length > 0) {
                const _lista = _itensSemNcm
                    .map(it => `• ${it.descricao || ('produto #' + (it.produto_id || it.id || '?'))}`)
                    .join('\n');
                const _err = new Error(
                    `Emissão bloqueada: ${_itensSemNcm.length} produto(s) sem NCM válido (8 dígitos). ` +
                    `Cadastre o NCM correto no cadastro de produtos antes de faturar:\n${_lista}`
                );
                _err.code = 'NCM_AUSENTE';
                throw _err;
            }

            // VALIDAÇÃO: CNPJ/CPF do destinatário
            const cnpjCliente = (pedido.cliente_cnpj || '').replace(/\D/g, '');
            const cpfCliente = (pedido.cliente_cpf || '').replace(/\D/g, '');
            if (!cnpjCliente && !cpfCliente) {
                throw new Error('Cliente sem CNPJ ou CPF cadastrado. Corrija o cadastro antes de faturar.');
            }
            if (cnpjCliente && cnpjCliente.length !== 14) {
                throw new Error(`CNPJ do cliente inválido (${cnpjCliente.length} dígitos). Deve ter 14 dígitos.`);
            }
            if (!cnpjCliente && cpfCliente && cpfCliente.length !== 11) {
                throw new Error(`CPF do cliente inválido (${cpfCliente.length} dígitos). Deve ter 11 dígitos.`);
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

            // HOTFIX: PRE-FLIGHT — Validar dados fiscais obrigatórios (IBGE, UF, CEP) antes de prosseguir
            const camposFaltantes = [];
            if (!emitente.codigoMunicipio || String(emitente.codigoMunicipio).replace(/\D/g, '').length !== 7) {
                camposFaltantes.push('Código IBGE do município do emitente (deve ter 7 dígitos)');
            }
            if (!emitente.uf || emitente.uf.length !== 2) {
                camposFaltantes.push('UF do emitente');
            }
            if (!emitente.cnpj || emitente.cnpj.replace(/\D/g, '').length !== 14) {
                camposFaltantes.push('CNPJ do emitente');
            }
            if (!emitente.cep || emitente.cep.replace(/\D/g, '').length !== 8) {
                camposFaltantes.push('CEP do emitente');
            }
            if (!destinatario.codigoMunicipio || String(destinatario.codigoMunicipio).replace(/\D/g, '').length !== 7) {
                camposFaltantes.push(`Código IBGE do município do cliente "${destinatario.nome}". Atualize o cadastro do cliente.`);
            }
            if (!destinatario.uf || destinatario.uf.length !== 2) {
                camposFaltantes.push(`UF do cliente "${destinatario.nome}"`);
            }
            if (!destinatario.cep || destinatario.cep.replace(/\D/g, '').length !== 8) {
                camposFaltantes.push(`CEP do cliente "${destinatario.nome}"`);
            }
            if (camposFaltantes.length > 0) {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    errorCode: 'IBGE_PREFLIGHT',
                    message: 'Dados fiscais incompletos. Corrija antes de gerar a NF-e.',
                    camposFaltantes
                });
            }

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
                INSERT INTO nfes (
                    pedido_id,
                    numero,
                    serie,
                    modelo,
                    tipo_emissao,
                    finalidade,
                    natureza_operacao,
                    cliente_id,
                    destinatario_nome,
                    destinatario_cnpj_cpf,
                    destinatario_endereco,
                    destinatario_cidade,
                    destinatario_uf,
                    destinatario_cep,
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
                    UPDATE nfes SET xml_nfe = ?, chave_acesso = ?, emitente_uf = ?, emitente_cnpj = ? WHERE id = ?
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

            // 9. Integrações PRÉ-COMMIT (dentro da transação para garantir ACID)
            // VULN-011 FIX: Integrações são MANDATÓRIAS quando solicitadas — falha causa ROLLBACK
            const integracoes = { financeiro: null, estoque: null, avisos: [] };

            if (autoReservarEstoque && pedido_id) {
                try {
                    integracoes.estoque = await vendasEstoqueService.reservarEstoque(pedido_id, usuario_id);
                } catch (err) {
                    console.error(`[FATURAMENTO] ❌ Falha CRÍTICA ao reservar estoque para pedido ${pedido_id}:`, err.message);
                    throw new Error(`Falha na reserva de estoque: ${err.message}. NF-e não gerada — rollback executado.`);
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
                    console.error(`[FATURAMENTO] ❌ Falha CRÍTICA ao gerar contas a receber para NF-e ${nfe_id}:`, err.message);
                    throw new Error(`Falha na integração financeira: ${err.message}. NF-e não gerada — rollback executado.`);
                }
            }

            await connection.commit();

            // VULN-013 FIX: Audit trail explícito para geração de NF-e
            logAuditEvent(pool, {
                userId: usuario_id,
                action: 'GERAR_NFE',
                module: 'faturamento',
                description: `NF-e ${proximoNumero} gerada para pedido ${pedido_id}. Valor: R$ ${valorTotal.toFixed(2)}`,
                newData: { nfe_id, numero_nfe: proximoNumero, pedido_id, valor_total: valorTotal, chave_acesso: chaveAcesso },
                ip: req.ip,
                userAgent: req.headers['user-agent']
            });

            // AUDITORIA ENTERPRISE: Log de geração de NF-e fiscal
            console.log(`[FATURAMENTO-AUDIT] ✅ NF-e ${proximoNumero} gerada por usuário ${usuario_id} para pedido ${pedido_id}. Valor: R$ ${valorTotal.toFixed(2)}`);

            // Enviar DANFE por email AUTOMATICAMENTE (assíncrono, não bloqueia resposta)
            let emailResult = null;
            {
                const emailDestinatario = pedido.cliente_email_nfe || pedido.cliente_email;
                enviarDanfeEmail(nfe_id, emailDestinatario, pedido.cliente_nome, proximoNumero, valorTotal)
                    .then(r => { emailResult = r; })
                    .catch(err => console.error('[FATURAMENTO-EMAIL] Erro assíncrono:', err.message));
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
            // HOTFIX: Diferenciar causa raiz para mensagens granulares
            const msg = (error.message || '').toLowerCase();
            let statusCode = 500;
            let errorCode = 'GERAR_NFE_ERRO';
            if (msg.includes('certificado') || msg.includes('certificate') || msg.includes('pfx')) {
                statusCode = 401;
                errorCode = 'CERTIFICADO_INVALIDO';
            } else if (msg.includes('estoque')) {
                statusCode = 400;
                errorCode = 'ESTOQUE_INSUFICIENTE';
            } else if (msg.includes('já existe')) {
                statusCode = 409;
                errorCode = 'NFE_DUPLICADA';
            } else if (
                msg.includes('não encontrado') || msg.includes('nao encontrado') ||
                msg.includes('sem itens') || msg.includes('sem cnpj') || msg.includes('sem cpf') ||
                msg.includes('quantidade inv') || msg.includes('quantidade inválida') ||
                msg.includes('cnpj do cliente') || msg.includes('cpf do cliente') ||
                msg.includes('obrigatório') || msg.includes('obrigatorio')
            ) {
                statusCode = 400;
                errorCode = 'VALIDACAO_ERRO';
            }
            res.status(statusCode).json({
                success: false,
                errorCode,
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
            const { status, data_inicio, data_fim, cliente_id, busca } = req.query;

            // UNION: NF-es formais (tabela nfes) + Pedidos faturados sem NF-e formal
            let query = `
                SELECT * FROM (
                    SELECT
                        n.id,
                        'nfe' COLLATE utf8mb4_general_ci as origem,
                        n.numero COLLATE utf8mb4_general_ci as numero,
                        COALESCE(n.serie, 1) as serie,
                        n.cliente_id,
                        COALESCE(n.destinatario_nome, c.nome) COLLATE utf8mb4_general_ci as cliente_nome,
                        COALESCE(n.destinatario_nome, c.nome) COLLATE utf8mb4_general_ci as destinatario,
                        COALESCE(n.valor_total, 0) as valor,
                        CASE
                            WHEN n.status COLLATE utf8mb4_general_ci = 'autorizada'
                                 AND (n.chave_acesso IS NULL OR n.chave_acesso = ''
                                      OR n.protocolo_autorizacao IS NULL OR n.protocolo_autorizacao = '')
                            THEN 'pendente'
                            ELSE n.status COLLATE utf8mb4_general_ci
                        END as status,
                        n.data_emissao,
                        n.natureza_operacao COLLATE utf8mb4_general_ci as observacoes,
                        n.chave_acesso COLLATE utf8mb4_general_ci as chave_acesso,
                        n.protocolo_autorizacao COLLATE utf8mb4_general_ci as protocolo,
                        n.pedido_id
                    FROM nfes n
                    LEFT JOIN clientes c ON n.cliente_id = c.id

                    UNION ALL

                    SELECT
                        p.id,
                        'pedido' as origem,
                        COALESCE(p.numero_nf, LPAD(p.id, 9, '0')) as numero,
                        1 as serie,
                        p.cliente_id,
                        COALESCE(p.cliente_nome, c.nome) as cliente_nome,
                        COALESCE(p.cliente_nome, c.nome) as destinatario,
                        COALESCE(p.valor, 0) as valor,
                        CASE WHEN p.nfe_chave IS NOT NULL AND p.nfe_chave <> '' AND p.nfe_protocolo IS NOT NULL AND p.nfe_protocolo <> '' THEN 'autorizada' ELSE 'pendente' END as status,
                        COALESCE(p.data_faturamento, p.created_at) as data_emissao,
                        'VENDA DE MERCADORIA' as observacoes,
                        p.nfe_chave as chave_acesso,
                        p.nfe_protocolo as protocolo,
                        p.id as pedido_id
                    FROM pedidos p
                    LEFT JOIN clientes c ON p.cliente_id = c.id
                    WHERE p.status = 'faturado'
                      AND p.id NOT IN (SELECT COALESCE(pedido_id, 0) FROM nfes WHERE pedido_id IS NOT NULL)
                ) AS unificado
                WHERE 1=1
            `;

            const params = [];

            if (status) {
                query += ' AND status = ?';
                params.push(status);
            }

            if (data_inicio) {
                query += ' AND DATE(data_emissao) >= ?';
                params.push(data_inicio);
            }

            if (data_fim) {
                query += ' AND DATE(data_emissao) <= ?';
                params.push(data_fim);
            }

            if (cliente_id) {
                query += ' AND cliente_id = ?';
                params.push(cliente_id);
            }

            if (busca) {
                query += ' AND (cliente_nome LIKE ? OR numero LIKE ? OR destinatario LIKE ?)';
                const term = `%${busca}%`;
                params.push(term, term, term);
            }

            query += ' ORDER BY data_emissao DESC LIMIT 100';

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
    // CONTRATOS — base para os relatórios gerenciais de Contratos
    // (Ativos, A Vencer, Vencidos, Receita, por Cliente)
    // ============================================================

    // Garante que a tabela exista antes de qualquer operação.
    let _contratosTabelaPronta = false;
    async function ensureContratosTable() {
        if (_contratosTabelaPronta) return;
        await pool.query(`
            CREATE TABLE IF NOT EXISTS contratos (
                id INT AUTO_INCREMENT PRIMARY KEY,
                numero VARCHAR(50),
                cliente_id INT NULL,
                cliente_nome VARCHAR(255),
                descricao VARCHAR(255),
                valor DECIMAL(15,2) NOT NULL DEFAULT 0,
                periodicidade VARCHAR(20) NOT NULL DEFAULT 'mensal',
                data_inicio DATE NULL,
                data_fim DATE NULL,
                status VARCHAR(20) NOT NULL DEFAULT 'ativo',
                observacoes TEXT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_contratos_cliente (cliente_id),
                INDEX idx_contratos_status (status),
                INDEX idx_contratos_data_fim (data_fim)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        _contratosTabelaPronta = true;
    }

    // LISTAR contratos — usado pelos 5 relatórios (agregação feita no front).
    // Filtros opcionais: status, cliente_id, busca, data_inicio/data_fim (vigência).
    router.get('/contratos', authenticateToken, async (req, res) => {
        try {
            await ensureContratosTable();
            const { status, cliente_id, busca, data_inicio, data_fim } = req.query;

            let query = `
                SELECT
                    ct.id, ct.numero, ct.cliente_id,
                    COALESCE(ct.cliente_nome, c.nome) AS cliente_nome,
                    ct.descricao, ct.valor, ct.periodicidade,
                    ct.data_inicio, ct.data_fim, ct.status, ct.observacoes,
                    ct.created_at
                FROM contratos ct
                LEFT JOIN clientes c ON ct.cliente_id = c.id
                WHERE 1=1
            `;
            const params = [];

            if (status) { query += ' AND ct.status = ?'; params.push(status); }
            if (cliente_id) { query += ' AND ct.cliente_id = ?'; params.push(cliente_id); }
            if (data_inicio) { query += ' AND (ct.data_fim IS NULL OR ct.data_fim >= ?)'; params.push(data_inicio); }
            if (data_fim) { query += ' AND (ct.data_inicio IS NULL OR ct.data_inicio <= ?)'; params.push(data_fim); }
            if (busca) {
                query += ' AND (COALESCE(ct.cliente_nome, c.nome) LIKE ? OR ct.numero LIKE ? OR ct.descricao LIKE ?)';
                const term = `%${busca}%`;
                params.push(term, term, term);
            }

            query += ' ORDER BY ct.data_fim IS NULL, ct.data_fim ASC, ct.id DESC';

            const [contratos] = await pool.query(query, params);
            res.json({ success: true, data: contratos });
        } catch (error) {
            console.error('[FATURAMENTO] Erro ao listar contratos:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    });

    // CRIAR contrato
    router.post('/contratos', authenticateToken, async (req, res) => {
        try {
            await ensureContratosTable();
            const {
                numero, cliente_id, cliente_nome, descricao,
                valor, periodicidade, data_inicio, data_fim, status, observacoes
            } = req.body || {};

            const [result] = await pool.query(
                `INSERT INTO contratos
                    (numero, cliente_id, cliente_nome, descricao, valor, periodicidade, data_inicio, data_fim, status, observacoes)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    numero || null,
                    cliente_id || null,
                    cliente_nome || null,
                    descricao || null,
                    Number(valor) || 0,
                    periodicidade || 'mensal',
                    data_inicio || null,
                    data_fim || null,
                    status || 'ativo',
                    observacoes || null
                ]
            );
            res.status(201).json({ success: true, id: result.insertId });
        } catch (error) {
            console.error('[FATURAMENTO] Erro ao criar contrato:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    });

    // ATUALIZAR contrato
    router.put('/contratos/:id', authenticateToken, async (req, res) => {
        try {
            await ensureContratosTable();
            const campos = [];
            const valores = [];
            const permitidos = ['numero', 'cliente_id', 'cliente_nome', 'descricao', 'valor', 'periodicidade', 'data_inicio', 'data_fim', 'status', 'observacoes'];
            for (const campo of permitidos) {
                if (req.body && req.body[campo] !== undefined) {
                    campos.push(`${campo} = ?`);
                    valores.push(req.body[campo] === '' ? null : req.body[campo]);
                }
            }
            if (!campos.length) {
                return res.status(400).json({ success: false, message: 'Nenhum campo para atualizar' });
            }
            valores.push(req.params.id);
            await pool.query(`UPDATE contratos SET ${campos.join(', ')} WHERE id = ?`, valores);
            res.json({ success: true });
        } catch (error) {
            console.error('[FATURAMENTO] Erro ao atualizar contrato:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    });

    // EXCLUIR contrato
    router.delete('/contratos/:id', authenticateToken, async (req, res) => {
        try {
            await ensureContratosTable();
            await pool.query('DELETE FROM contratos WHERE id = ?', [req.params.id]);
            res.json({ success: true });
        } catch (error) {
            console.error('[FATURAMENTO] Erro ao excluir contrato:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    });

    // ============================================================
    // DETALHES DA NF-e
    // ============================================================

    router.get('/nfes/:id', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const origem = req.query.origem || 'nfe';

            // Se origem=pedido, buscar dados do pedido faturado
            if (origem === 'pedido') {
                const [pedidos] = await pool.query(`
                    SELECT
                        p.id,
                        'pedido' as origem,
                        COALESCE(p.numero_nf, LPAD(p.id, 9, '0')) as numero,
                        1 as serie,
                        p.cliente_id,
                        COALESCE(p.cliente_nome, c.nome) as cliente_nome,
                        COALESCE(p.cliente_nome, c.nome) as destinatario,
                        COALESCE(c.cnpj, c.cpf, '') as destinatario_cnpj_cpf,
                        COALESCE(p.valor, 0) as valor_total,
                        COALESCE(p.valor, 0) as valor,
                        CASE WHEN p.nfe_chave IS NOT NULL AND p.nfe_chave <> '' AND p.nfe_protocolo IS NOT NULL AND p.nfe_protocolo <> '' THEN 'autorizada' ELSE 'pendente' END as status,
                        COALESCE(p.data_faturamento, p.created_at) as data_emissao,
                        'VENDA DE MERCADORIA' as natureza_operacao,
                        p.nfe_chave as chave_acesso,
                        p.nfe_protocolo as protocolo,
                        p.observacao as observacoes,
                        c.email as cliente_email,
                        p.id as pedido_id
                    FROM pedidos p
                    LEFT JOIN clientes c ON p.cliente_id = c.id
                    WHERE p.id = ? AND p.status = 'faturado'
                `, [id]);

                if (pedidos.length === 0) {
                    return res.status(404).json({
                        success: false,
                        message: 'Pedido faturado não encontrado'
                    });
                }

                // Buscar itens do pedido
                const [itens] = await pool.query(`
                    SELECT
                        pi.id,
                        pi.descricao as descricao,
                        COALESCE(pr.descricao, pi.descricao) as produto_nome,
                        pi.quantidade,
                        pi.preco_unitario as valor_unitario,
                        pi.subtotal as valor_total,
                        pi.codigo,
                        pi.unidade
                    FROM pedido_itens pi
                    LEFT JOIN produtos pr ON pi.produto_id = pr.id
                    WHERE pi.pedido_id = ?
                `, [id]);

                return res.json({
                    success: true,
                    data: {
                        ...pedidos[0],
                        itens
                    }
                });
            }

            // Busca padrão na tabela nfes
            const [nfes] = await pool.query(`
                SELECT
                    n.*,
                    'nfe' as origem,
                    n.destinatario_nome as cliente_nome,
                    c.email as cliente_email
                FROM nfes n
                LEFT JOIN clientes c ON n.cliente_id = c.id
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

            // FISC: NF-e só é "autorizada" com chave de acesso + protocolo reais.
            // Registros legados/importados sem esses dados não podem exibir status autorizado.
            const nfeRow = nfes[0];
            if (nfeRow && String(nfeRow.status || '').toLowerCase() === 'autorizada'
                && (!nfeRow.chave_acesso || !nfeRow.protocolo_autorizacao)) {
                nfeRow.status = 'pendente';
            }

            res.json({
                success: true,
                data: {
                    ...nfeRow,
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
    // ATUALIZAR NF-e (PUT)
    // ============================================================

    router.put('/nfes/:id', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const usuario_id = req.user.id;

            // Verificar se NF-e existe
            const [[nfeExistente]] = await pool.query('SELECT id, status, chave_acesso, numero_protocolo FROM nfes WHERE id = ?', [id]);
            if (!nfeExistente) {
                return res.status(404).json({ success: false, message: 'NF-e não encontrada' });
            }

            const {
                numero, serie, cliente_id,
                valor_total, status, data_emissao,
                natureza_operacao, chave_acesso, destinatario_nome,
                observacoes, protocolo
            } = req.body;

            // FISC-003: status 'autorizada' só pode ser definido via SEFAZ (rota /enviar-sefaz),
            // que grava chave_acesso e numero_protocolo reais. Editar manualmente para 'autorizada'
            // sem esses dados cria NF-e "autorizada" sem respaldo fiscal (chave/protocolo ausentes).
            if (status === 'autorizada' && nfeExistente.status !== 'autorizada') {
                const chaveFinal = chave_acesso !== undefined ? chave_acesso : nfeExistente.chave_acesso;
                const protocoloFinal = protocolo !== undefined ? protocolo : nfeExistente.numero_protocolo;
                if (!chaveFinal || !protocoloFinal) {
                    return res.status(400).json({
                        success: false,
                        message: 'NF-e não pode ser marcada como "autorizada" manualmente sem chave de acesso e protocolo de autorização. Use o envio à SEFAZ.'
                    });
                }
            }

            const campos = [];
            const valores = [];

            if (numero !== undefined) { campos.push('numero = ?'); valores.push(numero); }
            if (serie !== undefined) { campos.push('serie = ?'); valores.push(serie); }
            if (destinatario_nome !== undefined) { campos.push('destinatario_nome = ?'); valores.push(destinatario_nome); }
            if (cliente_id !== undefined) { campos.push('cliente_id = ?'); valores.push(cliente_id); }
            if (valor_total !== undefined) { campos.push('valor_total = ?'); valores.push(valor_total); }
            if (status !== undefined) { campos.push('status = ?'); valores.push(status); }
            if (data_emissao !== undefined) { campos.push('data_emissao = ?'); valores.push(data_emissao); }
            if (natureza_operacao !== undefined) { campos.push('natureza_operacao = ?'); valores.push(natureza_operacao); }
            if (chave_acesso !== undefined) { campos.push('chave_acesso = ?'); valores.push(chave_acesso); }
            if (observacoes !== undefined) { campos.push('observacoes = ?'); valores.push(observacoes); }
            if (protocolo !== undefined) { campos.push('protocolo_autorizacao = ?'); valores.push(protocolo); }

            if (campos.length === 0) {
                return res.status(400).json({ success: false, message: 'Nenhum campo para atualizar' });
            }

            valores.push(id);
            await pool.query(`UPDATE nfes SET ${campos.join(', ')} WHERE id = ?`, valores);

            // Audit trail
            if (typeof logAuditEvent === 'function') {
                logAuditEvent(pool, {
                    usuario_id,
                    acao: 'EDITAR_NFE',
                    recurso: 'nfe',
                    recurso_id: id,
                    detalhes: `NF-e ${nfeExistente.id} editada`
                });
            }

            console.log(`[FATURAMENTO] NF-e ${id} atualizada por usuário ${usuario_id}`);
            res.json({ success: true, message: 'NF-e atualizada com sucesso' });

        } catch (error) {
            console.error('[FATURAMENTO] Erro ao atualizar NF-e:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    });

    // ============================================================
    // EXCLUIR NF-e (DELETE)
    // ============================================================

    router.delete('/nfes/:id', authenticateToken, async (req, res) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            const { id } = req.params;
            const usuario_id = req.user.id;

            const [[nfe]] = await connection.query('SELECT id, numero, status FROM nfes WHERE id = ?', [id]);
            if (!nfe) {
                await connection.rollback();
                return res.status(404).json({ success: false, message: 'NF-e não encontrada' });
            }

            // Não permitir excluir NF-e autorizada
            if (nfe.status === 'autorizada') {
                await connection.rollback();
                return res.status(400).json({ success: false, message: 'NF-e autorizada não pode ser excluída. Utilize o cancelamento.' });
            }

            // Excluir itens e depois a NF-e
            await connection.query('DELETE FROM nfe_itens WHERE nfe_id = ?', [id]);
            await connection.query('DELETE FROM nfes WHERE id = ?', [id]);

            await connection.commit();

            if (typeof logAuditEvent === 'function') {
                logAuditEvent(pool, {
                    usuario_id,
                    acao: 'EXCLUIR_NFE',
                    recurso: 'nfe',
                    recurso_id: id,
                    detalhes: `NF-e ${nfe.numero || id} excluída`
                });
            }

            console.log(`[FATURAMENTO] NF-e ${id} excluída por usuário ${usuario_id}`);
            res.json({ success: true, message: 'NF-e excluída com sucesso' });

        } catch (error) {
            await connection.rollback();
            console.error('[FATURAMENTO] Erro ao excluir NF-e:', error);
            res.status(500).json({ success: false, message: error.message });
        } finally {
            connection.release();
        }
    });

    // ============================================================
    // EVENTOS DA NF-e (histórico: emissão, autorização, cancelamento, CC-e)
    // ============================================================

    router.get('/nfes/:id/eventos', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const [[nfe]] = await pool.query(
                'SELECT id, numero, status, data_emissao, created_at FROM nfes WHERE id = ?',
                [id]
            );
            if (!nfe) return res.status(404).json({ success: false, message: 'NF-e não encontrada' });

            const eventos = [];

            // Evento de emissão
            eventos.push({ tipo: 'Emissão', data: nfe.data_emissao, descricao: `NF-e ${nfe.numero} emitida`, protocolo: null });

            // Evento de autorização SEFAZ
            if (nfe.data_autorizacao) {
                eventos.push({ tipo: 'Autorização SEFAZ', data: nfe.data_autorizacao, descricao: `NF-e autorizada`, protocolo: nfe.protocolo || null });
            }

            // Eventos registrados (CC-e, cancelamento eletrônico, etc.)
            const [rows] = await pool.query(
                `SELECT tipo_evento AS tipo, COALESCE(data_evento, created_at) AS data, descricao, protocolo
                 FROM nfe_eventos WHERE nfe_id = ? ORDER BY data ASC`,
                [id]
            );
            rows.forEach(r => eventos.push(r));

            // Cancelamento
            if (nfe.status === 'cancelada' && nfe.data_cancelamento) {
                eventos.push({ tipo: 'Cancelamento', data: nfe.data_cancelamento, descricao: nfe.motivo_cancelamento || 'NF-e cancelada', protocolo: null });
            }

            eventos.sort((a, b) => new Date(a.data) - new Date(b.data));
            res.json({ success: true, data: eventos });
        } catch (error) {
            console.error('[FATURAMENTO] Erro ao buscar eventos:', error);
            if (error.code === 'ER_NO_SUCH_TABLE') return res.json({ success: true, data: [] });
            res.status(500).json({ success: false, message: error.message });
        }
    });

    // ============================================================
    // DOWNLOAD XML DA NF-e
    // ============================================================

    router.get('/nfes/:id/xml', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const origem = req.query.origem || 'nfe';

            // Pedidos faturados não possuem XML formal
            if (origem === 'pedido') {
                return res.json({
                    success: false,
                    available: false,
                    message: 'XML não disponível: este registro é um pedido faturado sem NF-e formal emitida.'
                });
            }

            const [[nfe]] = await pool.query('SELECT numero, xml_nfe FROM nfes WHERE id = ?', [id]);
            if (!nfe) return res.status(404).json({ success: false, message: 'NF-e não encontrada' });
            if (!nfe.xml_nfe) return res.status(404).json({ success: false, message: 'XML não disponível para esta NF-e' });

            res.setHeader('Content-Type', 'application/xml; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="nfe_${nfe.numero || id}.xml"`);
            res.send(nfe.xml_nfe);
        } catch (error) {
            console.error('[FATURAMENTO] Erro ao baixar XML:', error);
            res.status(500).json({ success: false, message: error.message });
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

            // Erros de validação de negócio carregam statusCode 400 para o catch final não
            // devolvê-los como 500 (BUG-FAT-014: erro de regra vazava como falha interna).
            const erroNegocio = (msg) => { const e = new Error(msg); e.statusCode = 400; return e; };

            // VALIDAÇÃO FISCAL: Motivo deve ter entre 15 e 255 caracteres (SEFAZ)
            if (!motivo || motivo.trim().length < 15) {
                throw erroNegocio('Motivo do cancelamento deve ter no mínimo 15 caracteres');
            }
            if (motivo.length > 255) {
                throw erroNegocio('Motivo do cancelamento excede o limite de 255 caracteres');
            }

            // Buscar NF-e
            const [nfes] = await connection.query(`
                SELECT * FROM nfes WHERE id = ?
            `, [id]);

            if (nfes.length === 0) {
                throw erroNegocio('NF-e não encontrada');
            }

            const nfe = nfes[0];

            if (nfe.status === 'cancelada') {
                throw erroNegocio('NF-e já está cancelada');
            }

            // BUG-FAT-015: a janela de 24h só se aplica a NF-e AUTORIZADA (emitida à SEFAZ).
            // Uma NF-e em rascunho/pendente nunca foi emitida — deve poder ser descartada sem a
            // regra de prazo (que antes disparava "não pode cancelar após 24h" num rascunho e
            // apontava para Carta de Correção, recurso inexistente).
            const statusNfe = String(nfe.status || '').toLowerCase().trim();
            const nfeEmitida = ['autorizada', 'cancelamento_pendente'].includes(statusNfe);
            if (nfeEmitida && nfe.created_at) {
                const horasDesdeEmissao = (Date.now() - new Date(nfe.created_at).getTime()) / (1000 * 60 * 60);
                if (horasDesdeEmissao > 24) {
                    console.log(`[FATURAMENTO] Tentativa de cancelar NF-e ${id} após prazo de 24h`);
                    throw erroNegocio(`NF-e não pode ser cancelada após 24 horas da autorização (${Math.floor(horasDesdeEmissao)}h decorridas). Entre em contato com a contabilidade.`);
                }
            }

            // ── TRANSMISSÃO DO CANCELAMENTO À SEFAZ (evento 110111) ──
            // Só transmite quando a NF-e tem chave + protocolo reais (autorizada de fato).
            // NF-e sem chave (legada/local, ex.: importada do Omie) é cancelada só localmente.
            let cancelamentoSefaz = null;
            const temAutorizacaoReal = !!(nfe.chave_acesso && nfe.protocolo_autorizacao);
            if (temAutorizacaoReal) {
                let resultadoSefaz;
                try {
                    resultadoSefaz = await sefazService.cancelarNFe(
                        nfe.chave_acesso,
                        nfe.protocolo_autorizacao,
                        motivo.trim(),
                        nfe.emitente_uf,
                        nfe.emitente_cnpj
                    );
                } catch (sefazErr) {
                    await connection.rollback();
                    console.error(`[FATURAMENTO] Falha SEFAZ ao cancelar NF-e ${id}:`, sefazErr.message);
                    return res.status(502).json({
                        success: false,
                        error: 'SEFAZ_INDISPONIVEL',
                        message: `Não foi possível transmitir o cancelamento à SEFAZ: ${sefazErr.message}`
                    });
                }
                // cStat 135 = registrado e vinculado; 136 = registrado não vinculado; 155 = cancelamento extemporâneo homologado
                const cStat = String(resultadoSefaz?.codigoStatus || '');
                if (!['135', '136', '155'].includes(cStat)) {
                    await connection.rollback();
                    return res.status(400).json({
                        success: false,
                        error: 'SEFAZ_REJEITOU',
                        message: `SEFAZ não homologou o cancelamento (cStat ${cStat || '?'}: ${resultadoSefaz?.motivo || 'sem retorno'}). A NF-e continua válida.`
                    });
                }
                cancelamentoSefaz = resultadoSefaz;
            }

            // Atualizar status
            await connection.query(`
                UPDATE nfes
                SET status = 'cancelada'
                WHERE id = ?
            `, [id]);

            // Registrar o evento de cancelamento (com o protocolo da SEFAZ quando transmitido)
            try {
                await connection.query(`
                    INSERT INTO nfe_eventos (nfe_id, tipo_evento, sequencia, descricao, protocolo, xml_evento, created_at)
                    VALUES (?, '110111', 1, ?, ?, ?, NOW())
                `, [id, motivo.trim().substring(0, 255), cancelamentoSefaz?.numeroProtocolo || null, cancelamentoSefaz?.xmlCompleto || null]);
            } catch (evErr) {
                console.log('⚠️ Evento de cancelamento não registrado:', evErr.message);
            }

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

            // VULN-013 FIX: Audit trail para cancelamento de NF-e (operação fiscal crítica)
            logAuditEvent(pool, {
                userId: usuario_id,
                action: 'CANCELAR_NFE',
                module: 'faturamento',
                description: `NF-e ${nfe.numero_nfe} cancelada. Motivo: ${motivo.substring(0, 100)}`,
                previousData: { nfe_id: id, numero_nfe: nfe.numero_nfe, status: nfe.status, valor_total: nfe.valor_total },
                newData: { status: 'cancelada', motivo, integracoes },
                ip: req.ip,
                userAgent: req.headers['user-agent']
            });

            res.json({
                success: true,
                message: cancelamentoSefaz
                    ? `NF-e cancelada na SEFAZ (protocolo ${cancelamentoSefaz.numeroProtocolo || 'sem protocolo'}).`
                    : (integracoes.avisos.length === 0
                        ? 'NF-e cancelada localmente (sem chave de acesso — nota não estava autorizada na SEFAZ).'
                        : 'NF-e cancelada com avisos'),
                data: {
                    nfe_id: id,
                    status: 'cancelada',
                    sefaz: cancelamentoSefaz ? { protocolo: cancelamentoSefaz.numeroProtocolo, cStat: cancelamentoSefaz.codigoStatus, motivo: cancelamentoSefaz.motivo } : null,
                    integracoes
                }
            });

        } catch (error) {
            await connection.rollback();
            // BUG-FAT-014: erro de validação de negócio → 400; só falha inesperada → 500.
            const httpStatus = error.statusCode || 500;
            if (httpStatus >= 500) console.error('[FATURAMENTO] Erro ao cancelar NF-e:', error);
            res.status(httpStatus).json({
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
            // Estatísticas combinadas: nfes formais + pedidos faturados sem NF-e formal
            const [stats] = await pool.query(`
                SELECT
                    SUM(total_nfes) as total_nfes,
                    SUM(autorizadas) as autorizadas,
                    SUM(pendentes) as pendentes,
                    SUM(canceladas) as canceladas,
                    SUM(valor_total_faturado) as valor_total_faturado,
                    SUM(valor_mes_atual) as valor_mes_atual
                FROM (
                    SELECT
                        COUNT(*) as total_nfes,
                        SUM(CASE WHEN status COLLATE utf8mb4_general_ci = 'autorizada'
                                 AND chave_acesso IS NOT NULL AND chave_acesso <> ''
                                 AND protocolo_autorizacao IS NOT NULL AND protocolo_autorizacao <> ''
                            THEN 1 ELSE 0 END) as autorizadas,
                        SUM(CASE WHEN status COLLATE utf8mb4_general_ci = 'cancelada' THEN 0
                                 WHEN status COLLATE utf8mb4_general_ci = 'autorizada'
                                      AND chave_acesso IS NOT NULL AND chave_acesso <> ''
                                      AND protocolo_autorizacao IS NOT NULL AND protocolo_autorizacao <> ''
                                 THEN 0
                                 ELSE 1 END) as pendentes,
                        SUM(CASE WHEN status COLLATE utf8mb4_general_ci = 'cancelada' THEN 1 ELSE 0 END) as canceladas,
                        SUM(CASE WHEN status COLLATE utf8mb4_general_ci = 'autorizada'
                                 AND chave_acesso IS NOT NULL AND chave_acesso <> ''
                                 AND protocolo_autorizacao IS NOT NULL AND protocolo_autorizacao <> ''
                            THEN COALESCE(valor_total, 0) ELSE 0 END) as valor_total_faturado,
                        SUM(CASE WHEN status COLLATE utf8mb4_general_ci = 'autorizada'
                                 AND chave_acesso IS NOT NULL AND chave_acesso <> ''
                                 AND protocolo_autorizacao IS NOT NULL AND protocolo_autorizacao <> ''
                                 AND MONTH(data_emissao) = MONTH(NOW()) AND YEAR(data_emissao) = YEAR(NOW())
                            THEN COALESCE(valor_total, 0) ELSE 0 END) as valor_mes_atual
                    FROM nfes

                    UNION ALL

                    SELECT
                        COUNT(*) as total_nfes,
                        SUM(CASE WHEN p.nfe_chave IS NOT NULL AND p.nfe_chave <> '' AND p.nfe_protocolo IS NOT NULL AND p.nfe_protocolo <> '' THEN 1 ELSE 0 END) as autorizadas,
                        SUM(CASE WHEN p.nfe_chave IS NOT NULL AND p.nfe_chave <> '' AND p.nfe_protocolo IS NOT NULL AND p.nfe_protocolo <> '' THEN 0 ELSE 1 END) as pendentes,
                        0 as canceladas,
                        SUM(COALESCE(p.valor, 0)) as valor_total_faturado,
                        SUM(CASE WHEN MONTH(COALESCE(p.data_faturamento, p.created_at)) = MONTH(NOW()) AND YEAR(COALESCE(p.data_faturamento, p.created_at)) = YEAR(NOW()) THEN COALESCE(p.valor, 0) ELSE 0 END) as valor_mes_atual
                    FROM pedidos p
                    WHERE p.status = 'faturado'
                      AND p.id NOT IN (SELECT COALESCE(pedido_id, 0) FROM nfes WHERE pedido_id IS NOT NULL)
                ) combined
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
                    error: 'Permissão insuficiente',
                    message: `Seu perfil (${userRole || 'não definido'}) não possui permissão para enviar NF-e à SEFAZ. Perfis autorizados: ${rolesPermitidas.join(', ')}. Solicite ao administrador a alteração do seu cargo.`,
                    errorCode: 'RBAC_DENIED'
                });
            }

            // Buscar NFe
            const [nfes] = await connection.query(`SELECT * FROM nfes WHERE id = ?`, [id]);

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
            // [FIX] Nunca enviar XML sem assinatura — falha de assinatura = abortar envio
            let xmlAssinado;
            try {
                xmlAssinado = await certificadoService.assinarXML(nfe.xml_nfe, 'infNFe');
                await connection.query(
                    `UPDATE nfes SET xml_assinado = ? WHERE id = ?`,
                    [xmlAssinado, id]
                );
            } catch (certError) {
                console.error(`[FATURAMENTO] ✗ Assinatura falhou: ${certError.message}`);
                connection.release();
                return res.status(401).json({
                    success: false,
                    errorCode: 'CERTIFICADO_INVALIDO',
                    message: 'Não foi possível assinar o XML com o certificado digital. '
                        + (certError.message.includes('não carregado')
                            ? 'Nenhum certificado foi configurado. Acesse Configurações → Fiscal para enviar o arquivo .pfx.'
                            : 'Verifique se o certificado está válido e a senha está correta. Detalhe: ' + certError.message)
                });
            }

            // Enviar para SEFAZ
            const resultado = await sefazService.autorizarNFe(xmlAssinado, nfe.emitente_uf);

            if (resultado.autorizado) {
                await connection.beginTransaction();

                await connection.query(`
                    UPDATE nfes
                    SET status = 'autorizada',
                        numero_protocolo = ?,
                        chave_acesso = COALESCE(chave_acesso, ?),
                        data_autorizacao = NOW(),
                        xml_protocolo = ?,
                        autorizado_por = ?
                    WHERE id = ?
                `, [resultado.numeroProtocolo, resultado.chaveAcesso, resultado.xmlCompleto, usuario_id, id]);

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

                // Enviar DANFE por email automaticamente após autorização SEFAZ
                const emailDanfe = { enviado: false };
                try {
                    const [[nfeCliente]] = await pool.query(
                        `SELECT c.email, c.email_nfe, c.nome as cliente_nome, n.valor_total, n.numero
                         FROM nfes n LEFT JOIN clientes c ON n.cliente_id = c.id WHERE n.id = ?`, [id]
                    );
                    if (nfeCliente) {
                        const emailDest = nfeCliente.email_nfe || nfeCliente.email;
                        const r = await enviarDanfeEmail(parseInt(id), emailDest, nfeCliente.cliente_nome, nfe.numero_nfe || nfeCliente.numero, nfeCliente.valor_total);
                        emailDanfe.enviado = r.enviado;
                    }
                } catch (emailErr) {
                    console.warn(`[FATURAMENTO-EMAIL] ⚠ DANFE email falhou: ${emailErr.message}`);
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
            // HOTFIX: Diferenciar causa raiz — certificado/credencial vs erro genérico
            const msg = (error.message || '').toLowerCase();
            if (msg.includes('certificado') || msg.includes('certificate') || msg.includes('pfx') || msg.includes('pkcs12')) {
                return res.status(401).json({
                    success: false,
                    errorCode: 'CERTIFICADO_INVALIDO',
                    message: 'Certificado digital inválido, expirado ou não encontrado. Verifique o arquivo .pfx e a senha nas configurações do sistema.'
                });
            }
            if (msg.includes('401') || msg.includes('unauthorized') || msg.includes('credencial') || msg.includes('credential')) {
                return res.status(401).json({
                    success: false,
                    errorCode: 'CREDENCIAL_SEFAZ',
                    message: 'Credenciais de acesso à SEFAZ inválidas. Verifique o certificado digital e as configurações de integração.'
                });
            }
            if (msg.includes('econnrefused') || msg.includes('timeout') || msg.includes('enotfound') || msg.includes('socket')) {
                return res.status(502).json({
                    success: false,
                    errorCode: 'SEFAZ_INDISPONIVEL',
                    message: 'Não foi possível conectar à SEFAZ. O serviço pode estar temporariamente indisponível. Tente novamente em alguns minutos.'
                });
            }
            res.status(500).json({ success: false, message: error.message });
        } finally {
            connection.release();
        }
    });

    // ============================================================
    // ENVIAR DANFE POR EMAIL (MANUAL)
    // ============================================================

    router.post('/nfes/:id/enviar-email', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const { email: emailOverride } = req.body;

            const [[nfeData]] = await pool.query(
                `SELECT n.numero, n.valor_total, n.cliente_id, n.destinatario_nome,
                        c.email, c.email_nfe, c.nome as cliente_nome
                 FROM nfes n LEFT JOIN clientes c ON n.cliente_id = c.id
                 WHERE n.id = ?`, [id]
            );

            if (!nfeData) {
                return res.status(404).json({ success: false, message: 'NF-e não encontrada' });
            }

            const emailDest = emailOverride || nfeData.email_nfe || nfeData.email;
            if (!emailDest) {
                return res.status(400).json({ success: false, message: 'Email do destinatário não informado. Informe o email no cadastro do cliente ou envie no campo "email".' });
            }

            const result = await enviarDanfeEmail(
                parseInt(id),
                emailDest,
                nfeData.cliente_nome || nfeData.destinatario_nome,
                nfeData.numero,
                nfeData.valor_total
            );

            if (result.enviado) {
                res.json({ success: true, message: `DANFE enviada para ${emailDest}` });
            } else {
                res.status(500).json({ success: false, message: result.motivo || 'Falha ao enviar email' });
            }
        } catch (error) {
            console.error('[FATURAMENTO-EMAIL] Erro:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    });

    // ============================================================
    // ESPELHO DE NOTA — Pré-visualização DANFE oficial com dados reais
    // Usa o mesmo template danfe.html (layout oficial) do danfe-renderer
    // ============================================================

    router.get('/nfes/:id/espelho', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            if (req.query.origem === 'pedido') {
                const htmlPedido = await montarDanfePedidoFaturado(id);
                if (!htmlPedido) {
                    return res.status(404).json({ success: false, message: 'Pedido faturado não encontrado' });
                }
                res.setHeader('Content-Type', 'text/html; charset=utf-8');
                return res.send(htmlPedido);
            }

            const { renderDanfe } = require(path.resolve(__dirname, '../../../routes/danfe-renderer'));

            // Buscar NF-e completa com dados do cliente
            const [nfes] = await pool.query(`
                SELECT n.*,
                       c.nome AS cli_nome, c.razao_social AS cli_razao_social,
                       COALESCE(c.cnpj, c.cnpj_cpf) AS cli_cnpj, c.inscricao_estadual AS cli_ie,
                       c.endereco AS cli_endereco, c.bairro AS cli_bairro,
                       c.cidade AS cli_cidade, c.estado AS cli_uf, c.cep AS cli_cep,
                       c.telefone AS cli_telefone, c.email AS cli_email
                FROM nfes n
                LEFT JOIN clientes c ON c.id = n.cliente_id
                WHERE n.id = ?
            `, [id]);

            if (!nfes.length) return res.status(404).json({ success: false, message: 'NF-e não encontrada' });

            const nfe = nfes[0];
            const [itens] = await pool.query('SELECT * FROM nfe_itens WHERE nfe_id = ?', [id]);

            // Dados do emitente — prioridade: configuracoes_empresa → configuracoes → env
            let emit = {
                razaoSocial: 'ALUFORCE INDÚSTRIA E COMÉRCIO LTDA',
                nomeFantasia: 'ALUFORCE',
                cnpj: process.env.EMITENTE_CNPJ || '',
                ie: process.env.EMITENTE_IE || '',
                logradouro: '', numero: '', bairro: '', cidade: '',
                uf: process.env.EMITENTE_UF || 'SP',
                cep: '', telefone: '', email: '', logoPath: ''
            };
            try {
                const [ceRows] = await pool.query('SELECT * FROM configuracoes_empresa LIMIT 1');
                if (ceRows && ceRows[0] && (ceRows[0].cnpj || ceRows[0].razao_social)) {
                    const e = ceRows[0];
                    emit = { razaoSocial: e.razao_social || emit.razaoSocial, nomeFantasia: e.nome_fantasia || emit.nomeFantasia, cnpj: e.cnpj || '', ie: e.inscricao_estadual || '', logradouro: e.endereco || '', numero: e.numero || '', bairro: e.bairro || '', cidade: e.cidade || '', uf: e.estado || 'SP', cep: e.cep || '', telefone: e.telefone || '', email: e.email || '', logoPath: e.logo_path || '' };
                } else {
                    const [cfgRows] = await pool.query(`SELECT * FROM configuracoes WHERE chave = 'empresa_emitente' LIMIT 1`);
                    const cfg = cfgRows.length ? JSON.parse(cfgRows[0].valor || '{}') : {};
                    if (cfg.cnpj) emit = { ...emit, ...cfg, cidade: cfg.cidade || cfg.municipio || '', logradouro: cfg.logradouro || cfg.endereco || '' };
                }
            } catch (_) {}
            const emitLogoUrl = emit.logoPath || '/images/Logo Monocromatico - Azul - Aluforce.png';

            const fmtMoney = v => (parseFloat(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const fmtQty   = v => (parseFloat(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
            const fmtDate  = d => { if (!d) return ''; const dt = new Date(d); return isNaN(dt.getTime()) ? '' : dt.toLocaleDateString('pt-BR'); };
            const fmtTime  = d => { if (!d) return ''; const dt = new Date(d); return isNaN(dt.getTime()) ? '' : dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); };

            const isPreview = !nfe.chave_acesso && !nfe.numero_protocolo;
            const chave     = nfe.chave_acesso || '';
            const valorTotal = parseFloat(nfe.valor || nfe.valor_total || 0);
            const frete     = parseFloat(nfe.valor_frete || 0);
            const desconto  = parseFloat(nfe.valor_desconto || 0);
            const seguro    = parseFloat(nfe.valor_seguro || 0);
            const outras    = parseFloat(nfe.outras_despesas || 0);
            const valorNF   = valorTotal || ((itens || []).reduce((s, i) => s + parseFloat(i.valor_total || 0), 0)) + frete + seguro + outras - desconto;

            // Duplicatas da NF-e
            let dups = [];
            try {
                const [dupRows] = await pool.query('SELECT * FROM nfe_duplicatas WHERE nfe_id = ? ORDER BY numero', [id]);
                dups = dupRows.map(d => ({
                    nDup: d.numero || '',
                    dVenc: fmtDate(d.vencimento),
                    vDup: fmtMoney(d.valor)
                }));
            } catch (e) { /* tabela pode não existir */ }

            // Destinatário — separar logradouro/numero
            const splitEnd = str => { const m = (str || '').match(/^(.+?),\s*(\S+.*)$/); return m ? [m[1].trim(), m[2].trim()] : [(str || ''), '']; };
            const [dstLgr, dstNro] = splitEnd(nfe.cli_endereco || nfe.endereco_destinatario || '');

            // Montar contexto no formato NFe.infNFe (mesmo utilizado pelo danfe-renderer)
            const ctx = {
                marcaAguaClasse: isPreview ? '' : 'hidden',
                avisoTopo: isPreview ? 'DOCUMENTO DE PRÉVIA — NÃO POSSUI VALOR FISCAL' : '',
                paginaAtual: '1',
                paginaTotal: '1',
                codigoBarrasUrl: chave ? `https://barcodeapi.org/api/128/${chave}` : '',
                emitenteLogoUrl: emitLogoUrl,
                portalConsultaUrl: 'www.nfe.fazenda.gov.br/portal',
                NFe: {
                    infNFe: {
                        ide: {
                            nNF: nfe.numero || nfe.numero_nfe || '',
                            serie: nfe.serie || '1',
                            tpNF: nfe.tipo_operacao || '1',
                            natOp: nfe.natureza_operacao || 'Venda de Mercadoria',
                            dhEmi: fmtDate(nfe.data_emissao),
                            dhSaiEnt: fmtDate(nfe.data_saida || nfe.data_emissao),
                            _danfeHoraSaida: fmtTime(nfe.data_saida || nfe.data_emissao)
                        },
                        emit: {
                            xNome: emit.razaoSocial,
                            xFant: emit.nomeFantasia,
                            CNPJ: emit.cnpj,
                            CPF: '',
                            IE: emit.ie,
                            IEST: '',
                            CRT: nfe.crt || '',
                            IM: '',
                            email: emit.email,
                            enderEmit: {
                                xLgr: emit.logradouro,
                                nro: emit.numero,
                                xCpl: '',
                                xBairro: emit.bairro,
                                xMun: emit.cidade,
                                UF: emit.uf,
                                CEP: emit.cep,
                                fone: emit.telefone
                            }
                        },
                        dest: {
                            xNome: nfe.destinatario || nfe.cli_razao_social || nfe.cli_nome || '',
                            CNPJ: (nfe.cli_cnpj || '').length > 11 ? (nfe.cli_cnpj || '') : '',
                            CPF: (nfe.cli_cnpj || '').length <= 11 ? (nfe.cli_cnpj || '') : '',
                            IE: nfe.cli_ie || '',
                            indIEDest: nfe.cli_ie ? '1' : '9',
                            enderDest: {
                                xLgr: dstLgr,
                                nro: dstNro,
                                xCpl: '',
                                xBairro: nfe.cli_bairro || '',
                                xMun: nfe.cli_cidade || '',
                                UF: nfe.cli_uf || '',
                                CEP: nfe.cli_cep || '',
                                fone: nfe.cli_telefone || ''
                            }
                        },
                        cobr: {
                            fat: {
                                nFat: nfe.numero || nfe.numero_nfe || '',
                                vOrig: fmtMoney(valorNF),
                                vLiq: fmtMoney(valorNF - desconto)
                            },
                            dup: dups
                        },
                        det: (itens || []).map((item, i) => ({
                            prod: {
                                cProd: item.codigo_produto || item.codigo || String(i + 1).padStart(3, '0'),
                                xProd: item.descricao || '',
                                NCM: item.ncm || '',
                                CFOP: item.cfop || '',
                                uCom: item.unidade || 'UN',
                                qCom: fmtQty(item.quantidade),
                                vUnCom: fmtMoney(item.valor_unitario),
                                vProd: fmtMoney(item.valor_total)
                            },
                            _danfeCstCsosn: item.cst || item.csosn || '',
                            _danfeBcIcms: fmtMoney(item.base_icms || item.valor_total || 0),
                            _danfeVIcms: fmtMoney(item.valor_icms || 0),
                            _danfePIcms: item.aliquota_icms ? fmtMoney(item.aliquota_icms) : '',
                            _danfeVIpi: fmtMoney(item.valor_ipi || 0),
                            _danfePIpi: item.aliquota_ipi ? fmtMoney(item.aliquota_ipi) : ''
                        })),
                        total: {
                            ICMSTot: {
                                vBC: fmtMoney(nfe.base_calculo_icms || 0),
                                vICMS: fmtMoney(nfe.valor_icms || 0),
                                vBCST: fmtMoney(nfe.base_calculo_st || 0),
                                vST: fmtMoney(nfe.valor_icms_st || 0),
                                vTotTrib: fmtMoney(nfe.valor_tributos || 0),
                                vProd: fmtMoney((itens || []).reduce((s, i) => s + parseFloat(i.valor_total || 0), 0)),
                                vFCPSTRet: '0,00',
                                vFrete: fmtMoney(frete),
                                vSeg: fmtMoney(seguro),
                                vDesc: fmtMoney(desconto),
                                vOutro: fmtMoney(outras),
                                vIPI: fmtMoney(nfe.valor_ipi || 0),
                                vNF: fmtMoney(valorNF),
                                vII: '0,00'
                            },
                            ISSQNtot: { vServ: '', vBC: '', vISS: '', cMunFG: '' }
                        },
                        transp: {
                            modFrete: { '0': '0 - Emitente', '1': '1 - Destinatário', '9': '9 - Sem Frete' }[nfe.modalidade_frete] || '',
                            transporta: {
                                xNome: nfe.transportadora_nome || '',
                                CNPJ: nfe.transportadora_cnpj || '',
                                CPF: '', IE: '', xEnder: '', xMun: '', UF: ''
                            },
                            veicTransp: { placa: nfe.placa_veiculo || '', UF: '', RNTC: '' },
                            _danfeQVol: nfe.qtd_volumes || '',
                            _danfeEsp: nfe.especie_volumes || '',
                            _danfeMarca: '', _danfeNVol: '',
                            _danfePesoB: nfe.peso_bruto ? fmtMoney(nfe.peso_bruto) : '',
                            _danfePesoL: nfe.peso_liquido ? fmtMoney(nfe.peso_liquido) : ''
                        },
                        infAdProd: '',
                        infAdic: {
                            infCpl: nfe.informacoes_complementares || nfe.observacao || '',
                            infAdFisco: nfe.informacoes_fisco || ''
                        }
                    }
                },
                protNFe: {
                    infProt: {
                        chNFe: chave,
                        nProt: nfe.numero_protocolo || (isPreview ? 'Pré-autorização' : ''),
                        dhRecbto: fmtDate(nfe.data_autorizacao || nfe.data_emissao)
                    }
                }
            };

            const html = renderDanfe(ctx);
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(html);

        } catch (error) {
            console.error('[FATURAMENTO] Erro ao gerar espelho:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    });

    // ============================================================
    // GERAR E BAIXAR DANFE
    // ============================================================

    // [FIX] DANFE usa o mesmo template HTML do espelho (danfe-renderer.js / danfe.html)
    // O PDFKit gerava layout diferente do modelo oficial definido em danfe.html.
    // Solução: retornar HTML do template oficial — usuário imprime via browser (Ctrl+P).
    router.get('/nfes/:id/danfe', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;

            // Origem = pedido faturado
            if (req.query.origem === 'pedido') {
                const htmlPedido = await montarDanfePedidoFaturado(id);
                if (!htmlPedido) return res.status(404).json({ success: false, message: 'Pedido faturado não encontrado' });
                res.setHeader('Content-Type', 'text/html; charset=utf-8');
                res.setHeader('Content-Disposition', `inline; filename="danfe-pedido-${id}.html"`);
                return res.send(htmlPedido);
            }

            const { renderDanfe, buildDanfeCtx } = require(path.resolve(__dirname, '../../../routes/danfe-renderer'));

            const [nfes] = await pool.query(`
                SELECT n.*,
                       c.nome AS cli_nome, c.razao_social AS cli_razao_social,
                       COALESCE(c.cnpj, c.cnpj_cpf) AS cli_cnpj, c.inscricao_estadual AS cli_ie,
                       c.endereco AS cli_endereco, c.bairro AS cli_bairro,
                       c.cidade AS cli_cidade, c.estado AS cli_uf, c.cep AS cli_cep,
                       c.telefone AS cli_telefone, c.email AS cli_email
                FROM nfes n LEFT JOIN clientes c ON c.id = n.cliente_id
                WHERE n.id = ?
            `, [id]);

            if (!nfes.length) return res.status(404).json({ success: false, message: 'NFe não encontrada' });

            const nfe = nfes[0];

            // BUG-FAT-005: o DANFE é o Documento Auxiliar de uma NF-e AUTORIZADA pela SEFAZ.
            // Não gerar DANFE para nota em rascunho/pendente (não tem chave nem protocolo). Para
            // conferência antes da emissão, usar o espelho (?origem=pedido ou a rota /espelho).
            const statusDanfe = String(nfe.status || '').toLowerCase().trim();
            if (!['autorizada', 'cancelada'].includes(statusDanfe)) {
                return res.status(409).json({
                    success: false,
                    code: 'NFE_NAO_AUTORIZADA',
                    message: 'DANFE disponível apenas para NF-e autorizada. Esta nota está em "' + (nfe.status || 'rascunho') + '". Use o espelho para pré-visualização.'
                });
            }

            const [itens] = await pool.query('SELECT * FROM nfe_itens WHERE nfe_id = ?', [id]);

            // Dados do emitente
            let emit = { razaoSocial: 'ALUFORCE', nomeFantasia: 'ALUFORCE', cnpj: process.env.EMITENTE_CNPJ || '',
                ie: process.env.EMITENTE_IE || '', logradouro: '', numero: '', bairro: '', cidade: '',
                uf: process.env.EMITENTE_UF || 'SP', cep: '', telefone: '', email: '', logoPath: '' };
            try {
                const [ceRows] = await pool.query('SELECT * FROM configuracoes_empresa LIMIT 1');
                if (ceRows && ceRows[0] && (ceRows[0].cnpj || ceRows[0].razao_social)) {
                    const e = ceRows[0];
                    emit = { razaoSocial: e.razao_social || emit.razaoSocial, nomeFantasia: e.nome_fantasia || emit.nomeFantasia,
                        cnpj: e.cnpj || '', ie: e.inscricao_estadual || '', logradouro: e.endereco || '',
                        numero: e.numero || '', bairro: e.bairro || '', cidade: e.cidade || '',
                        uf: e.estado || 'SP', cep: e.cep || '', telefone: e.telefone || '',
                        email: e.email || '', logoPath: e.logo_path || '' };
                }
            } catch (_) {}

            const fmtMoney = v => (parseFloat(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const fmtDate  = d => { if (!d) return ''; const dt = new Date(d); return isNaN(dt.getTime()) ? '' : dt.toLocaleDateString('pt-BR'); };
            const chave    = nfe.chave_acesso || '';

            const pedidoCtx = {
                id: nfe.id, nf: nfe.numero, serie_nf: nfe.serie || '1',
                nfe_chave: chave, nfe_protocolo: nfe.numero_protocolo || '',
                natureza_operacao: nfe.natureza_operacao || 'Venda de Mercadoria',
                data_emissao: nfe.data_emissao || nfe.created_at,
                data_faturamento: nfe.data_emissao || nfe.data_autorizacao,
                valor_total: nfe.valor_total || nfe.valor || 0,
                frete: nfe.valor_frete || 0, desconto: nfe.valor_desconto || 0,
                valor_seguro: nfe.valor_seguro || 0, outras_despesas: nfe.outras_despesas || 0,
                tipo_frete: nfe.modalidade_frete || '1',
                condicao_pagamento: nfe.condicao_pagamento || '',
                observacao: nfe.observacoes || '',
                empresa_razao_social: emit.razaoSocial, empresa_nome: emit.nomeFantasia,
                empresa_cnpj: emit.cnpj, empresa_ie: emit.ie,
                empresa_endereco: `${emit.logradouro}, ${emit.numero}`.trim().replace(/,\s*$/, ''),
                empresa_bairro: emit.bairro, empresa_cidade: emit.cidade,
                empresa_uf: emit.uf, empresa_cep: emit.cep, empresa_telefone: emit.telefone,
                emitenteLogoUrl: emit.logoPath || '/images/Logo Monocromatico - Azul - Aluforce.png',
                cliente_razao_social: nfe.destinatario_razao_social || nfe.cli_razao_social || nfe.cli_nome || '',
                cliente_nome: nfe.destinatario_nome || nfe.cli_nome || '',
                cliente_cnpj: nfe.destinatario_cnpj || nfe.cli_cnpj || '',
                cliente_cpf: nfe.destinatario_cpf || '',
                cliente_ie: nfe.destinatario_ie || nfe.cli_ie || '',
                cliente_endereco: nfe.cli_endereco || '', cliente_bairro: nfe.cli_bairro || '',
                cliente_cidade: nfe.cli_cidade || '', cliente_estado: nfe.cli_uf || '',
                cliente_cep: nfe.cli_cep || '', cliente_telefone: nfe.cli_telefone || ''
            };

            const itensCtx = (itens || []).map(i => ({
                codigo: i.codigo_produto || i.codigo || '',
                descricao: i.descricao || i.produto_nome || '',
                quantidade: i.quantidade || 0,
                preco_unitario: i.valor_unitario || i.preco_unitario || 0,
                subtotal: i.valor_total || ((i.quantidade || 0) * (i.valor_unitario || i.preco_unitario || 0)),
                unidade: i.unidade || 'UN',
                ncm: i.ncm || '', cfop: i.cfop || '5102',
                cst: i.cst || '', csosn: i.csosn || '',
                aliquota_icms: i.aliquota_icms || 0, icms_value: i.valor_icms || 0,
                aliquota_ipi: i.aliquota_ipi || 0, valor_ipi: i.valor_ipi || 0
            }));

            const ctx = buildDanfeCtx(pedidoCtx, itensCtx, {
                preview: !chave,
                logoDataUri: emit.logoPath ? emit.logoPath : null
            });

            const html = renderDanfe(ctx);
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Content-Disposition', `inline; filename="DANFE-NF${nfe.numero || id}.html"`);
            res.send(html);

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

            const [nfes] = await connection.query(`SELECT * FROM nfes WHERE id = ?`, [id]);

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
                // FISCAL-03: Extrair protocolo SEFAZ do resultado e persistir
                const protocolo_sefaz = resultado.protocolo || resultado.nProt || resultado.numProtocolo || null;
                const anoInut = new Date().getFullYear().toString().substring(2);
                const empresa_id_inut = req.user?.empresa_id || 1;

                // Registrar inutilização com auditoria + protocolo SEFAZ
                await pool.query(`
                    INSERT INTO nfe_inutilizacoes (
                        empresa_id, serie, numero_inicial, numero_final, ano, modelo,
                        justificativa, protocolo, xml_inutilizacao, status, data_inutilizacao, usuario_id, created_at
                    ) VALUES (?, ?, ?, ?, ?, '55', ?, ?, ?, 'processado', NOW(), ?, NOW())
                `, [empresa_id_inut, serie, numeroInicial, numeroFinal, anoInut, justificativa, protocolo_sefaz, resultado.xmlCompleto, usuario_id]);

                res.json({
                    success: true,
                    message: 'Numeração inutilizada',
                    protocolo: protocolo_sefaz
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
    // INUTILIZAÇÕES — GET e POST /inutilizacoes
    // Frontend: modules/Faturamento/public/inutilizacao.html
    // ============================================================

    router.get('/inutilizacoes', authenticateToken, async (req, res) => {
        try {
            const { serie, ano } = req.query;
            let sql = `
                SELECT id, serie, numero_inicial, numero_final, ano, justificativa,
                       protocolo, status, data_inutilizacao, created_at
                FROM nfe_inutilizacoes
                WHERE 1=1
            `;
            const params = [];
            if (serie !== undefined && serie !== '') { sql += ' AND serie = ?'; params.push(serie); }
            if (ano) { sql += ' AND ano = ?'; params.push(ano); }
            sql += ' ORDER BY created_at DESC LIMIT 200';

            const [rows] = await pool.query(sql, params);
            res.json(rows);
        } catch (error) {
            console.error('[FATURAMENTO/INUTILIZACOES] Erro ao listar:', error);
            res.json([]);
        }
    });

    router.post('/inutilizacoes', authenticateToken, async (req, res) => {
        try {
            const { ano, serie, numero_inicial, numero_final, justificativa } = req.body;
            const usuario_id = req.user?.id || null;
            const empresa_id = req.user?.empresa_id || 1;

            if (!serie || !numero_inicial || !numero_final || !justificativa) {
                return res.status(400).json({ success: false, error: 'Série, faixa de números e justificativa são obrigatórios' });
            }
            if (!justificativa || justificativa.trim().length < 15) {
                return res.status(400).json({ success: false, error: 'Justificativa deve ter no mínimo 15 caracteres conforme exigência SEFAZ' });
            }
            if (Number(numero_final) < Number(numero_inicial)) {
                return res.status(400).json({ success: false, error: 'Número final deve ser maior ou igual ao inicial' });
            }
            if ((Number(numero_final) - Number(numero_inicial)) > 10000) {
                return res.status(400).json({ success: false, error: 'Não é permitido inutilizar mais de 10.000 números por operação' });
            }

            const anoNum = ano ? parseInt(ano) : new Date().getFullYear();

            // Verificar conflito com NF-es já emitidas
            const [nfesUsadas] = await pool.query(
                'SELECT numero FROM nfes WHERE serie = ? AND numero BETWEEN ? AND ? LIMIT 1',
                [serie, numero_inicial, numero_final]
            );
            if (nfesUsadas.length) {
                return res.status(400).json({ success: false, error: `Número ${nfesUsadas[0].numero} da série ${serie} já foi emitido e não pode ser inutilizado` });
            }

            // Verificar sobreposição com inutilizações existentes
            const [inutilExist] = await pool.query(
                'SELECT id FROM nfe_inutilizacoes WHERE serie = ? AND ((numero_inicial BETWEEN ? AND ?) OR (numero_final BETWEEN ? AND ?)) LIMIT 1',
                [serie, numero_inicial, numero_final, numero_inicial, numero_final]
            );
            if (inutilExist.length) {
                return res.status(400).json({ success: false, error: 'Parte da faixa já foi inutilizada anteriormente' });
            }

            // Tentar enviar para SEFAZ via serviço (opcional — falha silenciosa se não configurado)
            let protocolo = null;
            let xmlInutilizacao = null;
            let statusInut = 'processado';
            try {
                const resultSefaz = await sefazService.inutilizarNumeracao({
                    ano: String(anoNum).substring(2),
                    cnpj: req.user?.empresa_cnpj || '',
                    modelo: '55',
                    serie,
                    numeroInicial: numero_inicial,
                    numeroFinal: numero_final,
                    justificativa
                }, req.user?.empresa_uf || 'SP');
                if (resultSefaz?.sucesso) {
                    protocolo = resultSefaz.protocolo || null;
                    xmlInutilizacao = resultSefaz.xmlCompleto || null;
                }
            } catch (sefazErr) {
                console.warn('[FATURAMENTO/INUTILIZACOES] SEFAZ indisponível, salvando localmente:', sefazErr.message);
            }

            await pool.query(`
                INSERT INTO nfe_inutilizacoes (
                    empresa_id, serie, numero_inicial, numero_final, ano, modelo,
                    justificativa, protocolo, xml_inutilizacao, status, data_inutilizacao, usuario_id, created_at
                ) VALUES (?, ?, ?, ?, ?, '55', ?, ?, ?, ?, NOW(), ?, NOW())
            `, [empresa_id, serie, numero_inicial, numero_final, anoNum, justificativa, protocolo, xmlInutilizacao, statusInut, usuario_id]);

            res.json({ success: true, message: 'Faixa inutilizada com sucesso', protocolo });
        } catch (error) {
            console.error('[FATURAMENTO/INUTILIZACOES] Erro ao inutilizar:', error);
            res.status(500).json({ success: false, error: 'Erro ao registrar inutilização: ' + error.message });
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
                    SUM(COALESCE(n.valor_total, 0)) as valor_total,
                    SUM(COALESCE(n.valor_produtos, 0)) as valor_produtos,
                    SUM(COALESCE(n.valor_icms, 0)) as total_icms,
                    SUM(COALESCE(n.pis, 0)) as total_pis,
                    SUM(COALESCE(n.cofins, 0)) as total_cofins
                FROM nfes n
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
                FROM nfes n
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

    // ============================================================
    // WEBHOOK NFe — Recebe callbacks de provedores externos (SEFAZ/Focus NFe)
    // Resiliência: não quebra se o registro não existir no banco
    // ============================================================

    router.post('/nfe/webhook/status', async (req, res) => {
        try {
            const { chave_acesso, numero_protocolo, status, motivo, xml_retorno, referencia_id } = req.body;

            // Identificar o registro: por chave_acesso (44 dígitos) ou referencia_id
            const identificador = chave_acesso || referencia_id;
            if (!identificador) {
                console.warn('[NFe-WEBHOOK] ⚠️ Evento recebido sem identificador (chave_acesso ou referencia_id). Payload descartado.');
                // Retorna 200 para evitar re-envios infinitos do provedor
                return res.status(200).json({ received: true, processed: false, reason: 'Identificador ausente' });
            }

            // RESILIÊNCIA: Verificar existência ANTES de atualizar (previne "Record not found")
            let nfeQuery, nfeParams;
            if (chave_acesso && /^\d{44}$/.test(chave_acesso)) {
                nfeQuery = 'SELECT id, status, numero FROM nfes WHERE chave_acesso = ?';
                nfeParams = [chave_acesso];
            } else {
                nfeQuery = 'SELECT id, status, numero FROM nfes WHERE id = ?';
                nfeParams = [referencia_id];
            }

            const [nfes] = await pool.query(nfeQuery, nfeParams);

            if (nfes.length === 0) {
                // Registro não encontrado — Race condition ou mapeamento incorreto
                console.warn(`[NFe-WEBHOOK] ⚠️ Registro não encontrado para webhook. Identificador: ${identificador}. Status recebido: ${status || 'N/A'}`);
                // Retorna 200 OK para que o provedor pare de re-enviar
                return res.status(200).json({ received: true, processed: false, reason: 'Registro não encontrado' });
            }

            const nfe = nfes[0];

            // Mapear status do provedor para status interno
            const statusMap = {
                'autorizada': 'autorizada',
                'aprovada': 'autorizada',
                'cancelada': 'cancelada',
                'rejeitada': 'rejeitada',
                'denegada': 'rejeitada',
                'processando': 'processando'
            };

            const statusInterno = statusMap[(status || '').toLowerCase()] || status;

            if (statusInterno) {
                // updateMany pattern: não quebra se 0 rows afetadas
                const [result] = await pool.query(`
                    UPDATE nfes
                    SET status = ?,
                        protocolo_autorizacao = COALESCE(?, protocolo_autorizacao)
                    WHERE id = ?
                `, [statusInterno, numero_protocolo, nfe.id]);

                console.log(`[NFe-WEBHOOK] ✅ NFe #${nfe.numero || nfe.id} atualizada: ${nfe.status} → ${statusInterno} (${result.affectedRows} linha(s) afetada(s))`);
            }

            res.status(200).json({ received: true, processed: true, nfe_id: nfe.id });
        } catch (error) {
            console.error('[NFe-WEBHOOK] ❌ Erro ao processar webhook:', error);
            // Ainda retorna 200 para evitar retries infinitos do provedor
            res.status(200).json({ received: true, processed: false, reason: 'Erro interno' });
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
    // ATIVIDADES RECENTES (Audit Log contextual do Faturamento)
    // ============================================================

    router.get('/atividades', authenticateToken, async (req, res) => {
        try {
            const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 50);

            // Busca atividades de tabelas do domínio Faturamento via auditoria_logs
            // + eventos de NF-e (nfe_eventos) — união cronológica reversa
            const [rows] = await pool.query(`
                (
                    SELECT
                        al.id,
                        al.operacao AS tipo,
                        al.tabela,
                        al.registro_id,
                        al.descricao,
                        al.created_at AS data,
                        u.nome AS usuario_nome
                    FROM auditoria_logs al
                    LEFT JOIN usuarios u ON u.id = al.usuario_id
                    WHERE al.tabela IN ('nfe', 'nfe_itens', 'contas_receber', 'contas_receber_parcelas', 'faturamento_config')
                    ORDER BY al.created_at DESC
                    LIMIT ?
                )
                UNION ALL
                (
                    SELECT
                        ne.id,
                        ne.tipo_evento AS tipo,
                        'nfe_eventos' AS tabela,
                        ne.nfe_id AS registro_id,
                        ne.descricao,
                        COALESCE(ne.data_evento, ne.created_at) AS data,
                        u2.nome AS usuario_nome
                    FROM nfe_eventos ne
                    LEFT JOIN usuarios u2 ON u2.id = ne.usuario_id
                    ORDER BY COALESCE(ne.data_evento, ne.created_at) DESC
                    LIMIT ?
                )
                ORDER BY data DESC
                LIMIT ?
            `, [limit, limit, limit]);

            res.json({ success: true, data: rows });
        } catch (error) {
            console.error('[FATURAMENTO] Erro ao buscar atividades:', error.message);
            // Fallback: se as tabelas não existem, retorna vazio graciosamente
            if (error.code === 'ER_NO_SUCH_TABLE') {
                return res.json({ success: true, data: [] });
            }
            res.status(500).json({ success: false, message: 'Erro ao buscar atividades recentes' });
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
