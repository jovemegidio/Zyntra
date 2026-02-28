// =================================================================
// SERVIÇO SPED EFD ICMS/IPI - ALUFORCE v2.0
// Geração do arquivo EFD (SPED Fiscal) conforme Guia Prático
// Layout: EFD ICMS/IPI versão 017 (vigente 2025+)
// =================================================================
'use strict';

const crypto = require('crypto');

class SpedFiscalService {

    /**
     * Gera arquivo SPED Fiscal (EFD ICMS/IPI)
     * @param {Object} pool - MySQL pool
     * @param {number} mes - Mês referência
     * @param {number} ano - Ano referência
     * @param {string} finalidade - '0'=Original '1'=Retificadora
     * @returns {Object} { conteudo, registros, hash }
     */
    static async gerarEFDICMSIPI(pool, mes, ano, finalidade = '0') {
        const linhas = [];
        let totalRegistros = 0;

        // Buscar dados da empresa
        const [configRows] = await pool.query('SELECT * FROM empresa_config WHERE id = 1');
        const empresa = configRows[0] || {};

        const dtIni = `01${String(mes).padStart(2, '0')}${ano}`;
        const dtFin = new Date(ano, mes, 0).getDate() + String(mes).padStart(2, '0') + ano;

        // ==================== BLOCO 0 - ABERTURA ====================
        // Registro 0000 - Abertura do arquivo
        linhas.push(SpedFiscalService._reg0000(empresa, dtIni, dtFin, finalidade));
        totalRegistros++;

        // Registro 0001 - Abertura do Bloco 0
        linhas.push('|0001|0|');
        totalRegistros++;

        // Registro 0005 - Dados complementares da entidade
        linhas.push(SpedFiscalService._reg0005(empresa));
        totalRegistros++;

        // Registro 0100 - Dados do contabilista
        linhas.push(SpedFiscalService._reg0100(empresa));
        totalRegistros++;

        // Registro 0150 - Tabela de participantes (fornecedores + clientes)
        const participantes = await SpedFiscalService._getParticipantes(pool, mes, ano);
        for (const p of participantes) {
            linhas.push(SpedFiscalService._reg0150(p));
            totalRegistros++;
        }

        // Registro 0190 - Unidades de medida usadas
        const unidades = await SpedFiscalService._getUnidades(pool, mes, ano);
        for (const u of unidades) {
            linhas.push(`|0190|${u}|${u}|`);
            totalRegistros++;
        }

        // Registro 0200 - Tabela de produtos
        const produtos = await SpedFiscalService._getProdutos(pool, mes, ano);
        for (const prod of produtos) {
            linhas.push(SpedFiscalService._reg0200(prod));
            totalRegistros++;
        }

        // Registro 0990 - Encerramento do Bloco 0
        const qtd0 = totalRegistros + 1;
        linhas.push(`|0990|${qtd0}|`);
        totalRegistros++;

        // ==================== BLOCO C - DOCUMENTOS FISCAIS ====================
        linhas.push('|C001|0|');
        totalRegistros++;
        const inicioC = totalRegistros;

        // Registro C100 - NF-e Saída
        const nfSaidas = await SpedFiscalService._getNFSaidas(pool, mes, ano);
        for (const nf of nfSaidas) {
            linhas.push(SpedFiscalService._regC100(nf, '1')); // 1 = saída
            totalRegistros++;

            // C170 - Itens do documento
            if (nf.itens) {
                for (const item of nf.itens) {
                    linhas.push(SpedFiscalService._regC170(item));
                    totalRegistros++;
                }
            }

            // C190 - Registro analítico (CFOP + CST)
            if (nf.analiticos) {
                for (const a of nf.analiticos) {
                    linhas.push(SpedFiscalService._regC190(a));
                    totalRegistros++;
                }
            }
        }

        // Registro C100 - NF-e Entrada
        const nfEntradas = await SpedFiscalService._getNFEntradas(pool, mes, ano);
        for (const nf of nfEntradas) {
            linhas.push(SpedFiscalService._regC100(nf, '0')); // 0 = entrada
            totalRegistros++;

            if (nf.itens) {
                for (const item of nf.itens) {
                    linhas.push(SpedFiscalService._regC170(item));
                    totalRegistros++;
                }
            }
            if (nf.analiticos) {
                for (const a of nf.analiticos) {
                    linhas.push(SpedFiscalService._regC190(a));
                    totalRegistros++;
                }
            }
        }

        const qtdC = (totalRegistros - inicioC) + 2; // +1 C001 +1 C990
        linhas.push(`|C990|${qtdC}|`);
        totalRegistros++;

        // ==================== BLOCO D - SERVIÇOS (CT-e) ====================
        // Bloco vazio (sem CT-e por enquanto — Fase 5 irá preencher)
        linhas.push('|D001|1|'); // 1 = sem dados
        totalRegistros++;
        linhas.push('|D990|2|');
        totalRegistros++;

        // ==================== BLOCO E - APURAÇÃO ====================
        linhas.push('|E001|0|');
        totalRegistros++;
        const inicioE = totalRegistros;

        // Registro E100 - Período da apuração ICMS
        linhas.push(`|E100|${dtIni}|${dtFin}|`);
        totalRegistros++;

        // Registro E110 - Apuração ICMS
        const apuracao = await SpedFiscalService._calcularApuracao(pool, mes, ano);
        linhas.push(SpedFiscalService._regE110(apuracao));
        totalRegistros++;

        const qtdE = (totalRegistros - inicioE) + 2;
        linhas.push(`|E990|${qtdE}|`);
        totalRegistros++;

        // ==================== BLOCOS G, H, K (vazios) ====================
        for (const bloco of ['G', 'H', 'K']) {
            linhas.push(`|${bloco}001|1|`);
            totalRegistros++;
            linhas.push(`|${bloco}990|2|`);
            totalRegistros++;
        }

        // ==================== BLOCO 1 - INFORMAÇÕES COMPLEMENTARES ====================
        linhas.push('|1001|1|');
        totalRegistros++;
        linhas.push('|1990|2|');
        totalRegistros++;

        // ==================== BLOCO 9 - CONTROLE E ENCERRAMENTO ====================
        linhas.push('|9001|0|');
        totalRegistros++;
        // 9900 - Contadores de cada registro (simplificado)
        linhas.push(`|9900|0000|1|`);
        totalRegistros++;
        linhas.push(`|9900|9999|1|`);
        totalRegistros++;
        linhas.push('|9990|3|');
        totalRegistros++;

        // Registro 9999 - Encerramento do arquivo
        totalRegistros++; // conta ele mesmo
        linhas.push(`|9999|${totalRegistros}|`);

        const conteudo = linhas.join('\r\n') + '\r\n';
        const hash = crypto.createHash('sha256').update(conteudo).digest('hex');

        return {
            conteudo,
            registros: totalRegistros,
            hash,
            periodo: { mes, ano },
            tipo: 'efd_icms_ipi'
        };
    }

