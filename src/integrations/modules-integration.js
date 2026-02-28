/**
 * MÓDULO DE INTEGRAÇÃO ENTRE MÓDULOS - ALUFORCE ERP
 * AUDITORIA 02/02/2026: Integração automática entre módulos
 * 
 * Integrações implementadas:
 * - Vendas → Financeiro (criar contas a receber automaticamente)
 * - Compras → Financeiro (criar contas a pagar automaticamente)
 * - NFe → Financeiro (vincular notas às contas)
 * - Folha RH → Financeiro (criar lançamentos de folha)
 */

/**
 * Cria contas a receber a partir de um pedido de venda faturado
 * @param {Object} pool - Pool de conexão MySQL
 * @param {Object} pedido - Dados do pedido
 * @param {number} userId - ID do usuário que executou a ação
 * @returns {Promise<Object>} - Resultado da integração
 */
async function criarContasReceberDePedido(pool, pedido, userId) {
    const connection = await pool.getConnection();
    
    try {
        await connection.beginTransaction();
        
        const {
            id: pedido_id,
            cliente_id,
            cliente_nome,
            valor_total,
            condicao_pagamento,
            prazo_entrega,
            empresa_id,
            vendedor_id,
            vendedor_nome,
            nfe_numero
        } = pedido;
        
        // Parsear condição de pagamento para criar parcelas
        // Exemplos: "30 dias", "30/60/90", "À vista", "28DDL"
        const parcelas = parseCondicaoPagamento(condicao_pagamento, valor_total);
        
        const contasCriadas = [];
        const dataBase = new Date();
        
        for (let i = 0; i < parcelas.length; i++) {
            const parcela = parcelas[i];
            const dataVencimento = new Date(dataBase);
            dataVencimento.setDate(dataVencimento.getDate() + parcela.dias);
            
            const [result] = await connection.query(`
                INSERT INTO contas_receber (
                    cliente_id,
                    cliente_nome,
                    descricao,
                    valor,
                    data_vencimento,
                    data_emissao,
                    status,
                    pedido_id,
                    nota_fiscal,
                    parcela_numero,
                    total_parcelas,
                    vendedor,
                    observacoes
                ) VALUES (?, ?, ?, ?, ?, NOW(), 'pendente', ?, ?, ?, ?, ?, ?)
            `, [
                cliente_id,
                cliente_nome,
                `Pedido #${pedido_id} - Parcela ${i + 1}/${parcelas.length}`,
                parcela.valor,
                dataVencimento,
                pedido_id,
                nfe_numero || null,
                i + 1,
                parcelas.length,
                vendedor_nome || null,
                `Gerado automaticamente pelo faturamento do pedido #${pedido_id}`
            ]);
            
            contasCriadas.push({
                id: result.insertId,
                valor: parcela.valor,
                vencimento: dataVencimento,
                parcela: i + 1
            });
        }
        
        // Registrar auditoria da integração
        await connection.query(`
            INSERT INTO audit_log (
                tabela,
                registro_id,
                acao,
                dados_novos,
                usuario_id,
                created_at
            ) VALUES ('integracao_vendas_financeiro', ?, 'CREATE', ?, ?, NOW())
        `, [
            pedido_id,
            JSON.stringify({
                pedido_id,
                contas_criadas: contasCriadas.length,
                valor_total,
                condicao_pagamento
            }),
            userId
        ]);
        
        await connection.commit();
        
        console.log(`✅ Integração Vendas→Financeiro: ${contasCriadas.length} contas a receber criadas para pedido #${pedido_id}`);
        
        return {
            success: true,
            pedido_id,
            contas_criadas: contasCriadas,
            message: `${contasCriadas.length} parcela(s) criada(s) no financeiro`
        };
        
    } catch (error) {
        await connection.rollback();
        console.error('❌ Erro na integração Vendas→Financeiro:', error);
        throw error;
    } finally {
        connection.release();
    }
}

/**
 * Cria contas a pagar a partir de um pedido de compra aprovado
 * @param {Object} pool - Pool de conexão MySQL
 * @param {Object} pedidoCompra - Dados do pedido de compra
 * @param {number} userId - ID do usuário
 * @returns {Promise<Object>}
 */
