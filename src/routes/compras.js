// =====================================================
// ROTAS DO MÓDULO DE COMPRAS
// Sistema Aluforce v2.0
// =====================================================

const express = require('express');
const router = express.Router();
const { body, param, query, validationResult } = require('express-validator');

// Validação de CNPJ
function validarCNPJ(cnpj) {
    cnpj = cnpj.replace(/[^\d]+/g, '');
    if (cnpj.length !== 14) return false;
    
    // Validação dos dígitos verificadores
    let tamanho = cnpj.length - 2;
    let numeros = cnpj.substring(0, tamanho);
    let digitos = cnpj.substring(tamanho);
    let soma = 0;
    let pos = tamanho - 7;
    
    for (let i = tamanho; i >= 1; i--) {
        soma += numeros.charAt(tamanho - i) * pos--;
        if (pos < 2) pos = 9;
    }
    
    let resultado = soma % 11 < 2 ? 0 : 11 - soma % 11;
    if (resultado != digitos.charAt(0)) return false;
    
    tamanho = tamanho + 1;
    numeros = cnpj.substring(0, tamanho);
    soma = 0;
    pos = tamanho - 7;
    
    for (let i = tamanho; i >= 1; i--) {
        soma += numeros.charAt(tamanho - i) * pos--;
        if (pos < 2) pos = 9;
    }
    
    resultado = soma % 11 < 2 ? 0 : 11 - soma % 11;
    if (resultado != digitos.charAt(1)) return false;
    
    return true;
}

// Middleware de log para auditoria
async function logAcao(pool, usuarioId, acao, entidadeTipo, entidadeId, dadosAnteriores = null, dadosNovos = null, req) {
    try {
        await pool.execute(
            `INSERT INTO compras_logs 
            (usuario_id, acao, entidade_tipo, entidade_id, dados_anteriores, dados_novos, ip_address, user_agent)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                usuarioId,
                acao,
                entidadeTipo,
                entidadeId,
                dadosAnteriores ? JSON.stringify(dadosAnteriores) : null,
                dadosNovos ? JSON.stringify(dadosNovos) : null,
                req.ip,
                req.get('user-agent')
            ]
        );
    } catch (error) {
        console.error('Erro ao registrar log:', error);
    }
}

// Função para criar notificação
async function criarNotificacao(pool, usuarioId, tipo, titulo, mensagem, entidadeTipo = null, entidadeId = null, enviarEmail = false) {
    try {
        await pool.execute(
            `INSERT INTO compras_notificacoes 
            (usuario_id, tipo, titulo, mensagem, entidade_tipo, entidade_id, enviar_email)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [usuarioId, tipo, titulo, mensagem, entidadeTipo, entidadeId, enviarEmail]
        );
    } catch (error) {
        console.error('Erro ao criar notificação:', error);
    }
}

// =====================================================
// FUNÇÕES DE VALIDAÇÍO E EXTRAÇÍO DE CHAVE NF-e
// =====================================================

// Validar chave de acesso NF-e (44 dígitos + DV)
function validarChaveAcesso(chave) {
    if (!chave || chave.length !== 44) return false;
    
    const chaveSemDV = chave.substr(0, 43);
    const dvInformado = chave.substr(43, 1);
    
    // Calcular dígito verificador usando módulo 11
    let peso = 2;
    let soma = 0;
    
    for (let i = chaveSemDV.length - 1; i >= 0; i--) {
        soma += parseInt(chaveSemDV[i]) * peso;
        peso = peso === 9 ? 2 : peso + 1;
    }
    
    const resto = soma % 11;
    const dvCalculado = resto < 2 ? 0 : 11 - resto;
    
    return dvInformado === dvCalculado.toString();
}

// Extrair dados da chave de acesso NF-e
// Formato: cUF(2) + AAMM(4) + CNPJ(14) + mod(2) + serie(3) + nNF(9) + tpEmis(1) + cNF(8) + cDV(1)
function extrairDadosChave(chave) {
    const ufCodigos = {
        '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
        '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL',
        '28': 'SE', '29': 'BA', '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP', '41': 'PR',
        '42': 'SC', '43': 'RS', '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF'
    };
    
    return {
        ufCodigo: chave.substr(0, 2),
        uf: ufCodigos[chave.substr(0, 2)] || chave.substr(0, 2),
        ano: '20' + chave.substr(2, 2),
        mes: chave.substr(4, 2),
        cnpj: chave.substr(6, 14),
        cnpjFormatado: chave.substr(6, 14).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5'),
        modelo: chave.substr(20, 2),
        serie: parseInt(chave.substr(22, 3)),
        numero: parseInt(chave.substr(25, 9)),
        formaEmissao: chave.substr(34, 1),
        codigoNumerico: chave.substr(35, 8),
        digitoVerificador: chave.substr(43, 1)
    };
}

// Extrair dados do XML de retorno do SEFAZ
function extrairDadosNFeXML(xml) {
    const dados = {};
    
    // Função helper para extrair valor
    const extrair = (tag) => {
        const match = xml.match(new RegExp(`<${tag}>(.*?)</${tag}>`, 's'));
        return match ? match[1].trim() : null;
    };
    
    // Dados da NF-e
    dados.numero = extrair('nNF');
    dados.serie = extrair('serie');
    dados.dataEmissao = extrair('dhEmi') || extrair('dEmi');
    dados.valorTotal = parseFloat(extrair('vNF')) || 0;
    dados.valorProdutos = parseFloat(extrair('vProd')) || 0;
    dados.valorFrete = parseFloat(extrair('vFrete')) || 0;
    dados.valorDesconto = parseFloat(extrair('vDesc')) || 0;
    
    // Dados do emitente
    const emitenteMatch = xml.match(/<emit>(.*?)<\/emit>/s);
    if (emitenteMatch) {
        const emitente = emitenteMatch[1];
        dados.emitenteCnpj = emitente.match(/<CNPJ>(.*?)<\/CNPJ>/)?.[1];
        dados.emitenteNome = emitente.match(/<xNome>(.*?)<\/xNome>/)?.[1];
        dados.emitenteFantasia = emitente.match(/<xFant>(.*?)<\/xFant>/)?.[1];
        dados.emitenteUf = emitente.match(/<UF>(.*?)<\/UF>/)?.[1];
        dados.emitenteCidade = emitente.match(/<xMun>(.*?)<\/xMun>/)?.[1];
    }
    
    // Dados do destinatário
    const destMatch = xml.match(/<dest>(.*?)<\/dest>/s);
    if (destMatch) {
        const dest = destMatch[1];
        dados.destinatarioCnpj = dest.match(/<CNPJ>(.*?)<\/CNPJ>/)?.[1] || dest.match(/<CPF>(.*?)<\/CPF>/)?.[1];
        dados.destinatarioNome = dest.match(/<xNome>(.*?)<\/xNome>/)?.[1];
    }
    
    // Itens (simplificado)
    dados.itens = [];
    const itensMatch = xml.matchAll(/<det[^>]*>(.*?)<\/det>/gs);
    for (const item of itensMatch) {
        const itemXml = item[1];
        dados.itens.push({
            codigo: itemXml.match(/<cProd>(.*?)<\/cProd>/)?.[1],
            descricao: itemXml.match(/<xProd>(.*?)<\/xProd>/)?.[1],
            ncm: itemXml.match(/<NCM>(.*?)<\/NCM>/)?.[1],
            cfop: itemXml.match(/<CFOP>(.*?)<\/CFOP>/)?.[1],
            unidade: itemXml.match(/<uCom>(.*?)<\/uCom>/)?.[1],
            quantidade: parseFloat(itemXml.match(/<qCom>(.*?)<\/qCom>/)?.[1]) || 0,
            valorUnitario: parseFloat(itemXml.match(/<vUnCom>(.*?)<\/vUnCom>/)?.[1]) || 0,
            valorTotal: parseFloat(itemXml.match(/<vProd>(.*?)<\/vProd>/)?.[1]) || 0
        });
    }
    
    return dados;
}

