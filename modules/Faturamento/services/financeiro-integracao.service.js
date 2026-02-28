/**
 * SERVIÇO DE INTEGRAÇÃO COM FINANCEIRO
 * Integra faturamento com contas a receber, boletos e conciliação
 */

class FinanceiroIntegracaoService {
    
    constructor(pool) {
        this.pool = pool;
    }
    
    /**
     * Gerar contas a receber a partir da NFe
     */
    async gerarContasReceber(nfe_id, dadosPagamento) {
        const connection = await this.pool.getConnection();
        
        try {
            await connection.beginTransaction();
            
            // Buscar dados da NFe
            const [nfe] = await connection.query(`
                SELECT n.*, c.id as cliente_id, c.nome as cliente_nome
                FROM nfe n
                LEFT JOIN clientes c ON n.cliente_id = c.id
                WHERE n.id = ?
            `, [nfe_id]);
            
            if (nfe.length === 0) {
                throw new Error('NFe não encontrada');
            }
            
            const nfeData = nfe[0];
            const valorTotal = parseFloat(nfeData.valor_total);
            
            // Determinar parcelas
            const parcelas = this.calcularParcelas(valorTotal, dadosPagamento);
            
            // Criar conta a receber principal
            const [contaReceber] = await connection.query(`
                INSERT INTO contas_receber (
                    cliente_id,
                    nfe_id,
                    descricao,
                    valor_original,
                    valor_saldo,
                    data_emissao,
                    data_vencimento,
                    status,
                    created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'aberto', NOW())
            `, [
                nfeData.cliente_id,
                nfe_id,
                `NF-e ${nfeData.numero_nfe} - ${nfeData.cliente_nome}`,
                valorTotal,
                valorTotal,
                nfeData.data_emissao,
                parcelas[0].vencimento,
                'aberto'
            ]);
            
            const conta_receber_id = contaReceber.insertId;
            
            // Criar parcelas
            for (const parcela of parcelas) {
                await connection.query(`
                    INSERT INTO contas_receber_parcelas (
                        conta_receber_id,
                        numero_parcela,
                        valor,
                        data_vencimento,
                        status,
                        created_at
                    ) VALUES (?, ?, ?, ?, 'aberto', NOW())
                `, [
                    conta_receber_id,
                    parcela.numero,
                    parcela.valor,
                    parcela.vencimento
                ]);
            }
            
            // Atualizar NFe com referência da conta a receber
            await connection.query(`
                UPDATE nfe 
                SET conta_receber_id = ?
                WHERE id = ?
            `, [conta_receber_id, nfe_id]);
            
            await connection.commit();
            
            return {
                success: true,
                conta_receber_id,
                parcelas: parcelas.length,
                valor_total: valorTotal
            };
            
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }
    
    /**
     * Calcular parcelas de pagamento
     */
    calcularParcelas(valorTotal, dadosPagamento) {
        const parcelas = [];
        const { numeroParcelas = 1, diaVencimento = 30, intervalo = 30 } = dadosPagamento;
        
        const valorParcela = valorTotal / numeroParcelas;
        const dataBase = new Date();
        
        for (let i = 0; i < numeroParcelas; i++) {
            const dataVencimento = new Date(dataBase);
            dataVencimento.setDate(dataBase.getDate() + (diaVencimento + (i * intervalo)));
            
            parcelas.push({
                numero: i + 1,
                valor: i === numeroParcelas - 1 ? 
                       (valorTotal - (valorParcela * (numeroParcelas - 1))) : // Ajusta última parcela
                       valorParcela,
                vencimento: dataVencimento.toISOString().split('T')[0]
            });
        }
        
        return parcelas;
    }
    
    /**
     * Registrar pagamento/baixa
     */
    async registrarPagamento(parcela_id, dadosPagamento) {
        const connection = await this.pool.getConnection();
        
        try {
            await connection.beginTransaction();
            
            const { valor_pago, data_pagamento, forma_pagamento, observacoes } = dadosPagamento;
            
            // Buscar parcela
            const [parcela] = await connection.query(`
                SELECT p.*, cr.cliente_id
                FROM contas_receber_parcelas p
                INNER JOIN contas_receber cr ON p.conta_receber_id = cr.id
                WHERE p.id = ?
            `, [parcela_id]);
            
            if (parcela.length === 0) {
                throw new Error('Parcela não encontrada');
            }
            
            const parcelaData = parcela[0];
            const valorOriginal = parseFloat(parcelaData.valor);
            const valorPago = parseFloat(valor_pago);
            
            // Calcular juros e multa se houver atraso
            const diasAtraso = this.calcularDiasAtraso(parcelaData.data_vencimento, data_pagamento);
            const juros = diasAtraso > 0 ? valorOriginal * 0.01 : 0; // 1% de multa
            const mora = diasAtraso > 0 ? (valorOriginal * 0.001 * diasAtraso) : 0; // 0,1% ao dia
            
            const valorTotal = valorOriginal + juros + mora;
            const desconto = valorTotal - valorPago;
            
            // Registrar pagamento
            await connection.query(`
                INSERT INTO financeiro_pagamentos (
                    parcela_id,
                    valor_pago,
                    valor_juros,
                    valor_mora,
                    valor_desconto,
                    data_pagamento,
                    forma_pagamento,
                    observacoes,
                    created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
            `, [
                parcela_id,
                valorPago,
                juros,
                mora,
                desconto > 0 ? desconto : 0,
                data_pagamento,
                forma_pagamento,
                observacoes
            ]);
            
            // Atualizar status da parcela
            await connection.query(`
                UPDATE contas_receber_parcelas
                SET status = 'pago', data_pagamento = ?
                WHERE id = ?
            `, [data_pagamento, parcela_id]);
            
            // Verificar se todas as parcelas foram pagas
            const [parcelasAbertas] = await connection.query(`
                SELECT COUNT(*) as abertas
                FROM contas_receber_parcelas
                WHERE conta_receber_id = ? AND status = 'aberto'
            `, [parcelaData.conta_receber_id]);
            
            if (parcelasAbertas[0].abertas === 0) {
                // Todas pagas - atualizar conta a receber
                await connection.query(`
                    UPDATE contas_receber
                    SET status = 'pago', valor_saldo = 0
                    WHERE id = ?
                `, [parcelaData.conta_receber_id]);
            }
            
            await connection.commit();
            
            return {
                success: true,
                valor_pago: valorPago,
                juros,
                mora,
                desconto: desconto > 0 ? desconto : 0,
                dias_atraso: diasAtraso
            };
            
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }
    
    /**
     * Gerar boleto bancário
     */
    async gerarBoleto(parcela_id, dadosBanco) {
        const connection = await this.pool.getConnection();
        
        try {
            const [parcela] = await connection.query(`
                SELECT 
                    p.*,
                    cr.cliente_id,
                    cr.nfe_id,
                    c.nome as cliente_nome,
                    c.cpf,
                    c.cnpj,
                    c.endereco,
                    c.cidade,
                    c.estado,
                    c.cep
                FROM contas_receber_parcelas p
                INNER JOIN contas_receber cr ON p.conta_receber_id = cr.id
                INNER JOIN clientes c ON cr.cliente_id = c.id
                WHERE p.id = ?
            `, [parcela_id]);
            
            if (parcela.length === 0) {
                throw new Error('Parcela não encontrada');
            }
            
            const parcelaData = parcela[0];
            
            // Gerar nosso número (específico de cada banco)
            const nossoNumero = this.gerarNossoNumero(dadosBanco.banco, parcela_id);
            
            // Gerar código de barras
            const codigoBarras = this.gerarCodigoBarras({
                banco: dadosBanco.banco,
                moeda: '9',
                valor: parcelaData.valor,
                vencimento: parcelaData.data_vencimento,
                agencia: dadosBanco.agencia,
                conta: dadosBanco.conta,
                nossoNumero
            });
            
            // Salvar boleto
            const [boleto] = await connection.query(`
                INSERT INTO financeiro_boletos (
                    parcela_id,
                    nosso_numero,
                    codigo_barras,
                    linha_digitavel,
                    valor,
                    data_vencimento,
                    banco,
                    agencia,
                    conta,
                    status,
                    created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'emitido', NOW())
            `, [
                parcela_id,
                nossoNumero,
                codigoBarras,
                this.formatarLinhaDigitavel(codigoBarras),
                parcelaData.valor,
                parcelaData.data_vencimento,
                dadosBanco.banco,
                dadosBanco.agencia,
                dadosBanco.conta
            ]);
            
            await connection.commit();
            
            return {
                success: true,
                boleto_id: boleto.insertId,
                nosso_numero: nossoNumero,
                codigo_barras: codigoBarras,
                linha_digitavel: this.formatarLinhaDigitavel(codigoBarras)
            };
            
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }
    
    /**
     * Estornar NFe cancelada no financeiro
     */
    async estornarNFeCancelada(nfe_id) {
        const connection = await this.pool.getConnection();
        
        try {
            await connection.beginTransaction();
            
            // Buscar conta a receber
            const [conta] = await connection.query(`
                SELECT id FROM contas_receber WHERE nfe_id = ?
            `, [nfe_id]);
            
            if (conta.length > 0) {
                const conta_id = conta[0].id;
                
                // Cancelar parcelas abertas
                await connection.query(`
                    UPDATE contas_receber_parcelas
                    SET status = 'cancelado'
                    WHERE conta_receber_id = ? AND status = 'aberto'
                `, [conta_id]);
                
                // Cancelar conta
                await connection.query(`
                    UPDATE contas_receber
                    SET status = 'cancelado', valor_saldo = 0
                    WHERE id = ?
                `, [conta_id]);
                
                // Cancelar boletos
                await connection.query(`
                    UPDATE financeiro_boletos b
                    INNER JOIN contas_receber_parcelas p ON b.parcela_id = p.id
                    SET b.status = 'cancelado'
                    WHERE p.conta_receber_id = ? AND b.status = 'emitido'
                `, [conta_id]);
            }
            
            await connection.commit();
            
            return { success: true };
            
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }
    
    /**
     * Relatório de contas a receber
     */
    async relatorioContasReceber(filtros = {}) {
        const { status, data_inicio, data_fim, cliente_id } = filtros;
        
        let query = `
            SELECT 
                cr.*,
                c.nome as cliente_nome,
                n.numero_nfe,
                COUNT(p.id) as total_parcelas,
                SUM(CASE WHEN p.status = 'pago' THEN 1 ELSE 0 END) as parcelas_pagas,
                SUM(CASE WHEN p.status = 'aberto' AND p.data_vencimento < CURDATE() THEN 1 ELSE 0 END) as parcelas_vencidas
            FROM contas_receber cr
            LEFT JOIN clientes c ON cr.cliente_id = c.id
            LEFT JOIN nfe n ON cr.nfe_id = n.id
            LEFT JOIN contas_receber_parcelas p ON cr.id = p.conta_receber_id
            WHERE 1=1
        `;
        
        const params = [];
        
        if (status) {
            query += ' AND cr.status = ?';
            params.push(status);
        }
        
        if (data_inicio) {
            query += ' AND cr.data_emissao >= ?';
            params.push(data_inicio);
        }
        
        if (data_fim) {
            query += ' AND cr.data_emissao <= ?';
            params.push(data_fim);
        }
        
        if (cliente_id) {
            query += ' AND cr.cliente_id = ?';
            params.push(cliente_id);
        }
        
        query += ' GROUP BY cr.id ORDER BY cr.data_emissao DESC';
        
        const [contas] = await this.pool.query(query, params);
        
        return contas;
    }
    
    // ============================================================
    // MÉTODOS AUXILIARES
    // ============================================================
    
    calcularDiasAtraso(dataVencimento, dataPagamento) {
        const venc = new Date(dataVencimento);
        const pag = new Date(dataPagamento);
        const diff = pag.getTime() - venc.getTime();
        const dias = Math.floor(diff / (1000 * 60 * 60 * 24));
        return dias > 0 ? dias : 0;
    }
    
    gerarNossoNumero(banco, id) {
        // Implementação simplificada - ajustar por banco
        return id.toString().padStart(11, '0');
    }
    
    gerarCodigoBarras(dados) {
        // Implementação simplificada - usar biblioteca específica em produção
        const { banco, moeda, valor, vencimento } = dados;
        
        // Código do banco (3 dígitos)
        let codigo = banco.toString().padStart(3, '0');
        
        // Código da moeda (1 dígito)
        codigo += moeda;
        
        // DV (será calculado depois)
        codigo += '0';
        
        // Fator de vencimento (4 dígitos)
        const fatorVencimento = this.calcularFatorVencimento(vencimento);
        codigo += fatorVencimento.toString().padStart(4, '0');
        
        // Valor (10 dígitos)
        const valorFormatado = Math.floor(parseFloat(valor) * 100).toString().padStart(10, '0');
        codigo += valorFormatado;
        
        // Campo livre (25 dígitos) - específico de cada banco
        codigo += '0'.repeat(25);
        
        // Calcular DV
        const dv = this.calcularDVCodigoBarras(codigo.replace(/^(.{4})0/, '$1'));
        codigo = codigo.replace(/^(.{4})0/, `$1${dv}`);
        
        return codigo;
    }
    
    calcularFatorVencimento(dataVencimento) {
        const dataBase = new Date('1997-10-07');
        const vencimento = new Date(dataVencimento);
        const diff = vencimento.getTime() - dataBase.getTime();
        return Math.floor(diff / (1000 * 60 * 60 * 24));
    }
    
    calcularDVCodigoBarras(codigo) {
        // Módulo 11
        const multiplicadores = [2, 3, 4, 5, 6, 7, 8, 9];
        let soma = 0;
        let multiplicadorIndex = 0;
        
        for (let i = codigo.length - 1; i >= 0; i--) {
            soma += parseInt(codigo[i]) * multiplicadores[multiplicadorIndex];
            multiplicadorIndex = (multiplicadorIndex + 1) % multiplicadores.length;
        }
        
        const resto = soma % 11;
        const dv = resto === 0 || resto === 1 ? 1 : 11 - resto;
        
        return dv;
    }
    
    formatarLinhaDigitavel(codigoBarras) {
        // Formatar código de barras em linha digitável
        // Implementação simplificada
        return codigoBarras.replace(/(\d{5})(\d{5})(\d{5})(\d{6})(\d{5})(\d{6})(\d{1})(\d{14})/, 
                                   '$1.$2 $3.$4 $5.$6 $7 $8');
    }
}

module.exports = FinanceiroIntegracaoService;
