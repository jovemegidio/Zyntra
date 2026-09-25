'use strict';

/**
 * EMISSOR NF-e IN-PROCESS (reutilizável)
 * ======================================
 * Encapsula o caminho COMPROVADO de emissão (espelha
 * modules/Faturamento/api/faturamento.js: gerar-nfe + enviar-sefaz, cStat 100):
 *   1. monta emitente (FiscalProfileService) + destinatário (cliente do pedido)
 *   2. calcula tributos por item (CalculoTributosService)
 *   3. reserva número (faturamento-shared), grava nfes/nfe_itens, gera XML
 *   4. assina (certificadoService) e transmite à SEFAZ (sefazService)
 *
 * Usado pelo fluxo do Kanban (vendas: faturar / meia-nota / remessa) para que
 * o faturamento realmente emita NF-e à SEFAZ — antes só reservava número.
 *
 * A transmissão SEFAZ ocorre FORA da transação de banco (não segura locks).
 */

const FiscalProfileService = require('../modules/Faturamento/services/fiscal-profile.service');
const CalculoTributosService = require('../modules/Faturamento/services/calculo-tributos.service');
const XmlNFeService = require('../modules/Faturamento/services/xml-nfe.service');
const certificadoService = require('../modules/Faturamento/services/certificado.service');
const sefazService = require('../modules/Faturamento/services/sefaz.service');
const nfeConfig = require('../modules/Faturamento/config/nfe.config');
const NFePedidoMapper = require('../modules/_shared/services/nfe-pedido.mapper');
const { getFaturamentoSharedService } = require('./faturamento-shared.service');
const { resolverCodigoMunicipioCliente } = require('../modules/Faturamento/services/fiscal-helpers');
const { resolverRegraFiscal } = require('./fiscal-regra-resolver.service');
const { aplicarTotaisFiscaisDoPedido, garantirCstCompativelComSt, validarAritmeticaFiscal } = require('./nfe-fiscal-totals.service');
const { vendaEhConsumidorFinal } = require('../utils/vendas-fiscal');
const { resolverNaturezaOperacao, aplicarPerfilCfop } = require('./cfop-operacao.service');

const onlyDigits = (v) => String(v || '').replace(/\D/g, '');
// Limite do campo xNome no layout da NF-e (e da coluna nfes.destinatario_nome).
const LIMITE_XNOME = 60;
const cortarNome = (v) => String(v || '').trim().slice(0, LIMITE_XNOME);
// O leiaute 4.00 da NF-e limita ide/natOp a 60 caracteres. O catálogo de CFOP
// possui descrições oficiais maiores; normalizar aqui protege banco e XML em
// todos os fluxos (emissão, regeneração e reemissão).
const LIMITE_NATOP = 60;
const cortarNaturezaOperacao = (v) => String(v || 'Venda de Produtos').trim().slice(0, LIMITE_NATOP);

// Modo de ST escolhido no Editar NF-e (pedidos.st_modo). 'remover' tira o ST do item e
// troca CFOP/CSOSN/CST para os equivalentes sem substituição; 'calcular' faz o inverso
// e liga o cálculo mesmo onde a regra automática não ligaria. Sem isto a emissão
// recalculava o ST pelas regras do cadastro e a nota saía diferente do espelho
// conferido (NF-e 970 da Energy, 24/09/2026: 5101 conferido, 5401 com ST autorizado).
const CFOP_SEM_ST = { 5401: '5101', 5402: '5101', 5403: '5102', 6401: '6101', 6402: '6101', 6403: '6102' };
const CFOP_COM_ST = { 5101: '5401', 5102: '5403', 6101: '6401', 6102: '6403' };
const CSOSN_SEM_ST = { 201: '101', 202: '102', 203: '103' };
const CSOSN_COM_ST = { 101: '201', 102: '202', 103: '203', 300: '203', 400: '203' };
const CST_SEM_ST = { 10: '00', 30: '40', 70: '20' };
const CST_COM_ST = { '00': '10', 20: '70', 40: '30', 41: '30' };
function aplicarModoStDoPedido(item, modo) {
    const m = String(modo || '').trim().toLowerCase();
    if (m !== 'remover' && m !== 'calcular') return item;
    const remover = m === 'remover';
    const cfop = onlyDigits(item.cfop);
    const novoCfop = (remover ? CFOP_SEM_ST : CFOP_COM_ST)[cfop];
    if (novoCfop) item.cfop = novoCfop;
    const csosn = onlyDigits(item.csosn);
    if (csosn) item.csosn = (remover ? CSOSN_SEM_ST : CSOSN_COM_ST)[csosn] || item.csosn;
    const cst = String(item.cst || '').padStart(2, '0');
    if (item.cst) item.cst = (remover ? CST_SEM_ST : CST_COM_ST)[cst] || item.cst;
    item.calcularICMSST = !remover;
    return item;
}
// Mesma normalizacao usada ao semear `municipios_ibge`: sem acento, sem
// pontuacao, caixa alta. "Sumaré" e "SUMARE" tem de casar.
const normalizarMunicipio = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

/**
 * cMun do destinatario quando o cadastro nao tem codigo IBGE.
 *
 * 21 clientes ativos da Aluforce tinham cidade e UF preenchidas e nenhum codigo
 * IBGE — e a emissao morria com "Dados fiscais incompletos: IBGE do cliente".
 * O codigo nao precisa estar no cadastro: cidade + UF determinam o municipio de
 * forma unica na tabela oficial do IBGE (`municipios_ibge`, semeada da API do
 * proprio IBGE). Resolver aqui conserta os cadastros existentes E os futuros,
 * sem reescrever a tabela de clientes.
 *
 * So aceita correspondencia UNICA dentro da UF: "Viçosa" existe em AL, MG e RN,
 * e homonimo dentro do mesmo estado fica sem resposta em vez de chutar.
 */
async function resolverMunicipioPorNome(connection, cidade, uf) {
    const nome = normalizarMunicipio(cidade);
    const sigla = String(uf || '').trim().toUpperCase().slice(0, 2);
    if (!nome || sigla.length !== 2) return null;
    try {
        const [linhas] = await connection.query(
            'SELECT codigo FROM municipios_ibge WHERE uf = ? AND nome_normalizado = ? LIMIT 2',
            [sigla, nome]);
        if (linhas.length !== 1) return null;
        return onlyDigits(linhas[0].codigo).length === 7 ? onlyDigits(linhas[0].codigo) : null;
    } catch (e) {
        // Instancia sem a tabela ainda: segue com o comportamento anterior.
        return null;
    }
}
const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

/**
 * Emite uma NF-e (modelo 55) para um subconjunto de itens de um pedido ou,
 * quando `dadosManuais` e informado, sem vinculo com pedido.
 *
 * @param {Object} pool - pool MySQL
 * @param {Object} opts
 * @param {number} opts.pedidoId
 * @param {Array<{produto_id:number, quantidade:number, valor_unitario?:number, desconto?:number}>} opts.itens
 * @param {number} [opts.usuarioId]
 * @param {string} [opts.naturezaOperacao='Venda de Produtos']
 * @param {string} [opts.cfopOverride] - força um CFOP (ex.: remessa). Default: CFOP de venda do produto.
 * @param {boolean} [opts.transmitir=true] - se false, deixa a NF-e em 'pendente' (não envia à SEFAZ).
 * @param {Object} [opts.dadosManuais] - destinatario e metadados de uma emissao avulsa.
 * @returns {Promise<Object>} resultado da emissão
 */
