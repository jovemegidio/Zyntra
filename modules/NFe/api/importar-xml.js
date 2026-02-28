/**
 * API de Importação de XML NFe
 * 
 * Permite importar XMLs de notas fiscais eletrônicas de fornecedores
 * para registro automático no sistema de compras e financeiro.
 * 
 * FUNCIONALIDADES:
 * - Upload de arquivos XML
 * - Parse e validação de XML NFe
 * - Extração de dados do emitente, destinatário, produtos e impostos
 * - Registro automático de entrada de mercadorias
 * - Integração com contas a pagar
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const xml2js = require('xml2js');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
// Integração SEFAZ
const SEFAZService = require('../../../src/nfe/services/SEFAZService');
const mysql = require('mysql2/promise');

// JWT_SECRET para validação de tokens
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error('❌ [NFe/importar-xml] ERRO: JWT_SECRET não definido');
}

// Middleware de autenticação
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ success: false, message: 'Token de autenticação não fornecido' });
    }
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ success: false, message: 'Token inválido ou expirado' });
        }
        req.user = user;
        next();
    });
}

// Aplicar autenticação a TODAS as rotas deste router
router.use(authenticateToken);

// Pool de conexão para logs SEFAZ
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'aluforce_vendas',
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10
});
const sefazService = new SEFAZService(pool);

// Configuração do multer para upload de XMLs
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, '../uploads/xml');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const timestamp = Date.now();
        const originalName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
        cb(null, `${timestamp}-${originalName}`);
    }
});

const upload = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'text/xml' || file.mimetype === 'application/xml' || path.extname(file.originalname).toLowerCase() === '.xml') {
            cb(null, true);
        } else {
            cb(new Error('Apenas arquivos XML são permitidos'), false);
        }
    },
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB
    }
});

/**
 * POST /upload - Upload e processamento de XML NFe
 */
router.post('/upload', upload.single('xml'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'Nenhum arquivo XML enviado' });
        }
        const xmlContent = fs.readFileSync(req.file.path, 'utf-8');
        const nfeData = await parseNFeXML(xmlContent);

        if (!nfeData.success) {
            // Remove arquivo em caso de erro
            fs.unlinkSync(req.file.path);
            return res.status(400).json(nfeData);
        }

        // === Integração SEFAZ: Consulta/autorização real ===
        let sefazRetorno = null;
        let sefazErro = null;
        try {
            // Chave de acesso e UF do emitente
            const chaveAcesso = nfeData.data?.identificacao?.chaveAcesso;
            const uf = nfeData.data?.emitente?.endereco?.uf;
            if (chaveAcesso && uf) {
                // Consulta protocolo na SEFAZ (ambiente homologação)
                sefazRetorno = await sefazService.consultarProtocolo(chaveAcesso, uf, 'homologacao');
            }
        } catch (e) {
            sefazErro = e.message || String(e);
        }

        // Salva dados processados
        const processedFile = req.file.path.replace('.xml', '.json');
        fs.writeFileSync(processedFile, JSON.stringify(nfeData, null, 2));

        res.json({
            success: true,
            message: 'XML processado com sucesso',
            data: nfeData.data,
            sefaz: sefazRetorno,
            sefazErro,
            arquivoOriginal: req.file.filename,
            arquivoProcessado: path.basename(processedFile)
        });
    } catch (error) {
        console.error('Erro ao processar XML:', error);
        res.status(500).json({ success: false, message: 'Erro ao processar XML', error: error.message });
    }
});

/**
 * POST /upload-multiple - Upload de múltiplos XMLs
 */
router.post('/upload-multiple', upload.array('xmls', 50), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ success: false, message: 'Nenhum arquivo XML enviado' });
        }

        const results = [];
        for (const file of req.files) {
            try {
                const xmlContent = fs.readFileSync(file.path, 'utf-8');
                const nfeData = await parseNFeXML(xmlContent);
                
                results.push({
                    arquivo: file.originalname,
                    success: nfeData.success,
                    data: nfeData.success ? nfeData.data : null,
                    error: nfeData.success ? null : nfeData.message
                });
            } catch (err) {
                results.push({
                    arquivo: file.originalname,
                    success: false,
                    error: err.message
                });
            }
        }

        const successCount = results.filter(r => r.success).length;
        const errorCount = results.filter(r => !r.success).length;

        res.json({
            success: true,
            message: `Processados ${req.files.length} arquivos: ${successCount} sucesso, ${errorCount} erros`,
            total: req.files.length,
            sucesso: successCount,
            erros: errorCount,
            resultados: results
        });
    } catch (error) {
        console.error('Erro ao processar XMLs:', error);
        res.status(500).json({ success: false, message: 'Erro ao processar XMLs', error: error.message });
    }
});