async function criarContasPagarDePedidoCompra(pool, pedidoCompra, userId) {
    const connection = await pool.getConnection();
    
    try {
        await connection.beginTransaction();
        
        const {
            id: pedido_id,
            fornecedor_id,
            fornecedor_nome,
            valor_total,
            condicao_pagamento,
            nfe_numero,
            empresa_id
        } = pedidoCompra;
        
        const parcelas = parseCondicaoPagamento(condicao_pagamento, valor_total);
        const contasCriadas = [];
        const dataBase = new Date();
        
        for (let i = 0; i < parcelas.length; i++) {
            const parcela = parcelas[i];
            const dataVencimento = new Date(dataBase);
            dataVencimento.setDate(dataVencimento.getDate() + parcela.dias);
            
            const [result] = await connection.query(`
                INSERT INTO contas_pagar (
                    fornecedor_id,
                    fornecedor_nome,
                    descricao,
                    valor,
                    data_vencimento,
                    data_emissao,
                    status,
                    pedido_compra_id,
                    nota_fiscal,
                    parcela_numero,
                    total_parcelas,
                    observacoes
                ) VALUES (?, ?, ?, ?, ?, NOW(), 'pendente', ?, ?, ?, ?, ?)
            `, [
                fornecedor_id,
                fornecedor_nome,
                `Pedido Compra #${pedido_id} - Parcela ${i + 1}/${parcelas.length}`,
                parcela.valor,
                dataVencimento,
                pedido_id,
                nfe_numero || null,
                i + 1,
                parcelas.length,
                `Gerado automaticamente pelo recebimento do pedido de compra #${pedido_id}`
            ]);
            
            contasCriadas.push({
                id: result.insertId,
                valor: parcela.valor,
                vencimento: dataVencimento,
                parcela: i + 1
            });
        }
        
        await connection.query(`
            INSERT INTO audit_log (
                tabela,
                registro_id,
                acao,
                dados_novos,
                usuario_id,
                created_at
            ) VALUES ('integracao_compras_financeiro', ?, 'CREATE', ?, ?, NOW())
        `, [
            pedido_id,
            JSON.stringify({
                pedido_compra_id: pedido_id,
                contas_criadas: contasCriadas.length,
                valor_total,
                condicao_pagamento
            }),
            userId
        ]);
        
        await connection.commit();
        
        console.log(`✅ Integração Compras→Financeiro: ${contasCriadas.length} contas a pagar criadas para pedido #${pedido_id}`);
        
        return {
            success: true,
            pedido_id,
            contas_criadas: contasCriadas,
            message: `${contasCriadas.length} parcela(s) criada(s) no financeiro`
        };
        
    } catch (error) {
        await connection.rollback();
        console.error('❌ Erro na integração Compras→Financeiro:', error);
        throw error;
    } finally {
        connection.release();
    }
}

/**
 * Cria lançamentos financeiros da folha de pagamento
 * @param {Object} pool - Pool de conexão MySQL
 * @param {Object} folha - Dados da folha de pagamento
 * @param {number} userId - ID do usuário
 * @returns {Promise<Object>}
 */
async function criarLancamentosFolhaPagamento(pool, folha, userId) {
    const connection = await pool.getConnection();
    
    try {
        await connection.beginTransaction();
        
        const {
            competencia,
            funcionarios,
            empresa_id,
            total_liquido,
            data_pagamento
        } = folha;
        
        // Criar conta a pagar consolidada da folha
        const [result] = await connection.query(`
            INSERT INTO contas_pagar (
                fornecedor_nome,
                descricao,
                valor,
                data_vencimento,
                data_emissao,
                status,
                origem,
                empresa_id,
                criado_por,
                criado_em,
                observacoes,
                categoria
            ) VALUES ('FOLHA DE PAGAMENTO', ?, ?, ?, NOW(), 'pendente', 'rh', ?, ?, NOW(), ?, 'folha_pagamento')
        `, [
            `Folha de Pagamento - ${competencia}`,
            total_liquido,
            data_pagamento,
            empresa_id,
            userId,
            `Folha referente a ${competencia} - ${funcionarios.length} funcionários`
        ]);
        
        // Criar lançamentos individuais por funcionário (para controle)
        for (const func of funcionarios) {
            await connection.query(`
                INSERT INTO lancamentos_folha (
                    folha_conta_pagar_id,
                    funcionario_id,
                    funcionario_nome,
                    valor_liquido,
                    competencia,
                    empresa_id,
                    criado_em
                ) VALUES (?, ?, ?, ?, ?, ?, NOW())
            `, [
                result.insertId,
                func.id,
                func.nome,
                func.valor_liquido,
                competencia,
                empresa_id
            ]);
        }
        
        await connection.commit();
        
        console.log(`✅ Integração RH→Financeiro: Folha ${competencia} criada - R$ ${total_liquido}`);
        
        return {
            success: true,
            conta_pagar_id: result.insertId,
            competencia,
            valor_total: total_liquido,
            funcionarios: funcionarios.length
        };
        
    } catch (error) {
        await connection.rollback();
        console.error('❌ Erro na integração RH→Financeiro:', error);
        throw error;
    } finally {
        connection.release();
    }
}

