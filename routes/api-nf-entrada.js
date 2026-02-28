// =================================================================
// ROTAS API NF ENTRADA - ALUFORCE v2.0
// CRUD + Importação XML + Escrituração + Créditos Fiscais
// =================================================================
'use strict';

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Multer para upload de XML
const xmlUpload = multer({
    dest: path.join(__dirname, '..', 'uploads', 'xml-entrada'),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'text/xml' || file.originalname.endsWith('.xml')) {
            cb(null, true);
        } else {
            cb(new Error('Apenas arquivos XML são aceitos'), false);
        }
    }
});

function createNFEntradaRouter(pool, authenticateToken) {

    // ============================================================
    // LISTAR NF DE ENTRADA
    // ============================================================

    /**
     * GET /api/nf-entrada
     * Lista notas fiscais de entrada com filtros
     */
    router.get('/', authenticateToken, async (req, res) => {
        try {
            const { status, fornecedor, data_inicio, data_fim, pagina = 1, limite = 50 } = req.query;
            let query = `
                SELECT id, chave_acesso, numero_nfe, serie, 
                    fornecedor_cnpj, fornecedor_razao_social, fornecedor_uf,
                    valor_total, valor_icms, valor_ipi, valor_pis, valor_cofins,
                    credito_icms, credito_pis, credito_cofins,
                    data_emissao, data_entrada, status, manifestacao_status,
                    natureza_operacao, cfop_principal
                FROM nf_entrada WHERE 1=1
            `;
            const params = [];

            if (status) {
                query += ' AND status = ?';
                params.push(status);
            }
            if (fornecedor) {
                query += ' AND (fornecedor_cnpj LIKE ? OR fornecedor_razao_social LIKE ?)';
                params.push(`%${fornecedor}%`, `%${fornecedor}%`);
            }
            if (data_inicio) {
                query += ' AND data_emissao >= ?';
                params.push(data_inicio);
            }
            if (data_fim) {
                query += ' AND data_emissao <= ?';
                params.push(data_fim + ' 23:59:59');
            }

            // Contagem total
            const countQuery = query.replace(/SELECT .+ FROM/, 'SELECT COUNT(*) as total FROM');
            const [countRows] = await pool.query(countQuery, params);
            const total = countRows[0].total;

            query += ' ORDER BY data_emissao DESC LIMIT ? OFFSET ?';
            params.push(parseInt(limite), (parseInt(pagina) - 1) * parseInt(limite));

            const [rows] = await pool.query(query, params);

            res.json({ total, pagina: parseInt(pagina), limite: parseInt(limite), notas: rows });
        } catch (error) {
            console.error('❌ Erro ao listar NF entrada:', error);
            res.status(500).json({ error: 'Erro ao listar notas de entrada' });
        }
    });

    // ============================================================
    // DETALHES DE UMA NF DE ENTRADA
    // ============================================================

    /**
     * GET /api/nf-entrada/:id
     * Retorna NF de entrada com todos os itens
     */
    router.get('/:id', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const [notas] = await pool.query('SELECT * FROM nf_entrada WHERE id = ?', [id]);
            if (notas.length === 0) {
                return res.status(404).json({ error: 'NF de entrada não encontrada' });
            }

            const [itens] = await pool.query(
                'SELECT * FROM nf_entrada_itens WHERE nf_entrada_id = ? ORDER BY numero_item',
                [id]
            );

            res.json({ ...notas[0], itens });
        } catch (error) {
            console.error('❌ Erro ao buscar NF entrada:', error);
            res.status(500).json({ error: 'Erro ao buscar nota de entrada' });
        }
    });

    // ============================================================
    // IMPORTAR XML
    // ============================================================

    /**
     * POST /api/nf-entrada/importar-xml
     * Importa NF-e de entrada a partir de arquivo XML
     */
    router.post('/importar-xml', authenticateToken, xmlUpload.single('xml'), async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({ error: 'Arquivo XML é obrigatório' });
            }

            const xmlContent = fs.readFileSync(req.file.path, 'utf8');
            const resultado = await processarXMLEntrada(pool, xmlContent, req.user.id);

            // Limpar arquivo temporário
            fs.unlinkSync(req.file.path);

            res.json(resultado);
        } catch (error) {
            console.error('❌ Erro ao importar XML:', error);
            if (req.file && fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }
            res.status(500).json({ error: 'Erro ao importar XML: ' + error.message });
        }
    });

    /**
     * POST /api/nf-entrada/importar-xml-texto
     * Importa NF-e a partir de XML como texto no body
     */
    router.post('/importar-xml-texto', authenticateToken, async (req, res) => {
        try {
            const { xml } = req.body;
            if (!xml) {
                return res.status(400).json({ error: 'Conteúdo XML é obrigatório' });
            }
            const resultado = await processarXMLEntrada(pool, xml, req.user.id);
            res.json(resultado);
        } catch (error) {
            console.error('❌ Erro ao importar XML:', error);
            res.status(500).json({ error: 'Erro ao importar XML: ' + error.message });
        }
    });

    // ============================================================
    // ESCRITURAÇÃO
    // ============================================================

    /**
     * PUT /api/nf-entrada/:id/escriturar
     * Marca a NF como escriturada e calcula créditos fiscais
     */
    router.put('/:id/escriturar', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const [notas] = await pool.query('SELECT * FROM nf_entrada WHERE id = ?', [id]);
            if (notas.length === 0) {
                return res.status(404).json({ error: 'NF não encontrada' });
            }
            if (notas[0].status === 'escriturada') {
                return res.status(400).json({ error: 'NF já escriturada' });
            }

            // Buscar regime da empresa para determinar créditos
            const [config] = await pool.query('SELECT regime_tributario, crt FROM empresa_config WHERE id = 1');
            const regime = config[0]?.regime_tributario || 'simples';
            const crt = config[0]?.crt || 1;

            // Calcular créditos baseado no regime
            const [itens] = await pool.query('SELECT * FROM nf_entrada_itens WHERE nf_entrada_id = ?', [id]);
            let creditoICMS = 0, creditoIPI = 0, creditoPIS = 0, creditoCOFINS = 0;

            for (const item of itens) {
                // ICMS: crédito para Regime Normal (CRT 3)
                if (crt === 3 && item.valor_icms > 0) {
                    const cstCredito = ['00', '10', '20', '70'];
                    if (cstCredito.includes(item.cst_icms)) {
                        creditoICMS += parseFloat(item.valor_icms) || 0;
                    }
                }

                // IPI: crédito para indústria (Regime Normal)
                if (crt === 3 && item.valor_ipi > 0) {
                    creditoIPI += parseFloat(item.valor_ipi) || 0;
                }

                // PIS/COFINS: crédito no não-cumulativo (Regime Normal)
                if (crt === 3) {
                    const cstCreditoPISCOFINS = ['01', '02', '50', '51', '52', '53', '54', '55', '56'];
                    if (cstCreditoPISCOFINS.includes(item.cst_pis)) {
                        creditoPIS += parseFloat(item.valor_pis) || 0;
                    }
                    if (cstCreditoPISCOFINS.includes(item.cst_cofins)) {
                        creditoCOFINS += parseFloat(item.valor_cofins) || 0;
                    }
                }

                // Atualizar créditos no item
                await pool.query(`
                    UPDATE nf_entrada_itens SET
                        credito_icms = ?, credito_ipi = ?, credito_pis = ?, credito_cofins = ?
                    WHERE id = ?
                `, [
                    crt === 3 ? (parseFloat(item.valor_icms) || 0) : 0,
                    crt === 3 ? (parseFloat(item.valor_ipi) || 0) : 0,
                    crt === 3 ? (parseFloat(item.valor_pis) || 0) : 0,
                    crt === 3 ? (parseFloat(item.valor_cofins) || 0) : 0,
                    item.id
                ]);
            }

            // Atualizar NF com créditos totais
            await pool.query(`
                UPDATE nf_entrada SET
                    status = 'escriturada',
                    data_escrituracao = NOW(),
                    escriturado_por = ?,
                    credito_icms = ?,
                    credito_ipi = ?,
                    credito_pis = ?,
                    credito_cofins = ?
                WHERE id = ?
            `, [req.user.id, creditoICMS, creditoIPI, creditoPIS, creditoCOFINS, id]);

            res.json({
                success: true,
                message: 'NF escriturada com sucesso',
                creditos: {
                    regime,
                    crt,
                    icms: creditoICMS,
                    ipi: creditoIPI,
                    pis: creditoPIS,
                    cofins: creditoCOFINS,
                    total: creditoICMS + creditoIPI + creditoPIS + creditoCOFINS
                }
            });
        } catch (error) {
            console.error('❌ Erro ao escriturar NF:', error);
            res.status(500).json({ error: 'Erro ao escriturar: ' + error.message });
        }
    });

    // ============================================================
    // RESUMO / DASHBOARD
    // ============================================================

    /**
     * GET /api/nf-entrada/resumo/periodo
     * Resumo de entradas por período (para SPED e livros fiscais)
     */
    router.get('/resumo/periodo', authenticateToken, async (req, res) => {
        try {
            const { mes, ano } = req.query;
            const mesRef = parseInt(mes) || new Date().getMonth() + 1;
            const anoRef = parseInt(ano) || new Date().getFullYear();

            const [resumo] = await pool.query(`
                SELECT 
                    COUNT(*) as total_notas,
                    SUM(valor_total) as total_valor,
                    SUM(valor_icms) as total_icms,
                    SUM(valor_ipi) as total_ipi,
                    SUM(valor_pis) as total_pis,
                    SUM(valor_cofins) as total_cofins,
                    SUM(credito_icms) as total_credito_icms,
                    SUM(credito_ipi) as total_credito_ipi,
                    SUM(credito_pis) as total_credito_pis,
                    SUM(credito_cofins) as total_credito_cofins,
                    COUNT(CASE WHEN status = 'escriturada' THEN 1 END) as escrituradas,
                    COUNT(CASE WHEN status = 'importada' THEN 1 END) as pendentes
                FROM nf_entrada
                WHERE MONTH(data_emissao) = ? AND YEAR(data_emissao) = ?
                    AND status != 'cancelada'
            `, [mesRef, anoRef]);

            res.json({
                periodo: { mes: mesRef, ano: anoRef },
                ...resumo[0]
            });
        } catch (error) {
            console.error('❌ Erro ao gerar resumo:', error);
            res.status(500).json({ error: 'Erro ao gerar resumo' });
        }
    });

    return router;
}