async function emitirNFePedido(pool, opts) {
    const {
        pedidoId,
        itens,
        usuarioId = null,
        // Renomeado do `naturezaOperacao` recebido: o valor final (depois de
        // `resolverNaturezaOperacao`, linha ~582) precisa poder ser REATRIBUÍDO, e uma
        // constante de destructuring não permite — era exatamente isso que lançava
        // "Assignment to constant variable" em toda emissão real (pedido faturado sem
        // NF-e autorizada, caindo no fallback de número legado). Ver `let naturezaOperacao`
        // logo abaixo, inicializado a partir deste valor recebido.
        naturezaOperacao: naturezaOperacaoInformada = 'Venda de Produtos',
        cfopOverride = null,
        transmitir = true,
        dadosManuais = null,
        // Suporte a NF-e de entrada/devolução: finalidade 4 = devolução, tipoOperacao 0 = entrada,
        // nfRef = chave(s) de acesso da(s) NF-e original(is) referenciada(s).
        finalidade = '1',
        tipoOperacao = '1',
        nfRef = null,
        // null = deduzir do pedido (NFePedidoMapper.mapearIndicadorPresenca); um valor
        // explícito aqui (ex.: '0' na devolução) continua vencendo.
        indicadorPresenca = null,
        semCobranca = false,
        // Em emissão avulsa não há pedido para inferir a empresa. Nos pedidos, a
        // empresa gravada no documento sempre prevalece.
        empresaId = null,
        // Id de uma NF-e PENDENTE/REJEITADA a ser reescrita no lugar (mesmo número).
        // Ver o bloco "4. Reservar número" para as regras.
        regerarNfeId = null,
        // Identidade de quem confirmou o envio (`nfe-confirmacao-audit.service#identidade`
        // + confirmouEmTela/origemConfirmacao). Alimenta o log de não repúdio.
        auditoriaEnvio = null,
        // Só o "Faturar" integral opta: se a SEFAZ REJEITAR em definitivo, desfaz o
        // faturamento que originou a nota (ver services/nfe-rollback.service.js).
        reverterFaturamentoAoFalhar = false
    } = opts || {};

    const emissaoManual = !pedidoId && !!dadosManuais;
    if (!pedidoId && !emissaoManual) throw new Error('pedidoId ou dadosManuais é obrigatório');
    if (!Array.isArray(itens) || itens.length === 0) throw new Error('itens é obrigatório');

    const faturamentoShared = getFaturamentoSharedService(pool);
    await faturamentoShared.ensureInfrastructure();

    if (!certificadoService.certificadoCarregado) {
        throw new Error('Certificado digital não carregado nesta instância. Configure o .pfx antes de emitir.');
    }

    const connection = await pool.getConnection();
    let nfeId = null;
    let proximoNumero = null;
    let serieConfig = null;
    let chaveAcesso = null;
    // Mutável de propósito: `resolverNaturezaOperacao` (linha ~582) substitui este valor
    // pelo perfil do CFOP dos itens quando eles convergem para um único CFOP conhecido.
    let naturezaOperacao = naturezaOperacaoInformada;
    let xmlNfe = null;
    let emitente = null;
    let valorTotal = 0;
    let cfopEmitido = null;

    try {
        await connection.beginTransaction();

        // 1. Origem da nota. No modo manual nao se cria pedido artificial: a NF-e e
        // gravada com pedido_id/cliente_id nulos e recebe os dados fiscais digitados.
        let pedido;
        let destinatario;
        let itensEmissao = itens;

        if (emissaoManual) {
            const dest = dadosManuais.destinatario || {};
            const documento = onlyDigits(dest.documento || dest.cnpj || dest.cpf);
            const tipoDocumento = String(dest.tipoDocumento || (documento.length === 11 ? 'CPF' : 'CNPJ')).toUpperCase();
            pedido = {
                empresa_id: Number(empresaId) || null,
                cliente_id: Number(dest.clienteId) || null,
                cliente_contribuinte_icms: dest.contribuinteICMS,
                tipo_venda: dest.consumidorFinal ? 'consumidor_final' : 'revenda',
                forma_pagamento: String(dadosManuais.formaPagamento || '01'),
                frete: 0,
                desconto: 0,
                valor_seguro: 0,
                outras_despesas: 0,
                dados_adicionais_nf: String(dadosManuais.informacoesAdicionais || '')
            };
            destinatario = {
                cnpj: tipoDocumento === 'CNPJ' ? documento : null,
                cpf: tipoDocumento === 'CPF' ? documento : null,
                nome: cortarNome(dest.nome),
                ie: String(dest.ie || '').trim() || null,
                uf: String(dest.uf || '').trim().toUpperCase(),
                logradouro: String(dest.endereco || dest.logradouro || '').trim(),
                numero: String(dest.numero || '').trim(),
                complemento: String(dest.complemento || '').trim(),
                bairro: String(dest.bairro || '').trim(),
                codigoMunicipio: onlyDigits(dest.codigoMunicipio),
                municipio: String(dest.municipio || '').trim(),
                cep: onlyDigits(dest.cep),
                telefone: onlyDigits(dest.telefone),
                email: String(dest.email || '').trim()
            };
        } else {
            const [pedidos] = await connection.query(`
                SELECT p.*,
                       -- xNome do destinatario e a RAZAO SOCIAL. A coluna clientes.nome
                       -- guarda o nome de tela, que em boa parte da base e o fantasia: a
                       -- NF-e 905 saiu como "NM-ENGENHARIA" em vez de "NEILOR MIRANDA E CIA
                       -- LTDA". So cai para nome quando nao ha razao social cadastrada.
                       -- (sem crase neste comentario: ele vive DENTRO de um template
                       -- literal, e uma crase aqui fecha a string e quebra o arquivo)
                       COALESCE(NULLIF(TRIM(c.razao_social), ''), c.nome) AS cliente_nome,
                       c.cnpj AS cliente_cnpj, c.cpf AS cliente_cpf, c.cnpj_cpf AS cliente_cnpj_cpf,
                       c.inscricao_estadual AS cliente_ie, c.endereco AS cliente_endereco,
                       c.numero AS cliente_numero, c.complemento AS cliente_complemento,
                       c.bairro AS cliente_bairro, c.cidade AS cliente_cidade,
                       c.estado AS cliente_estado,
                       c.fiscal_contribuinte_icms AS cliente_contribuinte_icms,
                       c.codigo_ibge AS cliente_codigo_ibge,
                       c.codigo_municipio AS cliente_codigo_municipio,
                       c.cep AS cliente_cep, c.telefone AS cliente_telefone, c.email AS cliente_email
                FROM pedidos p
                INNER JOIN clientes c ON p.cliente_id = c.id
                WHERE p.id = ?
                FOR UPDATE
            `, [pedidoId]);
            if (pedidos.length === 0) throw new Error('Pedido ou cliente não encontrado para emissão');
            pedido = pedidos[0];
            // O documento é decidido pelo NÚMERO DE DÍGITOS (14 = CNPJ, 11 = CPF) olhando as três
            // colunas: cadastros com o CPF gravado em clientes.cnpj (pedidos 913/1013) eram
            // recusados com CNPJ de 11 dígitos, e os que só têm cnpj_cpf (pedido 3481) ficavam
            // sem documento nenhum.
            const docsCliente = [pedido.cliente_cnpj, pedido.cliente_cpf, pedido.cliente_cnpj_cpf].map(onlyDigits);
            const cnpjDest = docsCliente.find(d => d.length === 14) || null;
            const cpfDest = cnpjDest ? null : (docsCliente.find(d => d.length === 11) || null);
            destinatario = {
                cnpj: cnpjDest || (cpfDest ? null : (pedido.cliente_cnpj || null)),
                cpf: cpfDest || (cnpjDest ? null : (pedido.cliente_cpf || null)),
                nome: cortarNome(pedido.cliente_nome),
                ie: pedido.cliente_ie || null,
                uf: pedido.cliente_estado,
                logradouro: pedido.cliente_endereco || '',
                numero: pedido.cliente_numero || '',
                complemento: pedido.cliente_complemento || '',
                bairro: pedido.cliente_bairro || '',
                codigoMunicipio: resolverCodigoMunicipioCliente(pedido) || '',
                municipio: pedido.cliente_cidade || '',
                cep: pedido.cliente_cep || '',
                telefone: pedido.cliente_telefone || '',
                email: pedido.cliente_email || ''
            };
        }

        // Cadastro sem codigo IBGE ainda pode ter cidade e UF: a tabela oficial
        // resolve o cMun sem que ninguem precise reeditar o cliente.
        if (onlyDigits(destinatario.codigoMunicipio).length !== 7) {
            const resolvido = await resolverMunicipioPorNome(connection, destinatario.municipio, destinatario.uf);
            if (resolvido) destinatario.codigoMunicipio = resolvido;
        }

        // 2. Emitente (perfil fiscal validado contra o certificado)
        emitente = await FiscalProfileService.carregar(connection);

        // Pré-flight fiscal (mesma validação do motor)
        const faltantes = [];
        if (onlyDigits(emitente.codigoMunicipio).length !== 7) faltantes.push('IBGE do emitente');
        if (!emitente.uf || emitente.uf.length !== 2) faltantes.push('UF do emitente');
        if (onlyDigits(emitente.cnpj).length !== 14) faltantes.push('CNPJ do emitente');
        if (onlyDigits(emitente.cep).length !== 8) faltantes.push('CEP do emitente');
        const cnpjCli = onlyDigits(destinatario.cnpj);
        const cpfCli = onlyDigits(destinatario.cpf);
        if (!cnpjCli && !cpfCli) faltantes.push(`CNPJ/CPF do cliente "${destinatario.nome}"`);
        if (cnpjCli && cnpjCli.length !== 14) faltantes.push('CNPJ do cliente (14 dígitos)');
        if (!cnpjCli && cpfCli && cpfCli.length !== 11) faltantes.push('CPF do cliente (11 dígitos)');
        if (onlyDigits(destinatario.codigoMunicipio).length !== 7) faltantes.push(`IBGE do cliente "${destinatario.nome}"`);
        if (!destinatario.uf || destinatario.uf.length !== 2) faltantes.push(`UF do cliente`);
        if (onlyDigits(destinatario.cep).length !== 8) faltantes.push(`CEP do cliente`);
        if (!destinatario.logradouro) faltantes.push('logradouro do cliente');
        // O layout da NF-e trata endereco sem numero como 'S/N' — o campo nro e
        // obrigatorio, o numero em si nao. Varios CNPJ (MEI, sobretudo) voltam da
        // Receita sem numero, e recusar a emissao por isso barrava nota de cadastro
        // que a propria Receita nao tem como completar.
        if (!destinatario.numero) {
            destinatario.numero = 'S/N';
            console.warn('[NFE-EMITTER] Cliente "' + destinatario.nome + '" sem numero no endereco;'
                + ' a NF-e sai com S/N. Complete o cadastro se houver numero.');
        }
        if (!destinatario.bairro) faltantes.push('bairro do cliente');
        if (faltantes.length) {
            const err = new Error('Dados fiscais incompletos: ' + faltantes.join(', '));
            err.code = 'IBGE_PREFLIGHT';
            throw err;
        }

        // 3. Produtos (campos fiscais) dos itens a emitir
        // Emissao avulsa continua usando o cadastro de produtos como fonte da
        // tributacao. O operador informa o codigo; NCM/CFOP podem ser ajustados na
        // tela, mas CST, CSOSN e aliquotas nunca sao inventados pelo frontend.
        if (emissaoManual) {
            // Validar a AUSÊNCIA de código item a item. Comparar `codigos.length` com
            // `itensEmissao.length` parecia fazer isso, mas `codigos` é um Set: dois itens
            // com o MESMO produto (dois lances do mesmo cabo, o mesmo item em dois preços)
            // encurtavam a lista e a nota era recusada com "informe o código cadastrado",
            // uma mensagem que não descreve o que aconteceu. Repetir produto é legítimo.
            const semCodigo = itensEmissao
                .map((it, i) => (String(it.codigo || '').trim() ? null : i + 1))
                .filter(n => n !== null);
            if (semCodigo.length) {
                throw new Error('Informe o código cadastrado do produto no item '
                    + semCodigo.join(', ') + '.');
            }
            // Dedupe só para o IN da consulta; o mapa é lido por item, então repetição não atrapalha.
            const codigos = [...new Set(itensEmissao.map(i => String(i.codigo).trim().toUpperCase()))];
            const [produtosPorCodigo] = await connection.query(
                `SELECT id, codigo FROM produtos WHERE UPPER(codigo) IN (${codigos.map(() => '?').join(',')})`,
                codigos
            );
            const idPorCodigo = new Map(produtosPorCodigo.map(p => [String(p.codigo).trim().toUpperCase(), Number(p.id)]));
            itensEmissao = itensEmissao.map(item => {
                const codigo = String(item.codigo || '').trim().toUpperCase();
                const produtoId = idPorCodigo.get(codigo);
                if (!produtoId) {
                    throw new Error(`Produto de código "${item.codigo}" não encontrado. Cadastre-o antes da emissão manual.`);
                }
                return { ...item, produto_id: produtoId };
            });
        }

        // ── Desconto por item do PEDIDO ─────────────────────────────────────────────
        // As rotas que chamam a emissão (faturar, parcial, remessa, reemitir, prévia) passam
        // só produto/quantidade/valor — o desconto da linha do pedido ficava de fora e a nota
        // saía com o valor CHEIO (Energy #752: R$ 29.880 na nota × R$ 29.581,20 vendido;
        // #3: R$ 13.500 × R$ 9.045). Quando o item não traz desconto, usa o da linha do
        // pedido, proporcional ao que está sendo faturado (quantidade × valor unitário), o
        // que também cobre meia nota e faturamento por itens.
        if (pedidoId && !emissaoManual && itensEmissao.some(it => it.desconto == null)) {
            try {
                const [linhasPed] = await connection.query(
                    'SELECT id, produto_id, quantidade, preco_unitario, desconto FROM pedido_itens WHERE pedido_id = ? ORDER BY id', [pedidoId]);
                const usadas = new Set();
                itensEmissao = itensEmissao.map(it => {
                    if (it.desconto != null) return it;
                    const linha = linhasPed.find(l => !usadas.has(l.id) && Number(l.produto_id) === Number(it.produto_id));
                    if (!linha) return it;
                    usadas.add(linha.id);
                    const descLinha = Number(linha.desconto) || 0;
                    const brutoLinha = (Number(linha.quantidade) || 0) * (Number(linha.preco_unitario) || 0);
                    if (!(descLinha > 0) || !(brutoLinha > 0)) return it;
                    const brutoEmit = (Number(it.quantidade) || 0) * (Number(it.valor_unitario ?? it.preco_unitario) || 0);
                    const desconto = Math.round(descLinha * Math.min(1, brutoEmit / brutoLinha) * 100) / 100;
                    return { ...it, desconto };
                });
            } catch (e) {
                console.warn('[NFE-EMITTER] Não foi possível aplicar o desconto dos itens do pedido:', e.message);
            }
        }

        const produtoIds = [...new Set(itensEmissao.map(i => Number(i.produto_id)))];
        const [produtos] = await connection.query(
            `SELECT id, codigo, descricao, ncm, unidade_medida, gtin, origem, cest,
                    cfop_saida_interna, cfop_saida_interestadual, cst_icms, csosn_icms,
                    aliquota_icms, reducao_bc_icms, aliquota_credito_sn, calcular_icms_st, mva_st,
                    fcp_aliquota, cbenef,
                    cst_ipi, aliquota_ipi, calcular_ipi, cst_pis, aliquota_pis, cst_cofins, aliquota_cofins,
                    cst_reforma, classe_tributaria_cbs, classe_tributaria_ibs
             FROM produtos WHERE id IN (${produtoIds.map(() => '?').join(',')})`,
            produtoIds
        );
        const prodById = new Map(produtos.map(p => [Number(p.id), p]));

        const operacaoInterna = emitente.uf === destinatario.uf;
        // A situação confirmada pela consulta cadastral prevalece. A presença de IE
        // continua sendo fallback para cadastros legados ainda não sincronizados.
        destinatario.contribuinteICMS = pedido.cliente_contribuinte_icms == null
            ? (!!destinatario.ie && String(destinatario.ie).trim().toUpperCase() !== 'ISENTO')
            : Number(pedido.cliente_contribuinte_icms) === 1;
        const tipoVendaInformado = String(pedido.tipo_venda || '').trim();
        // O tipo de venda gravado no pedido e a fonte primaria. A IE so e fallback
        // para pedidos legados; destinatario sem IE precisa ser consumidor final
        // para manter indIEDest=9 compativel com indFinal=1.
        destinatario.consumidorFinal = tipoVendaInformado
            ? vendaEhConsumidorFinal(tipoVendaInformado) || !destinatario.contribuinteICMS
            : !destinatario.contribuinteICMS;

        // Matriz da operação por UF. A alíquota interna alimenta DIFAL/ST e a
        // interestadual é respeitada para mercadoria nacional; origem importada
        // continua sujeita aos 4% definidos pelo Senado no motor de tributos.
        let matrizDestino = null;
        try {
            const [[linha]] = await connection.query(
                `SELECT aliquota_interna, aliquota_interestadual, fcp_aliquota
                   FROM aliquotas_icms_uf
                  WHERE uf_origem = ? AND uf_destino = ?
                  ORDER BY id LIMIT 1`,
                [emitente.uf, destinatario.uf]
            );
            matrizDestino = linha || null;
        } catch (_) { /* instância antiga: o motor mantém a regra constitucional */ }

        let reformaCfg = { aliq_cbs: 0.9, aliq_ibs: 0.1, destacar: false, cst_padrao: '000', classificacao_padrao: null };
        try {
            const [[rc]] = await connection.query(
                'SELECT aliq_cbs, aliq_ibs, destacar_documentos,cst_padrao,classificacao_padrao FROM reforma_tributaria_config ORDER BY id LIMIT 1'
            );
            if (rc) reformaCfg = {
                aliq_cbs: Number(rc.aliq_cbs ?? 0.9),
                aliq_ibs: Number(rc.aliq_ibs ?? 0.1),
                destacar: !!rc.destacar_documentos,
                cst_padrao: rc.cst_padrao || '000', classificacao_padrao: rc.classificacao_padrao || null
            };
        } catch (_) { /* sem configuração: não destaca IBS/CBS */ }

        // Transportadora do pedido (para o bloco <transporta>). Best-effort: o pedido pode
        // ter só o nome digitado, sem vínculo — nesse caso o mapper emite apenas o xNome.
        // `transportadoras` não tem coluna `nome` — pedir por ela derrubava a query inteira em
        // ER_BAD_FIELD_ERROR, e o `.catch` transformava isso em "pedido sem transportadora".
        // Resultado: nota com <xNome> e mais nada, mesmo com o vínculo preenchido.
        let transportadoraRow = null;
        if (pedido.transportadora_id) {
            try {
                const [tRows] = await connection.query(
                    `SELECT razao_social, nome_fantasia, cnpj_cpf, inscricao_estadual,
                            endereco, numero, complemento, cidade, estado, fiscal_situacao
                       FROM transportadoras WHERE id = ? LIMIT 1`,
                    [pedido.transportadora_id]
                );
                transportadoraRow = (tRows && tRows[0]) || null;
            } catch (erroTransportadora) {
                console.error('[NFE-EMITTER] Falha ao resolver transportadora '
                    + `${pedido.transportadora_id}: ${erroTransportadora.message}`);
                throw new Error('Não foi possível carregar o cadastro da transportadora. Emissão interrompida: ' + erroTransportadora.message);
            }
            if (!transportadoraRow) throw new Error('Transportadora vinculada não encontrada. Corrija o pedido antes de emitir.');
        }

        // ── Fontes da regra fiscal, carregadas UMA vez para todos os itens ────────
        // O laço abaixo roda por item; consultar o banco lá dentro seria o N+1 que a
        // especificação proíbe. UF e vigências não variam de item para item, e as
        // regras de NCM cabem numa consulta só.
        const fontesFiscais = { uf: null, vigencias: [], porNcm: new Map(), porNcmUf: new Map(), cenario: null };
        try {
            const [ufRows] = await connection.query(
                'SELECT * FROM aliquotas_icms_uf WHERE uf_origem = ? AND uf_destino = ? LIMIT 1',
                [emitente.uf, destinatario.uf]);
            fontesFiscais.uf = ufRows[0] || null;

            const [vigRows] = await connection.query(
                'SELECT * FROM regras_fiscais_vigencia WHERE ativo = 1');
            fontesFiscais.vigencias = vigRows || [];

            const cenarioFiscal = pedido.cenario_fiscal_id || pedido.cenario_fiscal;
            if (cenarioFiscal) {
                const termo = String(cenarioFiscal).trim();
                const [cenarioRows] = await connection.query(
                    `SELECT * FROM cenarios_fiscais WHERE ativo = 1
                      AND (id = ? OR LOWER(codigo) = LOWER(?) OR LOWER(nome) = LOWER(?))
                      ORDER BY id LIMIT 1`,
                    [/^\d+$/.test(termo) ? Number(termo) : 0, termo, termo]);
                fontesFiscais.cenario = cenarioRows[0] || null;
                if (!fontesFiscais.cenario) {
                    const erro = new Error('Cenário fiscal do pedido não existe ou está inativo. Corrija o orçamento antes de emitir a NF-e.');
                    erro.code = 'CENARIO_FISCAL_INVALIDO'; erro.status = 422; throw erro;
                }
            }

            const normalizarNcmEmissao = valor => {
                const ncm = onlyDigits(valor);
                return ncm.length > 8 ? ncm.slice(0, 8) : ncm;
            };
            const ncms = [...new Set(itensEmissao
                .map(i => normalizarNcmEmissao((prodById.get(Number(i.produto_id)) || {}).ncm))
                .filter(Boolean))];
            if (ncms.length) {
                // O NCM e gravado em formatos diferentes na mesma base ('8544.49.00' e
                // '85444900' convivem em produtos). O lado JS normaliza com onlyDigits, que
                // remove TODO nao-digito; o SQL removia apenas o ponto, entao um NCM
                // cadastrado com hifen ou espaco ('8544-4900') nunca casava e a regra do NCM
                // era silenciosamente ignorada — os impostos caiam no cadastro do produto.
                // Os dois lados passam a normalizar igual.
                const [ncmRows] = await connection.query(
                    `SELECT * FROM regras_fiscais_ncm
                       WHERE ativo = 1
                         AND REPLACE(REPLACE(REPLACE(ncm,'.',''),'-',''),' ','')
                             IN (${ncms.map(() => '?').join(',')})`,
                    ncms);
                (ncmRows || []).forEach(r2 => fontesFiscais.porNcm.set(normalizarNcmEmissao(r2.ncm), r2));

                const [nuRows] = await connection.query(
                    `SELECT * FROM impostos_produto
                       WHERE ativo = 1 AND uf = ?
                         AND REPLACE(REPLACE(REPLACE(ncm,'.',''),'-',''),' ','')
                             IN (${ncms.map(() => '?').join(',')})`,
                    [destinatario.uf, ...ncms]);
                // Mantém TODAS as candidatas: a escolha depende também da origem e
                // do CEST do produto, portanto não pode ser "a última linha do NCM".
                (nuRows || []).forEach(r2 => {
                    const chave = normalizarNcmEmissao(r2.ncm);
                    const lista = fontesFiscais.porNcmUf.get(chave) || [];
                    lista.push(r2);
                    fontesFiscais.porNcmUf.set(chave, lista);
                });
            }
        } catch (erroFontes) {
            // As fontes abaixo determinam CST/CSOSN, CFOP, alíquotas e ST do XML.
            // Continuar apenas com o cadastro do produto torna uma falha de banco uma
            // nota potencialmente tributada de forma diversa. Falha fechada: o usuário
            // corrige a indisponibilidade e reemite, sem risco de rejeição na SEFAZ.
            if (erroFontes?.code === 'CENARIO_FISCAL_INVALIDO') throw erroFontes;
            const erro = new Error('Não foi possível carregar as regras fiscais da operação. Emissão interrompida; tente novamente ou contate o suporte.');
            erro.code = 'FONTES_FISCAIS_INDISPONIVEIS';
            erro.status = 503;
            erro.cause = erroFontes;
            console.error('[NFE-EMITTER] Fontes fiscais indisponíveis; emissão bloqueada:', erroFontes.message);
            throw erro;
        }
        const pendenciasFiscais = [];

        let recomendacoesFiscais = {};
        try {
            const empresaFiscalId = Number(pedido.empresa_id) || 1;
            const [[row]] = await connection.query(`SELECT o.opcoes_json,c.icms_desonerado_deduz_total,c.icms_desonerado_motivo FROM fiscal_recomendacoes_config c LEFT JOIN fiscal_recomendacoes_opcoes o ON o.empresa_id=c.empresa_id WHERE c.empresa_id=? LIMIT 1`, [empresaFiscalId]);
            const extras = typeof row?.opcoes_json === 'string' ? JSON.parse(row.opcoes_json) : (row?.opcoes_json || {});
            recomendacoesFiscais = {...extras,...(row||{})};
        } catch (_) { /* configuração opcional/instância em atualização */ }
        // ── O XML segue o ICMS-ST do espelho do pedido ──────────────────────────────
        // Sem modo explícito (pedidos.st_modo), a emissão decidia o ST pelas regras de
        // cadastro/NCM e podia ACRESCENTAR ST que o pedido conferido não tinha: NF-e 970 e
        // 972 da Energy (25/09/2026) — pedido de R$ 180.000 sem ST, nota autorizada com
        // R$ 46.008 de ST porque o logistica@ zerou o ST no Editar NF-e e a emissão ignorou.
        // Agora o "automático" é o que está no pedido: tem ST → calcula; não tem → não calcula.
        let modoStEfetivo = pedido && pedido.st_modo ? String(pedido.st_modo).toLowerCase() : null;
        if (!modoStEfetivo && pedidoId && !emissaoManual) {
            try {
                const [[stPed]] = await connection.query(
                    'SELECT COALESCE(SUM(valor_icms_st), 0) AS st FROM pedido_itens WHERE pedido_id = ?', [pedidoId]);
                const stEspelho = Math.max(Number(pedido.total_icms_st) || 0, Number(stPed?.st) || 0);
                modoStEfetivo = stEspelho > 0 ? 'calcular' : 'remover';
            } catch (_) { modoStEfetivo = null; }
        }
        const itensParaCalculo = itensEmissao.map((it, index) => {
            const prod = prodById.get(Number(it.produto_id));
            if (!prod) throw new Error(`Produto ${it.produto_id} não encontrado`);
            // O NCM tem 8 posicoes por definicao (NCM/SH). Quatro produtos do
            // catalogo guardam 10 digitos ("8544.49.00.01"), com sufixo interno
            // depois do NCM — as 8 primeiras posicoes SAO o NCM, e o prefixo dos
            // dois casos ja e usado por 653 e 5 produtos com NCM valido. Cortar
            // aqui nao classifica nada: le o campo no tamanho que a norma define.
            // A NF-e avulsa usa exatamente a mesma classificação do faturamento por
            // pedido. Aceitar NCM digitado no modal fazia o XML usar uma classificação
            // enquanto CST/CFOP/alíquotas eram resolvidos pelo NCM cadastrado do produto.
            const ncmBruto = onlyDigits(prod.ncm);
            const ncm = ncmBruto.length > 8 ? ncmBruto.slice(0, 8) : ncmBruto;
            if (ncmBruto.length > 8) {
                console.warn(`[NFE-EMITTER] NCM de ${ncmBruto.length} dígitos no produto ${prod.codigo || prod.id}`
                    + ` ("${ncmBruto}") reduzido às 8 posições da NCM: ${ncm}. Corrija o cadastro.`);
            }
            if (ncm.length !== 8) throw new Error(`Produto "${prod.descricao}" sem NCM válido (8 dígitos)`);
            const quantidade = Number(it.quantidade);
            if (!(quantidade > 0)) throw new Error(`Quantidade inválida para "${prod.descricao}"`);
            const valorUnitario = Number(it.valor_unitario != null ? it.valor_unitario : 0);
            if (!(valorUnitario > 0)) throw new Error(`Preço unitário inválido para "${prod.descricao}"`);

            // ── Regra fiscal resolvida pela hierarquia ────────────────────────────
            // 🔴 O que isto conserta: até aqui a alíquota de ICMS saía de
            // `prod.aliquota_icms`, que é UM número sem dimensão de operação — na
            // prática a alíquota INTERNA. Toda NF-e interestadual saía com 18% no
            // lugar dos 12% (Sul/Sudeste) ou 7% (N/NE/CO), destacando ICMS a maior.
            // Medido em 300 produtos × 5 destinos: 1.200 de 1.500 casos divergiam, e
            // os 300 corretos eram justamente os internos. O pedido #3584 (NF-e 905,
            // SP→PR) só saiu com 12% porque alguém corrigiu à mão.
            const ncmNormalizado = ncm;
            const cestProduto = onlyDigits(prod.cest);
            const candidatasNcmUf = fontesFiscais.porNcmUf.get(ncmNormalizado) || [];
            const ncmUfEspecifica = candidatasNcmUf
                .filter(regra => {
                    const origem = String(regra.uf_origem || '').trim().toUpperCase();
                    const cest = onlyDigits(regra.cest);
                    return (!origem || origem === emitente.uf) && (!cest || cest === cestProduto);
                })
                .sort((a, b) => {
                    const aOrigem = String(a.uf_origem || '').trim().toUpperCase() === emitente.uf ? 1 : 0;
                    const bOrigem = String(b.uf_origem || '').trim().toUpperCase() === emitente.uf ? 1 : 0;
                    const aCest = onlyDigits(a.cest) === cestProduto && cestProduto ? 1 : 0;
                    const bCest = onlyDigits(b.cest) === cestProduto && cestProduto ? 1 : 0;
                    return bOrigem - aOrigem || bCest - aCest || Number(b.id || 0) - Number(a.id || 0);
                })[0] || null;
            const regraItem = resolverRegraFiscal({
                produtoId: prod.id,
                ncm: onlyDigits(prod.ncm),
                ufOrigem: emitente.uf,
                ufDestino: destinatario.uf,
                operacao: 'VENDA',
                contribuinte: destinatario.contribuinteICMS,
                consumidorFinal: destinatario.consumidorFinal,
                dataOperacao: pedido.data_emissao || pedido.data_faturamento || pedido.created_at || new Date()
            }, {
                produto: prod,
                ncmUf: ncmUfEspecifica,
                ncm: fontesFiscais.porNcm.get(ncmNormalizado) || null,
                uf: fontesFiscais.uf,
                cenario: fontesFiscais.cenario,
                vigencias: fontesFiscais.vigencias
            });
            if (regraItem.pendencias.length) {
                pendenciasFiscais.push({ item: index + 1, codigo: prod.codigo, pendencias: regraItem.pendencias });
            }
            const rf = regraItem.regra;

            // O CFOP da LINHA DO PEDIDO passou a valer tambem na emissao automatica
            // (antes so no modo manual). Sem isso, um pedido gravado com 5401 (venda com
            // substituicao tributaria) saia na nota com o CFOP do CADASTRO do produto —
            // tipicamente 5102, venda comum. Foi o que aconteceu com a NF-e 919 da
            // Aluforce: pedido 3619 com CFOP 5401 e ICMS-ST de R$ 1.134,00, nota emitida
            // como 5102. Um CFOP 5102 com CST 10 e uma declaracao incoerente: o CFOP diz
            // venda comum e o CST diz operacao com substituicao tributaria.
            //
            // ⚠️ `rf.cfop` NAO e necessariamente uma regra fiscal: o resolver expoe nesse
            // mesmo campo o `cfop_saida_interna/interestadual` do CADASTRO DO PRODUTO
            // (nivel PRODUTO da hierarquia), que e so um default. Colocar a linha do
            // pedido depois de `rf.cfop` nao mudava nada — era sempre o cadastro vencendo.
            // A `trilha` devolvida pelo resolver diz qual nivel decidiu cada campo, entao
            // da para distinguir: uma regra deliberada por NCM+UF continua mandando, e o
            // default do cadastro cede para o CFOP que foi efetivamente gravado na venda.
            const nivelDoCfop = (regraItem.trilha || [])
                .find(t => Array.isArray(t.campos) && t.campos.includes('cfop'))?.nivel || null;
            const cfopVeioDoCadastro = nivelDoCfop === 'PRODUTO' || nivelDoCfop === null;
            const cfopDaLinhaBruto = it && it.cfop ? onlyDigits(it.cfop) : null;
            const cfopDaLinhaPedido = cfopDaLinhaBruto && cfopDaLinhaBruto.length === 4
                ? cfopDaLinhaBruto : null;

            const cfop = cfopOverride
                || (cfopVeioDoCadastro ? cfopDaLinhaPedido : null)
                || rf.cfop
                || cfopDaLinhaPedido
                || (operacaoInterna ? prod.cfop_saida_interna : prod.cfop_saida_interestadual);
            if (!cfopEmitido) cfopEmitido = cfop;
            if (cfopDaLinhaPedido && cfop !== cfopDaLinhaPedido) {
                console.warn(`[NFE-EMITTER] item ${index + 1} (${prod.codigo}): CFOP da linha do `
                    + `pedido (${cfopDaLinhaPedido}) preterido por ${cfop} `
                    + `(definido no nivel ${nivelDoCfop || 'cadastro'}).`);
            }

            const itemParaCalculo = {
                _index: index + 1,
                codigo: emissaoManual && it.codigo ? String(it.codigo).trim() : prod.codigo,
                descricao: emissaoManual && it.descricao ? String(it.descricao).trim() : prod.descricao,
                ncm,
                cest: rf.icmsSt.cest || prod.cest,
                cfop,
                unidade: emissaoManual && it.unidade ? String(it.unidade).trim().toUpperCase() : (prod.unidade_medida || 'UN'),
                quantidade,
                valorUnitario,
                desconto: Number(it.desconto) || 0,
                acessoriosBaseICMS: recomendacoesFiscais.acessorios_base_icms !== false,
                acessoriosBaseIPI: recomendacoesFiscais.acessorios_base_ipi !== false,
                acessoriosBasePIS: recomendacoesFiscais.acessorios_base_pis !== false,
                acessoriosBaseCOFINS: recomendacoesFiscais.acessorios_base_cofins !== false,
                descontoBaseICMS: recomendacoesFiscais.desconto_base_icms !== false,
                descontoBaseIPI: recomendacoesFiscais.desconto_base_ipi !== false,
                descontoBasePIS: recomendacoesFiscais.desconto_base_pis !== false,
                descontoBaseCOFINS: recomendacoesFiscais.desconto_base_cofins !== false,
                deduzICMSDesonerado: recomendacoesFiscais.icms_desonerado_deduz_total !== 0,
                motivoDesoneracao: it.motivo_desoneracao || recomendacoesFiscais.icms_desonerado_motivo || undefined,
                ean: prod.gtin || 'SEM GTIN',
                origem: rf.icms.origem ?? prod.origem,
                cst: rf.icms.cst || prod.cst_icms || null,
                csosn: rf.icms.csosn || prod.csosn_icms || null,
                // A alíquota resolvida MANDA. Só cai para o cadastro (e daí para o
                // padrão do emitente) quando a hierarquia inteira ficou sem resposta —
                // e nesse caso a pendência já foi registrada acima.
                aliquotaICMS: rf.icms.aliquota ?? prod.aliquota_icms ?? emitente.aliquotaICMSPadrao,
                aliquotaICMSInternaDestino: matrizDestino?.aliquota_interna ?? undefined,
                aliquotaICMSInterestadual: matrizDestino?.aliquota_interestadual ?? undefined,
                aliquotaCredito: prod.aliquota_credito_sn,
                cstPIS: rf.pis.cst || prod.cst_pis || null,
                aliquotaPIS: rf.pis.aliquota ?? prod.aliquota_pis ?? emitente.aliquotaPISPadrao,
                cstCOFINS: rf.cofins.cst || prod.cst_cofins || null,
                aliquotaCOFINS: rf.cofins.aliquota ?? prod.aliquota_cofins ?? emitente.aliquotaCOFINSPadrao,
                cstIPI: rf.ipi.cst || prod.cst_ipi || '99',
                calcularIPI: (rf.ipi.aliquota ?? prod.aliquota_ipi ?? 0) > 0,
                aliquotaIPI: rf.ipi.aliquota ?? prod.aliquota_ipi ?? 0,
                // ST atende a operacao subsequente. Uma venda explicitamente destinada
                // a consumo nao pode herdar ST de flag generica, CFOP antigo ou cadastro.
                calcularICMSST: !destinatario.consumidorFinal && (
                    !!prod.calcular_icms_st
                    || !!rf.icmsSt.ativo
                    || ['5401', '5402', '5403', '6401', '6402', '6403'].includes(cfop)
                    || Number(it.valor_icms_st || 0) > 0
                ),
                // `mvaST` (não `mva`): é o nome que CalculoTributosService.calcularICMSST lê.
                // Com a chave errada o MVA chegava zerado e o cálculo abortava com
                // "MVA nao informada" em qualquer item com ST ligado.
                //
                // A cadeia era `rf.icmsSt.mva ?? prod.mva_st ?? 0`, e o `??` so pula
                // null/undefined: uma regra por NCM cadastrada com mva_st = 0.0000 (como
                // estao TODAS as regras de 8544 hoje) vencia o cadastro do produto e
                // zerava o MVA. Pior, a linha do PEDIDO — que e onde o MVA realmente
                // usado na venda fica gravado (42,00 no pedido 3619, o que produziu os
                // R$ 1.134,00 de ST) — nunca era consultada.
                // Agora vale o primeiro valor REALMENTE informado (> 0), mantendo a
                // precedencia: regra fiscal > linha do pedido > cadastro do produto.
                // Sem isso, ligar o ST fazia a emissao abortar em "MVA nao informada".
                mvaST: [rf.icmsSt.mva, it.mva_st, prod.mva_st]
                    .map(Number)
                    .find(v => Number.isFinite(v) && v > 0) ?? 0,
                mvaJaAjustada: rf.icmsSt.mvaAjustada === true || Number(it.mva_ja_ajustada) === 1,
                aliquotaICMSST: matrizDestino?.aliquota_interna ?? undefined,
                // FCP do destino: `calcularDifal` lê `aliquotaFCPUFDestino ?? 0` e nunca
                // presume a tabela por UF. Sem repassar o cadastro do produto, o FCP
                // ficava zerado mesmo em item com `fcp_aliquota` configurada.
                // FCP do par de UF quando o produto não define — é aliquotas_icms_uf
                // que tem a alíquota por estado de destino; o produto guarda no máximo
                // a do próprio estado.
                aliquotaFCPUFDestino: rf.fcp.aliquota ?? prod.fcp_aliquota ?? matrizDestino?.fcp_aliquota ?? 0,
                aliquotaFCPST: rf.fcp.aliquota ?? prod.fcp_aliquota ?? matrizDestino?.fcp_aliquota ?? 0,
                // Uma remessa pode usar benefício próprio da operação sem alterar o
                // cadastro global do produto (que também participa de vendas comuns).
                // O valor explícito do item prevalece; o cadastro continua como fallback.
                codigoBeneficioFiscal: it.codigo_beneficio_fiscal || it.cbenef || prod.cbenef || null,
                cstReforma: prod.cst_reforma || reformaCfg.cst_padrao || '000',
                classeTributariaCBS: reformaCfg.destacar ? (prod.classe_tributaria_cbs || reformaCfg.classificacao_padrao || null) : null,
                classeTributariaIBS: reformaCfg.destacar ? (prod.classe_tributaria_ibs || reformaCfg.classificacao_padrao || null) : null,
                aliquotaCBS: reformaCfg.aliq_cbs,
                aliquotaIBSUF: reformaCfg.aliq_ibs,
                aliquotaIBSMun: 0,
                reducaoBC: rf.icms.reducaoBase ?? prod.reducao_bc_icms ?? 0
            };
            aplicarModoStDoPedido(itemParaCalculo, modoStEfetivo);
            // Se o espelho traz ST positivo, CST 00 é estruturalmente impossível:
            // ele não possui vBCST/vICMSST e a SEFAZ rejeita o total com cStat 533.
            aplicarPerfilCfop(itemParaCalculo, emitente.regimeTributario, emitente.uf);
            garantirCstCompativelComSt(itemParaCalculo, pedido, emitente.regimeTributario);
            if (itemParaCalculo.calcularICMSST && !onlyDigits(itemParaCalculo.cest)) {
                const erro = new Error(`Item ${index + 1} (${itemParaCalculo.codigo}) sujeito a ICMS-ST sem CEST. `
                    + 'Cadastre a classificação fiscal antes de faturar; o sistema não pode inventar o CEST.');
                erro.code = 'CEST_OBRIGATORIO_ST';
                erro.status = 422;
                throw erro;
            }
            return itemParaCalculo;
        });
        naturezaOperacao = cortarNaturezaOperacao(
            resolverNaturezaOperacao(itensParaCalculo.map(item => item.cfop), naturezaOperacao)
        );

        if (pendenciasFiscais.length) {
            console.warn(`[NFE-EMITTER] ${pendenciasFiscais.length} item(ns) com pendência fiscal:`,
                JSON.stringify(pendenciasFiscais));
            const criticas = pendenciasFiscais.flatMap(p => p.pendencias
                .filter(x => x.critico)
                .map(x => `Item ${p.item} (${p.codigo}): ${x.mensagem}`));
            if (criticas.length) {
                const erro = new Error('Emissão bloqueada por pendências fiscais críticas:\n' + criticas.join('\n'));
                erro.code = 'PENDENCIA_FISCAL_CRITICA'; erro.status = 422; throw erro;
            }
        }

        // Frete/seguro/outras despesas são de CABEÇALHO no pedido, mas a NF-e os quer por
        // item — é da soma deles que sai o <vFrete> do total. Sem este rateio o vFrete saía
        // 0,00 mesmo com frete cobrado. Tem de rodar ANTES do cálculo dos tributos, porque
        // eles entram na base (vProd - vDesc + vFrete + vSeg + vOutro).
        NFePedidoMapper.ratearDespesasNosItens(itensParaCalculo, pedido);

        const itensCalculados = itensParaCalculo.map(itemParaCalculo =>
            CalculoTributosService.calcularTributosItem(
                itemParaCalculo, emitente, destinatario, naturezaOperacao
            )
        );

        // O cabeçalho não pode sobrescrever a tributação resolvida por item.
        // Divergências do espelho cheio precisam ser conferidas antes da emissão.
        if (!emissaoManual) {
            const [[somaPedido]] = await connection.query(
                'SELECT COALESCE(SUM(quantidade * preco_unitario), 0) AS valor_produtos FROM pedido_itens WHERE pedido_id = ?',
                [pedidoId]
            );
            aplicarTotaisFiscaisDoPedido(pedido, itensCalculados, somaPedido?.valor_produtos, { conferirEspelho: true });
        }

        validarAritmeticaFiscal(itensCalculados);
        const totais = CalculoTributosService.aplicarSomatoriosImportacao(
            CalculoTributosService.calcularTotaisNFe(itensCalculados), recomendacoesFiscais,
            itensParaCalculo.map(item => item.cfop)
        );
        valorTotal = round2(totais.valorTotal);

        // Cadastro irregular interrompe antes de reservar numeração ou criar outra nota.
        if (transmitir) await require('./nfe-cadastro-preflight').validarAntesTransmissao('', {
            pemCert: certificadoService.getCertificadoPEM(), pemKey: certificadoService.getChavePrivadaPEM()
        }, { dados: { ambiente: String(nfeConfig.ambiente), destinatario,
            transporte: NFePedidoMapper.mapearTransporte(pedido, transportadoraRow) } });

        // CST × cBenef incoerente rejeita na certeza (928/930/931 — foi o que aconteceu
        // repetidamente no pedido 3628/BRMAX). Checar aqui, ainda antes de reservar
        // numeração, poupa números de NF-e queimados em tentativas fadadas a rejeitar.
        {
            const { validarConsistenciaFiscalItens } = require('./nfe-cadastro-preflight');
            // MUTA itensParaCalculo somente em correções estruturais determinísticas.
            // CST, CSOSN e enquadramento fiscal nunca são trocados automaticamente.
            const { problemas, avisos, correcoes } = validarConsistenciaFiscalItens(itensParaCalculo);
            correcoes.forEach(c => console.warn('[NFE-EMITTER][CBENEF][AUTOCORRIGIDO]', c));
            avisos.forEach(a => console.warn('[NFE-EMITTER][CBENEF]', a));
            if (problemas.length) {
                const erro = new Error('Cadastro fiscal inconsistente — corrija antes de faturar:\n' + problemas.join('\n'));
                erro.code = 'CST_BENEFICIO_INCONSISTENTE';
                erro.status = 422;
                throw erro;
            }
        }

        // 4. Reservar número + gravar nfes
        //
        // REGERAÇÃO (`regerarNfeId`): a meia-nota emitida por este caminho não tinha como
        // ser corrigida. `gerar-nfe` do módulo de Faturamento sabe regerar, mas desconhece
        // o percentual do faturamento parcial e refaria a nota INTEIRA; e re-emitir aqui
        // queimava um número novo, deixando o anterior pendente e exigindo inutilização
        // junto à SEFAZ. Com esta opção o MESMO número é reaproveitado: os itens e o XML
        // são refeitos sobre os dados atuais e sobrescrevem a nota existente.
        //
        // Só vale para nota que a SEFAZ nunca autorizou (sem protocolo). Nota autorizada
        // ou cancelada é documento fiscal definitivo e não se reescreve.
        let regerandoRow = null;
        if (regerarNfeId) {
            const [[row]] = await connection.query(
                `SELECT id, numero, serie, status, protocolo_autorizacao, chave_acesso, pedido_id
                   FROM nfes WHERE id = ? FOR UPDATE`, [regerarNfeId]);
            if (!row) throw new Error(`NF-e ${regerarNfeId} não encontrada para regeração.`);
            if (row.protocolo_autorizacao) {
                throw new Error(`NF-e ${row.numero} já foi autorizada pela SEFAZ (protocolo `
                    + `${row.protocolo_autorizacao}) e não pode ser regerada. Use cancelamento ou CC-e.`);
            }
            const statusRegeravel = ['pendente', 'rejeitada', 'erro', 'processando'];
            if (!statusRegeravel.includes(String(row.status || '').toLowerCase())) {
                throw new Error(`NF-e ${row.numero} está em status "${row.status}" e não pode ser regerada.`);
            }
            if (!emissaoManual && Number(row.pedido_id) !== Number(pedidoId)) {
                throw new Error(`NF-e ${row.numero} pertence ao pedido ${row.pedido_id}, não ao ${pedidoId}.`);
            }
            regerandoRow = row;
            nfeId = row.id;
            proximoNumero = parseInt(row.numero, 10);
            serieConfig = row.serie;
            // Os itens antigos saem: sem isso `nfe_itens` ficaria com as duas versões e
            // os relatórios fiscais passariam a contar o dobro.
            await connection.query('DELETE FROM nfe_itens WHERE nfe_id = ?', [nfeId]);
            console.warn(`[NFE-EMITTER] Regerando NF-e ${row.numero}/${row.serie} (id ${row.id}) `
                + `do pedido ${pedidoId} — número preservado, XML e itens serão sobrescritos.`);
        } else {
            const nfNumero = await faturamentoShared.gerarProximoNumeroNFe(connection);
            proximoNumero = parseInt(nfNumero.numero, 10);
            serieConfig = nfNumero.serie;
        }

        const [nfe] = regerandoRow ? [{ insertId: nfeId }] : await connection.query(`
            INSERT INTO nfes (
                pedido_id, numero, serie, modelo, tipo_emissao, finalidade, natureza_operacao,
                cliente_id, destinatario_nome, destinatario_cnpj_cpf, destinatario_endereco,
                destinatario_cidade, destinatario_uf, destinatario_cep,
                valor_produtos, valor_frete, valor_desconto, base_calculo_icms,
                valor_icms, valor_ipi, valor_pis, valor_cofins, valor_total,
                base_calculo_icms_st, valor_icms_st, valor_fcp, valor_fcp_st, cfop,
                status, data_emissao, usuario_id, created_at
            ) VALUES (?, ?, ?, '55', 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendente', NOW(), ?, NOW())
        `, [
            emissaoManual ? null : pedidoId, proximoNumero, serieConfig, String(finalidade || '1'), naturezaOperacao,
            pedido.cliente_id, destinatario.nome, destinatario.cnpj || destinatario.cpf,
            destinatario.logradouro, destinatario.municipio, destinatario.uf, destinatario.cep,
            totais.valorProdutos, totais.valorFrete, totais.valorDesconto, totais.baseCalculoICMS,
            totais.valorICMS, totais.valorIPI, totais.valorPIS, totais.valorCOFINS, valorTotal,
            // ST/FCP no cabecalho: sem isto o total da nota incluia o ST (vNF) mas o ERP
            // nao sabia dizer quanto dele era ST.
            totais.baseCalculoST || 0, totais.valorST || 0,
            totais.valorFCP || 0, totais.valorFCPST || 0,
            // `nfes.cfop` existia e nunca era preenchido — a listagem e os relatórios
            // fiscais mostravam a coluna vazia mesmo com o CFOP correto no XML.
            cfopEmitido || null,
            usuarioId
        ]);
        nfeId = nfe.insertId;

        // Regerando: o INSERT acima foi pulado, então os totais do cabeçalho seriam os
        // ANTIGOS. Como a regeração existe justamente para corrigir valores, eles têm de
        // acompanhar. O status volta a 'pendente' porque a nota será transmitida de novo,
        // e o retorno anterior da SEFAZ (rejeição) deixa de valer.
        if (regerandoRow) {
            await connection.query(`
                UPDATE nfes
                   SET valor_produtos = ?, valor_frete = ?, valor_desconto = ?,
                       base_calculo_icms = ?, valor_icms = ?, valor_ipi = ?,
                       valor_pis = ?, valor_cofins = ?, valor_total = ?,
                       base_calculo_icms_st = ?, valor_icms_st = ?,
                       valor_fcp = ?, valor_fcp_st = ?,
                       destinatario_nome = ?, destinatario_cnpj_cpf = ?,
                       destinatario_endereco = ?, destinatario_cidade = ?, destinatario_uf = ?,
                       destinatario_cep = ?, natureza_operacao = ?, cfop = ?,
                       status = 'pendente',
                       sefaz_codigo_status = NULL, sefaz_motivo = NULL, sefaz_tipo_retorno = NULL
                 WHERE id = ?
            `, [
                totais.valorProdutos, totais.valorFrete, totais.valorDesconto, totais.baseCalculoICMS,
                totais.valorICMS, totais.valorIPI, totais.valorPIS, totais.valorCOFINS, valorTotal,
                totais.baseCalculoST || 0, totais.valorST || 0,
                totais.valorFCP || 0, totais.valorFCPST || 0,
                destinatario.nome, destinatario.cnpj || destinatario.cpf,
                destinatario.logradouro, destinatario.municipio, destinatario.uf,
                destinatario.cep, naturezaOperacao, cfopEmitido || null,
                nfeId
            ]);
        }

        for (let i = 0; i < itensCalculados.length; i++) {
            const itemCalc = itensCalculados[i];
            const it = itensEmissao[i];
            const prod = prodById.get(Number(it.produto_id));
            const itemFiscal = itensParaCalculo[i];
            await connection.query(`
                INSERT INTO nfe_itens (
                    nfe_id, produto_id, codigo_produto, descricao, ncm, unidade,
                    quantidade, valor_unitario, valor_total, valor_desconto,
                    base_calculo_icms, valor_icms, aliquota_icms, valor_ipi, valor_pis, valor_cofins,
                    cfop, cst_icms, csosn_icms,
                    base_calculo_icms_st, valor_icms_st, aliquota_icms_st, mva_st,
                    valor_fcp, valor_fcp_st
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                nfeId, prod.id, itemFiscal.codigo, itemFiscal.descricao, itemFiscal.ncm,
                itemFiscal.unidade, Number(it.quantidade), Number(it.valor_unitario),
                itemCalc.totais.valorBruto, itemCalc.totais.valorDesconto || 0,
                itemCalc.icms.baseCalculo || 0, itemCalc.icms.valorICMS || 0, itemCalc.icms.aliquota || 0,
                itemCalc.ipi.valorIPI || 0, itemCalc.pis.valorPIS || 0, itemCalc.cofins.valorCOFINS || 0,
                // CFOP/CST/ST do item: o que vai no XML passa a ficar gravado tambem.
                // Antes o `cfop` da nota ficava NULL e o ST nao tinha coluna nenhuma —
                // era impossivel conferir uma nota com ST sem abrir o XML. (NF-e 919)
                itemFiscal.cfop || null,
                itemCalc.icms.cst || null,
                itemCalc.icms.csosn || null,
                itemCalc.icms.baseCalculoST || 0,
                itemCalc.icms.valorICMSST || 0,
                itemCalc.icms.aliquotaST || 0,
                itemCalc.icms.mvaST || 0,
                itemCalc.icms.valorFCP || 0,
                itemCalc.icms.valorFCPST || 0
            ]);
        }

        // 5. Gerar XML
        const estadoConfig = nfeConfig.estados[emitente.uf];
        if (!estadoConfig?.codigo) throw new Error(`UF do emitente sem código fiscal: ${emitente.uf}`);
        const dadosNFe = {
            codigoUF: estadoConfig.codigo,
            naturezaOperacao,
            modelo: '55',
            serie: String(serieConfig),
            numeroNFe: proximoNumero,
            dataEmissao: new Date(),
            dataSaida: new Date(),
            tipoOperacao: String(tipoOperacao || '1'),
            tipoEmissao: '1',
            ambiente: emitente.ambiente,
            finalidade: String(finalidade || '1'),
            // `nfRef` explícito (devolução, MDF-e, etc.) + as chaves do modal "Notas ou
            // Cupons Relacionados" do pedido — as duas fontes podem coexistir na mesma nota.
            nfRef: [
                ...(Array.isArray(nfRef) ? nfRef : (nfRef ? [nfRef] : [])),
                ...NFePedidoMapper.mapearNotasReferenciadas(pedido)
            ],
            consumidorFinal: destinatario.consumidorFinal ? '1' : '0',
            indicadorPresenca: indicadorPresenca != null ? String(indicadorPresenca) : NFePedidoMapper.mapearIndicadorPresenca(pedido),
            emitente,
            destinatario,
            itens: itensCalculados,
            totais,
            // Transporte, cobrança e infCpl saem do MESMO mapper que alimenta o espelho —
            // antes liam `modalidade_frete` e `observacoes_nfe`, colunas que a tela nunca
            // escreve, então a nota saía sem transportadora, sem volumes, sem duplicatas e
            // com o campo "Dados Adicionais" vazio.
            transporte: NFePedidoMapper.mapearTransporte(pedido, transportadoraRow),
            // O ST DESTA nota (não o do pedido) decide quanto vai na 1ª duplicata.
            // Em meia nota os dois diferem — ver concentrarStNaPrimeira (NF-e 919).
            cobranca: semCobranca ? null : NFePedidoMapper.mapearCobranca(pedido, valorTotal, proximoNumero,
                {
                    icmsSt: totais.valorST || 0,
                    cfops: itensCalculados.map(item => item.item && item.item.cfop)
                }),
            pagamento: [{ forma: semCobranca ? '90' : (pedido.forma_pagamento || '01'), valor: semCobranca ? 0 : valorTotal }],
            informacoesAdicionais: NFePedidoMapper.mapearInformacoesAdicionais(pedido),
            // <entrega>/<retirada> — endereços alternativos do modal do pedido.
            entrega: NFePedidoMapper.mapearEnderecoEntrega(pedido),
            retirada: NFePedidoMapper.mapearEnderecoRetirada(pedido)
        };
        // <agropecuario> é por item no XSD, mas o modal do pedido só guarda um conjunto —
        // aplicado a todos os itens da nota quando presente. `null` não altera nada
        // (adicionarItem só emite o grupo quando o item carrega esse campo).
        const agropecuario = NFePedidoMapper.mapearAgropecuario(pedido);
        if (agropecuario) {
            itensCalculados.forEach(item => { item.agropecuario = agropecuario; });
        }
        const resultadoXml = XmlNFeService.gerarXML(dadosNFe);
        xmlNfe = resultadoXml.xml;
        chaveAcesso = resultadoXml.chaveAcesso;
        // Obrigatoriedade da categoria conferida no XML final e DENTRO da transação: se faltar
        // campo, o rollback devolve o número reservado em vez de queimá-lo. Rascunho
        // (transmitir=false) segue livre para ser corrigido e só é barrado ao enviar.
        if (transmitir) {
            const obrigatoriedade = require('./nfe-obrigatoriedade.service');
            const conferencia = obrigatoriedade.validarXml(xmlNfe);
            if (!conferencia.ok) throw obrigatoriedade.erroObrigatoriedade(conferencia);
        }
        await connection.query(
            `UPDATE nfes SET xml_nfe = ?, chave_acesso = ?, emitente_uf = ?, emitente_cnpj = ? WHERE id = ?`,
            [xmlNfe, chaveAcesso, emitente.uf, onlyDigits(emitente.cnpj), nfeId]
        );

        // Regerando: a chave MUDA (o dhEmi entra na composição) e o CFOP pode ter mudado.
        // O registro do faturamento parcial guarda os dois; sem atualizar, a meia-nota
        // continuaria apontando para uma chave que não existe mais e para o CFOP anterior
        // à correção — foi o que aconteceu com a NF-e 919 (apontava para 5102 e para a
        // chave da versão rejeitada).
        if (regerandoRow && !emissaoManual) {
            await connection.query(
                `UPDATE pedido_faturamentos
                    SET nfe_chave = ?, nfe_cfop = COALESCE(?, nfe_cfop)
                  WHERE pedido_id = ? AND nfe_numero = ?`,
                [chaveAcesso || null, cfopEmitido || null, pedidoId, String(proximoNumero)]
            ).catch(err => {
                // Instalação sem a tabela de faturamento parcial não pode derrubar a emissão.
                if (err.code !== 'ER_NO_SUCH_TABLE') throw err;
            });
        }

        await connection.commit();
    } catch (error) {
        await connection.rollback().catch(() => {});
        connection.release();
        throw error;
    }
    connection.release();

    // 6. Transmitir à SEFAZ (fora da transação — sem locks)
    if (!transmitir) {
        return {
            nfeId, numero: proximoNumero, serie: serieConfig, chaveAcesso,
            cfop: cfopEmitido, valorTotal, autorizado: false, codigoStatus: null,
            motivo: 'Não transmitida (transmitir=false)', protocolo: null, status: 'pendente'
        };
    }

    // Log de não repúdio (usuário + categoria + horário) ANTES de assinar/transmitir.
    // Fora do try abaixo de propósito: falha de auditoria não é falha da SEFAZ e não deve
    // marcar a nota como 'erro' — ela fica 'pendente' e pode ser reenviada.
    const envioGate = require('./nfe-envio-gate.service');
    const autorizacaoEnvio = await envioGate.autorizarEnvio(pool, xmlNfe, {
        auditoria: auditoriaEnvio || undefined, usuarioId, empresaId: empresaId || undefined, valorTotal,
        nfe: { id: nfeId, pedido_id: emissaoManual ? null : pedidoId, numero: proximoNumero, serie: serieConfig, chave_acesso: chaveAcesso }
    });

    try {
        const xmlAssinado = await certificadoService.assinarXML(xmlNfe, 'infNFe');
        await pool.query(`UPDATE nfes SET status = 'processando', xml_assinado = ? WHERE id = ?`, [xmlAssinado, nfeId]);

        const resultado = await sefazService.autorizarNFe(xmlAssinado, emitente.uf);

        if (resultado.autorizado) {
            const autorizacaoParams = [
                resultado.numeroProtocolo,
                resultado.xmlCompleto,
                usuarioId,
                Number(nfeConfig.ambiente) === 1 ? 'producao' : 'homologacao',
                nfeId
            ];
            await pool.query(`
                UPDATE nfes SET status = 'autorizada', protocolo_autorizacao = ?,
                    data_autorizacao = NOW(), xml_protocolo = ?, autorizado_por = ?,
                    sefaz_codigo_status = NULL, sefaz_motivo = NULL,
                    sefaz_data_retorno = NOW(), sefaz_ambiente = ?,
                    sefaz_tipo_retorno = 'autorizacao'
                WHERE id = ?
            `, autorizacaoParams).catch(async error => {
                // Compatibilidade com instalações que ainda não executaram o ensure das
                // colunas de retorno: nunca transformar uma autorização real em erro local.
                if (error.code !== 'ER_BAD_FIELD_ERROR') throw error;
                await pool.query(`
                    UPDATE nfes SET status = 'autorizada', protocolo_autorizacao = ?,
                        data_autorizacao = NOW(), xml_protocolo = ?, autorizado_por = ?
                    WHERE id = ?
                `, [resultado.numeroProtocolo, resultado.xmlCompleto, usuarioId, nfeId]);
            });
        } else {
            await pool.query(`
                UPDATE nfes
                   SET status = 'rejeitada', sefaz_codigo_status = ?, sefaz_motivo = ?,
                       sefaz_data_retorno = NOW(), sefaz_ambiente = ?, sefaz_tipo_retorno = 'rejeicao'
                 WHERE id = ?
            `, [
                String(resultado.codigoStatus || 'SEFAZ_REJEITADA').slice(0, 40),
                String(resultado.motivo || 'NF-e rejeitada sem motivo detalhado').slice(0, 500),
                Number(nfeConfig.ambiente) === 1 ? 'producao' : 'homologacao',
                nfeId
            ]).catch(async error => {
                if (error.code !== 'ER_BAD_FIELD_ERROR') throw error;
                await pool.query(`UPDATE nfes SET status = 'rejeitada' WHERE id = ?`, [nfeId]);
            });
        }

        await envioGate.registrarDesfecho(pool, autorizacaoEnvio,
            resultado.autorizado ? envioGate.EVENTOS.AUTORIZADA : envioGate.EVENTOS.REJEITADA,
            { codigo: resultado.autorizado ? '100' : resultado.codigoStatus,
              motivo: resultado.autorizado ? `Protocolo ${resultado.numeroProtocolo}` : resultado.motivo });

        // Rollback automático do faturamento quando a SEFAZ rejeitou em definitivo. O
        // serviço nunca lança: se recusar (título recebido, parcial, resultado incerto...) o
        // pedido segue como estava e o motivo vai em `rollback`, sem mascarar a rejeição.
        let rollback = null;
        if (!resultado.autorizado && reverterFaturamentoAoFalhar) {
            rollback = await require('./nfe-rollback.service').aoRejeitar(pool, nfeId, {
                usuario: { id: usuarioId }, req: require('./request-context').currentRequest()
            });
        }

        // Autorizada: liga a nota aos recebíveis do pedido. Roda FORA da transação e
        // depois do UPDATE de status, de propósito — a nota já existe na SEFAZ, e o
        // vínculo é rastreabilidade: falhar aqui não pode derrubar a emissão.
        // Sem isto o título fica sem número de NF e o usuário não o encontra (foi o
        // caso da NF-e 905 / pedido #3584).
        if (resultado.autorizado && pedidoId) {
            try {
                const vinculo = await faturamentoShared.vincularNfeAutorizada(pool, {
                    pedidoId, nfeId, numero: proximoNumero, serie: serieConfig, dataEmissao: new Date()
                });
                console.log(`[NFE-EMITTER] NF-e ${proximoNumero} vinculada ao pedido ${pedidoId}: `
                    + `${vinculo.titulos} título(s), ${vinculo.faturamentos} faturamento(s)`);
            } catch (erroVinculo) {
                console.error('[NFE-EMITTER] Falha ao vincular NF-e aos recebíveis:', erroVinculo.message);
            }
        }

        return {
            nfeId, numero: proximoNumero, serie: serieConfig, chaveAcesso,
            cfop: cfopEmitido, valorTotal,
            autorizado: !!resultado.autorizado,
            codigoStatus: resultado.codigoStatus,
            motivo: resultado.motivo,
            protocolo: resultado.numeroProtocolo || null,
            status: resultado.autorizado ? 'autorizada' : 'rejeitada',
            rollback
        };
    } catch (error) {
        // Persiste o último erro para que a aba "Retorno SEFAZ" continue útil após reload.
        await pool.query(`
            UPDATE nfes
               SET status = 'erro', sefaz_codigo_status = 'SEFAZ_ERRO', sefaz_motivo = ?,
                   sefaz_data_retorno = NOW(), sefaz_ambiente = ?, sefaz_tipo_retorno = 'comunicacao'
             WHERE id = ?
        `, [
            String(error.message || 'Falha na transmissão SEFAZ').slice(0, 500),
            Number(nfeConfig.ambiente) === 1 ? 'producao' : 'homologacao',
            nfeId
        ]).catch(() => pool.query(`UPDATE nfes SET status = 'erro' WHERE id = ?`, [nfeId]).catch(() => {}));
        const e = new Error(`Falha na transmissão SEFAZ: ${error.message}`);
        e.nfeId = nfeId; e.chaveAcesso = chaveAcesso;
        throw e;
    }
}

module.exports = { emitirNFePedido };