    // ==================== REGISTROS BLOCO 0 ====================

    static _reg0000(emp, dtIni, dtFin, finalidade) {
        const cod_ver = '017'; // versão layout 2025
        const cod_fin = finalidade;
        const ind_perfil = 'A'; // Perfil A = completo
        return `|0000|${cod_ver}|${cod_fin}|${dtIni}|${dtFin}|${emp.razao_social || ''}|${emp.cnpj || ''}|` +
               `${emp.codigo_uf || '35'}|${emp.inscricao_estadual || ''}|${emp.codigo_municipio || ''}|` +
               `||${ind_perfil}|0|`;
    }

    static _reg0005(emp) {
        return `|0005|${emp.nome_fantasia || emp.razao_social || ''}|` +
               `${emp.cep || ''}|${emp.endereco || ''}|${emp.numero_endereco || ''}|` +
               `${emp.complemento || ''}|${emp.bairro || ''}|${emp.telefone || ''}|` +
               `${emp.fax || ''}|${emp.email || ''}|`;
    }

    static _reg0100(emp) {
        // Dados do contabilista (simplificado — sem dados completos)
        return `|0100|${emp.contador_nome || 'CONTABILIDADE'}|` +
               `${emp.contador_cpf || ''}|${emp.contador_crc || ''}|` +
               `${emp.contador_cnpj || ''}||||||||${emp.contador_email || ''}|` +
               `${emp.codigo_municipio || ''}|`;
    }

    static _reg0150(p) {
        return `|0150|${p.codigo}|${p.nome}|${p.pais || '01058'}|` +
               `${p.cnpj || ''}|${p.cpf || ''}|${p.ie || ''}|` +
               `${p.cod_mun || ''}|${p.suframa || ''}|${p.endereco || ''}|` +
               `${p.numero || ''}|${p.complemento || ''}|${p.bairro || ''}|`;
    }

    static _reg0200(prod) {
        return `|0200|${prod.codigo}|${prod.descricao}|${prod.codigo_barras || ''}|` +
               `||${prod.unidade || 'UN'}|${SpedFiscalService._dec(prod.aliquota_icms)}|` +
               `||${prod.ncm || ''}|${prod.ex_tipi || ''}|${prod.genero || ''}|` +
               `||${prod.cest || ''}|`;
    }

    // ==================== REGISTROS BLOCO C ====================