/**
 * POST /parse - Parse de XML enviado como string (sem upload)
 */
router.post('/parse', async (req, res) => {
    try {
        const { xml } = req.body;
        
        if (!xml) {
            return res.status(400).json({ success: false, message: 'XML não fornecido' });
        }

        const nfeData = await parseNFeXML(xml);
        res.json(nfeData);
    } catch (error) {
        console.error('Erro ao fazer parse do XML:', error);
        res.status(500).json({ success: false, message: 'Erro ao processar XML', error: error.message });
    }
});

/**
 * GET /listar - Lista XMLs importados
 */
router.get('/listar', async (req, res) => {
    try {
        const uploadDir = path.join(__dirname, '../uploads/xml');
        
        if (!fs.existsSync(uploadDir)) {
            return res.json({ success: true, arquivos: [] });
        }

        const files = fs.readdirSync(uploadDir)
            .filter(f => f.endsWith('.json'))
            .map(f => {
                try {
                    const filePath = path.join(uploadDir, f);
                    const stats = fs.statSync(filePath);
                    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                    
                    return {
                        arquivo: f,
                        dataImportacao: stats.mtime,
                        chaveAcesso: content.data?.identificacao?.chaveAcesso,
                        numero: content.data?.identificacao?.numero,
                        serie: content.data?.identificacao?.serie,
                        emitente: content.data?.emitente?.razaoSocial,
                        cnpjEmitente: content.data?.emitente?.cnpj,
                        valorTotal: content.data?.totais?.valorNota,
                        dataEmissao: content.data?.identificacao?.dataEmissao
                    };
                } catch (parseErr) {
                    console.warn(`Erro ao ler arquivo ${f}:`, parseErr.message);
                    return null;
                }
            })
            .filter(Boolean)
            .sort((a, b) => new Date(b.dataImportacao) - new Date(a.dataImportacao));

        res.json({ success: true, total: files.length, arquivos: files });
    } catch (error) {
        console.error('Erro ao listar XMLs:', error);
        res.status(500).json({ success: false, message: 'Erro ao listar XMLs' });
    }
});

/**
 * GET /detalhes/:chave - Busca detalhes de uma NFe pela chave de acesso
 */
router.get('/detalhes/:chave', async (req, res) => {
    try {
        const { chave } = req.params;
        const uploadDir = path.join(__dirname, '../uploads/xml');

        if (!fs.existsSync(uploadDir)) {
            return res.status(404).json({ success: false, message: 'NFe não encontrada' });
        }

        const files = fs.readdirSync(uploadDir).filter(f => f.endsWith('.json'));
        
        for (const file of files) {
            try {
                const content = JSON.parse(fs.readFileSync(path.join(uploadDir, file), 'utf-8'));
                if (content.data?.identificacao?.chaveAcesso === chave) {
                    return res.json({ success: true, data: content.data });
                }
            } catch (parseErr) {
                console.warn(`Erro ao ler arquivo ${file}:`, parseErr.message);
                continue;
            }
        }

        res.status(404).json({ success: false, message: 'NFe não encontrada' });
    } catch (error) {
        console.error('Erro ao buscar NFe:', error);
        res.status(500).json({ success: false, message: 'Erro ao buscar NFe' });
    }
});

/**
 * DELETE /excluir/:arquivo - Remove um XML importado
 */
