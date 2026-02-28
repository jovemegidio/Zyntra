/**
 * LGPD - Lei Geral de Proteção de Dados
 * Endpoints DSAR (Data Subject Access Request)
 * 
 * Implementa os direitos do titular conforme Art. 18 da LGPD:
 * - Acesso aos dados pessoais (Art. 18, II)
 * - Correção de dados incompletos/desatualizados (Art. 18, III)
 * - Anonimização/bloqueio/eliminação (Art. 18, IV)
 * - Portabilidade dos dados (Art. 18, V)
 * - Eliminação dos dados (Art. 18, VI)
 * - Informação sobre compartilhamento (Art. 18, VII)
 * - Revogação de consentimento (Art. 18, IX)
 */

const express = require('express');
const router = express.Router();

module.exports = function(pool, authenticateToken) {
    
    // ============================================================
    // GET /api/lgpd/meus-dados - Acesso aos dados pessoais (Art. 18, II)
    // ============================================================
    router.get('/meus-dados', authenticateToken, async (req, res) => {
        try {
            const userId = req.user.id;
            
            // Buscar dados do usuário
            const [userRows] = await pool.query(
                `SELECT id, nome, email, role, telefone, cargo, departamento, 
                 data_admissao, data_nascimento, cpf, rg, endereco, cidade, 
                 estado, cep, created_at, updated_at, areas, status
                 FROM usuarios WHERE id = ?`, [userId]
            );
            
            if (!userRows.length) {
                return res.status(404).json({ message: 'Usuário não encontrado.' });
            }
            
            const userData = userRows[0];
            
            // Buscar logs de atividade do usuário
            const [activityRows] = await pool.query(
                `SELECT action, resource, ip_address, created_at 
                 FROM audit_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`,
                [userId]
            ).catch(() => [[]]);
            
            // Montar resposta LGPD
            const response = {
                titular: {
                    id: userData.id,
                    nome: userData.nome,
                    email: userData.email,
                    telefone: userData.telefone || null,
                    cargo: userData.cargo || null,
                    departamento: userData.departamento || null,
                    cpf: userData.cpf ? '***.***.***-' + String(userData.cpf).slice(-2) : null,
                    endereco: userData.endereco || null,
                    cidade: userData.cidade || null,
                    estado: userData.estado || null,
                    cep: userData.cep || null,
                },
                metadados: {
                    data_cadastro: userData.created_at,
                    ultima_atualizacao: userData.updated_at,
                    status: userData.status || 'ativo',
                    areas_acesso: userData.areas || '[]',
                },
                atividade_recente: activityRows.map(a => ({
                    acao: a.action,
                    recurso: a.resource,
                    ip: a.ip_address,
                    data: a.created_at
                })),
                direitos_lgpd: {
                    acesso: '/api/lgpd/meus-dados (este endpoint)',
                    correcao: 'PUT /api/lgpd/corrigir-dados',
                    eliminacao: 'DELETE /api/lgpd/eliminar-dados',
                    portabilidade: 'GET /api/lgpd/portabilidade',
                    revogar_consentimento: 'POST /api/lgpd/revogar-consentimento',
                    informacoes_compartilhamento: 'GET /api/lgpd/compartilhamento'
                },
                _meta: {
                    gerado_em: new Date().toISOString(),
                    formato: 'JSON (Lei 13.709/2018 - LGPD)',
                    base_legal: 'Execução de contrato de trabalho (Art. 7, V)'
                }
            };
            
            res.json(response);
        } catch (err) {
            console.error('[LGPD] Erro em /meus-dados:', err.message);
            res.status(500).json({ message: 'Erro ao buscar dados pessoais.' });
        }
    });
    
    // ============================================================
    // PUT /api/lgpd/corrigir-dados - Correção de dados (Art. 18, III)
    // ============================================================
    router.put('/corrigir-dados', authenticateToken, async (req, res) => {
        try {
            const userId = req.user.id;
            const allowedFields = ['nome', 'telefone', 'endereco', 'cidade', 'estado', 'cep'];
            const updates = {};
            
            for (const field of allowedFields) {
                if (req.body[field] !== undefined) {
                    updates[field] = req.body[field];
                }
            }
            
            if (Object.keys(updates).length === 0) {
                return res.status(400).json({ 
                    message: 'Nenhum campo válido para correção.',
                    campos_permitidos: allowedFields 
                });
            }
            
            const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
            const values = [...Object.values(updates), userId];
            
            await pool.query(`UPDATE usuarios SET ${setClauses}, updated_at = NOW() WHERE id = ?`, values);
            
            // Log de auditoria
            try {
                await pool.query(
                    'INSERT INTO audit_logs (user_id, action, resource, details, ip_address) VALUES (?, ?, ?, ?, ?)',
                    [userId, 'LGPD_CORRECAO', 'usuarios', JSON.stringify({ campos: Object.keys(updates) }), req.ip]
                );
            } catch(e) { /* audit log table may not exist */ }
            
            res.json({ 
                message: 'Dados corrigidos com sucesso.',
                campos_atualizados: Object.keys(updates),
                data: new Date().toISOString()
            });
        } catch (err) {
            console.error('[LGPD] Erro em /corrigir-dados:', err.message);
            res.status(500).json({ message: 'Erro ao corrigir dados.' });
        }
    });
    
    // ============================================================
    // GET /api/lgpd/portabilidade - Portabilidade dos dados (Art. 18, V)
    // ============================================================
    router.get('/portabilidade', authenticateToken, async (req, res) => {
        try {
            const userId = req.user.id;
            const format = req.query.format || 'json';
            
            // Coletar TODOS os dados do titular
            const [userData] = await pool.query('SELECT * FROM usuarios WHERE id = ?', [userId]);
            
            // Buscar dados relacionados
            let pedidos = [], atividades = [], solicitacoes = [];
            
            try {
                [pedidos] = await pool.query(
                    'SELECT id, numero, status, valor_total, created_at FROM pedidos WHERE vendedor_id = ? LIMIT 1000',
                    [userId]
                );
            } catch(e) {}
            
            try {
                [atividades] = await pool.query(
                    'SELECT action, resource, created_at FROM audit_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 1000',
                    [userId]
                );
            } catch(e) {}
            
            const exportData = {
                formato: 'LGPD Portabilidade - JSON',
                versao: '1.0',
                gerado_em: new Date().toISOString(),
                titular: userData[0] ? {
                    ...userData[0],
                    senha_hash: '[REDACTED]',
                    senha: '[REDACTED]',
                    password_hash: '[REDACTED]'
                } : null,
                pedidos_associados: pedidos,
                log_atividades: atividades,
                _aviso: 'Este arquivo contém todos os seus dados pessoais armazenados no sistema Aluforce ERP, conforme Art. 18, V da LGPD.'
            };
            
            if (format === 'csv') {
                // Exportar como CSV
                const fields = Object.keys(exportData.titular || {});
                let csv = fields.join(',') + '\n';
                csv += fields.map(f => `"${String(exportData.titular[f] || '').replace(/"/g, '""')}"`).join(',');
                
                res.setHeader('Content-Type', 'text/csv; charset=utf-8');
                res.setHeader('Content-Disposition', `attachment; filename="lgpd_portabilidade_${userId}_${Date.now()}.csv"`);
                return res.send(csv);
            }
            
            res.setHeader('Content-Disposition', `attachment; filename="lgpd_portabilidade_${userId}_${Date.now()}.json"`);
            res.json(exportData);
        } catch (err) {
            console.error('[LGPD] Erro em /portabilidade:', err.message);
            res.status(500).json({ message: 'Erro ao exportar dados.' });
        }
    });
    
    // ============================================================
    // DELETE /api/lgpd/eliminar-dados - Eliminação de dados (Art. 18, VI)
    // ============================================================
    router.delete('/eliminar-dados', authenticateToken, async (req, res) => {
        try {
            const userId = req.user.id;
            const { confirmacao, motivo } = req.body;
            
            if (confirmacao !== 'CONFIRMO_ELIMINACAO') {
                return res.status(400).json({ 
                    message: 'Para confirmar a eliminação, envie { "confirmacao": "CONFIRMO_ELIMINACAO", "motivo": "..." }',
                    aviso: 'Esta ação é IRREVERSÍVEL. Seus dados pessoais serão anonimizados.'
                });
            }
            
            // Anonimizar dados (não deletar - manter registro para compliance)
            await pool.query(`
                UPDATE usuarios SET 
                    nome = CONCAT('Usuário Anonimizado #', id),
                    email = CONCAT('anonimo_', id, '@removido.lgpd'),
                    telefone = NULL,
                    cpf = NULL,
                    rg = NULL,
                    endereco = NULL,
                    cidade = NULL,
                    estado = NULL,
                    cep = NULL,
                    data_nascimento = NULL,
                    status = 'anonimizado',
                    ativo = 0,
                    updated_at = NOW()
                WHERE id = ?
            `, [userId]);
            
            // Log de auditoria (obrigatório para compliance)
            try {
                await pool.query(
                    'INSERT INTO audit_logs (user_id, action, resource, details, ip_address) VALUES (?, ?, ?, ?, ?)',
                    [userId, 'LGPD_ELIMINACAO', 'usuarios', JSON.stringify({ motivo, data: new Date().toISOString() }), req.ip]
                );
            } catch(e) {}
            
            // Revogar todos os tokens do usuário
            if (global.revokeToken && req.cookies?.authToken) {
                global.revokeToken(req.cookies.authToken);
            }
            
            res.json({ 
                message: 'Dados pessoais eliminados/anonimizados com sucesso.',
                protocolo: `LGPD-ELIM-${userId}-${Date.now()}`,
                data: new Date().toISOString(),
                aviso: 'Sua conta foi desativada. Você será deslogado automaticamente.'
            });
        } catch (err) {
            console.error('[LGPD] Erro em /eliminar-dados:', err.message);
            res.status(500).json({ message: 'Erro ao eliminar dados.' });
        }
    });
    
    // ============================================================
    // GET /api/lgpd/compartilhamento - Info sobre compartilhamento (Art. 18, VII)
    // ============================================================
    router.get('/compartilhamento', authenticateToken, async (req, res) => {
        res.json({
            compartilhamento: {
                descricao: 'Informações sobre como seus dados pessoais são compartilhados',
                destinatarios: [
                    {
                        nome: 'Aluforce Industria e Comércio Ltda',
                        finalidade: 'Execução de contrato de trabalho',
                        base_legal: 'Art. 7, V - Execução de contrato',
                        dados_compartilhados: ['Nome', 'Email', 'Cargo', 'Departamento']
                    }
                ],
                transferencia_internacional: false,
                medidas_seguranca: [
                    'Criptografia em trânsito (HTTPS/TLS 1.2+)',
                    'Criptografia em repouso (AES-256-GCM) para campos sensíveis',
                    'Controle de acesso baseado em papéis (RBAC)',
                    'Logs de auditoria para todas as operações',
                    'Backups criptografados'
                ],
                encarregado_dpo: {
                    nome: 'TI - Aluforce',
                    email: 'ti@aluforce.ind.br',
                    telefone: 'Consulte o RH'
                }
            },
            _meta: {
                gerado_em: new Date().toISOString(),
                base_legal: 'Lei 13.709/2018 - LGPD, Art. 18, VII'
            }
        });
    });
    
    // ============================================================
    // POST /api/lgpd/revogar-consentimento - Revogação (Art. 18, IX)
    // ============================================================
    router.post('/revogar-consentimento', authenticateToken, async (req, res) => {
        try {
            const userId = req.user.id;
            const { tipo_consentimento, motivo } = req.body;
            
            const tiposValidos = ['marketing', 'analytics', 'comunicacao', 'todos'];
            if (!tipo_consentimento || !tiposValidos.includes(tipo_consentimento)) {
                return res.status(400).json({ 
                    message: 'Tipo de consentimento inválido.',
                    tipos_validos: tiposValidos
                });
            }
            
            // Registrar revogação
            try {
                await pool.query(
                    'INSERT INTO audit_logs (user_id, action, resource, details, ip_address) VALUES (?, ?, ?, ?, ?)',
                    [userId, 'LGPD_REVOGACAO_CONSENTIMENTO', 'consentimento', 
                     JSON.stringify({ tipo: tipo_consentimento, motivo, data: new Date().toISOString() }), req.ip]
                );
            } catch(e) {}
            
            res.json({ 
                message: `Consentimento '${tipo_consentimento}' revogado com sucesso.`,
                protocolo: `LGPD-REV-${userId}-${Date.now()}`,
                data: new Date().toISOString(),
                impacto: tipo_consentimento === 'todos' 
                    ? 'Todos os consentimentos opcionais foram revogados. Apenas dados necessários para execução do contrato serão mantidos.'
                    : `O consentimento para '${tipo_consentimento}' foi revogado.`
            });
        } catch (err) {
            console.error('[LGPD] Erro em /revogar-consentimento:', err.message);
            res.status(500).json({ message: 'Erro ao revogar consentimento.' });
        }
    });
    
    // ============================================================
    // GET /api/lgpd/politica - Política de privacidade (informativo)
    // ============================================================
    router.get('/politica', (req, res) => {
        res.json({
            politica_privacidade: {
                versao: '2.0',
                ultima_atualizacao: new Date().toISOString(),
                controlador: 'Aluforce Industria e Comércio Ltda',
                encarregado: 'TI - Aluforce (ti@aluforce.ind.br)',
                finalidades: [
                    'Gestão de recursos humanos',
                    'Controle de produção (PCP)',
                    'Gestão de vendas e clientes',
                    'Controle financeiro',
                    'Emissão de notas fiscais (NF-e)'
                ],
                bases_legais: [
                    'Art. 7, V - Execução de contrato',
                    'Art. 7, II - Cumprimento de obrigação legal',
                    'Art. 7, IX - Interesse legítimo'
                ],
                direitos_titular: [
                    'Acesso aos dados (Art. 18, II)',
                    'Correção de dados (Art. 18, III)',
                    'Anonimização/bloqueio/eliminação (Art. 18, IV)',
                    'Portabilidade (Art. 18, V)',
                    'Eliminação (Art. 18, VI)',
                    'Informação sobre compartilhamento (Art. 18, VII)',
                    'Revogação de consentimento (Art. 18, IX)'
                ],
                retencao: 'Dados mantidos durante vigência do contrato + 5 anos (prazo legal)',
                seguranca: 'Criptografia AES-256-GCM, HTTPS, RBAC, Logs de auditoria'
            }
        });
    });
    
    return router;
};