    static _regC100(nf, indOper) {
        // indOper: 0=Entrada 1=Saída
        const indEmit = indOper === '1' ? '0' : '1'; // 0=emissão própria 1=terceiros
        return `|C100|${indOper}|${indEmit}|${nf.participante_cod || ''}|55|00|` +
               `${nf.serie || '1'}|${nf.numero || ''}|${nf.chave_acesso || ''}|` +
               `${SpedFiscalService._data(nf.data_emissao)}|${SpedFiscalService._data(nf.data_saida_entrada)}|` +
               `${SpedFiscalService._dec(nf.valor_total)}|0|` +
               `${SpedFiscalService._dec(nf.valor_desconto)}|` +
               `${SpedFiscalService._dec(nf.valor_produtos)}|` +
               `${SpedFiscalService._dec(nf.valor_frete)}|` +
               `${SpedFiscalService._dec(nf.valor_seguro)}|` +
               `${SpedFiscalService._dec(nf.valor_outros)}|` +
               `${SpedFiscalService._dec(nf.bc_icms)}|` +
               `${SpedFiscalService._dec(nf.valor_icms)}|` +
               `${SpedFiscalService._dec(nf.bc_icms_st)}|` +
               `${SpedFiscalService._dec(nf.valor_icms_st)}|` +
               `${SpedFiscalService._dec(nf.valor_ipi)}|` +
               `${SpedFiscalService._dec(nf.valor_pis)}|` +
               `${SpedFiscalService._dec(nf.valor_cofins)}|` +
               `${SpedFiscalService._dec(nf.valor_pis_st)}|` +
               `${SpedFiscalService._dec(nf.valor_cofins_st)}|`;
    }

    static _regC170(item) {
        return `|C170|${item.numero_item}|${item.codigo_produto}|${item.descricao}|` +
               `${SpedFiscalService._dec(item.quantidade)}|${item.unidade || 'UN'}|` +
               `${SpedFiscalService._dec(item.valor_total)}|` +
               `${SpedFiscalService._dec(item.valor_desconto)}|0|${item.cst_icms || ''}|` +
               `${item.cfop || ''}|${item.ncm || ''}|` +
               `${SpedFiscalService._dec(item.bc_icms)}|${SpedFiscalService._dec(item.aliquota_icms)}|` +
               `${SpedFiscalService._dec(item.valor_icms)}|` +
               `${SpedFiscalService._dec(item.bc_icms_st)}|${SpedFiscalService._dec(item.aliquota_icms_st)}|` +
               `${SpedFiscalService._dec(item.valor_icms_st)}|` +
               `||${SpedFiscalService._dec(item.valor_ipi)}|` +
               `${item.cst_ipi || ''}|${SpedFiscalService._dec(item.bc_ipi)}|` +
               `${SpedFiscalService._dec(item.aliquota_ipi)}|${SpedFiscalService._dec(item.valor_ipi)}|` +
               `${item.cst_pis || ''}|${SpedFiscalService._dec(item.bc_pis)}|` +
               `${SpedFiscalService._dec(item.aliquota_pis)}|${SpedFiscalService._dec(item.valor_pis)}|` +
               `${item.cst_cofins || ''}|${SpedFiscalService._dec(item.bc_cofins)}|` +
               `${SpedFiscalService._dec(item.aliquota_cofins)}|${SpedFiscalService._dec(item.valor_cofins)}|` +
               `${item.codigo_conta || ''}|`;
    }

    static _regC190(a) {
        return `|C190|${a.cst_icms || ''}|${a.cfop || ''}|${SpedFiscalService._dec(a.aliquota_icms)}|` +
               `${SpedFiscalService._dec(a.valor_operacao)}|` +
               `${SpedFiscalService._dec(a.bc_icms)}|${SpedFiscalService._dec(a.valor_icms)}|` +
               `${SpedFiscalService._dec(a.bc_icms_st)}|${SpedFiscalService._dec(a.valor_icms_st)}|` +
               `${SpedFiscalService._dec(a.valor_ipi)}|` +
               `${a.codigo_observacao || ''}|`;
    }

    // ==================== REGISTRO BLOCO E ====================

    static _regE110(ap) {
        return `|E110|${SpedFiscalService._dec(ap.total_debitos)}|` +
               `${SpedFiscalService._dec(ap.estorno_creditos)}|` +
               `${SpedFiscalService._dec(ap.outros_debitos)}|` +
               `${SpedFiscalService._dec(ap.total_creditos)}|` +
               `${SpedFiscalService._dec(ap.estorno_debitos)}|` +
               `${SpedFiscalService._dec(ap.outros_creditos)}|` +
               `${SpedFiscalService._dec(ap.saldo_credor_anterior)}|` +
               `${SpedFiscalService._dec(ap.saldo_devedor)}|` +
               `${SpedFiscalService._dec(ap.saldo_credor)}|` +
               `${SpedFiscalService._dec(ap.deducoes)}|` +
               `${SpedFiscalService._dec(ap.icms_recolher)}|` +
               `${SpedFiscalService._dec(ap.saldo_credor_transportar)}|` +
               `${SpedFiscalService._dec(ap.debito_extra)}|`;
    }

    // ==================== CONSULTAS AO BANCO ====================