router.delete('/excluir/:arquivo', async (req, res) => {
    try {
        const { arquivo } = req.params;
        
        // SEGURANÇA: Prevenir Path Traversal - usar apenas o nome base do arquivo
        const safeFilename = path.basename(arquivo);
        
        // Validar que o nome do arquivo é seguro (apenas caracteres permitidos)
        if (!/^[\w\-\.]+$/.test(safeFilename) || safeFilename.includes('..')) {
            return res.status(400).json({ success: false, message: 'Nome de arquivo inválido' });
        }
        
        const uploadDir = path.join(__dirname, '../uploads/xml');
        const filePath = path.join(uploadDir, safeFilename);
        
        // SEGURANÇA: Verificar se o caminho final está dentro do diretório de uploads
        const resolvedPath = path.resolve(filePath);
        const resolvedUploadDir = path.resolve(uploadDir);
        if (!resolvedPath.startsWith(resolvedUploadDir)) {
            return res.status(403).json({ success: false, message: 'Acesso negado - caminho inválido' });
        }

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ success: false, message: 'Arquivo não encontrado' });
        }

        fs.unlinkSync(filePath);
        
        // Remove também o XML original se existir
        const xmlPath = filePath.replace('.json', '.xml');
        if (fs.existsSync(xmlPath)) {
            fs.unlinkSync(xmlPath);
        }

        res.json({ success: true, message: 'Arquivo excluído com sucesso' });
    } catch (error) {
        console.error('Erro ao excluir arquivo:', error);
        res.status(500).json({ success: false, message: 'Erro ao excluir arquivo' });
    }
});

// ===================================================================
// FUNÇÕES DE PARSE
// ===================================================================

/**
 * Parse do XML NFe
 */