// ============================================================
// PROCESSAMENTO DE XML DE ENTRADA
// ============================================================

async function processarXMLEntrada(pool, xmlContent, userId) {
    // Parser simples de XML NFe (sem dependência extra)
    const parseTag = (xml, tag) => {
        const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
        const match = xml.match(regex);
        return match ? match[1].trim() : null;
    };

    const parseTagSimples = (xml, tag) => {
        const regex = new RegExp(`<${tag}>([^<]*)<\\/${tag}>`, 'gi');
        const match = regex.exec(xml);
        return match ? match[1].trim() : '';
    };

    // Extrair chave de acesso
    let chaveAcesso = '';
    const infNFeMatch = xmlContent.match(/Id="NFe(\d{44})"/);
    if (infNFeMatch) {
        chaveAcesso = infNFeMatch[1];
    } else {
        const chNFeMatch = xmlContent.match(/<chNFe>(\d{44})<\/chNFe>/);
        if (chNFeMatch) chaveAcesso = chNFeMatch[1];
    }

    if (!chaveAcesso || chaveAcesso.length !== 44) {
        throw new Error('Chave de acesso não encontrada no XML');
    }

    // Verificar duplicidade
    const [existe] = await pool.query(
        'SELECT id FROM nf_entrada WHERE chave_acesso = ?', [chaveAcesso]
    );
    if (existe.length > 0) {
        return { success: false, error: 'NF já importada', id: existe[0].id, duplicada: true };
    }

    // Extrair dados do emitente
    const emitXML = parseTag(xmlContent, 'emit') || '';
    const fornecedorCNPJ = parseTagSimples(emitXML, 'CNPJ');
    const fornecedorRazao = parseTagSimples(emitXML, 'xNome');
    const fornecedorFantasia = parseTagSimples(emitXML, 'xFant');
    const fornecedorIE = parseTagSimples(emitXML, 'IE');
    const fornecedorUF = parseTagSimples(emitXML, 'UF');
    const fornecedorMun = parseTagSimples(emitXML, 'xMun');
    const fornecedorCodMun = parseTagSimples(emitXML, 'cMun');

    // Extrair IDE
    const ideXML = parseTag(xmlContent, 'ide') || '';
    const nNF = parseTagSimples(ideXML, 'nNF');
    const serie = parseTagSimples(ideXML, 'serie');
    const mod = parseTagSimples(ideXML, 'mod');
    const natOp = parseTagSimples(ideXML, 'natOp');
    const dhEmi = parseTagSimples(ideXML, 'dhEmi');
    const dhSaiEnt = parseTagSimples(ideXML, 'dhSaiEnt');

    // Extrair totais
    const icmsTotXML = parseTag(xmlContent, 'ICMSTot') || '';
    const valorProd = parseFloat(parseTagSimples(icmsTotXML, 'vProd')) || 0;
    const valorFrete = parseFloat(parseTagSimples(icmsTotXML, 'vFrete')) || 0;
    const valorSeg = parseFloat(parseTagSimples(icmsTotXML, 'vSeg')) || 0;
    const valorDesc = parseFloat(parseTagSimples(icmsTotXML, 'vDesc')) || 0;
    const valorOutro = parseFloat(parseTagSimples(icmsTotXML, 'vOutro')) || 0;
    const valorNF = parseFloat(parseTagSimples(icmsTotXML, 'vNF')) || 0;
    const bcICMS = parseFloat(parseTagSimples(icmsTotXML, 'vBC')) || 0;
    const valorICMS = parseFloat(parseTagSimples(icmsTotXML, 'vICMS')) || 0;
    const bcST = parseFloat(parseTagSimples(icmsTotXML, 'vBCST')) || 0;
    const valorST = parseFloat(parseTagSimples(icmsTotXML, 'vST')) || 0;
    const valorIPI = parseFloat(parseTagSimples(icmsTotXML, 'vIPI')) || 0;
    const valorPIS = parseFloat(parseTagSimples(icmsTotXML, 'vPIS')) || 0;
    const valorCOFINS = parseFloat(parseTagSimples(icmsTotXML, 'vCOFINS')) || 0;

    // Protocolo
    const nProt = parseTagSimples(xmlContent, 'nProt');
    const dhRecbto = parseTagSimples(xmlContent, 'dhRecbto');

    // Inserir NF de entrada
    const [insertResult] = await pool.query(`
        INSERT INTO nf_entrada (
            chave_acesso, numero_nfe, serie, modelo,
            fornecedor_cnpj, fornecedor_razao_social, fornecedor_nome_fantasia,
            fornecedor_ie, fornecedor_uf, fornecedor_municipio, fornecedor_codigo_municipio,
            valor_produtos, valor_frete, valor_seguro, valor_desconto, valor_outros, valor_total,
            bc_icms, valor_icms, bc_icms_st, valor_icms_st, valor_ipi, valor_pis, valor_cofins,
            data_emissao, data_saida, protocolo_autorizacao, data_autorizacao,
            natureza_operacao, status, xml_completo, importado_por
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'importada', ?, ?)
    `, [
        chaveAcesso, parseInt(nNF) || 0, parseInt(serie) || 1, mod || '55',
        fornecedorCNPJ, fornecedorRazao, fornecedorFantasia || fornecedorRazao,
        fornecedorIE, fornecedorUF, fornecedorMun, fornecedorCodMun,
        valorProd, valorFrete, valorSeg, valorDesc, valorOutro, valorNF,
        bcICMS, valorICMS, bcST, valorST, valorIPI, valorPIS, valorCOFINS,
        dhEmi || new Date(), dhSaiEnt || null, nProt || null, dhRecbto || null,
        natOp || '', xmlContent, userId
    ]);

    const nfEntradaId = insertResult.insertId;

    // Extrair e inserir itens
    const detMatches = xmlContent.match(/<det nItem="(\d+)">([\s\S]*?)<\/det>/gi) || [];
    let itensInseridos = 0;

    for (const detXML of detMatches) {
        const nItemMatch = detXML.match(/nItem="(\d+)"/);
        const nItem = nItemMatch ? parseInt(nItemMatch[1]) : ++itensInseridos;

        const prodXML = parseTag(detXML, 'prod') || '';

        const cProd = parseTagSimples(prodXML, 'cProd');
        const xProd = parseTagSimples(prodXML, 'xProd');
        const ncm = parseTagSimples(prodXML, 'NCM');
        const cest = parseTagSimples(prodXML, 'CEST');
        const cfop = parseTagSimples(prodXML, 'CFOP');
        const uCom = parseTagSimples(prodXML, 'uCom');
        const qCom = parseFloat(parseTagSimples(prodXML, 'qCom')) || 0;
        const vUnCom = parseFloat(parseTagSimples(prodXML, 'vUnCom')) || 0;
        const vProd = parseFloat(parseTagSimples(prodXML, 'vProd')) || 0;
        const cEAN = parseTagSimples(prodXML, 'cEAN');
        const vDesc = parseFloat(parseTagSimples(prodXML, 'vDesc')) || 0;
        const vFrete = parseFloat(parseTagSimples(prodXML, 'vFrete')) || 0;
        const vSeg = parseFloat(parseTagSimples(prodXML, 'vSeg')) || 0;
        const vOutro = parseFloat(parseTagSimples(prodXML, 'vOutro')) || 0;

        // Extrair impostos do item
        const impostoXML = parseTag(detXML, 'imposto') || '';
        const icmsXML = parseTag(impostoXML, 'ICMS') || '';
        const ipiXML = parseTag(impostoXML, 'IPI') || '';
        const pisXML = parseTag(impostoXML, 'PIS') || '';
        const cofinsXML = parseTag(impostoXML, 'COFINS') || '';

        const origItem = parseTagSimples(icmsXML, 'orig') || '0';
        const cstICMS = parseTagSimples(icmsXML, 'CST') || '';
        const csosn = parseTagSimples(icmsXML, 'CSOSN') || '';
        const bcICMSItem = parseFloat(parseTagSimples(icmsXML, 'vBC')) || 0;
        const aliqICMS = parseFloat(parseTagSimples(icmsXML, 'pICMS')) || 0;
        const valorICMSItem = parseFloat(parseTagSimples(icmsXML, 'vICMS')) || 0;

        const cstIPI = parseTagSimples(ipiXML, 'CST') || '';
        const bcIPI = parseFloat(parseTagSimples(ipiXML, 'vBC')) || 0;
        const aliqIPI = parseFloat(parseTagSimples(ipiXML, 'pIPI')) || 0;
        const valorIPIItem = parseFloat(parseTagSimples(ipiXML, 'vIPI')) || 0;

        const cstPIS = parseTagSimples(pisXML, 'CST') || '';
        const bcPIS = parseFloat(parseTagSimples(pisXML, 'vBC')) || 0;
        const aliqPIS = parseFloat(parseTagSimples(pisXML, 'pPIS')) || 0;
        const valorPISItem = parseFloat(parseTagSimples(pisXML, 'vPIS')) || 0;

        const cstCOFINS = parseTagSimples(cofinsXML, 'CST') || '';
        const bcCOFINS = parseFloat(parseTagSimples(cofinsXML, 'vBC')) || 0;
        const aliqCOFINS = parseFloat(parseTagSimples(cofinsXML, 'pCOFINS')) || 0;
        const valorCOFINSItem = parseFloat(parseTagSimples(cofinsXML, 'vCOFINS')) || 0;

        await pool.query(`
            INSERT INTO nf_entrada_itens (
                nf_entrada_id, numero_item, codigo_produto, descricao, ncm, cest, cfop,
                unidade, quantidade, valor_unitario, valor_total, ean,
                valor_desconto, valor_frete, valor_seguro, valor_outros,
                origem, cst_icms, csosn_icms, bc_icms, aliquota_icms, valor_icms,
                cst_ipi, bc_ipi, aliquota_ipi, valor_ipi,
                cst_pis, bc_pis, aliquota_pis, valor_pis,
                cst_cofins, bc_cofins, aliquota_cofins, valor_cofins
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            nfEntradaId, nItem, cProd, xProd, ncm, cest || null, cfop,
            uCom || 'UN', qCom, vUnCom, vProd, cEAN || null,
            vDesc, vFrete, vSeg, vOutro,
            origItem, cstICMS, csosn, bcICMSItem, aliqICMS, valorICMSItem,
            cstIPI, bcIPI, aliqIPI, valorIPIItem,
            cstPIS, bcPIS, aliqPIS, valorPISItem,
            cstCOFINS, bcCOFINS, aliqCOFINS, valorCOFINSItem
        ]);
        itensInseridos++;
    }

    // Auto-cadastrar fornecedor
    try {
        await pool.query(`
            INSERT INTO fornecedores (cnpj, razao_social, nome_fantasia, inscricao_estadual, uf, cidade, codigo_municipio)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE razao_social = VALUES(razao_social), nome_fantasia = VALUES(nome_fantasia)
        `, [fornecedorCNPJ, fornecedorRazao, fornecedorFantasia, fornecedorIE, fornecedorUF, fornecedorMun, fornecedorCodMun]);
    } catch (e) {
        // Não falhar se cadastro de fornecedor der erro
        console.warn('[NF Entrada] Erro ao auto-cadastrar fornecedor:', e.message);
    }

    return {
        success: true,
        id: nfEntradaId,
        chave_acesso: chaveAcesso,
        numero_nfe: parseInt(nNF),
        fornecedor: fornecedorRazao,
        valor_total: valorNF,
        itens: itensInseridos,
        message: `NF ${nNF} importada com ${itensInseridos} itens`
    };
}

module.exports = createNFEntradaRouter;