    static async _getParticipantes(pool, mes, ano) {
        try {
            // Buscar fornecedores das NFs de entrada e clientes das NFs de saída
            const [fornecedores] = await pool.query(`
                SELECT DISTINCT fornecedor_cnpj as cnpj, fornecedor_razao_social as nome,
                    fornecedor_ie as ie, fornecedor_uf as uf, fornecedor_codigo_municipio as cod_mun
                FROM nf_entrada
                WHERE MONTH(data_emissao) = ? AND YEAR(data_emissao) = ? AND status != 'cancelada'
            `, [mes, ano]);

            const participantes = [];
            let cod = 1;
            for (const f of fornecedores) {
                participantes.push({
                    codigo: `FORN${String(cod++).padStart(5, '0')}`,
                    nome: f.nome || '',
                    cnpj: f.cnpj || '',
                    ie: f.ie || '',
                    cod_mun: f.cod_mun || '',
                    endereco: '',
                    numero: '',
                    complemento: '',
                    bairro: ''
                });
            }

            return participantes;
        } catch (e) {
            console.warn('[SPED] Erro ao buscar participantes:', e.message);
            return [];
        }
    }

    static async _getUnidades(pool, mes, ano) {
        try {
            const [rows] = await pool.query(`
                SELECT DISTINCT unidade FROM nf_entrada_itens i
                JOIN nf_entrada n ON n.id = i.nf_entrada_id
                WHERE MONTH(n.data_emissao) = ? AND YEAR(n.data_emissao) = ?
            `, [mes, ano]);
            return rows.map(r => r.unidade || 'UN');
        } catch (e) {
            return ['UN', 'KG', 'MT', 'M2', 'PC'];
        }
    }

    static async _getProdutos(pool, mes, ano) {
        try {
            const [rows] = await pool.query(`
                SELECT DISTINCT i.codigo_produto as codigo, i.descricao, i.ncm, i.unidade
                FROM nf_entrada_itens i
                JOIN nf_entrada n ON n.id = i.nf_entrada_id
                WHERE MONTH(n.data_emissao) = ? AND YEAR(n.data_emissao) = ?
                LIMIT 1000
            `, [mes, ano]);
            return rows;
        } catch (e) {
            return [];
        }
    }

    static async _getNFEntradas(pool, mes, ano) {
        try {
            const [notas] = await pool.query(`
                SELECT * FROM nf_entrada
                WHERE MONTH(data_emissao) = ? AND YEAR(data_emissao) = ?
                    AND status IN ('escriturada', 'conferida')
                ORDER BY data_emissao
            `, [mes, ano]);

            for (const nf of notas) {
                const [itens] = await pool.query(
                    'SELECT * FROM nf_entrada_itens WHERE nf_entrada_id = ? ORDER BY numero_item',
                    [nf.id]
                );
                nf.itens = itens.map((item, idx) => ({
                    ...item,
                    numero_item: item.numero_item || idx + 1,
                    codigo_produto: item.codigo_produto || '',
                    descricao: item.descricao || ''
                }));

                // Gerar analíticos (agrupamento por CST+CFOP+Alíquota)
                const agrupados = {};
                for (const item of itens) {
                    const chave = `${item.cst_icms || ''}|${item.cfop || ''}|${item.aliquota_icms || 0}`;
                    if (!agrupados[chave]) {
                        agrupados[chave] = {
                            cst_icms: item.cst_icms || '',
                            cfop: item.cfop || '',
                            aliquota_icms: item.aliquota_icms || 0,
                            valor_operacao: 0, bc_icms: 0, valor_icms: 0,
                            bc_icms_st: 0, valor_icms_st: 0, valor_ipi: 0
                        };
                    }
                    agrupados[chave].valor_operacao += parseFloat(item.valor_total) || 0;
                    agrupados[chave].bc_icms += parseFloat(item.bc_icms) || 0;
                    agrupados[chave].valor_icms += parseFloat(item.valor_icms) || 0;
                    agrupados[chave].valor_ipi += parseFloat(item.valor_ipi) || 0;
                }
                nf.analiticos = Object.values(agrupados);
                nf.participante_cod = `FORN${String(1).padStart(5, '0')}`; // simplificado
            }

            return notas;
        } catch (e) {
            console.warn('[SPED] Erro ao buscar NF entradas:', e.message);
            return [];
        }
    }