async function parseNFeXML(xmlContent) {
    try {
        const parser = new xml2js.Parser({
            explicitArray: false,
            ignoreAttrs: false,
            mergeAttrs: true
        });

        const result = await parser.parseStringPromise(xmlContent);
        
        // Navega pela estrutura do XML
        let nfe = null;
        
        // Tenta encontrar a NFe em diferentes estruturas possíveis
        if (result.nfeProc?.NFe) {
            nfe = result.nfeProc.NFe;
        } else if (result.NFe) {
            nfe = result.NFe;
        } else if (result.enviNFe?.NFe) {
            nfe = result.enviNFe.NFe;
        } else {
            return { success: false, message: 'Estrutura de XML NFe não reconhecida' };
        }

        const infNFe = nfe.infNFe;
        if (!infNFe) {
            return { success: false, message: 'Elemento infNFe não encontrado' };
        }

        // Extrai dados da identificação
        const ide = infNFe.ide || {};
        const emit = infNFe.emit || {};
        const dest = infNFe.dest || {};
        const total = infNFe.total?.ICMSTot || {};
        const transp = infNFe.transp || {};
        const cobr = infNFe.cobr || {};
        const pag = infNFe.pag || {};
        const infAdic = infNFe.infAdic || {};

        // Processa produtos
        let produtos = [];
        const det = infNFe.det;
        if (det) {
            const detArray = Array.isArray(det) ? det : [det];
            produtos = detArray.map(item => {
                const prod = item.prod || {};
                const imposto = item.imposto || {};
                
                return {
                    numero: item.nItem,
                    codigo: prod.cProd,
                    codigoBarras: prod.cEAN,
                    descricao: prod.xProd,
                    ncm: prod.NCM,
                    cfop: prod.CFOP,
                    unidade: prod.uCom,
                    quantidade: parseFloat(prod.qCom) || 0,
                    valorUnitario: parseFloat(prod.vUnCom) || 0,
                    valorTotal: parseFloat(prod.vProd) || 0,
                    valorDesconto: parseFloat(prod.vDesc) || 0,
                    valorFrete: parseFloat(prod.vFrete) || 0,
                    valorSeguro: parseFloat(prod.vSeg) || 0,
                    valorOutros: parseFloat(prod.vOutro) || 0,
                    impostos: {
                        icms: extrairICMS(imposto.ICMS),
                        ipi: extrairIPI(imposto.IPI),
                        pis: extrairPIS(imposto.PIS),
                        cofins: extrairCOFINS(imposto.COFINS)
                    }
                };
            });
        }

        // Processa duplicatas
        let duplicatas = [];
        if (cobr?.dup) {
            const dupArray = Array.isArray(cobr.dup) ? cobr.dup : [cobr.dup];
            duplicatas = dupArray.map(dup => ({
                numero: dup.nDup,
                vencimento: dup.dVenc,
                valor: parseFloat(dup.vDup) || 0
            }));
        }

        // Monta objeto de retorno
        const nfeData = {
            identificacao: {
                chaveAcesso: infNFe.Id?.replace('NFe', '') || '',
                versao: infNFe.versao,
                numero: ide.nNF,
                serie: ide.serie,
                dataEmissao: ide.dhEmi || ide.dEmi,
                dataSaida: ide.dhSaiEnt || ide.dSaiEnt,
                naturezaOperacao: ide.natOp,
                tipoOperacao: ide.tpNF === '0' ? 'Entrada' : 'Saída',
                modelo: ide.mod,
                finalidade: ide.finNFe,
                ambiente: ide.tpAmb === '1' ? 'Produção' : 'Homologação'
            },
            emitente: {
                cnpj: emit.CNPJ,
                cpf: emit.CPF,
                razaoSocial: emit.xNome,
                nomeFantasia: emit.xFant,
                inscricaoEstadual: emit.IE,
                inscricaoMunicipal: emit.IM,
                cnae: emit.CNAE,
                crt: emit.CRT,
                endereco: {
                    logradouro: emit.enderEmit?.xLgr,
                    numero: emit.enderEmit?.nro,
                    complemento: emit.enderEmit?.xCpl,
                    bairro: emit.enderEmit?.xBairro,
                    codigoMunicipio: emit.enderEmit?.cMun,
                    municipio: emit.enderEmit?.xMun,
                    uf: emit.enderEmit?.UF,
                    cep: emit.enderEmit?.CEP,
                    pais: emit.enderEmit?.xPais,
                    telefone: emit.enderEmit?.fone
                }
            },
            destinatario: {
                cnpj: dest.CNPJ,
                cpf: dest.CPF,
                razaoSocial: dest.xNome,
                inscricaoEstadual: dest.IE,
                email: dest.email,
                endereco: {
                    logradouro: dest.enderDest?.xLgr,
                    numero: dest.enderDest?.nro,
                    complemento: dest.enderDest?.xCpl,
                    bairro: dest.enderDest?.xBairro,
                    codigoMunicipio: dest.enderDest?.cMun,
                    municipio: dest.enderDest?.xMun,
                    uf: dest.enderDest?.UF,
                    cep: dest.enderDest?.CEP
                }
            },
            produtos: produtos,
            totais: {
                baseCalculoICMS: parseFloat(total.vBC) || 0,
                valorICMS: parseFloat(total.vICMS) || 0,
                valorICMSDesonerado: parseFloat(total.vICMSDeson) || 0,
                baseCalculoST: parseFloat(total.vBCST) || 0,
                valorST: parseFloat(total.vST) || 0,
                valorFrete: parseFloat(total.vFrete) || 0,
                valorSeguro: parseFloat(total.vSeg) || 0,
                valorDesconto: parseFloat(total.vDesc) || 0,
                valorII: parseFloat(total.vII) || 0,
                valorIPI: parseFloat(total.vIPI) || 0,
                valorPIS: parseFloat(total.vPIS) || 0,
                valorCOFINS: parseFloat(total.vCOFINS) || 0,
                valorOutros: parseFloat(total.vOutro) || 0,
                valorProdutos: parseFloat(total.vProd) || 0,
                valorNota: parseFloat(total.vNF) || 0
            },
            transporte: {
                modalidade: transp.modFrete,
                transportadora: transp.transporta ? {
                    cnpj: transp.transporta.CNPJ,
                    cpf: transp.transporta.CPF,
                    nome: transp.transporta.xNome,
                    inscricaoEstadual: transp.transporta.IE,
                    endereco: transp.transporta.xEnder,
                    municipio: transp.transporta.xMun,
                    uf: transp.transporta.UF
                } : null,
                veiculo: transp.veicTransp ? {
                    placa: transp.veicTransp.placa,
                    uf: transp.veicTransp.UF,
                    rntc: transp.veicTransp.RNTC
                } : null,
                volumes: transp.vol ? {
                    quantidade: transp.vol.qVol,
                    especie: transp.vol.esp,
                    marca: transp.vol.marca,
                    numeracao: transp.vol.nVol,
                    pesoLiquido: parseFloat(transp.vol.pesoL) || 0,
                    pesoBruto: parseFloat(transp.vol.pesoB) || 0
                } : null
            },
            cobranca: {
                fatura: cobr.fat ? {
                    numero: cobr.fat.nFat,
                    valorOriginal: parseFloat(cobr.fat.vOrig) || 0,
                    valorDesconto: parseFloat(cobr.fat.vDesc) || 0,
                    valorLiquido: parseFloat(cobr.fat.vLiq) || 0
                } : null,
                duplicatas: duplicatas
            },
            pagamento: pag.detPag ? (Array.isArray(pag.detPag) ? pag.detPag.map(dp => ({
                formaPagamento: dp.tPag,
                valorPago: parseFloat(dp.vPag) || 0
            })) : [{
                formaPagamento: pag.detPag.tPag,
                valorPago: parseFloat(pag.detPag.vPag) || 0
            }]) : null,
            informacoesAdicionais: {
                fisco: infAdic.infAdFisco,
                contribuinte: infAdic.infCpl
            },
            protocolo: result.nfeProc?.protNFe?.infProt ? {
                numero: result.nfeProc.protNFe.infProt.nProt,
                dataHora: result.nfeProc.protNFe.infProt.dhRecbto,
                status: result.nfeProc.protNFe.infProt.cStat,
                motivo: result.nfeProc.protNFe.infProt.xMotivo
            } : null
        };

        return { success: true, data: nfeData };
    } catch (error) {
        console.error('Erro no parse do XML:', error);
        return { success: false, message: 'Erro ao fazer parse do XML: ' + error.message };
    }
}