/**
 * Vincula NFe a contas existentes
 * @param {Object} pool 
 * @param {Object} nfe 
 * @param {number} userId 
 * @returns {Promise<Object>}
 */
async function vincularNFeAContas(pool, nfe, userId) {
    const { numero, chave, pedido_id, tipo } = nfe;
    
    const tabela = tipo === 'entrada' ? 'contas_pagar' : 'contas_receber';
    const campo_pedido = tipo === 'entrada' ? 'pedido_compra_id' : 'pedido_id';
    
    const [result] = await pool.query(`
        UPDATE ${tabela}
        SET nfe_numero = ?, nfe_chave = ?, updated_at = NOW()
        WHERE ${campo_pedido} = ?
    `, [numero, chave, pedido_id]);
    
    console.log(`✅ NFe ${numero} vinculada a ${result.affectedRows} conta(s)`);
    
    return {
        success: true,
        nfe_numero: numero,
        contas_atualizadas: result.affectedRows
    };
}

/**
 * Parseia condição de pagamento e retorna array de parcelas
 * @param {string} condicao - Ex: "30/60/90", "À vista", "28DDL", "30 dias"
 * @param {number} valorTotal - Valor total a ser parcelado
 * @returns {Array<{dias: number, valor: number}>}
 */
function parseCondicaoPagamento(condicao, valorTotal) {
    if (!condicao || !valorTotal) {
        return [{ dias: 0, valor: valorTotal }];
    }
    
    const condicaoLower = condicao.toLowerCase().trim();
    
    // À vista / Antecipado
    if (condicaoLower.includes('vista') || condicaoLower.includes('antecipado') || condicaoLower === '0') {
        return [{ dias: 0, valor: valorTotal }];
    }
    
    // DDL (Dias da Data de Leitura/Liquidação) - Ex: "28DDL"
    const ddlMatch = condicaoLower.match(/(\d+)\s*ddl/);
    if (ddlMatch) {
        return [{ dias: parseInt(ddlMatch[1]), valor: valorTotal }];
    }
    
    // Prazo único - Ex: "30 dias", "60 dias"
    const prazoUnicoMatch = condicaoLower.match(/^(\d+)\s*dias?$/);
    if (prazoUnicoMatch) {
        return [{ dias: parseInt(prazoUnicoMatch[1]), valor: valorTotal }];
    }
    
    // Parcelado - Ex: "30/60/90", "30, 60, 90"
    const parcelasMatch = condicao.match(/\d+/g);
    if (parcelasMatch && parcelasMatch.length > 1) {
        const numParcelas = parcelasMatch.length;
        const valorParcela = Math.floor((valorTotal / numParcelas) * 100) / 100;
        const resto = valorTotal - (valorParcela * (numParcelas - 1));
        
        return parcelasMatch.map((dias, index) => ({
            dias: parseInt(dias),
            valor: index === numParcelas - 1 ? Math.round(resto * 100) / 100 : valorParcela
        }));
    }
    
    // Número único - Ex: "30", "60"
    const numeroMatch = condicao.match(/^(\d+)$/);
    if (numeroMatch) {
        return [{ dias: parseInt(numeroMatch[1]), valor: valorTotal }];
    }
    
    // Padrão: 30 dias
    console.warn(`Condição de pagamento não reconhecida: "${condicao}", usando 30 dias`);
    return [{ dias: 30, valor: valorTotal }];
}

/**
 * Verifica se há pendências financeiras para um cliente
 * @param {Object} pool 
 * @param {number} clienteId 
 * @returns {Promise<Object>}
 */
async function verificarPendenciasCliente(pool, clienteId) {
    const [pendencias] = await pool.query(`
        SELECT 
            COUNT(*) as total_pendencias,
            SUM(valor) as valor_total,
            MIN(data_vencimento) as vencimento_mais_antigo,
            SUM(CASE WHEN data_vencimento < CURDATE() THEN valor ELSE 0 END) as valor_vencido
        FROM contas_receber
        WHERE cliente_id = ? AND status IN ('pendente', 'vencido')
    `, [clienteId]);
    
    return {
        cliente_id: clienteId,
        tem_pendencias: pendencias[0].total_pendencias > 0,
        total_pendencias: pendencias[0].total_pendencias,
        valor_total: pendencias[0].valor_total || 0,
        valor_vencido: pendencias[0].valor_vencido || 0,
        vencimento_mais_antigo: pendencias[0].vencimento_mais_antigo,
        pode_vender: pendencias[0].valor_vencido < 5000 // Limite de crédito básico
    };
}

module.exports = {
    criarContasReceberDePedido,
    criarContasPagarDePedidoCompra,
    criarLancamentosFolhaPagamento,
    vincularNFeAContas,
    parseCondicaoPagamento,
    verificarPendenciasCliente
};