    static async _getNFSaidas(pool, mes, ano) {
        // Buscar NF-e emitidas (tabela depende do módulo de Faturamento)
        try {
            const [notas] = await pool.query(`
                SELECT * FROM nfe_emitidas
                WHERE MONTH(data_emissao) = ? AND YEAR(data_emissao) = ?
                    AND status IN ('autorizada', 'emitida')
                ORDER BY data_emissao
            `, [mes, ano]);

            for (const nf of notas) {
                try {
                    const [itens] = await pool.query(
                        'SELECT * FROM nfe_emitidas_itens WHERE nfe_emitida_id = ? ORDER BY numero_item',
                        [nf.id]
                    );
                    nf.itens = itens;

                    // Analíticos
                    const agrupados = {};
                    for (const item of itens) {
                        const chave = `${item.cst_icms || ''}|${item.cfop || ''}|${item.aliquota_icms || 0}`;
                        if (!agrupados[chave]) {
                            agrupados[chave] = {
                                cst_icms: item.cst_icms || '', cfop: item.cfop || '',
                                aliquota_icms: item.aliquota_icms || 0,
                                valor_operacao: 0, bc_icms: 0, valor_icms: 0,
                                bc_icms_st: 0, valor_icms_st: 0, valor_ipi: 0
                            };
                        }
                        agrupados[chave].valor_operacao += parseFloat(item.valor_total) || 0;
                        agrupados[chave].bc_icms += parseFloat(item.bc_icms) || 0;
                        agrupados[chave].valor_icms += parseFloat(item.valor_icms) || 0;
                        agrupados[chave].valor_ipi += parseFloat(item.valor_ipi) || 0;
                    }
                    nf.analiticos = Object.values(agrupados);
                } catch (e) {
                    nf.itens = [];
                    nf.analiticos = [];
                }
            }

            return notas;
        } catch (e) {
            console.warn('[SPED] Tabela nfe_emitidas não encontrada:', e.message);
            return [];
        }
    }

    static async _calcularApuracao(pool, mes, ano) {
        // Tentar ler apuração existente
        try {
            const [rows] = await pool.query(
                'SELECT * FROM apuracao_icms WHERE competencia_mes = ? AND competencia_ano = ?',
                [mes, ano]
            );
            if (rows.length > 0 && rows[0].status !== 'aberta') {
                return rows[0];
            }
        } catch (e) { /* continua calculando */ }

        // Calcular a partir dos documentos
        let totalDebitos = 0, totalCreditos = 0;
        try {
            const [debitos] = await pool.query(`
                SELECT COALESCE(SUM(valor_icms), 0) as total FROM nfe_emitidas
                WHERE MONTH(data_emissao) = ? AND YEAR(data_emissao) = ?
                AND status IN ('autorizada', 'emitida')
            `, [mes, ano]);
            totalDebitos = parseFloat(debitos[0].total) || 0;
        } catch (e) { /* sem NFs de saída */ }

        try {
            const [creditos] = await pool.query(`
                SELECT COALESCE(SUM(credito_icms), 0) as total FROM nf_entrada
                WHERE MONTH(data_emissao) = ? AND YEAR(data_emissao) = ?
                AND status = 'escriturada'
            `, [mes, ano]);
            totalCreditos = parseFloat(creditos[0].total) || 0;
        } catch (e) { /* sem NFs de entrada */ }

        // Buscar saldo credor anterior
        let saldoCredorAnterior = 0;
        try {
            const mesAnt = mes === 1 ? 12 : mes - 1;
            const anoAnt = mes === 1 ? ano - 1 : ano;
            const [anterior] = await pool.query(
                'SELECT saldo_credor FROM apuracao_icms WHERE competencia_mes = ? AND competencia_ano = ?',
                [mesAnt, anoAnt]
            );
            if (anterior.length > 0) {
                saldoCredorAnterior = parseFloat(anterior[0].saldo_credor) || 0;
            }
        } catch (e) { /* primeiro período */ }

        const saldoDevedor = Math.max(0, totalDebitos - totalCreditos - saldoCredorAnterior);
        const saldoCredor = Math.max(0, totalCreditos + saldoCredorAnterior - totalDebitos);

        return {
            total_debitos: totalDebitos,
            estorno_creditos: 0,
            outros_debitos: 0,
            total_creditos: totalCreditos,
            estorno_debitos: 0,
            outros_creditos: 0,
            saldo_credor_anterior: saldoCredorAnterior,
            saldo_devedor: saldoDevedor,
            saldo_credor: saldoCredor,
            deducoes: 0,
            icms_recolher: saldoDevedor,
            saldo_credor_transportar: saldoCredor,
            debito_extra: 0
        };
    }

    // ==================== HELPERS ====================

    static _dec(valor) {
        if (valor === null || valor === undefined || valor === '') return '0,00';
        const num = parseFloat(valor) || 0;
        return num.toFixed(2).replace('.', ',');
    }

    static _data(data) {
        if (!data) return '';
        const d = new Date(data);
        if (isNaN(d.getTime())) return '';
        return String(d.getDate()).padStart(2, '0') +
               String(d.getMonth() + 1).padStart(2, '0') +
               d.getFullYear();
    }
}

// ==================================================================
// SERVIÇO EFD CONTRIBUIÇÕES (PIS/COFINS)
// ==================================================================

class SpedContribuicoesService {

