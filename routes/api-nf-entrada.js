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
                SELECT id, chave_nfe AS chave_acesso, numero_nfe, serie, 
                    emitente_cnpj AS fornecedor_cnpj, emitente_razao AS fornecedor_razao_social, emitente_uf AS fornecedor_uf,
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
                query += ' AND (emitente_cnpj LIKE ? OR emitente_razao LIKE ?)';
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
            const countQuery = query.replace(/SELECT[\s\S]+?\sFROM\s/, 'SELECT COUNT(*) as total FROM ');
            const [countRows] = await pool.query(countQuery, params);
            const total = (countRows[0] && countRows[0].total) || 0;

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
            res.status(500).json({ error: 'Erro interno no servidor. Tente novamente.' });
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
            res.status(500).json({ error: 'Erro interno no servidor. Tente novamente.' });
        }
    });

    // ============================================================
    // SINCRONIZAR SEFAZ — NF-e emitidas contra o CNPJ (faturado pelo fornecedor)
    // Puxa todas as notas via DistDFe (distribuição de DF-e) e importa em nf_entrada.
    // Ativa quando o certificado A1 está configurado em empresa_config.
    // ============================================================
    router.post('/sincronizar-sefaz', authenticateToken, async (req, res) => {
        try {
            const { ManifestacaoSefazService } = require('../modules/Faturamento/services/manifestacao-sefaz.service');
            const zlib = require('zlib');

            await pool.query(`
                CREATE TABLE IF NOT EXISTS nf_entrada_sefaz_state (
                    empresa_id INT PRIMARY KEY,
                    ult_nsu VARCHAR(20) DEFAULT '0',
                    bloqueado_ate DATETIME NULL,
                    last_cstat VARCHAR(10) NULL,
                    last_motivo VARCHAR(500) NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            `).catch(() => {});
            await pool.query('ALTER TABLE nf_entrada_sefaz_state ADD COLUMN bloqueado_ate DATETIME NULL').catch(() => {});
            await pool.query('ALTER TABLE nf_entrada_sefaz_state ADD COLUMN last_cstat VARCHAR(10) NULL').catch(() => {});
            await pool.query('ALTER TABLE nf_entrada_sefaz_state ADD COLUMN last_motivo VARCHAR(500) NULL').catch(() => {});

            const empresaId = Number(req.user?.empresa_id || 1);
            const [[st]] = await pool.query('SELECT ult_nsu, bloqueado_ate, last_cstat, last_motivo FROM nf_entrada_sefaz_state WHERE empresa_id = ?', [empresaId]);
            if (st?.bloqueado_ate && new Date(st.bloqueado_ate) > new Date()) {
                return res.status(429).json({
                    success: false,
                    message: st.last_motivo || 'SEFAZ solicitou aguardar antes de uma nova consulta.',
                    bloqueado_ate: st.bloqueado_ate
                });
            }
            let ultNSU = (st && st.ult_nsu) || '0';

            let importadas = 0, resumos = 0, lotes = 0;
            // A SEFAZ devolve em lotes; itera até alcançar o maxNSU (limite de segurança: 20 lotes).
            for (let i = 0; i < 20; i++) {
                const r = await ManifestacaoSefazService.consultarNFeDestinatario(pool, { ultNSU });
                if (!r.sucesso) {
                    const certIssue = r.error && /certificad|cert\b|pfx|senha/i.test(r.error);
                    if (r.ultNSU) {
                        ultNSU = r.ultNSU;
                        const bloqueio = r.cStat === '656' ? 'DATE_ADD(NOW(), INTERVAL 1 HOUR)' : 'NULL';
                        await pool.query(
                            `INSERT INTO nf_entrada_sefaz_state (empresa_id, ult_nsu, bloqueado_ate, last_cstat, last_motivo)
                             VALUES (?, ?, ${bloqueio}, ?, ?)
                             ON DUPLICATE KEY UPDATE
                                ult_nsu = VALUES(ult_nsu),
                                bloqueado_ate = ${bloqueio},
                                last_cstat = VALUES(last_cstat),
                                last_motivo = VALUES(last_motivo)`,
                            [empresaId, ultNSU, r.cStat || null, r.xMotivo || r.error || null]
                        ).catch(() => {});
                    }
                    return res.status(certIssue ? 400 : 502).json({
                        success: false,
                        message: r.error || 'Falha na consulta à SEFAZ',
                        instrucoes: r.instrucoes || 'Configure o certificado digital A1 da empresa para habilitar a busca automática de NF-e.'
                    });
                }
                lotes++;
                for (const doc of (r.documentos || [])) {
                    try {
                        const xml = zlib.gunzipSync(Buffer.from(doc.conteudoBase64, 'base64')).toString('utf8');
                        if (/<nfeProc|<NFe[ >]/.test(xml)) {
                            const result = await processarXMLEntrada(pool, xml, req.user.id).catch(() => null);
                            if (result && !result.duplicada) importadas++;
                        } else if (/<resNFe[\s>]/.test(xml)) {
                            const result = await processarResumoNFe(pool, xml, req.user.id).catch(() => null);
                            if (result && !result.duplicada) importadas++;
                            resumos++;
                        } else {
                            resumos++; // resEvento/outros documentos sem dados mínimos de NF-e
                        }
                    } catch (_) { /* documento ilegível, ignora */ }
                }
                ultNSU = r.ultNSU || ultNSU;
                if (!r.documentos || !r.documentos.length || Number(r.ultNSU) >= Number(r.maxNSU)) break;
            }

            await pool.query(
                `INSERT INTO nf_entrada_sefaz_state (empresa_id, ult_nsu, bloqueado_ate, last_cstat, last_motivo) VALUES (?, ?, NULL, NULL, NULL)
                 ON DUPLICATE KEY UPDATE
                    ult_nsu = VALUES(ult_nsu),
                    bloqueado_ate = NULL,
                    last_cstat = NULL,
                    last_motivo = NULL`,
                [empresaId, ultNSU]
            );
            res.json({
                success: true,
                message: `Sincronização SEFAZ concluída: ${importadas} NF-e importada(s), ${resumos} resumo(s).`,
                importadas, resumos, lotes, ultNSU
            });
        } catch (error) {
            console.error('❌ Erro ao sincronizar SEFAZ:', error);
            res.status(500).json({ success: false, message: 'Erro ao sincronizar com a SEFAZ' });
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
            res.status(500).json({ error: 'Erro interno no servidor. Tente novamente.' });
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
        'SELECT id FROM nf_entrada WHERE chave_nfe = ?', [chaveAcesso]
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
            chave_nfe, numero_nfe, serie,
            emitente_cnpj, emitente_razao, emitente_uf,
            valor_produtos, valor_frete, valor_seguro, valor_desconto, valor_outras_despesas, valor_total,
            base_icms, valor_icms, base_icms_st, valor_icms_st, valor_ipi, valor_pis, valor_cofins,
            data_emissao, natureza_operacao, status, xml_conteudo
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendente', ?)
    `, [
        chaveAcesso, parseInt(nNF) || 0, parseInt(serie) || 1,
        fornecedorCNPJ, fornecedorRazao, fornecedorUF,
        valorProd, valorFrete, valorSeg, valorDesc, valorOutro, valorNF,
        bcICMS, valorICMS, bcST, valorST, valorIPI, valorPIS, valorCOFINS,
        dhEmi || new Date(), natOp || '', xmlContent
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
                nf_entrada_id, numero_item, codigo_produto, descricao, ncm, cfop,
                unidade, quantidade, valor_unitario, valor_total,
                base_icms, aliquota_icms, valor_icms, cst_icms,
                valor_ipi, aliquota_ipi, cst_ipi,
                valor_pis, aliquota_pis, cst_pis,
                valor_cofins, aliquota_cofins, cst_cofins
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            nfEntradaId, nItem, cProd, xProd, ncm, cfop,
            uCom || 'UN', qCom, vUnCom, vProd,
            bcICMSItem, aliqICMS, valorICMSItem, cstICMS,
            valorIPIItem, aliqIPI, cstIPI,
            valorPISItem, aliqPIS, cstPIS,
            valorCOFINSItem, aliqCOFINS, cstCOFINS
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

async function processarResumoNFe(pool, xmlContent, userId) {
    const parseTagSimples = (xml, tag) => {
        const regex = new RegExp(`<${tag}>([^<]*)<\\/${tag}>`, 'i');
        const match = regex.exec(xml);
        return match ? match[1].trim() : '';
    };

    const chaveAcesso = parseTagSimples(xmlContent, 'chNFe');
    if (!chaveAcesso || chaveAcesso.length !== 44) {
        throw new Error('Chave de acesso não encontrada no resumo da NF-e');
    }

    const [existe] = await pool.query('SELECT id FROM nf_entrada WHERE chave_nfe = ?', [chaveAcesso]);
    if (existe.length > 0) {
        return { success: false, error: 'NF já importada', id: existe[0].id, duplicada: true };
    }

    const numeroNFe = parseInt(chaveAcesso.slice(25, 34), 10) || 0;
    const serie = parseInt(chaveAcesso.slice(22, 25), 10) || 1;
    const emitenteCNPJ = parseTagSimples(xmlContent, 'CNPJ') || chaveAcesso.slice(6, 20);
    const emitenteRazao = parseTagSimples(xmlContent, 'xNome') || 'Fornecedor não identificado';
    const valorNF = parseFloat(parseTagSimples(xmlContent, 'vNF')) || 0;
    const dataEmissao = parseTagSimples(xmlContent, 'dhEmi');

    const [insertResult] = await pool.query(`
        INSERT INTO nf_entrada (
            chave_nfe, numero_nfe, serie,
            emitente_cnpj, emitente_razao, emitente_uf,
            valor_produtos, valor_total,
            data_emissao, natureza_operacao, status, xml_conteudo, usuario_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendente', ?, ?)
    `, [
        chaveAcesso,
        numeroNFe,
        serie,
        emitenteCNPJ,
        emitenteRazao,
        chaveAcesso.slice(0, 2),
        valorNF,
        valorNF,
        dataEmissao ? dataEmissao.slice(0, 10) : new Date(),
        'Resumo SEFAZ - NF-e emitida contra o CNPJ',
        xmlContent,
        userId || null
    ]);

    return {
        success: true,
        id: insertResult.insertId,
        resumo: true,
        chave_acesso: chaveAcesso,
        numero_nfe: numeroNFe,
        fornecedor: emitenteRazao,
        valor_total: valorNF,
        message: `Resumo NF ${numeroNFe} importado da SEFAZ`
    };
}

module.exports = createNFEntradaRouter;