module.exports = (pool, authenticateToken, logger) => {

    // ==================== DASHBOARD ====================
    router.get('/dashboard', authenticateToken, async (req, res) => {
        try {
            const [stats] = await pool.execute(`SELECT * FROM vw_dashboard_compras LIMIT 1`);
            
            // Pedidos por status (últimos 30 dias)
            const [pedidosPorStatus] = await pool.execute(`
                SELECT status, COUNT(*) as total, SUM(valor_total) as valor
                FROM pedidos_compra
                WHERE data_pedido >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
                GROUP BY status
            `);
            
            // Top fornecedores (por valor)
            const [topFornecedores] = await pool.execute(`
                SELECT f.id, f.razao_social, f.cidade, f.estado,
                       COUNT(pc.id) as total_pedidos,
                       SUM(pc.valor_total) as total_compras
                FROM fornecedores f
                JOIN pedidos_compra pc ON f.id = pc.fornecedor_id
                WHERE pc.status != 'cancelado'
                  AND pc.data_pedido >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
                GROUP BY f.id
                ORDER BY total_compras DESC
                LIMIT 10
            `);
            
            // Pedidos atrasados
            const [atrasados] = await pool.execute(`
                SELECT pc.id, pc.numero_pedido, pc.data_entrega_prevista,
                       f.razao_social as fornecedor,
                       DATEDIFF(CURDATE(), pc.data_entrega_prevista) as dias_atraso
                FROM pedidos_compra pc
                JOIN fornecedores f ON pc.fornecedor_id = f.id
                WHERE pc.data_entrega_prevista < CURDATE()
                  AND pc.status NOT IN ('recebido', 'cancelado')
                ORDER BY dias_atraso DESC
                LIMIT 10
            `);
            
            res.json({
                success: true,
                data: {
                    stats: stats[0] || {},
                    pedidosPorStatus,
                    topFornecedores,
                    pedidosAtrasados: atrasados
                }
            });
        } catch (error) {
            logger.error('Erro ao buscar dashboard:', error);
            res.status(500).json({ error: 'Erro ao carregar dashboard' });
        }
    });

    // ==================== FORNECEDORES ====================
    
    // Listar fornecedores
    router.get('/fornecedores', authenticateToken, async (req, res) => {
        try {
            const { search, status, categoria, limit = 50, offset = 0 } = req.query;
            
            let query = 'SELECT * FROM vw_fornecedores_performance WHERE 1=1';
            const params = [];
            
            if (search) {
                query += ' AND (razao_social LIKE ? OR nome_fantasia LIKE ? OR cnpj LIKE ? OR cidade LIKE ?)';
                const searchTerm = `%${search}%`;
                params.push(searchTerm, searchTerm, searchTerm, searchTerm);
            }
            
            if (status) {
                query += ' AND status = ?';
                params.push(status);
            }
            
            if (categoria) {
                query += ' AND categoria = ?';
                params.push(categoria);
            }
            
            // Contar total
            const countQuery = query.replace('SELECT * FROM', 'SELECT COUNT(*) as total FROM');
            const [countResult] = await pool.execute(countQuery, params);
            const total = countResult[0].total;
            
            query += ' ORDER BY razao_social LIMIT ? OFFSET ?';
            params.push(parseInt(limit), parseInt(offset));
            
            const [fornecedores] = await pool.execute(query, params);
            
            res.json({
                success: true,
                data: fornecedores,
                pagination: {
                    total,
                    limit: parseInt(limit),
                    offset: parseInt(offset),
                    pages: Math.ceil(total / limit)
                }
            });
        } catch (error) {
            logger.error('Erro ao listar fornecedores:', error);
            res.status(500).json({ error: 'Erro ao buscar fornecedores' });
        }
    });
    
    // Obter fornecedor por ID
    router.get('/fornecedores/:id', authenticateToken, async (req, res) => {
        try {
            const [fornecedor] = await pool.execute(
                'SELECT * FROM vw_fornecedores_performance WHERE id = ?',
                [req.params.id]
            );
            
            if (fornecedor.length === 0) {
                return res.status(404).json({ error: 'Fornecedor não encontrado' });
            }
            
            // Buscar contatos
            const [contatos] = await pool.execute(
                'SELECT * FROM fornecedor_contatos WHERE fornecedor_id = ? AND ativo = TRUE',
                [req.params.id]
            );
            
            // Buscar últimas avaliações
            const [avaliacoes] = await pool.execute(
                `SELECT fa.*, u.nome as avaliador_nome 
                FROM fornecedor_avaliacoes fa
                LEFT JOIN usuarios u ON fa.avaliador_id = u.id
                WHERE fa.fornecedor_id = ?
                ORDER BY fa.data_avaliacao DESC
                LIMIT 5`,
                [req.params.id]
            );
            
            // Buscar últimos pedidos
            const [pedidos] = await pool.execute(
                `SELECT id, numero_pedido, data_pedido, valor_total, status
                FROM pedidos_compra
                WHERE fornecedor_id = ?
                ORDER BY data_pedido DESC
                LIMIT 10`,
                [req.params.id]
            );
            
            res.json({
                success: true,
                data: {
                    ...fornecedor[0],
                    contatos,
                    avaliacoes,
                    ultimosPedidos: pedidos
                }
            });
        } catch (error) {
            logger.error('Erro ao buscar fornecedor:', error);
            res.status(500).json({ error: 'Erro ao buscar fornecedor' });
        }
    });
    
    // Criar fornecedor
    router.post('/fornecedores', 
        authenticateToken,
        [
            body('razao_social').notEmpty().withMessage('Razão social é obrigatória'),
            body('cnpj').notEmpty().withMessage('CNPJ é obrigatório')
                .custom((value) => validarCNPJ(value)).withMessage('CNPJ inválido'),
            body('telefone').notEmpty().withMessage('Telefone é obrigatório'),
            body('email').optional().isEmail().withMessage('Email inválido')
        ],
        async (req, res) => {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ errors: errors.array() });
            }
            
            const connection = await pool.getConnection();
            try {
                await connection.beginTransaction();
                
                const {
                    razao_social, nome_fantasia, cnpj, inscricao_estadual,
                    telefone, telefone_secundario, email, email_financeiro, site,
                    contato_principal, cargo_contato,
                    logradouro, numero, complemento, bairro, cidade, estado, cep,
                    prazo_entrega_padrao, prazo_pagamento_padrao, condicoes_pagamento,
                    valor_minimo_pedido, categoria, tipo_fornecedor, observacoes
                } = req.body;
                
                // Verificar se CNPJ já existe
                const [existente] = await connection.execute(
                    'SELECT id FROM fornecedores WHERE cnpj = ?',
                    [cnpj.replace(/[^\d]+/g, '')]
                );
                
                if (existente.length > 0) {
                    await connection.rollback();
                    return res.status(400).json({ error: 'CNPJ já cadastrado' });
                }
                
                // Gerar código do fornecedor
                const [ultimo] = await connection.execute(
                    "SELECT MAX(CAST(SUBSTRING(codigo, 5) AS UNSIGNED)) as ultimo FROM fornecedores WHERE codigo LIKE 'FOR-%'"
                );
                const proximo = (ultimo[0].ultimo || 0) + 1;
                const codigo = `FOR-${String(proximo).padStart(5, '0')}`;
                
                // Inserir fornecedor
                const [result] = await connection.execute(
                    `INSERT INTO fornecedores (
                        codigo, razao_social, nome_fantasia, cnpj, inscricao_estadual,
                        telefone, telefone_secundario, email, email_financeiro, site,
                        contato_principal, cargo_contato,
                        logradouro, numero, complemento, bairro, cidade, estado, cep,
                        prazo_entrega_padrao, prazo_pagamento_padrao, condicoes_pagamento,
                        valor_minimo_pedido, categoria, tipo_fornecedor, observacoes,
                        criado_por
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        codigo, razao_social, nome_fantasia, cnpj.replace(/[^\d]+/g, ''), inscricao_estadual,
                        telefone, telefone_secundario, email, email_financeiro, site,
                        contato_principal, cargo_contato,
                        logradouro, numero, complemento, bairro, cidade, estado, cep,
                        prazo_entrega_padrao || 30, prazo_pagamento_padrao, condicoes_pagamento,
                        valor_minimo_pedido || 0, categoria || 'homologado', tipo_fornecedor || 'outros', observacoes,
                        req.user.userId
                    ]
                );
                
                const fornecedorId = result.insertId;
                
                // Inserir contatos se fornecidos
                if (req.body.contatos && Array.isArray(req.body.contatos)) {
                    for (const contato of req.body.contatos) {
                        await connection.execute(
                            `INSERT INTO fornecedor_contatos 
                            (fornecedor_id, nome, cargo, departamento, telefone, celular, email, principal)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                            [
                                fornecedorId, contato.nome, contato.cargo, contato.departamento,
                                contato.telefone, contato.celular, contato.email, contato.principal || false
                            ]
                        );
                    }
                }
                
                await logAcao(connection, req.user.userId, 'criar_fornecedor', 'fornecedor', fornecedorId, null, { razao_social, cnpj }, req);
                
                await connection.commit();
                
                logger.info(`Fornecedor criado: ${codigo} - ${razao_social}`);
                res.json({ success: true, id: fornecedorId, codigo });
                
            } catch (error) {
                await connection.rollback();
                logger.error('Erro ao criar fornecedor:', error);
                res.status(500).json({ error: 'Erro ao criar fornecedor' });
            } finally {
                connection.release();
            }
        }
    );
    
    // Atualizar fornecedor
    router.put('/fornecedores/:id', authenticateToken, async (req, res) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            
            const fornecedorId = req.params.id;
            
            // Buscar dados anteriores
            const [anterior] = await connection.execute('SELECT * FROM fornecedores WHERE id = ?', [fornecedorId]);
            if (anterior.length === 0) {
                await connection.rollback();
                return res.status(404).json({ error: 'Fornecedor não encontrado' });
            }
            
            const campos = [];
            const valores = [];
            const camposPermitidos = [
                'razao_social', 'nome_fantasia', 'inscricao_estadual', 'telefone', 'telefone_secundario',
                'email', 'email_financeiro', 'site', 'contato_principal', 'cargo_contato',
                'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'estado', 'cep',
                'prazo_entrega_padrao', 'prazo_pagamento_padrao', 'condicoes_pagamento',
                'valor_minimo_pedido', 'status', 'categoria', 'tipo_fornecedor', 'observacoes'
            ];
            
            for (const campo of camposPermitidos) {
                if (req.body[campo] !== undefined) {
                    campos.push(`${campo} = ?`);
                    valores.push(req.body[campo]);
                }
            }
            
            if (campos.length === 0) {
                await connection.rollback();
                return res.status(400).json({ error: 'Nenhum campo para atualizar' });
            }
            
            campos.push('atualizado_por = ?', 'data_atualizacao = NOW()');
            valores.push(req.user.userId, fornecedorId);
            
            await connection.execute(
                `UPDATE fornecedores SET ${campos.join(', ')} WHERE id = ?`,
                valores
            );
            
            await logAcao(connection, req.user.userId, 'atualizar_fornecedor', 'fornecedor', fornecedorId, anterior[0], req.body, req);
            
            await connection.commit();
            
            logger.info(`Fornecedor atualizado: ${fornecedorId}`);
            res.json({ success: true });
            
        } catch (error) {
            await connection.rollback();
            logger.error('Erro ao atualizar fornecedor:', error);
            res.status(500).json({ error: 'Erro ao atualizar fornecedor' });
        } finally {
            connection.release();
        }
    });
    
    // Avaliar fornecedor
    router.post('/fornecedores/:id/avaliar', authenticateToken, async (req, res) => {
        try {
            const { pedido_id, nota_qualidade, nota_prazo, nota_preco, nota_atendimento, nota_entrega, comentarios, pontos_positivos, pontos_negativos, recomenda_fornecedor } = req.body;
            
            await pool.execute(
                `INSERT INTO fornecedor_avaliacoes 
                (fornecedor_id, pedido_id, data_avaliacao, avaliador_id, nota_qualidade, nota_prazo, nota_preco, nota_atendimento, nota_entrega, comentarios, pontos_positivos, pontos_negativos, recomenda_fornecedor)
                VALUES (?, ?, CURDATE(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [req.params.id, pedido_id, req.user.userId, nota_qualidade, nota_prazo, nota_preco, nota_atendimento, nota_entrega, comentarios, pontos_positivos, pontos_negativos, recomenda_fornecedor]
            );
            
            // Recalcular médias do fornecedor
            await pool.execute(`
                UPDATE fornecedores f
                SET 
                    nota_qualidade = (SELECT AVG(nota_qualidade) FROM fornecedor_avaliacoes WHERE fornecedor_id = f.id),
                    nota_prazo = (SELECT AVG(nota_prazo) FROM fornecedor_avaliacoes WHERE fornecedor_id = f.id),
                    nota_preco = (SELECT AVG(nota_preco) FROM fornecedor_avaliacoes WHERE fornecedor_id = f.id),
                    nota_atendimento = (SELECT AVG(nota_atendimento) FROM fornecedor_avaliacoes WHERE fornecedor_id = f.id),
                    avaliacao_geral = (
                        SELECT AVG((nota_qualidade + nota_prazo + nota_preco + nota_atendimento + IFNULL(nota_entrega, 0)) / 5)
                        FROM fornecedor_avaliacoes WHERE fornecedor_id = f.id
                    )
                WHERE id = ?
            `, [req.params.id]);
            
            res.json({ success: true });
        } catch (error) {
            logger.error('Erro ao avaliar fornecedor:', error);
            res.status(500).json({ error: 'Erro ao avaliar fornecedor' });
        }
    });

    // ==================== PEDIDOS DE COMPRA ====================
    
    // Listar pedidos
    router.get('/pedidos', authenticateToken, async (req, res) => {
        try {
            const { status, data_inicio, data_fim, fornecedor_id, prioridade, origem, limit = 50, offset = 0 } = req.query;
            
            let query = 'SELECT * FROM vw_pedidos_completos WHERE 1=1';
            const params = [];
            
            if (status) {
                query += ' AND status = ?';
                params.push(status);
            }
            
            if (data_inicio && data_fim) {
                query += ' AND data_pedido BETWEEN ? AND ?';
                params.push(data_inicio, data_fim);
            }
            
            if (fornecedor_id) {
                query += ' AND fornecedor_id = ?';
                params.push(fornecedor_id);
            }
            
            if (prioridade) {
                query += ' AND prioridade = ?';
                params.push(prioridade);
            }
            
            if (origem) {
                query += ' AND origem = ?';
                params.push(origem);
            }
            
            // Contar total
            const countQuery = query.replace('SELECT * FROM', 'SELECT COUNT(*) as total FROM');
            const [countResult] = await pool.execute(countQuery, params);
            const total = countResult[0].total;
            
            query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
            params.push(parseInt(limit), parseInt(offset));
            
            const [pedidos] = await pool.execute(query, params);
            
            res.json({
                success: true,
                data: pedidos,
                pagination: {
                    total,
                    limit: parseInt(limit),
                    offset: parseInt(offset),
                    pages: Math.ceil(total / limit)
                }
            });
        } catch (error) {
            logger.error('Erro ao listar pedidos:', error);
            res.status(500).json({ error: 'Erro ao buscar pedidos' });
        }
    });
    
    // Obter pedido por ID
    router.get('/pedidos/:id', authenticateToken, async (req, res) => {
        try {
            const [pedido] = await pool.execute(
                'SELECT * FROM vw_pedidos_completos WHERE id = ?',
                [req.params.id]
            );
            
            if (pedido.length === 0) {
                return res.status(404).json({ error: 'Pedido não encontrado' });
            }
            
            // Buscar itens do pedido
            const [itens] = await pool.execute(
                'SELECT * FROM pedidos_itens WHERE pedido_id = ?',
                [req.params.id]
            );
            
            // Buscar workflow de aprovações
            const [aprovacoes] = await pool.execute(
                `SELECT wa.*, u.nome as aprovador_nome
                FROM workflow_aprovacoes wa
                LEFT JOIN usuarios u ON wa.aprovador_id = u.id
                WHERE wa.entidade_tipo = 'pedido_compra' AND wa.entidade_id = ?
                ORDER BY wa.nivel`,
                [req.params.id]
            );
            
            // Buscar recebimentos
            const [recebimentos] = await pool.execute(
                `SELECT r.*, u.nome as recebedor_nome
                FROM recebimentos r
                LEFT JOIN usuarios u ON r.usuario_recebedor = u.id
                WHERE r.pedido_id = ?
                ORDER BY r.data_recebimento DESC`,
                [req.params.id]
            );
            
            res.json({
                success: true,
                data: {
                    ...pedido[0],
                    itens,
                    aprovacoes,
                    recebimentos
                }
            });
        } catch (error) {
            logger.error('Erro ao buscar pedido:', error);
            res.status(500).json({ error: 'Erro ao buscar pedido' });
        }
    });
    
    // Criar pedido de compra
    router.post('/pedidos', authenticateToken, async (req, res) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            
            const {
                fornecedor_id, data_entrega_prevista, prioridade, condicoes_pagamento,
                prazo_entrega_dias, local_entrega, forma_frete, origem, pcp_ordem_id,
                observacoes, observacoes_internas, itens, frete, seguro, outras_despesas, desconto
            } = req.body;
            
            if (!fornecedor_id || !itens || !Array.isArray(itens) || itens.length === 0) {
                await connection.rollback();
                return res.status(400).json({ error: 'Fornecedor e itens são obrigatórios' });
            }
            
            // Gerar número do pedido
            const ano = new Date().getFullYear();
            const [ultimos] = await connection.execute(
                "SELECT MAX(CAST(SUBSTRING(numero_pedido, 8) AS UNSIGNED)) as ultimo FROM pedidos_compra WHERE numero_pedido LIKE ?",
                [`PC-${ano}%`]
            );
            const proximo = (ultimos[0].ultimo || 0) + 1;
            const numero_pedido = `PC-${ano}-${String(proximo).padStart(6, '0')}`;
            
            // Calcular valor total dos produtos
            const valor_produtos = itens.reduce((sum, item) => {
                return sum + (parseFloat(item.quantidade) * parseFloat(item.preco_unitario) - (parseFloat(item.desconto) || 0));
            }, 0);
            
            // Inserir pedido
            const [pedido] = await connection.execute(
                `INSERT INTO pedidos_compra (
                    numero_pedido, fornecedor_id, data_pedido, data_entrega_prevista,
                    prioridade, valor_produtos, desconto, frete, seguro, outras_despesas,
                    condicoes_pagamento, prazo_entrega_dias, local_entrega, forma_frete,
                    origem, pcp_ordem_id, observacoes, observacoes_internas,
                    usuario_solicitante, criado_por, status
                ) VALUES (?, ?, CURDATE(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendente')`,
                [
                    numero_pedido, fornecedor_id, data_entrega_prevista,
                    prioridade || 'normal', valor_produtos, desconto || 0, frete || 0, seguro || 0, outras_despesas || 0,
                    condicoes_pagamento, prazo_entrega_dias, local_entrega, forma_frete || 'CIF',
                    origem || 'manual', pcp_ordem_id, observacoes, observacoes_internas,
                    req.user.userId, req.user.userId
                ]
            );
            
            const pedidoId = pedido.insertId;
            
            // Inserir itens
            for (const item of itens) {
                await connection.execute(
                    `INSERT INTO pedidos_itens (
                        pedido_id, produto_id, codigo_produto, descricao, especificacao,
                        quantidade, unidade, preco_unitario, desconto, prazo_entrega_item, observacoes
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        pedidoId, item.produto_id, item.codigo_produto, item.descricao, item.especificacao,
                        item.quantidade, item.unidade || 'UN', item.preco_unitario, item.desconto || 0,
                        item.prazo_entrega_item, item.observacoes
                    ]
                );
            }
            
            // Verificar se precisa de aprovação
            const [config] = await connection.execute(
                "SELECT valor FROM compras_configuracoes WHERE chave = 'pedido_aprovacao_valor_minimo'"
            );
            const valorMinimoAprovacao = parseFloat(config[0]?.valor || 5000);
            
            const valorTotal = valor_produtos - (desconto || 0) + (frete || 0) + (seguro || 0) + (outras_despesas || 0);
            
            if (valorTotal >= valorMinimoAprovacao) {
                // Buscar aprovadores necessários
                const [regras] = await connection.execute(
                    `SELECT * FROM workflow_regras_aprovacao 
                    WHERE entidade_tipo = 'pedido_compra' 
                      AND ativo = TRUE
                      AND (valor_minimo IS NULL OR ? >= valor_minimo)
                      AND (valor_maximo IS NULL OR ? <= valor_maximo)
                    ORDER BY nivel`,
                    [valorTotal, valorTotal]
                );
                
                // Criar workflow de aprovação
                for (const regra of regras) {
                    await connection.execute(
                        `INSERT INTO workflow_aprovacoes 
                        (entidade_tipo, entidade_id, nivel, aprovador_id, status)
                        VALUES ('pedido_compra', ?, ?, ?, 'pendente')`,
                        [pedidoId, regra.nivel, regra.aprovador_id]
                    );
                    
                    // Criar notificação para aprovador
                    await criarNotificacao(
                        connection,
                        regra.aprovador_id,
                        'pedido_aprovacao',
                        'Pedido aguardando aprovação',
                        `O pedido ${numero_pedido} no valor de R$ ${valorTotal.toFixed(2)} aguarda sua aprovação.`,
                        'pedido_compra',
                        pedidoId,
                        true
                    );
                }
                
                // Atualizar status do pedido
                await connection.execute(
                    'UPDATE pedidos_compra SET status = "aguardando_aprovacao" WHERE id = ?',
                    [pedidoId]
                );
            }
            
            await logAcao(connection, req.user.userId, 'criar_pedido', 'pedido_compra', pedidoId, null, { numero_pedido, fornecedor_id, valor_total: valorTotal }, req);
            
            await connection.commit();
            
            logger.info(`Pedido criado: ${numero_pedido}`);
            res.json({ success: true, id: pedidoId, numero_pedido });
            
        } catch (error) {
            await connection.rollback();
            logger.error('Erro ao criar pedido:', error);
            res.status(500).json({ error: 'Erro ao criar pedido: ' + error.message });
        } finally {
            connection.release();
        }
    });
    
    // Aprovar/Rejeitar pedido
    router.post('/pedidos/:id/aprovar', authenticateToken, async (req, res) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            
            const pedidoId = req.params.id;
            const { aprovar, comentario } = req.body;
            
            // Buscar workflow pendente do usuário
            const [workflow] = await connection.execute(
                `SELECT * FROM workflow_aprovacoes 
                WHERE entidade_tipo = 'pedido_compra' 
                  AND entidade_id = ? 
                  AND aprovador_id = ? 
                  AND status = 'pendente'
                ORDER BY nivel
                LIMIT 1`,
                [pedidoId, req.user.userId]
            );
            
            if (workflow.length === 0) {
                await connection.rollback();
                return res.status(403).json({ error: 'Você não tem permissão para aprovar este pedido' });
            }
            
            const novoStatus = aprovar ? 'aprovado' : 'rejeitado';
            
            // Atualizar workflow
            await connection.execute(
                `UPDATE workflow_aprovacoes 
                SET status = ?, data_acao = NOW(), comentario = ?
                WHERE id = ?`,
                [novoStatus, comentario, workflow[0].id]
            );
            
            if (aprovar) {
                // Verificar se há mais aprovações pendentes
                const [pendentes] = await connection.execute(
                    `SELECT COUNT(*) as total FROM workflow_aprovacoes 
                    WHERE entidade_tipo = 'pedido_compra' 
                      AND entidade_id = ? 
                      AND status = 'pendente'`,
                    [pedidoId]
                );
                
                if (pendentes[0].total === 0) {
                    // Todas as aprovações concluídas
                    await connection.execute(
                        `UPDATE pedidos_compra 
                        SET status = 'aprovado', usuario_aprovador = ?, data_aprovacao = NOW()
                        WHERE id = ?`,
                        [req.user.userId, pedidoId]
                    );
                    
                    // Notificar solicitante
                    const [pedido] = await connection.execute(
                        'SELECT usuario_solicitante, numero_pedido FROM pedidos_compra WHERE id = ?',
                        [pedidoId]
                    );
                    
                    await criarNotificacao(
                        connection,
                        pedido[0].usuario_solicitante,
                        'pedido_aprovado',
                        'Pedido aprovado',
                        `Seu pedido ${pedido[0].numero_pedido} foi aprovado e pode ser enviado ao fornecedor.`,
                        'pedido_compra',
                        pedidoId,
                        true
                    );
                }
            } else {
                // Rejeitar pedido
                await connection.execute(
                    `UPDATE pedidos_compra 
                    SET status = 'rejeitado', motivo_rejeicao = ?
                    WHERE id = ?`,
                    [comentario, pedidoId]
                );
                
                // Notificar solicitante
                const [pedido] = await connection.execute(
                    'SELECT usuario_solicitante, numero_pedido FROM pedidos_compra WHERE id = ?',
                    [pedidoId]
                );
                
                await criarNotificacao(
                    connection,
                    pedido[0].usuario_solicitante,
                    'pedido_rejeitado',
                    'Pedido rejeitado',
                    `Seu pedido ${pedido[0].numero_pedido} foi rejeitado. Motivo: ${comentario}`,
                    'pedido_compra',
                    pedidoId,
                    true
                );
            }
            
            await logAcao(connection, req.user.userId, aprovar ? 'aprovar_pedido' : 'rejeitar_pedido', 'pedido_compra', pedidoId, null, { comentario }, req);
            
            await connection.commit();
            res.json({ success: true });
            
        } catch (error) {
            await connection.rollback();
            logger.error('Erro ao aprovar/rejeitar pedido:', error);
            res.status(500).json({ error: 'Erro ao processar aprovação' });
        } finally {
            connection.release();
        }
    });
    
    // Cancelar pedido
    router.post('/pedidos/:id/cancelar', authenticateToken, async (req, res) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            
            const { motivo } = req.body;
            
            await connection.execute(
                `UPDATE pedidos_compra 
                SET status = 'cancelado', usuario_cancelamento = ?, data_cancelamento = NOW(), motivo_cancelamento = ?
                WHERE id = ?`,
                [req.user.userId, motivo, req.params.id]
            );
            
            await logAcao(connection, req.user.userId, 'cancelar_pedido', 'pedido_compra', req.params.id, null, { motivo }, req);
            
            await connection.commit();
            res.json({ success: true });
            
        } catch (error) {
            await connection.rollback();
            logger.error('Erro ao cancelar pedido:', error);
            res.status(500).json({ error: 'Erro ao cancelar pedido' });
        } finally {
            connection.release();
        }
    });

    // ==================== COTAÇÕES ====================
    
    // Listar cotações
    router.get('/cotacoes', authenticateToken, async (req, res) => {
        try {
            const { status, limit = 50, offset = 0 } = req.query;
            
            let query = `
                SELECT c.*, u.nome as responsavel_nome,
                       COUNT(DISTINCT ci.id) as total_itens,
                       COUNT(DISTINCT cp.id) as total_propostas
                FROM cotacoes c
                LEFT JOIN usuarios u ON c.usuario_responsavel = u.id
                LEFT JOIN cotacoes_itens ci ON c.id = ci.cotacao_id
                LEFT JOIN cotacoes_propostas cp ON c.id = cp.cotacao_id
                WHERE 1=1
            `;
            const params = [];
            
            if (status) {
                query += ' AND c.status = ?';
                params.push(status);
            }
            
            query += ' GROUP BY c.id ORDER BY c.created_at DESC LIMIT ? OFFSET ?';
            params.push(parseInt(limit), parseInt(offset));
            
            const [cotacoes] = await pool.execute(query, params);
            res.json({ success: true, data: cotacoes });
        } catch (error) {
            logger.error('Erro ao listar cotações:', error);
            res.status(500).json({ error: 'Erro ao buscar cotações' });
        }
    });
    
    // Criar cotação
    router.post('/cotacoes', authenticateToken, async (req, res) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            
            const { titulo, descricao, data_encerramento, tipo, itens, fornecedores } = req.body;
            
            // Gerar número da cotação
            const ano = new Date().getFullYear();
            const [ultimos] = await connection.execute(
                "SELECT MAX(CAST(SUBSTRING(numero_cotacao, 8) AS UNSIGNED)) as ultimo FROM cotacoes WHERE numero_cotacao LIKE ?",
                [`COT-${ano}%`]
            );
            const proximo = (ultimos[0].ultimo || 0) + 1;
            const numero_cotacao = `COT-${ano}-${String(proximo).padStart(6, '0')}`;
            
            // Inserir cotação
            const [cotacao] = await connection.execute(
                `INSERT INTO cotacoes (
                    numero_cotacao, titulo, descricao, data_abertura, data_encerramento,
                    tipo, usuario_responsavel, criado_por, status
                ) VALUES (?, ?, ?, CURDATE(), ?, ?, ?, ?, 'aberta')`,
                [numero_cotacao, titulo, descricao, data_encerramento, tipo || 'preco', req.user.userId, req.user.userId]
            );
            
            const cotacaoId = cotacao.insertId;
            
            // Inserir itens
            for (const item of itens) {
                await connection.execute(
                    `INSERT INTO cotacoes_itens (
                        cotacao_id, codigo_produto, descricao, especificacao,
                        quantidade, unidade, preco_referencia, observacoes
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        cotacaoId, item.codigo_produto, item.descricao, item.especificacao,
                        item.quantidade, item.unidade || 'UN', item.preco_referencia, item.observacoes
                    ]
                );
            }
            
            // Notificar fornecedores (se fornecidos)
            if (fornecedores && Array.isArray(fornecedores)) {
                for (const fornecedorId of fornecedores) {
                    // Aqui você pode implementar envio de email para fornecedor
                    // await enviarEmailCotacao(fornecedorId, cotacaoId);
                }
            }
            
            await logAcao(connection, req.user.userId, 'criar_cotacao', 'cotacao', cotacaoId, null, { numero_cotacao, titulo }, req);
            
            await connection.commit();
            
            logger.info(`Cotação criada: ${numero_cotacao}`);
            res.json({ success: true, id: cotacaoId, numero_cotacao });
            
        } catch (error) {
            await connection.rollback();
            logger.error('Erro ao criar cotação:', error);
            res.status(500).json({ error: 'Erro ao criar cotação' });
        } finally {
            connection.release();
        }
    });

    // Aprovar proposta e gerar pedido de compra automaticamente
    // FLUXO: Cotação → Fornecedor → Pedido de Compra
    router.post('/cotacoes/:id/aprovar-proposta', authenticateToken, async (req, res) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            
            const cotacaoId = req.params.id;
            const { proposta_id, fornecedor_id, observacoes } = req.body;
            
            // 1. Buscar a cotação com seus itens
            const [cotacaoResult] = await connection.execute(
                `SELECT c.*, u.nome as responsavel_nome 
                 FROM cotacoes c 
                 LEFT JOIN usuarios u ON c.usuario_responsavel = u.id 
                 WHERE c.id = ?`,
                [cotacaoId]
            );
            
            if (cotacaoResult.length === 0) {
                await connection.rollback();
                return res.status(404).json({ error: 'Cotação não encontrada' });
            }
            
            const cotacao = cotacaoResult[0];
            
            // 2. Buscar itens da cotação
            const [itensCotacao] = await connection.execute(
                `SELECT * FROM cotacoes_itens WHERE cotacao_id = ?`,
                [cotacaoId]
            );
            
            // 3. Buscar proposta selecionada (se houver)
            let proposta = null;
            let fornecedorIdFinal = fornecedor_id;
            
            if (proposta_id) {
                const [propostaResult] = await connection.execute(
                    `SELECT cp.*, f.razao_social as fornecedor_nome
                     FROM cotacoes_propostas cp
                     LEFT JOIN fornecedores f ON cp.fornecedor_id = f.id
                     WHERE cp.id = ?`,
                    [proposta_id]
                );
                if (propostaResult.length > 0) {
                    proposta = propostaResult[0];
                    fornecedorIdFinal = proposta.fornecedor_id;
                }
            }
            
            // 4. Validar fornecedor
            if (!fornecedorIdFinal) {
                await connection.rollback();
                return res.status(400).json({ error: 'Fornecedor é obrigatório' });
            }
            
            // 5. Buscar dados do fornecedor
            const [fornecedorResult] = await connection.execute(
                `SELECT * FROM fornecedores WHERE id = ?`,
                [fornecedorIdFinal]
            );
            
            if (fornecedorResult.length === 0) {
                await connection.rollback();
                return res.status(404).json({ error: 'Fornecedor não encontrado' });
            }
            
            const fornecedor = fornecedorResult[0];
            
            // 6. Gerar número do pedido de compra
            const ano = new Date().getFullYear();
            const [ultimos] = await connection.execute(
                "SELECT MAX(CAST(SUBSTRING(numero_pedido, 8) AS UNSIGNED)) as ultimo FROM pedidos_compra WHERE numero_pedido LIKE ?",
                [`PC-${ano}%`]
            );
            const proximo = (ultimos[0].ultimo || 0) + 1;
            const numero_pedido = `PC-${ano}-${String(proximo).padStart(6, '0')}`;
            
            // 7. Calcular valores dos itens
            let valorTotalProdutos = 0;
            const itensPedido = [];
            
            for (const itemCot of itensCotacao) {
                // Buscar preço da proposta (se houver) ou usar preço de referência
                let precoUnitario = itemCot.preco_referencia || 0;
                
                if (proposta_id) {
                    const [itemProposta] = await connection.execute(
                        `SELECT * FROM cotacoes_propostas_itens 
                         WHERE proposta_id = ? AND cotacao_item_id = ?`,
                        [proposta_id, itemCot.id]
                    );
                    if (itemProposta.length > 0) {
                        precoUnitario = itemProposta[0].preco_unitario;
                    }
                }
                
                const valorTotal = itemCot.quantidade * precoUnitario;
                valorTotalProdutos += valorTotal;
                
                itensPedido.push({
                    codigo: itemCot.codigo_produto,
                    descricao: itemCot.descricao,
                    quantidade: itemCot.quantidade,
                    unidade: itemCot.unidade,
                    preco_unitario: precoUnitario,
                    valor_total: valorTotal,
                    especificacao: itemCot.especificacao
                });
            }
            
            // 8. Criar pedido de compra
            const dataEntregaPrevista = new Date();
            dataEntregaPrevista.setDate(dataEntregaPrevista.getDate() + (proposta?.prazo_entrega_dias || 15));
            
            const [pedidoResult] = await connection.execute(
                `INSERT INTO pedidos_compra (
                    numero_pedido, fornecedor_id, cotacao_id, data_pedido, data_entrega_prevista,
                    status, prioridade, valor_produtos, valor_total,
                    condicoes_pagamento, observacoes, criado_por, origem
                ) VALUES (?, ?, ?, CURDATE(), ?, 'pendente', 'normal', ?, ?, ?, ?, ?, 'cotacao')`,
                [
                    numero_pedido,
                    fornecedorIdFinal,
                    cotacaoId,
                    dataEntregaPrevista.toISOString().split('T')[0],
                    valorTotalProdutos,
                    valorTotalProdutos,
                    proposta?.condicao_pagamento || fornecedor.condicao_pagamento || '30 dias',
                    observacoes || `Pedido gerado a partir da cotação ${cotacao.numero_cotacao}`,
                    req.user.userId
                ]
            );
            
            const pedidoId = pedidoResult.insertId;
            
            // 9. Inserir itens do pedido
            for (const item of itensPedido) {
                await connection.execute(
                    `INSERT INTO pedidos_itens (
                        pedido_id, codigo_produto, descricao, quantidade, unidade,
                        preco_unitario, valor_total, especificacao
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        pedidoId,
                        item.codigo,
                        item.descricao,
                        item.quantidade,
                        item.unidade,
                        item.preco_unitario,
                        item.valor_total,
                        item.especificacao
                    ]
                );
            }
            
            // 10. Atualizar status da cotação para aprovada
            await connection.execute(
                `UPDATE cotacoes 
                 SET status = 'aprovada', 
                     proposta_aprovada_id = ?,
                     fornecedor_aprovado_id = ?,
                     pedido_gerado_id = ?,
                     data_aprovacao = NOW(),
                     aprovado_por = ?
                 WHERE id = ?`,
                [proposta_id, fornecedorIdFinal, pedidoId, req.user.userId, cotacaoId]
            );
            
            // 11. Se houver proposta, atualizar status
            if (proposta_id) {
                await connection.execute(
                    `UPDATE cotacoes_propostas SET status = 'aprovada' WHERE id = ?`,
                    [proposta_id]
                );
                
                // Rejeitar outras propostas
                await connection.execute(
                    `UPDATE cotacoes_propostas 
                     SET status = 'rejeitada' 
                     WHERE cotacao_id = ? AND id != ?`,
                    [cotacaoId, proposta_id]
                );
            }
            
            // 12. Log da ação
            await logAcao(connection, req.user.userId, 'aprovar_cotacao_gerar_pedido', 'cotacao', cotacaoId, null, {
                cotacao_numero: cotacao.numero_cotacao,
                pedido_numero: numero_pedido,
                fornecedor_id: fornecedorIdFinal,
                valor_total: valorTotalProdutos
            }, req);
            
            await connection.commit();
            
            logger.info(`Cotação ${cotacao.numero_cotacao} aprovada → Pedido ${numero_pedido} gerado`);
            
            res.json({
                success: true,
                message: 'Proposta aprovada e pedido de compra gerado com sucesso!',
                pedido: {
                    id: pedidoId,
                    numero_pedido: numero_pedido,
                    fornecedor: fornecedor.razao_social,
                    valor_total: valorTotalProdutos
                },
                cotacao: {
                    id: cotacaoId,
                    numero: cotacao.numero_cotacao,
                    status: 'aprovada'
                }
            });
            
        } catch (error) {
            await connection.rollback();
            logger.error('Erro ao aprovar cotação e gerar pedido:', error);
            res.status(500).json({ error: 'Erro ao processar aprovação: ' + error.message });
        } finally {
            connection.release();
        }
    });

    // Buscar detalhes de uma cotação específica
    router.get('/cotacoes/:id', authenticateToken, async (req, res) => {
        try {
            const cotacaoId = req.params.id;
            
            // Buscar cotação
            const [cotacao] = await pool.execute(
                `SELECT c.*, u.nome as responsavel_nome,
                        ua.nome as aprovador_nome,
                        f.razao_social as fornecedor_aprovado_nome,
                        pc.numero_pedido as pedido_gerado_numero
                 FROM cotacoes c
                 LEFT JOIN usuarios u ON c.usuario_responsavel = u.id
                 LEFT JOIN usuarios ua ON c.aprovado_por = ua.id
                 LEFT JOIN fornecedores f ON c.fornecedor_aprovado_id = f.id
                 LEFT JOIN pedidos_compra pc ON c.pedido_gerado_id = pc.id
                 WHERE c.id = ?`,
                [cotacaoId]
            );
            
            if (cotacao.length === 0) {
                return res.status(404).json({ error: 'Cotação não encontrada' });
            }
            
            // Buscar itens
            const [itens] = await pool.execute(
                `SELECT * FROM cotacoes_itens WHERE cotacao_id = ?`,
                [cotacaoId]
            );
            
            // Buscar propostas
            const [propostas] = await pool.execute(
                `SELECT cp.*, f.razao_social as fornecedor_nome, f.cnpj as fornecedor_cnpj
                 FROM cotacoes_propostas cp
                 LEFT JOIN fornecedores f ON cp.fornecedor_id = f.id
                 WHERE cp.cotacao_id = ?
                 ORDER BY cp.valor_total ASC`,
                [cotacaoId]
            );
            
            // Para cada proposta, buscar seus itens
            for (const prop of propostas) {
                const [itensPropostas] = await pool.execute(
                    `SELECT cpi.*, ci.descricao as item_descricao
                     FROM cotacoes_propostas_itens cpi
                     LEFT JOIN cotacoes_itens ci ON cpi.cotacao_item_id = ci.id
                     WHERE cpi.proposta_id = ?`,
                    [prop.id]
                );
                prop.itens = itensPropostas;
            }
            
            res.json({
                success: true,
                data: {
                    ...cotacao[0],
                    itens,
                    propostas
                }
            });
            
        } catch (error) {
            logger.error('Erro ao buscar cotação:', error);
            res.status(500).json({ error: 'Erro ao buscar cotação' });
        }
    });

    // ==================== RECEBIMENTOS ====================
    
    // Criar recebimento
    router.post('/recebimentos', authenticateToken, async (req, res) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            
            const {
                pedido_id, numero_nfe, serie_nfe, chave_nfe, data_emissao_nfe, valor_nfe,
                conferente, observacoes, itens
            } = req.body;
            
            // Gerar número do recebimento
            const ano = new Date().getFullYear();
            const [ultimos] = await connection.execute(
                "SELECT MAX(CAST(SUBSTRING(numero_recebimento, 8) AS UNSIGNED)) as ultimo FROM recebimentos WHERE numero_recebimento LIKE ?",
                [`REC-${ano}%`]
            );
            const proximo = (ultimos[0].ultimo || 0) + 1;
            const numero_recebimento = `REC-${ano}-${String(proximo).padStart(6, '0')}`;
            
            // Inserir recebimento
            const [recebimento] = await connection.execute(
                `INSERT INTO recebimentos (
                    pedido_id, numero_recebimento, usuario_recebedor, conferente,
                    numero_nfe, serie_nfe, chave_nfe, data_emissao_nfe, valor_nfe,
                    observacoes, status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completo')`,
                [
                    pedido_id, numero_recebimento, req.user.userId, conferente,
                    numero_nfe, serie_nfe, chave_nfe, data_emissao_nfe, valor_nfe,
                    observacoes
                ]
            );
            
            const recebimentoId = recebimento.insertId;
            let temDivergencia = false;
            
            // Inserir itens recebidos
            for (const item of itens) {
                await connection.execute(
                    `INSERT INTO recebimentos_itens (
                        recebimento_id, pedido_item_id, quantidade_pedida, quantidade_recebida,
                        quantidade_aprovada, quantidade_rejeitada, motivo_rejeicao,
                        localizacao_estoque, lote, data_fabricacao, data_validade, observacoes
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        recebimentoId, item.pedido_item_id, item.quantidade_pedida, item.quantidade_recebida,
                        item.quantidade_aprovada, item.quantidade_rejeitada || 0, item.motivo_rejeicao,
                        item.localizacao_estoque, item.lote, item.data_fabricacao, item.data_validade, item.observacoes
                    ]
                );
                
                // Atualizar quantidade recebida no item do pedido
                await connection.execute(
                    `UPDATE pedidos_itens 
                    SET quantidade_recebida = quantidade_recebida + ?
                    WHERE id = ?`,
                    [item.quantidade_aprovada, item.pedido_item_id]
                );
                
                if (item.quantidade_rejeitada > 0 || item.quantidade_recebida != item.quantidade_pedida) {
                    temDivergencia = true;
                }
            }
            
            // Atualizar status do recebimento se houver divergência
            if (temDivergencia) {
                await connection.execute(
                    'UPDATE recebimentos SET status = "com_divergencia" WHERE id = ?',
                    [recebimentoId]
                );
            }
            
            // Verificar se pedido foi totalmente recebido
            const [pedidoItens] = await connection.execute(
                `SELECT SUM(quantidade) as total_pedido, SUM(quantidade_recebida) as total_recebido
                FROM pedidos_itens WHERE pedido_id = ?`,
                [pedido_id]
            );
            
            if (pedidoItens[0].total_pedido <= pedidoItens[0].total_recebido) {
                await connection.execute(
                    `UPDATE pedidos_compra 
                    SET status = 'recebido', data_entrega_real = CURDATE()
                    WHERE id = ?`,
                    [pedido_id]
                );
            } else {
                await connection.execute(
                    'UPDATE pedidos_compra SET status = "parcial" WHERE id = ?',
                    [pedido_id]
                );
            }
            
            await logAcao(connection, req.user.userId, 'criar_recebimento', 'recebimento', recebimentoId, null, { numero_recebimento, pedido_id }, req);
            
            await connection.commit();
            
            logger.info(`Recebimento criado: ${numero_recebimento}`);
            res.json({ success: true, id: recebimentoId, numero_recebimento });
            
        } catch (error) {
            await connection.rollback();
            logger.error('Erro ao criar recebimento:', error);
            res.status(500).json({ error: 'Erro ao criar recebimento' });
        } finally {
            connection.release();
        }
    });

    // ==================== NOTIFICAÇÕES ====================
    
    // Listar notificações do usuário
    router.get('/notificacoes', authenticateToken, async (req, res) => {
        try {
            const { limit = 20 } = req.query;
            
            const [notificacoes] = await pool.execute(
                `SELECT * FROM compras_notificacoes 
                WHERE usuario_id = ? 
                ORDER BY created_at DESC 
                LIMIT ?`,
                [req.user.userId, parseInt(limit)]
            );
            
            const [naoLidas] = await pool.execute(
                'SELECT COUNT(*) as total FROM compras_notificacoes WHERE usuario_id = ? AND lida = FALSE',
                [req.user.userId]
            );
            
            res.json({
                success: true,
                data: notificacoes,
                nao_lidas: naoLidas[0].total
            });
        } catch (error) {
            logger.error('Erro ao listar notificações:', error);
            res.status(500).json({ error: 'Erro ao buscar notificações' });
        }
    });
    
    // Marcar notificação como lida
    router.put('/notificacoes/:id/ler', authenticateToken, async (req, res) => {
        try {
            await pool.execute(
                `UPDATE compras_notificacoes 
                SET lida = TRUE, data_leitura = NOW() 
                WHERE id = ? AND usuario_id = ?`,
                [req.params.id, req.user.userId]
            );
            
            res.json({ success: true });
        } catch (error) {
            logger.error('Erro ao marcar notificação:', error);
            res.status(500).json({ error: 'Erro ao marcar notificação' });
        }
    });

    // ==================== CONSULTA NF-e SEFAZ ====================
    
    // Consultar NF-e pela chave de acesso no SEFAZ
    router.get('/nfe/consultar/:chaveAcesso', authenticateToken, async (req, res) => {
        try {
            const { chaveAcesso } = req.params;
            
            // Validar formato da chave (44 dígitos)
            const chaveNormalizada = chaveAcesso.replace(/\D/g, '');
            if (chaveNormalizada.length !== 44) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Chave de acesso inválida. Deve conter 44 dígitos.' 
                });
            }
            
            // Validar dígito verificador
            if (!validarChaveAcesso(chaveNormalizada)) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Chave de acesso inválida. Dígito verificador incorreto.' 
                });
            }
            
            // Extrair informações da chave de acesso
            const dadosChave = extrairDadosChave(chaveNormalizada);
            
            try {
                // Tentar consultar no SEFAZ
                const sefazService = require('../../modules/Faturamento/services/sefaz.service');
                const resultado = await sefazService.consultarNFe(chaveNormalizada, dadosChave.uf);
                
                if (resultado.autorizado) {
                    // Extrair dados do XML retornado
                    const dadosNfe = extrairDadosNFeXML(resultado.xmlCompleto);
                    
                    res.json({
                        success: true,
                        fonte: 'sefaz',
                        dados: {
                            chave_acesso: chaveNormalizada,
                            numero: dadosNfe.numero || dadosChave.numero,
                            serie: dadosNfe.serie || dadosChave.serie,
                            data_emissao: dadosNfe.dataEmissao,
                            valor_total: dadosNfe.valorTotal,
                            emitente: {
                                cnpj: dadosNfe.emitenteCnpj || dadosChave.cnpj,
                                razao_social: dadosNfe.emitenteNome,
                                uf: dadosNfe.emitenteUf || dadosChave.uf
                            },
                            destinatario: {
                                cnpj: dadosNfe.destinatarioCnpj,
                                razao_social: dadosNfe.destinatarioNome
                            },
                            status: 'autorizada',
                            protocolo: resultado.numeroProtocolo,
                            itens: dadosNfe.itens || []
                        }
                    });
                } else {
                    res.status(404).json({
                        success: false,
                        error: 'NF-e não encontrada ou não autorizada',
                        codigo: resultado.codigoStatus
                    });
                }
            } catch (sefazError) {
                // Se falhou a consulta ao SEFAZ, retornar dados extraídos da chave
                logger.warn('Erro ao consultar SEFAZ:', sefazError.message);
                
                res.json({
                    success: true,
                    fonte: 'chave',
                    aviso: 'Não foi possível consultar o SEFAZ. Dados extraídos da chave de acesso.',
                    dados: {
                        chave_acesso: chaveNormalizada,
                        numero: dadosChave.numero,
                        serie: dadosChave.serie,
                        data_emissao: `${dadosChave.ano}-${dadosChave.mes}-01`,
                        uf: dadosChave.uf,
                        modelo: dadosChave.modelo,
                        emitente: {
                            cnpj: dadosChave.cnpj,
                            uf: dadosChave.uf
                        },
                        status: 'nao_verificado'
                    }
                });
            }
        } catch (error) {
            logger.error('Erro ao consultar NF-e:', error);
            res.status(500).json({ success: false, error: 'Erro ao consultar NF-e' });
        }
    });
    
    // Consulta simplificada (apenas valida e extrai dados da chave)
    router.post('/nfe/validar-chave', authenticateToken, async (req, res) => {
        try {
            const { chave_acesso } = req.body;
            
            if (!chave_acesso) {
                return res.status(400).json({ success: false, error: 'Chave de acesso não informada' });
            }
            
            const chaveNormalizada = chave_acesso.replace(/\D/g, '');
            
            if (chaveNormalizada.length !== 44) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Chave de acesso inválida. Deve conter 44 dígitos.',
                    digitos_informados: chaveNormalizada.length
                });
            }
            
            if (!validarChaveAcesso(chaveNormalizada)) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Dígito verificador da chave é inválido' 
                });
            }
            
            const dados = extrairDadosChave(chaveNormalizada);
            
            res.json({
                success: true,
                valida: true,
                dados: {
                    chave_acesso: chaveNormalizada,
                    uf: dados.uf,
                    ano_mes: `${dados.ano}/${dados.mes}`,
                    cnpj_emitente: dados.cnpj,
                    modelo: dados.modelo === '55' ? 'NF-e' : (dados.modelo === '65' ? 'NFC-e' : dados.modelo),
                    serie: dados.serie,
                    numero: dados.numero,
                    forma_emissao: dados.formaEmissao,
                    codigo_numerico: dados.codigoNumerico,
                    digito_verificador: dados.digitoVerificador
                }
            });
        } catch (error) {
            logger.error('Erro ao validar chave:', error);
            res.status(500).json({ success: false, error: 'Erro ao validar chave de acesso' });
        }
    });

    // ==================== RELATÓRIOS ====================
    
    // Relatório de compras por período
    router.get('/relatorios/compras-periodo', authenticateToken, async (req, res) => {
        try {
            const { data_inicio, data_fim } = req.query;
            
            const [resultado] = await pool.execute(`
                SELECT 
                    DATE_FORMAT(pc.data_pedido, '%Y-%m') as mes,
                    COUNT(DISTINCT pc.id) as total_pedidos,
                    SUM(pc.valor_total) as valor_total,
                    COUNT(DISTINCT pc.fornecedor_id) as fornecedores_distintos,
                    AVG(pc.valor_total) as ticket_medio,
                    SUM(CASE WHEN pc.status = 'cancelado' THEN 1 ELSE 0 END) as pedidos_cancelados
                FROM pedidos_compra pc
                WHERE pc.data_pedido BETWEEN ? AND ?
                GROUP BY mes
                ORDER BY mes
            `, [data_inicio, data_fim]);
            
            res.json({ success: true, data: resultado });
        } catch (error) {
            logger.error('Erro ao gerar relatório:', error);
            res.status(500).json({ error: 'Erro ao gerar relatório' });
        }
    });
    
    // Relatório de top fornecedores
    router.get('/relatorios/top-fornecedores', authenticateToken, async (req, res) => {
        try {
            const { data_inicio, data_fim, limit = 10 } = req.query;
            
            const [resultado] = await pool.execute(`
                SELECT 
                    f.id, f.razao_social, f.cidade, f.estado,
                    f.avaliacao_geral,
                    COUNT(DISTINCT pc.id) as total_pedidos,
                    SUM(pc.valor_total) as valor_total,
                    AVG(DATEDIFF(pc.data_entrega_real, pc.data_entrega_prevista)) as media_atraso,
                    SUM(CASE WHEN pc.status = 'cancelado' THEN 1 ELSE 0 END) as pedidos_cancelados
                FROM fornecedores f
                JOIN pedidos_compra pc ON f.id = pc.fornecedor_id
                WHERE pc.data_pedido BETWEEN ? AND ?
                GROUP BY f.id
                ORDER BY valor_total DESC
                LIMIT ?
            `, [data_inicio, data_fim, parseInt(limit)]);
            
            res.json({ success: true, data: resultado });
        } catch (error) {
            logger.error('Erro ao gerar relatório:', error);
            res.status(500).json({ error: 'Erro ao gerar relatório' });
        }
    });

    return router;
};