    /**
     * Gera arquivo EFD Contribuições (SPED PIS/COFINS)
     */
    static async gerarEFDContribuicoes(pool, mes, ano, finalidade = '0') {
        const linhas = [];
        let totalRegistros = 0;

        const [configRows] = await pool.query('SELECT * FROM empresa_config WHERE id = 1');
        const empresa = configRows[0] || {};
        const regime = empresa.regime_tributario || 'simples';

        if (regime === 'simples') {
            throw new Error('Empresas do Simples Nacional não geram EFD Contribuições');
        }

        const dtIni = `01${String(mes).padStart(2, '0')}${ano}`;
        const dtFin = new Date(ano, mes, 0).getDate() + String(mes).padStart(2, '0') + ano;

        // Bloco 0 - Abertura
        linhas.push(`|0000|007|0|${dtIni}|${dtFin}|${empresa.razao_social || ''}|` +
                     `${empresa.cnpj || ''}|${empresa.codigo_uf || '35'}|${empresa.codigo_municipio || ''}|` +
                     `${empresa.suframa || ''}|${regime === 'normal' ? '01' : '02'}|` +
                     `||${finalidade}|0|1|`);
        totalRegistros++;

        linhas.push('|0001|0|');
        totalRegistros++;

        // 0140 - Estabelecimento
        linhas.push(`|0140|${empresa.cnpj || ''}|${empresa.razao_social || ''}|` +
                     `${empresa.nome_fantasia || ''}|${empresa.cep || ''}|` +
                     `${empresa.endereco || ''}|${empresa.numero_endereco || ''}|` +
                     `${empresa.complemento || ''}|${empresa.bairro || ''}|` +
                     `${empresa.codigo_municipio || ''}|${empresa.inscricao_estadual || ''}|${empresa.suframa || ''}|`);
        totalRegistros++;

        linhas.push(`|0990|${totalRegistros + 1}|`);
        totalRegistros++;

        // Bloco A - Serviços (vazio)
        linhas.push('|A001|1|');
        totalRegistros++;
        linhas.push('|A990|2|');
        totalRegistros++;

        // Bloco C - Documentos (NF-e PIS/COFINS)
        linhas.push('|C001|0|');
        totalRegistros++;
        const inicioC = totalRegistros;

        // Saídas - Débitos de PIS/COFINS
        try {
            const [nfs] = await pool.query(`
                SELECT * FROM nfe_emitidas
                WHERE MONTH(data_emissao) = ? AND YEAR(data_emissao) = ?
                AND status IN ('autorizada', 'emitida')
            `, [mes, ano]);

            for (const nf of nfs) {
                // C010 - Identificação do estabelecimento
                // C100 - Documento
                linhas.push(`|C100|1|0|${nf.participante_codigo || ''}|55|00|` +
                            `${nf.serie || '1'}|${nf.numero || ''}|${nf.chave_acesso || ''}|` +
                            `${SpedFiscalService._data(nf.data_emissao)}|` +
                            `${SpedFiscalService._dec(nf.valor_total)}|` +
                            `${SpedFiscalService._dec(nf.valor_desconto)}|0|0|0|0|0|0|0|` +
                            `${SpedFiscalService._dec(nf.valor_pis)}|${SpedFiscalService._dec(nf.valor_cofins)}|`);
                totalRegistros++;
            }
        } catch (e) { /* sem NFs saída */ }

        // Entradas - Créditos de PIS/COFINS
        try {
            const [nfs] = await pool.query(`
                SELECT * FROM nf_entrada
                WHERE MONTH(data_emissao) = ? AND YEAR(data_emissao) = ?
                AND status = 'escriturada'
            `, [mes, ano]);

            for (const nf of nfs) {
                linhas.push(`|C100|0|1|${nf.fornecedor_cnpj || ''}|55|00|` +
                            `${nf.serie || '1'}|${nf.numero_nfe || ''}|${nf.chave_acesso || ''}|` +
                            `${SpedFiscalService._data(nf.data_emissao)}|` +
                            `${SpedFiscalService._dec(nf.valor_total)}|` +
                            `${SpedFiscalService._dec(nf.valor_desconto)}|0|0|0|0|0|0|0|` +
                            `${SpedFiscalService._dec(nf.credito_pis)}|${SpedFiscalService._dec(nf.credito_cofins)}|`);
                totalRegistros++;
            }
        } catch (e) { /* sem NFs entrada */ }

        const qtdC = (totalRegistros - inicioC) + 2;
        linhas.push(`|C990|${qtdC}|`);
        totalRegistros++;

        // Blocos D, F (vazios)
        for (const bloco of ['D', 'F']) {
            linhas.push(`|${bloco}001|1|`);
            totalRegistros++;
            linhas.push(`|${bloco}990|2|`);
            totalRegistros++;
        }

        // Bloco M - Apuração PIS/COFINS
        linhas.push('|M001|0|');
        totalRegistros++;

        const apuracao = await SpedContribuicoesService._calcularApuracao(pool, mes, ano);

        // M200 - Consolidação PIS
        linhas.push(`|M200|${SpedFiscalService._dec(apuracao.pis_debito_saidas)}|` +
                     `${SpedFiscalService._dec(apuracao.pis_credito_entradas)}|` +
                     `${SpedFiscalService._dec(apuracao.pis_outros_creditos)}|` +
                     `${SpedFiscalService._dec(apuracao.pis_saldo_credor_anterior)}|` +
                     `${SpedFiscalService._dec(apuracao.pis_a_recolher)}|` +
                     `${SpedFiscalService._dec(apuracao.pis_saldo_credor)}|0,00|`);
        totalRegistros++;

        // M600 - Consolidação COFINS
        linhas.push(`|M600|${SpedFiscalService._dec(apuracao.cofins_debito_saidas)}|` +
                     `${SpedFiscalService._dec(apuracao.cofins_credito_entradas)}|` +
                     `${SpedFiscalService._dec(apuracao.cofins_outros_creditos)}|` +
                     `${SpedFiscalService._dec(apuracao.cofins_saldo_credor_anterior)}|` +
                     `${SpedFiscalService._dec(apuracao.cofins_a_recolher)}|` +
                     `${SpedFiscalService._dec(apuracao.cofins_saldo_credor)}|0,00|`);
        totalRegistros++;

        linhas.push(`|M990|4|`);
        totalRegistros++;

        // Blocos 1, 9
        linhas.push('|1001|1|');
        totalRegistros++;
        linhas.push('|1990|2|');
        totalRegistros++;

        linhas.push('|9001|0|');
        totalRegistros++;
        totalRegistros++;
        linhas.push(`|9999|${totalRegistros}|`);

        const conteudo = linhas.join('\r\n') + '\r\n';
        const hash = crypto.createHash('sha256').update(conteudo).digest('hex');

        return {
            conteudo,
            registros: totalRegistros,
            hash,
            periodo: { mes, ano },
            tipo: 'efd_contribuicoes'
        };
    }

