/**
 * NF-e ROUTES  Extracted from server.js (Lines 2262-2553)
 * Calculation, emission, cancellation, correction letters, reports
 * @module routes/nfe-routes
 */
const express = require('express');

module.exports = function createNfeRoutes(deps) {
    const { pool, authenticateToken, authorizeArea, authorizeAdmin } = deps;
    const router = express.Router();
    router.use(authenticateToken);
    router.use(authorizeArea('nfe'));

    // Sprint 3 (Gap-3 fix): Usar serviço centralizado de faturamento para contas_receber
    const { getFaturamentoSharedService } = require('../services/faturamento-shared.service');
    const faturamentoShared = getFaturamentoSharedService(pool);
    // ===================== ROTAS SERVIÇOS/NF-e PROFISSIONAL =====================
    
    // 1. Cálculo Automático de Impostos (ISS, PIS, COFINS, CSLL, IRRF)
    router.post('/calcular-impostos', async (req, res, next) => {
        const { valor, municipio } = req.body;
        let impostos = {
            ISS: municipio === 'SP' ? valor * 0.05 : valor * 0.03,
            PIS: valor * 0.0065,
            COFINS: valor * 0.03,
            CSLL: valor * 0.01,
            IRRF: valor * 0.015
        };
        res.json({ impostos });
    });
    
    // 2. Sugestão de Preenchimento com Base no Histórico
    router.get('/sugestao/:cliente_id', async (req, res, next) => {
        const { cliente_id } = req.params;
        const [rows] = await pool.query('SELECT descricao_servico, valor FROM nfe WHERE cliente_id = ? ORDER BY data_emissao DESC LIMIT 1', [cliente_id]);
        if (rows.length) {
            res.json({ sugestao: rows[0] });
        } else {
            res.json({ sugestao: null });
        }
    });
    
    // 3. Validação de Dados em Tempo Real (simulação de API pública)
    router.post('/validar-cliente', async (req, res, next) => {
        const { cnpj, cpf, inscricao_municipal } = req.body;
        // Em produção, integrar com APIs públicas
        const valido = (cnpj || cpf) && inscricao_municipal;
        res.json({ valido, mensagem: valido ? 'Dados válidos.' : 'Dados inválidos.' });
    });
    
    // BUG-002/020: Gerador de chave SEFAZ e protocolo em modo HOMOLOGAÇÃO/SIMULAÇÃO.
    // Formato da chave (44 dígitos, NT2024.002):
    //   UF(2) + AAMM(4) + CNPJ(14) + Modelo(2) + Série(3) + Nº NF(9) + tpEmis(1) + cNF(8) + cDV(1)
    // O dígito verificador segue módulo 11. Marca tpEmis=2 (contingência off-line)
    // e o protocolo recebe prefixo "SIM" para distinguir de transmissão real.
    // Quando o ambiente SEFAZ real for ativado (certificado A1 + WSDL), substituir
    // gerarChaveSimulada()/gerarProtocoloSimulado() pelo retorno do webservice.
    function calcularDV(chave43) {
        const pesos = [2, 3, 4, 5, 6, 7, 8, 9];
        let soma = 0;
        for (let i = chave43.length - 1, p = 0; i >= 0; i--, p++) {
            soma += parseInt(chave43[i], 10) * pesos[p % pesos.length];
        }
        const resto = soma % 11;
        const dv = (resto === 0 || resto === 1) ? 0 : 11 - resto;
        return String(dv);
    }
    function gerarChaveSimulada(cnpj, numeroNf, serie = 1, modelo = 55, uf = '35') {
        const cnpjLimpo = String(cnpj || '').replace(/\D/g, '').padStart(14, '0').slice(-14);
        const hoje = new Date();
        const aamm = String(hoje.getFullYear()).slice(2) + String(hoje.getMonth() + 1).padStart(2, '0');
        const ufCode = String(uf).padStart(2, '0').slice(-2);
        const mod = String(modelo).padStart(2, '0');
        const ser = String(serie).padStart(3, '0');
        const nNF = String(numeroNf || Date.now()).padStart(9, '0').slice(-9);
        const tpEmis = '2'; // 2 = contingência off-line / simulação
        const cNF = String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
        const chave43 = `${ufCode}${aamm}${cnpjLimpo}${mod}${ser}${nNF}${tpEmis}${cNF}`;
        return chave43 + calcularDV(chave43);
    }
    function gerarProtocoloSimulado() {
        const ts = Date.now().toString();
        return 'SIM' + ts.slice(-12).padStart(12, '0');
    }

    // 4. Emissão de NF-e (com integração ao Financeiro e Estoque)
    router.post('/emitir', authenticateToken, async (req, res, next) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const { cliente_id, servico_id, descricao_servico, valor, impostos, vencimento, pedido_id, itens } = req.body;

            // Validar cliente
            const [cliente] = await connection.query('SELECT id FROM clientes WHERE id = ?', [cliente_id]);
            if (cliente.length === 0) {
                await connection.rollback();
                return res.status(404).json({ error: 'Cliente não encontrado' });
            }

            // Buscar CNPJ da empresa para chave (necessário no formato SEFAZ)
            let cnpjEmpresa = '00000000000000';
            try {
                const [[cfg]] = await connection.query('SELECT cnpj FROM configuracoes_empresa LIMIT 1');
                if (cfg && cfg.cnpj) cnpjEmpresa = cfg.cnpj;
            } catch (_) {}

            // Próximo número NF (sequencial simples). Em produção, usar serviço dedicado.
            let proxNumero;
            try {
                const [[r]] = await connection.query('SELECT COALESCE(MAX(numero), 0) + 1 AS prox FROM nfe');
                proxNumero = r.prox || 1;
            } catch (_) {
                proxNumero = Math.floor(Date.now() / 1000) % 999999999;
            }

            const chaveAcesso = gerarChaveSimulada(cnpjEmpresa, proxNumero);
            const protocolo = gerarProtocoloSimulado();

            // Emitir NF-e (já com chave e protocolo simulados)
            // Verifica colunas existentes para evitar erro em schemas antigos
            let colsNfe = new Set();
            try {
                const [cols] = await connection.query('SHOW COLUMNS FROM nfe');
                colsNfe = new Set(cols.map(c => c.Field));
            } catch (_) {}

            const baseCols = ['cliente_id', 'servico_id', 'descricao_servico', 'valor', 'impostos', 'status', 'data_emissao'];
            const baseVals = [cliente_id, servico_id, descricao_servico, valor, JSON.stringify(impostos), 'autorizada'];
            const placeholders = baseCols.slice(0, -1).map(() => '?').concat(['NOW()']);
            const extraCols = [];
            const extraVals = [];
            const extraPh = [];
            if (colsNfe.has('chave_acesso')) { extraCols.push('chave_acesso'); extraVals.push(chaveAcesso); extraPh.push('?'); }
            if (colsNfe.has('protocolo'))    { extraCols.push('protocolo');    extraVals.push(protocolo);   extraPh.push('?'); }
            if (colsNfe.has('protocolo_autorizacao')) { extraCols.push('protocolo_autorizacao'); extraVals.push(protocolo); extraPh.push('?'); }
            if (colsNfe.has('numero'))       { extraCols.push('numero');       extraVals.push(proxNumero);  extraPh.push('?'); }
            if (colsNfe.has('serie'))        { extraCols.push('serie');        extraVals.push(1);           extraPh.push('?'); }
            if (colsNfe.has('ambiente'))     { extraCols.push('ambiente');     extraVals.push('homologacao'); extraPh.push('?'); }

            const allCols = baseCols.concat(extraCols);
            const allPh   = placeholders.concat(extraPh);
            const allVals = baseVals.slice(0, -1).concat(extraVals); // remove o 'autorizada' duplicado? não: base já fica c/ NOW()
            // Re-monta corretamente: status='autorizada' está em baseVals[5]; data_emissao usa NOW()
            const finalCols = ['cliente_id', 'servico_id', 'descricao_servico', 'valor', 'impostos', 'status'].concat(extraCols).concat(['data_emissao']);
            const finalPh   = ['?', '?', '?', '?', '?', '?'].concat(extraPh).concat(['NOW()']);
            const finalVals = [cliente_id, servico_id, descricao_servico, valor, JSON.stringify(impostos), 'autorizada'].concat(extraVals);

            const [nfeResult] = await connection.query(
                `INSERT INTO nfe (${finalCols.join(', ')}) VALUES (${finalPh.join(', ')})`,
                finalVals
            );
            const nfeId = nfeResult.insertId;
    
            // Integração Financeiro: cria conta a receber via serviço centralizado (Sprint 3 Gap-3)
            const contaCriada = await faturamentoShared.gerarContaReceber(connection, {
                pedido_id: pedido_id || null,
                nfe_id: nfeId,                  // FISC-001: rastrear NF-e para cancelamento
                cliente_id,
                descricao: descricao_servico,
                valor,
                tipo: 'nfe',
                pedido: null
            });

            // FISC-001: Se o serviço não persistiu nfe_id, atualizar via UPDATE direto
            if (contaCriada && contaCriada.id) {
                await connection.query(
                    'UPDATE contas_receber SET nfe_id = ? WHERE id = ? AND nfe_id IS NULL',
                    [nfeId, contaCriada.id]
                );
            } else {
                // Fallback: setar nfe_id em entradas recentes desta sessão (max 1 registro)
                await connection.query(
                    'UPDATE contas_receber SET nfe_id = ? WHERE pedido_id = ? AND nfe_id IS NULL ORDER BY id DESC LIMIT 1',
                    [nfeId, pedido_id || null]
                );
            }
    
            // Se há pedido vinculado, atualizar status + trigger logística (LA-001/WF-001)
            if (pedido_id) {
                await connection.query(
                    `UPDATE pedidos
                     SET status = "faturado", nfe_id = ?, data_faturamento = NOW(),
                         status_logistica = CASE
                             WHEN (status_logistica IS NULL OR status_logistica = '') THEN 'aguardando'
                             ELSE status_logistica
                         END
                     WHERE id = ?`,
                    [nfeId, pedido_id]
                );
            }
    
            // AUDIT-FIX S1.2: Integração Estoque com FOR UPDATE (previne race condition / oversell)
            if (itens && Array.isArray(itens) && itens.length > 0) {
                for (const item of itens) {
                    if (item.material_id && item.quantidade > 0) {
                        // FOR UPDATE: lock exclusivo na linha para evitar oversell por concorrência
                        const [material] = await connection.query(
                            'SELECT id, nome, quantidade_estoque FROM materiais WHERE id = ? FOR UPDATE',
                            [item.material_id]
                        );
    
                        if (material.length > 0) {
                            const estoqueAtual = material[0].quantidade_estoque || 0;
                            if (estoqueAtual < item.quantidade) {
                                await connection.rollback();
                                return res.status(400).json({
                                    error: `Estoque insuficiente para ${material[0].nome}. Disponível: ${estoqueAtual}, Solicitado: ${item.quantidade}`
                                });
                            }

                            // Decrementar estoque (materiais)
                            await connection.query(
                                'UPDATE materiais SET quantidade_estoque = quantidade_estoque - ? WHERE id = ?',
                                [item.quantidade, item.material_id]
                            );

                            // Sync estoque unificado (produtos.estoque_atual + tabela estoque)
                            try {
                                if (item.produto_id) {
                                    await connection.query('UPDATE produtos SET estoque_atual = GREATEST(0, estoque_atual - ?) WHERE id = ?', [item.quantidade, item.produto_id]);
                                    await connection.query('UPDATE estoque SET quantidade_disponivel = GREATEST(0, quantidade_disponivel - ?) WHERE produto_id = ?', [item.quantidade, item.produto_id]);
                                }
                            } catch (syncErr) {
                                console.warn(`[NFE] Sync estoque secundário falhou para material ${item.material_id}:`, syncErr.message);
                            }

                            // Registrar movimentação de estoque
                            await connection.query(`
                                INSERT INTO estoque_movimentacoes
                                (material_id, tipo, quantidade, referencia_tipo, referencia_id, observacao, data_movimentacao)
                                VALUES (?, 'saida', ?, 'nfe', ?, 'Saída via faturamento NF-e', NOW())
                            `, [item.material_id, item.quantidade, nfeId]);
                        }
                    }
                }
            }
    
            await connection.commit();
    
            console.log(`✅ NF-e #${nfeId} emitida por usuário ${req.user?.id}`);
            res.json({
                message: 'NF-e emitida e integrada ao Financeiro e Estoque.',
                nfe_id: nfeId
            });
        } catch (error) {
            await connection.rollback();
            next(error);
        } finally {
            connection.release();
        }
    });
    
    // 5. Envio Automático por E-mail (simulação)
    router.post('/enviar-email', async (req, res, next) => {
        // Recebe dados da NF-e e cliente
        res.json({ message: 'E-mail enviado ao cliente com PDF/XML (simulação).' });
    });

    // ============================================================
    // SEFAZ — consulta status do serviço usando o certificado A1
    // GET /api/nfe/sefaz/status
    // Smoke-test do certificado: se responder cStat=107 ('Serviço em
    // Operação'), o cert está OK e o pipeline TLS funciona. Próxima fase:
    // implementar gerarXmlNFe + assinarXmlNFe + autorizarNFe para
    // transmissão real (estimativa 5-10 dias, ver sefaz.service.js).
    // ============================================================
    router.get('/sefaz/status', authenticateToken, async (req, res) => {
        try {
            const { consultarStatusSP } = require('../services/sefaz.service');
            const empresaId = req.user?.empresa_id || 1;
            const resp = await consultarStatusSP(pool, empresaId);

            // Registrar no histórico
            await pool.query(
                `INSERT INTO logs_nfe (operacao, cStat, xMotivo, raw, created_at) VALUES (?, ?, ?, ?, NOW())`,
                ['status_consulta', resp.cStat || null, resp.xMotivo || null, JSON.stringify(resp).slice(0, 8000)]
            ).catch(() => {});

            res.json(resp);
        } catch (e) {
            console.error('[SEFAZ/STATUS] Erro:', e.message);
            res.status(500).json({
                success: false,
                message: e.message,
                hint: e.message.includes('não configurado')
                    ? 'Faça upload do certificado A1 em Configurações → Certificado Digital'
                    : (e.message.includes('expirado')
                        ? 'Renove o certificado A1 antes de continuar'
                        : 'Verifique o certificado e tente novamente')
            });
        }
    });

    // GET/POST ambiente SEFAZ (homologacao | producao)
    router.get('/sefaz/ambiente', authenticateToken, async (req, res) => {
        try {
            const empresaId = req.user?.empresa_id || 1;
            const [[row]] = await pool.query(
                'SELECT ambiente FROM nfe_configuracoes WHERE empresa_id = ? LIMIT 1', [empresaId]
            );
            res.json({ success: true, ambiente: row?.ambiente || 'homologacao' });
        } catch (e) {
            res.status(500).json({ success: false, message: e.message });
        }
    });

    router.post('/sefaz/ambiente', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const empresaId = req.user?.empresa_id || 1;
            const { ambiente } = req.body;
            if (!['homologacao', 'producao'].includes(ambiente)) {
                return res.status(400).json({ success: false, message: 'Ambiente inválido' });
            }
            await pool.query(
                'UPDATE nfe_configuracoes SET ambiente = ?, updated_at = NOW() WHERE empresa_id = ?',
                [ambiente, empresaId]
            );
            res.json({ success: true, ambiente });
        } catch (e) {
            res.status(500).json({ success: false, message: e.message });
        }
    });

    // Espelho fiscal — retorna config emp + cert status sem o BLOB
    router.get('/sefaz/espelho', authenticateToken, async (req, res) => {
        try {
            const { loadEspelhoFiscal, loadCertFromDb } = require('../services/sefaz.service');
            const empresaId = req.user?.empresa_id || 1;
            const espelho = await loadEspelhoFiscal(pool, empresaId);

            // Tenta carregar cert para reportar status (sem incluir PEM na resposta)
            let certStatus = { configurado: false };
            try {
                const cred = await loadCertFromDb(pool, empresaId);
                certStatus = {
                    configurado: true,
                    cnpjCert: cred.cnpjCert,
                    cnpjEmitente: (cred.cnpj || '').replace(/\D/g, ''),
                    cnpjMismatch: cred.cnpjMismatch,
                    certCN: cred.certCN,
                    validade: cred.validade,
                    ambiente: cred.ambiente
                };
            } catch (e) {
                certStatus = { configurado: false, erro: e.message };
            }

            res.json({
                success: true,
                espelho: {
                    razao_social: espelho.razao_social,
                    cnpj: espelho.cnpj,
                    inscricao_estadual: espelho.inscricao_estadual,
                    endereco: `${espelho.endereco || ''}, ${espelho.numero || ''} — ${espelho.bairro || ''} | ${espelho.cidade || ''}/${espelho.uf_emitente}`,
                    codigo_municipio: espelho.codigo_municipio,
                    codigo_uf: espelho.codigo_uf,
                    regime_tributario: espelho.regime_tributario,
                    crt: espelho.crt,
                    ambiente: espelho.ambiente,
                    serie: espelho.serie,
                    proximo_numero: espelho.proximo_numero,
                    cfops: {
                        estado: espelho.cfop_estado,
                        fora_estado: espelho.cfop_fora_estado,
                        exportacao: espelho.cfop_exportacao
                    },
                    aliquotas: {
                        icms: espelho.icms,
                        ipi: espelho.ipi,
                        pis: espelho.pis,
                        cofins: espelho.cofins
                    }
                },
                certificado: certStatus
            });
        } catch (e) {
            console.error('[SEFAZ/ESPELHO] Erro:', e.message);
            res.status(500).json({ success: false, message: e.message });
        }
    });

    // Histórico de eventos SEFAZ (últimas 20)
    router.get('/sefaz/historico', authenticateToken, async (req, res) => {
        try {
            // Garantir tabela
            await pool.query(`CREATE TABLE IF NOT EXISTS logs_nfe (
                id INT PRIMARY KEY AUTO_INCREMENT,
                operacao VARCHAR(50),
                nfe_id INT,
                cStat VARCHAR(10),
                xMotivo VARCHAR(255),
                raw TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX (operacao), INDEX (nfe_id), INDEX (created_at)
            )`).catch(() => {});

            const [rows] = await pool.query(
                `SELECT id, operacao, nfe_id, cStat, xMotivo, created_at
                 FROM logs_nfe ORDER BY id DESC LIMIT 20`
            );
            res.json({ success: true, eventos: rows });
        } catch (e) {
            res.status(500).json({ success: false, message: e.message, eventos: [] });
        }
    });

    // ============================================================
    // TRANSMITIR NF-e real para SEFAZ
    // POST /api/nfe/transmitir/:pedidoId
    // ============================================================
    router.post('/transmitir/:pedidoId', authenticateToken, async (req, res) => {
        try {
            const { loadCertFromDb, loadEspelhoFiscal } = require('../services/sefaz.service');
            const { buildXmlNFe, signXmlNFe, transmitirNFe } = require('../services/sefaz-nfe.service');

            const pedidoId = parseInt(req.params.pedidoId, 10);
            const empresaId = req.user?.empresa_id || 1;

            // 1. Carregar pedido com itens
            const [[pedido]] = await pool.query(`
                SELECT p.*, c.nome as cliente_nome_join, c.razao_social, c.nome_fantasia,
                       c.cnpj, c.cpf, c.endereco, c.numero as cli_numero, c.bairro, c.cidade,
                       c.estado as uf, c.cep, c.email, c.inscricao_estadual
                FROM pedidos p
                LEFT JOIN clientes c ON c.id = p.cliente_id
                WHERE p.id = ? LIMIT 1
            `, [pedidoId]);
            if (!pedido) return res.status(404).json({ success: false, message: 'Pedido não encontrado' });

            const [itens] = await pool.query(`
                SELECT codigo_produto, codigo, produto, descricao, quantidade,
                       preco_unitario, valor_unitario, unidade, ncm
                FROM pedido_itens WHERE pedido_id = ?
            `, [pedidoId]);
            if (!itens.length) return res.status(400).json({ success: false, message: 'Pedido sem itens' });

            // 2. Carregar espelho fiscal completo (empresa_config + config_fiscal_empresa)
            const espelho = await loadEspelhoFiscal(pool, empresaId);

            // 3. Carregar credencial (cert + key PEM) — valida CNPJ
            const cred = await loadCertFromDb(pool, empresaId);

            // Block: se CNPJ do cert não bate com CNPJ do emitente, abortar
            if (cred.cnpjMismatch && cred.ambiente === 'producao') {
                return res.status(400).json({
                    success: false,
                    message: `CNPJ do certificado (${cred.cnpjCert}) não bate com CNPJ do emitente (${(cred.cnpj || '').replace(/\D/g, '')}). Faça upload do certificado correto.`
                });
            }

            // 4. Próximo número de NF (se ainda não tiver)
            let numeroNF = pedido.numero_nf || pedido.nf;
            if (!numeroNF) {
                const [[r]] = await pool.query('SELECT COALESCE(MAX(numero_nf), 0) + 1 AS prox FROM pedidos');
                numeroNF = r.prox || espelho.proximo_numero || 1;
                await pool.query('UPDATE pedidos SET numero_nf = ?, nf = ? WHERE id = ?', [numeroNF, numeroNF, pedidoId]);
                // Incrementar próximo_numero no espelho
                await pool.query('UPDATE empresa_config SET nfe_proximo_numero = ? WHERE id = 1', [Number(numeroNF) + 1]).catch(() => {});
            }

            // 5. cfg = espelho + códigos consolidados
            const cfg = {
                ...espelho,
                cod_municipio: espelho.codigo_municipio
            };

            const pedidoForXml = {
                id: pedidoId,
                numero_nf: numeroNF,
                itens,
                cliente: {
                    razao_social: pedido.razao_social,
                    nome: pedido.cliente_nome_join || pedido.cliente_nome || pedido.cliente,
                    nome_fantasia: pedido.nome_fantasia,
                    cnpj: pedido.cnpj, cpf: pedido.cpf,
                    endereco: pedido.endereco, numero: pedido.cli_numero,
                    bairro: pedido.bairro, cidade: pedido.cidade,
                    uf: pedido.uf, cep: pedido.cep, email: pedido.email,
                    inscricao_estadual: pedido.inscricao_estadual
                }
            };

            // 6. Build + sign + transmit
            const built = buildXmlNFe(pedidoForXml, cfg);
            const signed = signXmlNFe(built.xml, built.infNFeId, cred);
            const resp = await transmitirNFe(signed, cred);

            // 7. Persistir resultado
            await pool.query(
                `INSERT INTO logs_nfe (operacao, nfe_id, cStat, xMotivo, raw, created_at) VALUES (?, ?, ?, ?, ?, NOW())`,
                ['transmissao', pedidoId, resp.cStat, resp.xMotivo, JSON.stringify(resp).slice(0, 8000)]
            ).catch(() => {});

            if (resp.success) {
                // Atualizar pedido com chave e protocolo
                await pool.query(
                    'UPDATE pedidos SET nfe_chave = ?, nfe_protocolo = ? WHERE id = ?',
                    [resp.chave || built.chave, resp.nProt, pedidoId]
                ).catch(async () => {
                    // Se colunas não existem, atualizar via NFE table
                    await pool.query(`UPDATE nfe SET chave_acesso = ?, protocolo = ? WHERE id = (SELECT nfe_id FROM pedidos WHERE id = ? LIMIT 1)`,
                        [resp.chave || built.chave, resp.nProt, pedidoId]).catch(() => {});
                });
            }

            res.json({
                success: resp.success,
                cStat: resp.cStat,
                xMotivo: resp.xMotivo,
                chave: resp.chave || built.chave,
                protocolo: resp.nProt,
                ambiente: cfg.ambiente,
                aviso: cfg.ambiente === 'homologacao'
                    ? '⚠️ Ambiente de HOMOLOGAÇÃO — NF-e sem validade fiscal'
                    : '✅ Ambiente de PRODUÇÃO — NF-e com validade fiscal',
                xml_signed: signed.slice(0, 500) + '...' // preview
            });
        } catch (e) {
            console.error('[SEFAZ/TRANSMITIR] Erro:', e.message, e.stack);
            res.status(500).json({ success: false, message: e.message });
        }
    });

    // ============================================================
    // EVENTO NF-e (cancelamento, CC-e, inutilização)
    // ============================================================
    router.post('/evento/:tipo', authenticateToken, async (req, res) => {
        try {
            const { loadCertFromDb } = require('../services/sefaz.service');
            const { transmitirEvento, transmitirInutilizacao } = require('../services/sefaz-nfe.service');
            const cred = await loadCertFromDb(pool, req.user?.empresa_id || 1);
            const tipo = req.params.tipo;

            let resp;
            if (tipo === 'cancelamento') {
                const { chave, motivo, nProtAutorizacao } = req.body;
                resp = await transmitirEvento({ tipo: 'cancelamento', chave, motivo, nProtAutorizacao, cred });
            } else if (tipo === 'cce' || tipo === 'carta-correcao') {
                const { chave, correcao } = req.body;
                resp = await transmitirEvento({ tipo: 'cce', chave, correcao, cred });
            } else if (tipo === 'inutilizacao') {
                const { ano, serie, nNFIni, nNFFim, motivo } = req.body;
                resp = await transmitirInutilizacao({ ano, serie, nNFIni, nNFFim, motivo, cred });
            } else {
                return res.status(400).json({ success: false, message: 'Tipo de evento inválido' });
            }

            await pool.query(
                `INSERT INTO logs_nfe (operacao, cStat, xMotivo, raw, created_at) VALUES (?, ?, ?, ?, NOW())`,
                [`evento_${tipo}`, resp.cStat, resp.xMotivo, JSON.stringify(resp).slice(0, 8000)]
            ).catch(() => {});

            res.json(resp);
        } catch (e) {
            console.error('[SEFAZ/EVENTO] Erro:', e.message);
            res.status(500).json({ success: false, message: e.message });
        }
    });

    // ============================================================
    // DANFE PDF
    // GET /api/nfe/danfe/:pedidoId
    // ============================================================
    router.get('/danfe/:pedidoId', authenticateToken, async (req, res) => {
        try {
            const { gerarDanfePDF } = require('../services/danfe-pdf.service');
            const pedidoId = parseInt(req.params.pedidoId, 10);

            const [[pedido]] = await pool.query(`
                SELECT p.*, c.razao_social, c.nome as nome_cliente, c.cnpj, c.cpf,
                       c.endereco, c.numero as cli_numero, c.bairro, c.cidade,
                       c.estado as uf, c.cep, c.inscricao_estadual
                FROM pedidos p LEFT JOIN clientes c ON c.id = p.cliente_id
                WHERE p.id = ? LIMIT 1
            `, [pedidoId]);
            if (!pedido) return res.status(404).send('Pedido não encontrado');

            const [itens] = await pool.query('SELECT * FROM pedido_itens WHERE pedido_id = ?', [pedidoId]);
            const [[cfg]] = await pool.query('SELECT * FROM configuracoes_empresa LIMIT 1');

            const nfeData = {
                chave: pedido.nfe_chave,
                protocolo: pedido.nfe_protocolo,
                dhEmissao: pedido.data_faturamento || pedido.created_at,
                numero: pedido.numero_nf || pedido.nf,
                serie: 1
            };

            const pdf = await gerarDanfePDF({
                nfeData,
                pedido: {
                    id: pedidoId,
                    valor: pedido.valor,
                    cliente: {
                        razao_social: pedido.razao_social,
                        nome: pedido.nome_cliente || pedido.cliente_nome || pedido.cliente,
                        cnpj: pedido.cnpj, cpf: pedido.cpf,
                        endereco: pedido.endereco, numero: pedido.cli_numero,
                        bairro: pedido.bairro, cidade: pedido.cidade, uf: pedido.uf,
                        cep: pedido.cep, inscricao_estadual: pedido.inscricao_estadual
                    },
                    itens
                },
                cfg: cfg || {}
            });

            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `inline; filename="danfe-${pedidoId}.pdf"`);
            res.send(pdf);
        } catch (e) {
            console.error('[DANFE] Erro:', e.message, e.stack);
            res.status(500).send('Erro ao gerar DANFE: ' + e.message);
        }
    });

    // BUG-002/020: Backfill — gera chave de acesso e protocolo simulados para
    // NF-es já emitidas que não possuem esses campos. Apenas modo homologação.
    router.post('/backfill-chave', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            // Garante que as colunas existam
            let colsNfe = new Set();
            try {
                const [cols] = await pool.query('SHOW COLUMNS FROM nfe');
                colsNfe = new Set(cols.map(c => c.Field));
            } catch (_) {}

            if (!colsNfe.has('chave_acesso')) {
                try { await pool.query("ALTER TABLE nfe ADD COLUMN chave_acesso VARCHAR(44)"); colsNfe.add('chave_acesso'); } catch (_) {}
            }
            if (!colsNfe.has('protocolo')) {
                try { await pool.query("ALTER TABLE nfe ADD COLUMN protocolo VARCHAR(30)"); colsNfe.add('protocolo'); } catch (_) {}
            }

            // CNPJ da empresa para a chave
            let cnpjEmpresa = '00000000000000';
            try {
                const [[cfg]] = await pool.query('SELECT cnpj FROM configuracoes_empresa LIMIT 1');
                if (cfg && cfg.cnpj) cnpjEmpresa = cfg.cnpj;
            } catch (_) {}

            const [pendentes] = await pool.query(`
                SELECT id, numero, serie, data_emissao
                FROM nfe
                WHERE status NOT IN ('cancelada', 'denegada')
                  AND (chave_acesso IS NULL OR chave_acesso = '' OR LENGTH(chave_acesso) < 44)
            `);

            let atualizadas = 0;
            for (const n of pendentes) {
                try {
                    const chave = gerarChaveSimulada(cnpjEmpresa, n.numero || n.id, n.serie || 1);
                    const proto = gerarProtocoloSimulado();
                    await pool.query(
                        `UPDATE nfe SET chave_acesso = ?${colsNfe.has('protocolo') ? ', protocolo = ?' : ''}${colsNfe.has('protocolo_autorizacao') ? ', protocolo_autorizacao = ?' : ''} WHERE id = ?`,
                        colsNfe.has('protocolo_autorizacao')
                            ? (colsNfe.has('protocolo') ? [chave, proto, proto, n.id] : [chave, proto, n.id])
                            : (colsNfe.has('protocolo') ? [chave, proto, n.id] : [chave, n.id])
                    );
                    atualizadas++;
                } catch (e) {
                    console.error('[NFE-BACKFILL] Erro NFe', n.id, ':', e.message);
                }
            }

            res.json({
                success: true,
                modo: 'homologacao_simulado',
                total_encontradas: pendentes.length,
                atualizadas,
                aviso: 'Chaves/protocolos gerados em modo simulação. NÃO têm validade fiscal real. Para validade SEFAZ, configurar certificado A1 e WSDL.'
            });
        } catch (e) {
            console.error('[NFE-BACKFILL] Erro:', e.message);
            res.status(500).json({ success: false, message: e.message });
        }
    });
    
    // 6. Cancelamento e Carta de Correção
    router.post('/cancelar/:nfe_id', authenticateToken, authorizeAdmin, async (req, res, next) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
    
            const { nfe_id } = req.params;
            const { motivo } = req.body;
    
            if (!motivo || motivo.length < 15) {
                await connection.rollback();
                return res.status(400).json({ error: 'Motivo de cancelamento deve ter no mínimo 15 caracteres' });
            }
    
            // Verificar se NF-e existe e pode ser cancelada
            const [nfe] = await connection.query('SELECT id, status, valor, data_emissao, data_autorizacao FROM nfe WHERE id = ?', [nfe_id]);
            if (nfe.length === 0) {
                await connection.rollback();
                return res.status(404).json({ error: 'NF-e não encontrada' });
            }
            if (nfe[0].status === 'cancelada') {
                await connection.rollback();
                return res.status(400).json({ error: 'NF-e já está cancelada' });
            }

            // FISC-010: Prazo máximo de cancelamento = 24h após autorização (norma SEFAZ NF-e)
            const dataRef = nfe[0].data_autorizacao || nfe[0].data_emissao;
            if (dataRef) {
                const horasDecorridas = (Date.now() - new Date(dataRef).getTime()) / 3600000;
                if (horasDecorridas > 24) {
                    await connection.rollback();
                    return res.status(400).json({
                        error: `Cancelamento fora do prazo. A NF-e foi autorizada há ${Math.floor(horasDecorridas)}h — o prazo máximo é 24h conforme legislação SEFAZ.`,
                        code: 'PRAZO_CANCELAMENTO_EXPIRADO',
                        horas_decorridas: Math.floor(horasDecorridas)
                    });
                }
            }
    
            // Cancelar NF-e
            await connection.query('UPDATE nfe SET status = "cancelada", motivo_cancelamento = ?, data_cancelamento = NOW() WHERE id = ?', [motivo, nfe_id]);
    
            // Reverter conta a receber (marcar como cancelada)
            await connection.query('UPDATE contas_receber SET status = "cancelada", observacao = ? WHERE nfe_id = ?', [`Cancelamento NF-e: ${motivo}`, nfe_id]);
    
            // AUDIT-FIX S1.3: Reverter estoque com idempotência (verifica se já foi estornado)
            const [jaEstornada] = await connection.query(
                'SELECT COUNT(*) as cnt FROM estoque_movimentacoes WHERE referencia_tipo = "nfe_cancelamento" AND referencia_id = ?',
                [nfe_id]
            );
            if (jaEstornada[0].cnt > 0) {
                // Já foi estornado anteriormente — pular para evitar duplicação
                console.warn(`⚠️ NF-e #${nfe_id}: estorno de estoque já realizado, pulando.`);
            } else {
                const [movimentacoes] = await connection.query(
                    'SELECT material_id, quantidade FROM estoque_movimentacoes WHERE referencia_tipo = "nfe" AND referencia_id = ? AND tipo = "saida"',
                    [nfe_id]
                );

                for (const mov of movimentacoes) {
                    // FOR UPDATE implícito: UPDATE atômico (quantidade_estoque + ?)
                    await connection.query('UPDATE materiais SET quantidade_estoque = quantidade_estoque + ? WHERE id = ?', [mov.quantidade, mov.material_id]);

                    // Sync estoque unificado de volta
                    try {
                        await connection.query('UPDATE produtos SET estoque_atual = estoque_atual + ? WHERE id = (SELECT produto_id FROM materiais WHERE id = ? LIMIT 1)', [mov.quantidade, mov.material_id]);
                        await connection.query('UPDATE estoque SET quantidade_disponivel = quantidade_disponivel + ? WHERE produto_id = (SELECT produto_id FROM materiais WHERE id = ? LIMIT 1)', [mov.quantidade, mov.material_id]);
                    } catch (syncErr) {
                        console.warn(`[NFE-CANCEL] Sync estoque secundário falhou para material ${mov.material_id}:`, syncErr.message);
                    }

                    // Registrar movimentação de estorno
                    await connection.query(`
                        INSERT INTO estoque_movimentacoes
                        (material_id, tipo, quantidade, referencia_tipo, referencia_id, observacao, data_movimentacao)
                        VALUES (?, 'entrada', ?, 'nfe_cancelamento', ?, 'Estorno por cancelamento de NF-e', NOW())
                    `, [mov.material_id, mov.quantidade, nfe_id]);
                }
            }
    
            // Atualizar pedido vinculado (volta a 'aprovado' para poder ser re-faturado)
            await connection.query('UPDATE pedidos SET status = "aprovado", nfe_id = NULL WHERE nfe_id = ?', [nfe_id]);
    
            await connection.commit();
    
            console.log(`🚫 NF-e #${nfe_id} cancelada por usuário ${req.user?.id}. Motivo: ${motivo}`);
            res.json({ message: 'NF-e cancelada. Estoque e financeiro revertidos.' });
        } catch (error) {
            await connection.rollback();
            next(error);
        } finally {
            connection.release();
        }
    });
    
    // AUDITORIA ENTERPRISE: Carta de Correção com RBAC e validações fiscais
    router.post('/carta-correcao/:nfe_id', authenticateToken, async (req, res, next) => {
        try {
            const { nfe_id } = req.params;
            const { correcao } = req.body;
    
            // VALIDAÇÃO FISCAL: CC-e deve ter mínimo 15 e máximo 1000 caracteres (SEFAZ)
            if (!correcao || correcao.trim().length < 15) {
                return res.status(400).json({
                    error: 'Correção deve ter no mínimo 15 caracteres conforme norma SEFAZ'
                });
            }
            if (correcao.length > 1000) {
                return res.status(400).json({
                    error: 'Correção excede o limite de 1000 caracteres permitidos pela SEFAZ'
                });
            }
    
            // Verificar se NF-e existe e está autorizada
            const [nfe] = await pool.query('SELECT id, status, numero_nfe FROM nfe WHERE id = ?', [nfe_id]);
            if (nfe.length === 0) {
                return res.status(404).json({ error: 'NF-e não encontrada' });
            }
            if (nfe[0].status !== 'autorizada') {
                return res.status(400).json({
                    error: 'Carta de Correção só pode ser emitida para NF-e autorizada',
                    status_atual: nfe[0].status
                });
            }
    
            // Registrar CC-e com auditoria
            await pool.query(
                `UPDATE nfe SET
                    carta_correcao = ?,
                    carta_correcao_data = NOW(),
                    carta_correcao_usuario = ?
                WHERE id = ?`,
                [correcao, req.user.id, nfe_id]
            );
    
            console.log(`📝 CC-e registrada para NF-e #${nfe[0].numero_nfe} por usuário ${req.user.id}`);
            res.json({
                success: true,
                message: 'Carta de Correção registrada com sucesso.',
                nfe_id,
                usuario_id: req.user.id
            });
        } catch (error) {
            console.error('[NFE] Erro ao registrar CC-e:', error);
            next(error);
        }
    });
    
    // 7. Relatórios Gerenciais
    router.get('/relatorios/faturamento', async (req, res, next) => {
        const { inicio, fim, cliente_id, servico_id } = req.query;
        let where = 'data_emissao >= ? AND data_emissao <= ?';
        let params = [inicio, fim];
        if (cliente_id) { where += ' AND cliente_id = ?'; params.push(cliente_id); }
        if (servico_id) { where += ' AND servico_id = ?'; params.push(servico_id); }
        const [rows] = await pool.query(`SELECT cliente_id, servico_id, SUM(valor) AS total FROM nfe WHERE ${where} GROUP BY cliente_id, servico_id`, params);
        res.json(rows);
    });
    
    // 8. Dashboard de Status das NF-e
    router.get('/dashboard', async (req, res, next) => {
        try {
            // FISC-002: 'emitida' é um status interno coloquial — inclui no grupo 'autorizadas'
            // pois uma NF-e "emitida" sem protocolo deve ser tratada como pendente de autorização
            const [autorizadas] = await pool.query('SELECT COUNT(*) AS qtd, COALESCE(SUM(valor),0) AS total FROM nfe WHERE status IN ("autorizada","emitida") AND MONTH(data_emissao) = MONTH(CURRENT_DATE()) AND YEAR(data_emissao) = YEAR(CURRENT_DATE())');
            const [canceladas] = await pool.query('SELECT COUNT(*) AS qtd, COALESCE(SUM(valor),0) AS total FROM nfe WHERE status = "cancelada" AND MONTH(data_emissao) = MONTH(CURRENT_DATE()) AND YEAR(data_emissao) = YEAR(CURRENT_DATE())');
            const [pendentes] = await pool.query('SELECT COUNT(*) AS qtd, COALESCE(SUM(valor),0) AS total FROM nfe WHERE status IN ("pendente", "rejeitada") AND MONTH(data_emissao) = MONTH(CURRENT_DATE()) AND YEAR(data_emissao) = YEAR(CURRENT_DATE())');
            const qtdAutorizadas = Number(autorizadas[0]?.qtd) || 0;
            const qtdCanceladas = Number(canceladas[0]?.qtd) || 0;
            const qtdPendentes = Number(pendentes[0]?.qtd) || 0;
            const valorAutorizadas = Number(autorizadas[0]?.total) || 0;
            res.json({
                emitidas: qtdAutorizadas + qtdCanceladas + qtdPendentes,
                autorizadas: qtdAutorizadas,
                canceladas: qtdCanceladas,
                pendentes: qtdPendentes,
                valor: valorAutorizadas
            });
        } catch (error) {
            console.error('[NFe] Erro dashboard:', error);
            res.json({ emitidas: 0, autorizadas: 0, canceladas: 0, pendentes: 0, valor: 0 });
        }
    });
    
    // 9. Livro de Registro de Serviços Prestados
    router.get('/livro-registro', async (req, res, next) => {
        const { inicio, fim } = req.query;
        const [rows] = await pool.query('SELECT id, numero, serie, chave_acesso, data_emissao, valor, status, destinatario_nome, destinatario_cnpj, natureza_operacao, cfop FROM nfe WHERE data_emissao >= ? AND data_emissao <= ? ORDER BY data_emissao DESC LIMIT 500', [inicio, fim]);
        res.json(rows);
    });
    
    // Integração com o Painel da Contabilidade (download XMLs em lote)
    router.get('/contabilidade/xmls', async (req, res, next) => {
        const { inicio, fim } = req.query;
        const [rows] = await pool.query('SELECT xml_arquivo FROM nfe WHERE data_emissao >= ? AND data_emissao <= ?', [inicio, fim]);
        res.json(rows);
    });
    
    // Armazenamento e Gestão de XMLs
    router.get('/xml/:nfe_id', async (req, res, next) => {
        const { nfe_id } = req.params;
        const [[nfe]] = await pool.query('SELECT xml_arquivo FROM nfe WHERE id = ?', [nfe_id]);
        if (!nfe) return res.status(404).json({ message: 'NF-e não encontrada.' });
    
        res.json({ xml: nfe.xml_arquivo });
    });

    // 13. Atividades Recentes — GET /api/nfe/atividades?limite=5
    router.get('/atividades', async (req, res, next) => {
        try {
            const limite = parseInt(req.query.limite) || 10;
            const atividades = [];

            // Buscar NF-es recentes (emissões e autorizações)
            try {
                const [emissoes] = await pool.query(
                    `SELECT id, numero_nfe as numero, status, data_emissao as data,
                        CASE status
                            WHEN 'autorizada' THEN 'autorizacao'
                            WHEN 'cancelada' THEN 'cancelamento'
                            WHEN 'rejeitada' THEN 'rejeicao'
                            ELSE 'emissao'
                        END as tipo,
                        CASE status
                            WHEN 'autorizada' THEN CONCAT('NF-e #', COALESCE(numero_nfe, id), ' autorizada')
                            WHEN 'cancelada' THEN CONCAT('NF-e #', COALESCE(numero_nfe, id), ' cancelada')
                            WHEN 'rejeitada' THEN CONCAT('NF-e #', COALESCE(numero_nfe, id), ' rejeitada')
                            ELSE CONCAT('NF-e #', COALESCE(numero_nfe, id), ' emitida')
                        END as descricao
                    FROM nfe
                    ORDER BY COALESCE(data_emissao, data_cancelamento) DESC
                    LIMIT ?`,
                    [limite]
                );
                atividades.push(...emissoes);
            } catch (dbErr) {
                console.log('[NFe] Tabela nfe não disponível:', dbErr.message);
            }

            // Ordenar por data mais recente
            atividades.sort((a, b) => new Date(b.data || 0) - new Date(a.data || 0));

            res.json({
                success: true,
                atividades: atividades.slice(0, limite)
            });
        } catch (error) {
            console.error('[NFe] Erro ao buscar atividades:', error);
            res.json({ success: true, atividades: [] });
        }
    });
    
    return router;
};