/**
 * Extrai dados do ICMS
 */
function extrairICMS(icms) {
    if (!icms) return null;
    
    const tipos = ['ICMS00', 'ICMS10', 'ICMS20', 'ICMS30', 'ICMS40', 'ICMS51', 'ICMS60', 'ICMS70', 'ICMS90', 'ICMSSN101', 'ICMSSN102', 'ICMSSN201', 'ICMSSN202', 'ICMSSN500', 'ICMSSN900'];
    
    for (const tipo of tipos) {
        if (icms[tipo]) {
            const dados = icms[tipo];
            return {
                tipo: tipo,
                origem: dados.orig,
                cst: dados.CST || dados.CSOSN,
                baseCalculo: parseFloat(dados.vBC) || 0,
                aliquota: parseFloat(dados.pICMS) || 0,
                valor: parseFloat(dados.vICMS) || 0,
                baseCalculoST: parseFloat(dados.vBCST) || 0,
                aliquotaST: parseFloat(dados.pICMSST) || 0,
                valorST: parseFloat(dados.vICMSST) || 0
            };
        }
    }
    return null;
}

/**
 * Extrai dados do IPI
 */
function extrairIPI(ipi) {
    if (!ipi) return null;
    
    const ipitrib = ipi.IPITrib;
    if (ipitrib) {
        return {
            cst: ipitrib.CST,
            baseCalculo: parseFloat(ipitrib.vBC) || 0,
            aliquota: parseFloat(ipitrib.pIPI) || 0,
            valor: parseFloat(ipitrib.vIPI) || 0
        };
    }
    
    return {
        cst: ipi.IPINT?.CST || ipi.cEnq,
        valor: 0
    };
}

/**
 * Extrai dados do PIS
 */
function extrairPIS(pis) {
    if (!pis) return null;
    
    const tipos = ['PISAliq', 'PISQtde', 'PISNT', 'PISOutr'];
    
    for (const tipo of tipos) {
        if (pis[tipo]) {
            const dados = pis[tipo];
            return {
                cst: dados.CST,
                baseCalculo: parseFloat(dados.vBC) || 0,
                aliquota: parseFloat(dados.pPIS) || 0,
                valor: parseFloat(dados.vPIS) || 0
            };
        }
    }
    return null;
}

/**
 * Extrai dados do COFINS
 */
function extrairCOFINS(cofins) {
    if (!cofins) return null;
    
    const tipos = ['COFINSAliq', 'COFINSQtde', 'COFINSNT', 'COFINSOutr'];
    
    for (const tipo of tipos) {
        if (cofins[tipo]) {
            const dados = cofins[tipo];
            return {
                cst: dados.CST,
                baseCalculo: parseFloat(dados.vBC) || 0,
                aliquota: parseFloat(dados.pCOFINS) || 0,
                valor: parseFloat(dados.vCOFINS) || 0
            };
        }
    }
    return null;
}

module.exports = router;