    static async _calcularApuracao(pool, mes, ano) {
        let pisDebito = 0, cofinsDebito = 0;
        let pisCredito = 0, cofinsCredito = 0;

        try {
            const [debitos] = await pool.query(`
                SELECT COALESCE(SUM(valor_pis), 0) as pis, COALESCE(SUM(valor_cofins), 0) as cofins
                FROM nfe_emitidas WHERE MONTH(data_emissao) = ? AND YEAR(data_emissao) = ?
                AND status IN ('autorizada', 'emitida')
            `, [mes, ano]);
            pisDebito = parseFloat(debitos[0].pis) || 0;
            cofinsDebito = parseFloat(debitos[0].cofins) || 0;
        } catch (e) { /* sem saídas */ }

        try {
            const [creditos] = await pool.query(`
                SELECT COALESCE(SUM(credito_pis), 0) as pis, COALESCE(SUM(credito_cofins), 0) as cofins
                FROM nf_entrada WHERE MONTH(data_emissao) = ? AND YEAR(data_emissao) = ?
                AND status = 'escriturada'
            `, [mes, ano]);
            pisCredito = parseFloat(creditos[0].pis) || 0;
            cofinsCredito = parseFloat(creditos[0].cofins) || 0;
        } catch (e) { /* sem entradas */ }

        // Buscar saldo credor anterior
        let pisSaldoAnt = 0, cofinsSaldoAnt = 0;
        try {
            const mesAnt = mes === 1 ? 12 : mes - 1;
            const anoAnt = mes === 1 ? ano - 1 : ano;
            const [ant] = await pool.query(
                'SELECT pis_saldo_credor, cofins_saldo_credor FROM apuracao_pis_cofins WHERE competencia_mes = ? AND competencia_ano = ?',
                [mesAnt, anoAnt]
            );
            if (ant.length > 0) {
                pisSaldoAnt = parseFloat(ant[0].pis_saldo_credor) || 0;
                cofinsSaldoAnt = parseFloat(ant[0].cofins_saldo_credor) || 0;
            }
        } catch (e) { /* primeiro período */ }

        return {
            pis_debito_saidas: pisDebito,
            pis_credito_entradas: pisCredito,
            pis_outros_creditos: 0,
            pis_saldo_credor_anterior: pisSaldoAnt,
            pis_a_recolher: Math.max(0, pisDebito - pisCredito - pisSaldoAnt),
            pis_saldo_credor: Math.max(0, pisCredito + pisSaldoAnt - pisDebito),

            cofins_debito_saidas: cofinsDebito,
            cofins_credito_entradas: cofinsCredito,
            cofins_outros_creditos: 0,
            cofins_saldo_credor_anterior: cofinsSaldoAnt,
            cofins_a_recolher: Math.max(0, cofinsDebito - cofinsCredito - cofinsSaldoAnt),
            cofins_saldo_credor: Math.max(0, cofinsCredito + cofinsSaldoAnt - cofinsDebito)
        };
    }
}

// ==================================================================
// SERVIÇO SINTEGRA
// ==================================================================

class SintegraService {

    /**
     * Gera arquivo Sintegra (para UFs que ainda exigem)
     */
    static async gerarSintegra(pool, mes, ano) {
        const linhas = [];

        const [configRows] = await pool.query('SELECT * FROM empresa_config WHERE id = 1');
        const empresa = configRows[0] || {};

        const dtIni = `${ano}${String(mes).padStart(2, '0')}01`;
        const dtFin = `${ano}${String(mes).padStart(2, '0')}${new Date(ano, mes, 0).getDate()}`;

        // Registro 10 - Mestre do estabelecimento
        const r10 = '10' +
            SintegraService._pad(empresa.cnpj, 14) +
            SintegraService._pad(empresa.inscricao_estadual, 14) +
            SintegraService._pad(empresa.razao_social, 35) +
            SintegraService._pad(empresa.cidade || '', 30) +
            SintegraService._pad(empresa.uf || 'SP', 2) +
            SintegraService._pad('', 10) + // fax
            dtIni + dtFin +
            '3' + // código 3 = totalizadores
            '3' + // código 3 = totaliz. parcial
            '1'; // natureza = indústria

        linhas.push(r10);

        // Registro 11 - Dados complementares
        const r11 = '11' +
            SintegraService._pad(empresa.endereco || '', 34) +
            SintegraService._pad(empresa.numero_endereco || '', 5) +
            SintegraService._pad(empresa.complemento || '', 22) +
            SintegraService._pad(empresa.bairro || '', 15) +
            SintegraService._pad(empresa.cep || '', 8) +
            SintegraService._pad(empresa.contato_nome || '', 28) +
            SintegraService._pad(empresa.telefone || '', 12);

        linhas.push(r11);

        // Registro 50 - NF modelos 1/1A/55
        try {
            const [nfs] = await pool.query(`
                SELECT * FROM nf_entrada
                WHERE MONTH(data_emissao) = ? AND YEAR(data_emissao) = ?
                AND status IN ('escriturada', 'conferida')
            `, [mes, ano]);

            for (const nf of nfs) {
                const r50 = '50' +
                    SintegraService._pad(nf.fornecedor_cnpj, 14) +
                    SintegraService._pad(nf.fornecedor_ie || 'ISENTO', 14) +
                    SintegraService._data(nf.data_emissao) +
                    SintegraService._pad(nf.fornecedor_uf || '', 2) +
                    '55' + // modelo NF-e
                    SintegraService._pad(String(nf.serie || '1'), 3) +
                    SintegraService._padNum(String(nf.numero_nfe || ''), 6) +
                    SintegraService._pad(nf.cfop_principal || '1102', 4) +
                    'T' + // Tributado
                    SintegraService._decSintegra(nf.valor_total, 13) +
                    SintegraService._decSintegra(nf.bc_icms, 13) +
                    SintegraService._decSintegra(nf.valor_icms, 13) +
                    SintegraService._decSintegra(0, 13) + // isenta/não trib
                    SintegraService._decSintegra(0, 13) + // outras
                    SintegraService._decSintegra(nf.aliquota_icms || 0, 4) +
                    '1'; // situação N=Normal

                linhas.push(r50);
            }
        } catch (e) {
            console.warn('[Sintegra] Erro NF entrada:', e.message);
        }

        // Registro 90 - Totalizador
        const totalRegs = linhas.length + 1;
        linhas.push('90' + SintegraService._pad(empresa.cnpj, 14) +
                     SintegraService._pad(empresa.inscricao_estadual, 14) +
                     '50' + SintegraService._padNum(String(totalRegs - 2), 8) + // qtd registros 50
                     SintegraService._padNum(String(totalRegs + 1), 8) +
                     SintegraService._pad('', 46) + '1');

        const conteudo = linhas.join('\r\n') + '\r\n';
        const hash = crypto.createHash('sha256').update(conteudo).digest('hex');

        return {
            conteudo,
            registros: linhas.length,
            hash,
            periodo: { mes, ano },
            tipo: 'sintegra'
        };
    }

    static _pad(str, len) {
        return String(str || '').substring(0, len).padEnd(len, ' ');
    }

    static _padNum(str, len) {
        return String(str || '').substring(0, len).padStart(len, '0');
    }

    static _data(d) {
        if (!d) return '00000000';
        const dt = new Date(d);
        return `${dt.getFullYear()}${String(dt.getMonth() + 1).padStart(2, '0')}${String(dt.getDate()).padStart(2, '0')}`;
    }

    static _decSintegra(valor, len) {
        const num = Math.round((parseFloat(valor) || 0) * 100);
        return String(num).padStart(len, '0');
    }
}

module.exports = { SpedFiscalService, SpedContribuicoesService, SintegraService };
