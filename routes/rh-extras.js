/**
 * Rotas de API para RH - Notificações, Calendário e Gestão de Ponto
 */

require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');

// Middleware de autenticação (fallback)
let defaultAuthMiddleware = null;
try {
    defaultAuthMiddleware = require('../middleware/auth').authenticateToken;
} catch(e) {}

module.exports = function createRHExtrasRoutes(deps) {
    // Aceitar tanto { pool, authenticateToken } (factory) quanto pool direto
    let pool, authenticateToken;
    if (deps && deps.pool) {
        pool = deps.pool;
        authenticateToken = deps.authenticateToken || defaultAuthMiddleware;
    } else {
        // Fallback: criar pool próprio (backward compat)
        pool = mysql.createPool({
            host: process.env.DB_HOST || 'localhost',
            port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'railway',
            charset: 'utf8mb4',
            connectionLimit: 10,
            waitForConnections: true
        });
        authenticateToken = defaultAuthMiddleware || ((req, res, next) => next());
    }

    const router = express.Router();

// ==================== AUTO-CREATE AUDIT TABLE ====================
(async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS ponto_alteracoes (
                id INT AUTO_INCREMENT PRIMARY KEY,
                marcacao_id INT NOT NULL,
                funcionario_id INT DEFAULT NULL,
                usuario_id INT DEFAULT NULL,
                acao ENUM('criacao','edicao','exclusao') NOT NULL DEFAULT 'edicao',
                campo_alterado VARCHAR(50) DEFAULT NULL,
                valor_anterior VARCHAR(255) DEFAULT NULL,
                valor_novo VARCHAR(255) DEFAULT NULL,
                motivo TEXT DEFAULT NULL,
                ip_address VARCHAR(50) DEFAULT NULL,
                criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_marcacao (marcacao_id),
                INDEX idx_funcionario (funcionario_id),
                INDEX idx_data (criado_em)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        console.log('[RH-PONTO] Tabela ponto_alteracoes verificada/criada');
    } catch (e) {
        console.error('[RH-PONTO] Erro ao criar tabela ponto_alteracoes:', e.message);
    }
})();

// ==================== NOTIFICAÇÕES ====================

/**
 * GET /api/rh/notificacoes
 * Buscar notificações do funcionário logado
 */
router.get('/notificacoes', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const { todas, limite = 10 } = req.query;

        let sql = `
            SELECT n.*, f.nome_completo as funcionario_nome
            FROM rh_notificacoes n
            LEFT JOIN funcionarios f ON n.funcionario_id = f.id
            WHERE n.funcionario_id = ? OR n.funcionario_id IS NULL
        `;
        
        if (!todas) {
            sql += ' AND n.lida = FALSE';
        }
        
        sql += ' ORDER BY n.data_criacao DESC LIMIT ?';

        const [notificacoes] = await pool.query(sql, [userId, parseInt(limite)]);

        // Contar não lidas
        const [countResult] = await pool.query(
            'SELECT COUNT(*) as total FROM rh_notificacoes WHERE (funcionario_id = ? OR funcionario_id IS NULL) AND lida = FALSE',
            [userId]
        );

        res.json({
            success: true,
            notificacoes,
            naoLidas: countResult[0].total
        });

    } catch (error) {
        console.error('Erro ao buscar notificações:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * PUT /api/rh/notificacoes/:id/ler
 * Marcar notificação como lida
 */
router.put('/notificacoes/:id/ler', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        
        await pool.query(
            'UPDATE rh_notificacoes SET lida = TRUE, data_leitura = NOW() WHERE id = ?',
            [id]
        );

        res.json({ success: true });

    } catch (error) {
        console.error('Erro ao marcar notificação como lida:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * PUT /api/rh/notificacoes/ler-todas
 * Marcar todas as notificações como lidas
 */
router.put('/notificacoes/ler-todas', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        
        await pool.query(
            'UPDATE rh_notificacoes SET lida = TRUE, data_leitura = NOW() WHERE (funcionario_id = ? OR funcionario_id IS NULL) AND lida = FALSE',
            [userId]
        );

        res.json({ success: true });

    } catch (error) {
        console.error('Erro ao marcar todas notificações como lidas:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/rh/notificacoes
 * Criar nova notificação (admin)
 */
router.post('/notificacoes', authenticateToken, async (req, res) => {
    try {
        const { funcionario_id, tipo, titulo, descricao, link } = req.body;

        const [result] = await pool.query(
            `INSERT INTO rh_notificacoes (funcionario_id, tipo, titulo, descricao, link)
             VALUES (?, ?, ?, ?, ?)`,
            [funcionario_id || null, tipo, titulo, descricao, link]
        );

        res.json({ success: true, id: result.insertId });

    } catch (error) {
        console.error('Erro ao criar notificação:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==================== ANIVERSARIANTES ====================

/**
 * GET /api/rh/funcionarios/aniversariantes
 * Buscar aniversariantes do mês
 */
router.get('/funcionarios/aniversariantes', authenticateToken, async (req, res) => {
    try {
        const { mes } = req.query;
        const mesAtual = mes ? parseInt(mes) : new Date().getMonth() + 1;

        const [aniversariantes] = await pool.query(
            `SELECT id, nome_completo, email, data_nascimento, departamento, cargo, avatar
             FROM funcionarios 
             WHERE MONTH(data_nascimento) = ? AND (ativo = 1 OR status = 'Ativo' OR status = 'ativo')
             ORDER BY DAY(data_nascimento) ASC`,
            [mesAtual]
        );

        res.json({ success: true, aniversariantes });

    } catch (error) {
        console.error('Erro ao buscar aniversariantes:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==================== FERIADOS ====================

/**
 * GET /api/rh/feriados
 * Buscar feriados nacionais (e customizados se houver)
 */
router.get('/feriados', authenticateToken, async (req, res) => {
    try {
        const { ano } = req.query;
        const anoAtual = ano ? parseInt(ano) : new Date().getFullYear();

        // Feriados nacionais fixos do Brasil
        const feriadosNacionais = [
            { data: `${anoAtual}-01-01`, titulo: 'Confraternização Universal', tipo: 'feriado', nacional: true },
            { data: `${anoAtual}-04-21`, titulo: 'Tiradentes', tipo: 'feriado', nacional: true },
            { data: `${anoAtual}-05-01`, titulo: 'Dia do Trabalhador', tipo: 'feriado', nacional: true },
            { data: `${anoAtual}-09-07`, titulo: 'Independência do Brasil', tipo: 'feriado', nacional: true },
            { data: `${anoAtual}-10-12`, titulo: 'Nossa Senhora Aparecida', tipo: 'feriado', nacional: true },
            { data: `${anoAtual}-11-02`, titulo: 'Finados', tipo: 'feriado', nacional: true },
            { data: `${anoAtual}-11-15`, titulo: 'Proclamação da República', tipo: 'feriado', nacional: true },
            { data: `${anoAtual}-12-25`, titulo: 'Natal', tipo: 'feriado', nacional: true }
        ];

        // Feriados móveis (Carnaval, Sexta-feira Santa, Páscoa, Corpus Christi)
        // Cálculo da Páscoa usando algoritmo de computus
        const calcularPascoa = (ano) => {
            const a = ano % 19;
            const b = Math.floor(ano / 100);
            const c = ano % 100;
            const d = Math.floor(b / 4);
            const e = b % 4;
            const f = Math.floor((b + 8) / 25);
            const g = Math.floor((b - f + 1) / 3);
            const h = (19 * a + b - d - g + 15) % 30;
            const i = Math.floor(c / 4);
            const k = c % 4;
            const l = (32 + 2 * e + 2 * i - h - k) % 7;
            const m = Math.floor((a + 11 * h + 22 * l) / 451);
            const mes = Math.floor((h + l - 7 * m + 114) / 31);
            const dia = ((h + l - 7 * m + 114) % 31) + 1;
            return new Date(ano, mes - 1, dia);
        };

        const pascoa = calcularPascoa(anoAtual);
        
        // Carnaval: 47 dias antes da Páscoa
        const carnaval = new Date(pascoa);
        carnaval.setDate(carnaval.getDate() - 47);
        
        // Sexta-feira Santa: 2 dias antes da Páscoa
        const sextaSanta = new Date(pascoa);
        sextaSanta.setDate(sextaSanta.getDate() - 2);
        
        // Corpus Christi: 60 dias depois da Páscoa
        const corpusChristi = new Date(pascoa);
        corpusChristi.setDate(corpusChristi.getDate() + 60);

        const formatarData = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

        const feriadosMoveis = [
            { data: formatarData(carnaval), titulo: 'Carnaval', tipo: 'feriado', nacional: true },
            { data: formatarData(sextaSanta), titulo: 'Sexta-feira Santa', tipo: 'feriado', nacional: true },
            { data: formatarData(pascoa), titulo: 'Páscoa', tipo: 'feriado', nacional: true },
            { data: formatarData(corpusChristi), titulo: 'Corpus Christi', tipo: 'feriado', nacional: true }
        ];

        const feriados = [...feriadosNacionais, ...feriadosMoveis].sort((a, b) => new Date(a.data) - new Date(b.data));

        res.json({ success: true, feriados });

    } catch (error) {
        console.error('Erro ao buscar feriados:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==================== CALENDÁRIO ====================

/**
 * GET /api/rh/calendario
 * Buscar eventos do calendário
 */
router.get('/calendario', authenticateToken, async (req, res) => {
    try {
        const { mes, ano, tipo } = req.query;
        const userId = req.user.id;

        let sql = `
            SELECT c.*, f.nome_completo as funcionario_nome
            FROM rh_calendario c
            LEFT JOIN funcionarios f ON c.funcionario_id = f.id
            WHERE 1=1
        `;
        const params = [];

        if (mes && ano) {
            sql += ' AND (MONTH(c.data_inicio) = ? AND YEAR(c.data_inicio) = ?)';
            params.push(parseInt(mes), parseInt(ano));
        }

        if (tipo && tipo !== 'todos') {
            sql += ' AND c.tipo = ?';
            params.push(tipo);
        }

        sql += ' ORDER BY c.data_inicio ASC, c.hora_inicio ASC';

        const [eventos] = await pool.query(sql, params);

        res.json({ success: true, eventos });

    } catch (error) {
        console.error('Erro ao buscar calendário:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/rh/calendario
 * Criar novo evento no calendário
 */
router.post('/calendario', authenticateToken, async (req, res) => {
    try {
        const { titulo, descricao, data_inicio, data_fim, hora_inicio, hora_fim, tipo, cor, funcionario_id, todos_funcionarios } = req.body;
        const criado_por = req.user.id;

        const [result] = await pool.query(
            `INSERT INTO rh_calendario (titulo, descricao, data_inicio, data_fim, hora_inicio, hora_fim, tipo, cor, funcionario_id, todos_funcionarios, criado_por)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [titulo, descricao, data_inicio, data_fim || null, hora_inicio || null, hora_fim || null, tipo, cor || '#8b5cf6', funcionario_id || null, todos_funcionarios || false, criado_por]
        );

        res.json({ success: true, id: result.insertId });

    } catch (error) {
        console.error('Erro ao criar evento:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * PUT /api/rh/calendario/:id
 * Atualizar evento do calendário
 */
router.put('/calendario/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { titulo, descricao, data_inicio, data_fim, hora_inicio, hora_fim, tipo, cor, funcionario_id, todos_funcionarios } = req.body;

        await pool.query(
            `UPDATE rh_calendario 
             SET titulo = ?, descricao = ?, data_inicio = ?, data_fim = ?, hora_inicio = ?, hora_fim = ?, tipo = ?, cor = ?, funcionario_id = ?, todos_funcionarios = ?
             WHERE id = ?`,
            [titulo, descricao, data_inicio, data_fim || null, hora_inicio || null, hora_fim || null, tipo, cor, funcionario_id || null, todos_funcionarios || false, id]
        );

        res.json({ success: true });

    } catch (error) {
        console.error('Erro ao atualizar evento:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * DELETE /api/rh/calendario/:id
 * Excluir evento do calendário
 */
router.delete('/calendario/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        
        await pool.query('DELETE FROM rh_calendario WHERE id = ?', [id]);

        res.json({ success: true });

    } catch (error) {
        console.error('Erro ao excluir evento:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==================== GESTÍO DE PONTO ====================

/**
 * GET /api/rh/ponto/marcacoes
 * Buscar marcações de ponto
 */
router.get('/ponto/marcacoes', authenticateToken, async (req, res) => {
    try {
        const { funcionario_id, data_inicio, data_fim, status } = req.query;

        let sql = `
            SELECT m.*, f.nome_completo as funcionario_nome, f.cargo, f.departamento
            FROM ponto_marcacoes m
            LEFT JOIN funcionarios f ON m.funcionario_id = f.id
            WHERE 1=1
        `;
        const params = [];

        if (funcionario_id) {
            sql += ' AND m.funcionario_id = ?';
            params.push(funcionario_id);
        }

        if (data_inicio) {
            sql += ' AND m.data >= ?';
            params.push(data_inicio);
        }

        if (data_fim) {
            sql += ' AND m.data <= ?';
            params.push(data_fim);
        }

        sql += ' ORDER BY m.data DESC, m.hora DESC';

        const [marcacoes] = await pool.query(sql, params);

        res.json({ success: true, marcacoes });

    } catch (error) {
        console.error('Erro ao buscar marcações:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * PUT /api/rh/ponto/marcacoes/:id
 * Editar marcação de ponto com audit trail completo
 */
router.put('/ponto/marcacoes/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { hora, tipo, observacao, motivo, data, funcionario_id } = req.body;
        const editado_por = req.user.id;
        const ipAddress = req.ip || req.connection.remoteAddress || null;

        // Buscar marcação atual para comparação
        const [atual] = await pool.query(
            'SELECT * FROM ponto_marcacoes WHERE id = ?', [id]
        );
        if (atual.length === 0) {
            return res.status(404).json({ success: false, message: 'Marcação não encontrada' });
        }
        const old = atual[0];

        // Determinar quais campos mudaram e registrar cada alteração
        const changes = [];
        if (hora !== undefined && hora !== null && String(hora).substring(0,5) !== String(old.hora).substring(0,5)) {
            changes.push({ campo: 'hora', anterior: String(old.hora).substring(0,5), novo: String(hora).substring(0,5) });
        }
        if (tipo !== undefined && tipo !== old.tipo) {
            changes.push({ campo: 'tipo', anterior: old.tipo, novo: tipo });
        }
        if (observacao !== undefined && observacao !== (old.observacao || '')) {
            changes.push({ campo: 'observacao', anterior: old.observacao || '', novo: observacao });
        }
        if (data !== undefined && data !== null) {
            const oldData = old.data ? new Date(old.data).toISOString().split('T')[0] : null;
            if (data !== oldData) {
                changes.push({ campo: 'data', anterior: oldData, novo: data });
            }
        }
        if (funcionario_id !== undefined && funcionario_id !== null && Number(funcionario_id) !== Number(old.funcionario_id)) {
            changes.push({ campo: 'funcionario_id', anterior: String(old.funcionario_id), novo: String(funcionario_id) });
        }

        // Executar UPDATE
        const updateFields = [];
        const updateParams = [];
        if (hora !== undefined) { updateFields.push('hora = ?'); updateParams.push(hora); }
        if (tipo !== undefined) { updateFields.push('tipo = ?'); updateParams.push(tipo); }
        if (observacao !== undefined) { updateFields.push('observacao = ?'); updateParams.push(observacao); }
        if (data !== undefined) { updateFields.push('data = ?'); updateParams.push(data); }
        if (funcionario_id !== undefined) { updateFields.push('funcionario_id = ?'); updateParams.push(funcionario_id); }
        updateFields.push('atualizado_em = NOW()');
        updateParams.push(id);

        await pool.query(
            'UPDATE ponto_marcacoes SET ' + updateFields.join(', ') + ' WHERE id = ?',
            updateParams
        );

        // Registrar cada alteração na tabela de auditoria
        for (const change of changes) {
            try {
                await pool.query(
                    `INSERT INTO ponto_alteracoes (marcacao_id, funcionario_id, usuario_id, acao, campo_alterado, valor_anterior, valor_novo, motivo, ip_address)
                     VALUES (?, ?, ?, 'edicao', ?, ?, ?, ?, ?)`,
                    [id, old.funcionario_id, editado_por, change.campo, change.anterior, change.novo, motivo || null, ipAddress]
                );
            } catch (auditErr) {
                console.error('[PONTO-AUDIT] Erro ao registrar alteração:', auditErr.message);
            }
        }

        // Se nenhum campo individual mudou, registrar edição genérica
        if (changes.length === 0) {
            try {
                await pool.query(
                    `INSERT INTO ponto_alteracoes (marcacao_id, funcionario_id, usuario_id, acao, campo_alterado, motivo, ip_address)
                     VALUES (?, ?, ?, 'edicao', 'geral', ?, ?)`,
                    [id, old.funcionario_id, editado_por, motivo || 'Edição sem alterações detectadas', ipAddress]
                );
            } catch (e) { /* ok */ }
        }

        // Criar notificação de alteração
        if (old.funcionario_id) {
            try {
                const dataFormatada = old.data ? new Date(old.data).toLocaleDateString('pt-BR') : 'N/A';
                const detalhes = changes.map(c => c.campo + ': ' + c.anterior + ' → ' + c.novo).join(', ');
                await pool.query(
                    `INSERT INTO rh_notificacoes (funcionario_id, tipo, titulo, descricao)
                     VALUES (?, 'ponto', 'Marcação de ponto alterada', ?)`,
                    [old.funcionario_id, 'Sua marcação do dia ' + dataFormatada + ' foi alterada. ' + detalhes]
                );
            } catch (e) { /* ok */ }
        }

        console.log('[PONTO-EDIT] Marcação #' + id + ' editada por user #' + editado_por + ': ' + changes.length + ' campos alterados');

        res.json({
            success: true,
            changes: changes,
            message: changes.length > 0
                ? changes.length + ' campo(s) alterado(s) com sucesso'
                : 'Marcação salva (sem alterações detectadas)'
        });

    } catch (error) {
        console.error('Erro ao editar marcação:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/rh/ponto/marcacoes
 * Adicionar marcação manual
 */
router.post('/ponto/marcacoes', authenticateToken, async (req, res) => {
    try {
        const { funcionario_id, pis, data, hora, tipo, observacao } = req.body;

        // Buscar PIS do funcionário se não fornecido
        let pisNumber = pis;
        if (!pisNumber && funcionario_id) {
            const [func] = await pool.query('SELECT pis_pasep FROM funcionarios WHERE id = ?', [funcionario_id]);
            if (func.length > 0) pisNumber = func[0].pis_pasep || '';
        }

        const [result] = await pool.query(
            `INSERT INTO ponto_marcacoes (funcionario_id, pis, data, hora, tipo, origem, observacao, criado_em)
             VALUES (?, ?, ?, ?, ?, 'manual', ?, NOW())`,
            [funcionario_id, pisNumber || '', data, hora, tipo || 'marcacao', observacao]
        );

        res.json({ success: true, id: result.insertId });

    } catch (error) {
        console.error('Erro ao adicionar marcação:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * DELETE /api/rh/ponto/marcacoes/:id
 * Excluir marcação de ponto com audit trail
 */
router.delete('/ponto/marcacoes/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const motivo = req.body ? req.body.motivo : null;
        const excluido_por = req.user.id;
        const ipAddress = req.ip || req.connection.remoteAddress || null;
        
        // Buscar marcação completa antes de excluir
        const [marcacao] = await pool.query('SELECT * FROM ponto_marcacoes WHERE id = ?', [id]);
        if (marcacao.length === 0) {
            return res.status(404).json({ success: false, message: 'Marcação não encontrada' });
        }
        const old = marcacao[0];

        // Registrar exclusão na auditoria
        try {
            const detalhes = 'Data: ' + (old.data ? new Date(old.data).toISOString().split('T')[0] : '?') + ', Hora: ' + (old.hora || '?') + ', Tipo: ' + (old.tipo || '?');
            await pool.query(
                `INSERT INTO ponto_alteracoes (marcacao_id, funcionario_id, usuario_id, acao, campo_alterado, valor_anterior, valor_novo, motivo, ip_address)
                 VALUES (?, ?, ?, 'exclusao', 'registro_completo', ?, NULL, ?, ?)`,
                [id, old.funcionario_id, excluido_por, detalhes, motivo || 'Exclusão manual', ipAddress]
            );
        } catch (auditErr) {
            console.error('[PONTO-AUDIT] Erro ao registrar exclusão:', auditErr.message);
        }

        await pool.query('DELETE FROM ponto_marcacoes WHERE id = ?', [id]);

        // Criar notificação de exclusão
        if (old.funcionario_id) {
            try {
                await pool.query(
                    `INSERT INTO rh_notificacoes (funcionario_id, tipo, titulo, descricao)
                     VALUES (?, 'ponto', 'Marcação de ponto excluída', ?)`,
                    [old.funcionario_id, 'Uma marcação do dia ' + (old.data ? new Date(old.data).toLocaleDateString('pt-BR') : 'N/A') + ' às ' + (old.hora ? String(old.hora).substring(0,5) : '?') + ' foi excluída.']
                );
            } catch (e) { /* ok */ }
        }

        console.log('[PONTO-DELETE] Marcação #' + id + ' excluída por user #' + excluido_por);

        res.json({ success: true, message: 'Marcação excluída com sucesso' });

    } catch (error) {
        console.error('Erro ao excluir marcação:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/rh/ponto/alteracoes
 * Buscar histórico de alterações (audit trail)
 */
router.get('/ponto/alteracoes', authenticateToken, async (req, res) => {
    try {
        const { marcacao_id, funcionario_id, data_inicio, data_fim, limite } = req.query;
        const lim = parseInt(limite) || 100;

        let sql = `
            SELECT a.*, 
                   u.nome as usuario_nome, u.email as usuario_email,
                   f.nome_completo as funcionario_nome
            FROM ponto_alteracoes a
            LEFT JOIN usuarios u ON a.usuario_id = u.id
            LEFT JOIN funcionarios f ON a.funcionario_id = f.id
            WHERE 1=1
        `;
        const params = [];

        if (marcacao_id) {
            sql += ' AND a.marcacao_id = ?';
            params.push(marcacao_id);
        }
        if (funcionario_id) {
            sql += ' AND a.funcionario_id = ?';
            params.push(funcionario_id);
        }
        if (data_inicio) {
            sql += ' AND a.criado_em >= ?';
            params.push(data_inicio + ' 00:00:00');
        }
        if (data_fim) {
            sql += ' AND a.criado_em <= ?';
            params.push(data_fim + ' 23:59:59');
        }

        sql += ' ORDER BY a.criado_em DESC LIMIT ?';
        params.push(lim);

        const [alteracoes] = await pool.query(sql, params);

        res.json({ success: true, alteracoes });

    } catch (error) {
        console.error('Erro ao buscar alterações:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/rh/ponto/resumo
 * Resumo mensal de ponto de um funcionário
 */
router.get('/ponto/resumo', authenticateToken, async (req, res) => {
    try {
        const { funcionario_id, mes, ano } = req.query;
        if (!funcionario_id) return res.status(400).json({ success: false, message: 'funcionario_id obrigatório' });

        const mesNum = parseInt(mes) || (new Date().getMonth() + 1);
        const anoNum = parseInt(ano) || new Date().getFullYear();

        const [marcacoes] = await pool.query(
            `SELECT data, hora, tipo FROM ponto_marcacoes 
             WHERE funcionario_id = ? AND MONTH(data) = ? AND YEAR(data) = ?
             ORDER BY data ASC, hora ASC`,
            [funcionario_id, mesNum, anoNum]
        );

        // Calcular resumo
        const diasSet = new Set();
        let entradas = 0, saidas = 0;
        marcacoes.forEach(m => {
            const dataStr = m.data ? new Date(m.data).toISOString().split('T')[0] : null;
            if (dataStr) diasSet.add(dataStr);
            if (m.tipo === 'entrada' || m.tipo === 'retorno_almoco') entradas++;
            if (m.tipo === 'saida' || m.tipo === 'saida_almoco') saidas++;
        });

        // Buscar alterações do mês
        const [alteracoes] = await pool.query(
            `SELECT COUNT(*) as total FROM ponto_alteracoes 
             WHERE funcionario_id = ? AND MONTH(criado_em) = ? AND YEAR(criado_em) = ?`,
            [funcionario_id, mesNum, anoNum]
        );

        res.json({
            success: true,
            resumo: {
                dias_trabalhados: diasSet.size,
                total_marcacoes: marcacoes.length,
                entradas: entradas,
                saidas: saidas,
                alteracoes_no_mes: alteracoes[0].total
            },
            penalidades: []
        });

    } catch (error) {
        console.error('Erro ao buscar resumo:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==================== PENALIDADES ====================

/**
 * GET /api/rh/penalidades
 * Buscar penalidades
 */
router.get('/penalidades', authenticateToken, async (req, res) => {
    try {
        const { funcionario_id } = req.query;

        let sql = `
            SELECT p.*, f.nome_completo as funcionario_nome, u.nome as aplicado_por_nome
            FROM rh_penalidades p
            LEFT JOIN funcionarios f ON p.funcionario_id = f.id
            LEFT JOIN usuarios u ON p.aplicado_por = u.id
            WHERE 1=1
        `;
        const params = [];

        if (funcionario_id) {
            sql += ' AND p.funcionario_id = ?';
            params.push(funcionario_id);
        }

        sql += ' ORDER BY p.data_penalidade DESC';

        const [penalidades] = await pool.query(sql, params);

        res.json({ success: true, penalidades });

    } catch (error) {
        console.error('Erro ao buscar penalidades:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/rh/penalidades
 * Criar penalidade
 */
router.post('/penalidades', authenticateToken, async (req, res) => {
    try {
        const { funcionario_id, marcacao_id, tipo, motivo, data_penalidade, valor_desconto, dias_suspensao } = req.body;
        const aplicado_por = req.user.id;

        const [result] = await pool.query(
            `INSERT INTO rh_penalidades (funcionario_id, marcacao_id, tipo, motivo, data_penalidade, valor_desconto, dias_suspensao, aplicado_por)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [funcionario_id, marcacao_id || null, tipo, motivo, data_penalidade, valor_desconto || null, dias_suspensao || null, aplicado_por]
        );

        // Criar notificação para o funcionário
        const tipoTexto = { advertencia: 'Advertência', suspensao: 'Suspensão', desconto: 'Desconto', observacao: 'Observação' };
        await pool.query(
            `INSERT INTO rh_notificacoes (funcionario_id, tipo, titulo, descricao)
             VALUES (?, 'ponto', ?, ?)`,
            [funcionario_id, `${tipoTexto[tipo]} registrada`, motivo]
        );

        res.json({ success: true, id: result.insertId });

    } catch (error) {
        console.error('Erro ao criar penalidade:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * DELETE /api/rh/penalidades/:id
 * Excluir penalidade
 */
router.delete('/penalidades/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        
        await pool.query('DELETE FROM rh_penalidades WHERE id = ?', [id]);

        res.json({ success: true });

    } catch (error) {
        console.error('Erro ao excluir penalidade:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/rh/ponto/resumo
 * Resumo do ponto por funcionário
 */
router.get('/ponto/resumo', authenticateToken, async (req, res) => {
    try {
        const { funcionario_id, mes, ano } = req.query;

        const [resumo] = await pool.query(`
            SELECT 
                COUNT(DISTINCT data) as dias_trabalhados,
                COUNT(*) as total_marcacoes,
                SUM(CASE WHEN tipo = 'entrada' THEN 1 ELSE 0 END) as entradas,
                SUM(CASE WHEN tipo = 'saida' THEN 1 ELSE 0 END) as saidas
            FROM ponto_marcacoes
            WHERE funcionario_id = ?
            AND MONTH(data) = ? AND YEAR(data) = ?
        `, [funcionario_id, mes || new Date().getMonth() + 1, ano || new Date().getFullYear()]);

        // Buscar penalidades do mês
        const [penalidades] = await pool.query(`
            SELECT COUNT(*) as total, tipo
            FROM rh_penalidades
            WHERE funcionario_id = ?
            AND MONTH(data_penalidade) = ? AND YEAR(data_penalidade) = ?
            GROUP BY tipo
        `, [funcionario_id, mes || new Date().getMonth() + 1, ano || new Date().getFullYear()]);

        res.json({ 
            success: true, 
            resumo: resumo[0],
            penalidades
        });

    } catch (error) {
        console.error('Erro ao buscar resumo:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==================== ESPELHO DE PONTO (Self-service) ====================

/**
 * GET /api/rh/espelho-ponto
 * Retorna o espelho de ponto do funcionário logado (ou de um funcionário específico se admin)
 * Agrupa as marcações por dia, monta a "folha espelho" com entrada/saída/almoço
 */
router.get('/espelho-ponto', authenticateToken, async (req, res) => {
    try {
        const { data_inicio, data_fim, funcionario_id: reqFuncId } = req.query;

        // Determinar funcionario_id: buscar pelo email do usuário logado
        let funcionarioId = null;
        
        // Se admin e pediu funcionário específico, usar esse
        if (reqFuncId && (req.user.role === 'admin' || req.user.is_admin === 1)) {
            funcionarioId = parseInt(reqFuncId);
        }
        
        // Caso contrário, buscar o funcionário vinculado ao usuário logado
        if (!funcionarioId) {
            const [funcRows] = await pool.query(
                'SELECT id FROM funcionarios WHERE email = ? LIMIT 1',
                [req.user.email]
            );
            if (funcRows.length > 0) {
                funcionarioId = funcRows[0].id;
            } else {
                // Tentar pelo user id direto
                funcionarioId = req.user.id;
            }
        }

        if (!funcionarioId) {
            return res.status(400).json({ success: false, message: 'Funcionário não encontrado para este usuário' });
        }

        // Definir período padrão: mês atual
        const hoje = new Date();
        const inicioDefault = new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().split('T')[0];
        const fimDefault = hoje.toISOString().split('T')[0];
        
        const inicio = data_inicio || inicioDefault;
        const fim = data_fim || fimDefault;

        // Buscar todas as marcações do período
        const [marcacoes] = await pool.query(
            `SELECT data, hora, tipo 
             FROM ponto_marcacoes 
             WHERE funcionario_id = ? AND data >= ? AND data <= ?
             ORDER BY data ASC, hora ASC`,
            [funcionarioId, inicio, fim]
        );

        // Buscar jornada do funcionário
        const [funcInfo] = await pool.query(
            'SELECT nome_completo, jornada_trabalho, cargo, departamento FROM funcionarios WHERE id = ?',
            [funcionarioId]
        );
        const jornada = funcInfo.length > 0 ? funcInfo[0].jornada_trabalho : '44h';
        const nomeFunc = funcInfo.length > 0 ? funcInfo[0].nome_completo : '';
        
        // Horário padrão de entrada (08:00 para jornada 44h)
        const horarioEntradaPadrao = '08:00';
        const toleranciaMinutos = 10; // 10 min de tolerância

        // Agrupar marcações por dia
        const porDia = {};
        marcacoes.forEach(m => {
            const dataStr = m.data ? new Date(m.data).toISOString().split('T')[0] : null;
            if (!dataStr) return;
            if (!porDia[dataStr]) porDia[dataStr] = [];
            porDia[dataStr].push({
                hora: m.hora ? String(m.hora).substring(0, 5) : null,
                tipo: m.tipo
            });
        });

        // Gerar todos os dias do período (inclusive fins de semana e feriados)
        const diasDoMes = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
        const registros = [];
        let diasTrabalhados = 0;
        let totalMinutos = 0;
        let atrasos = 0;
        let faltas = 0;

        const dtInicio = new Date(inicio + 'T00:00:00');
        const dtFim = new Date(fim + 'T00:00:00');

        for (let d = new Date(dtFim); d >= dtInicio; d.setDate(d.getDate() - 1)) {
            const dataStr = d.toISOString().split('T')[0];
            const diaSemana = d.getDay(); // 0=Dom, 6=Sáb
            const diaNome = diasDoMes[diaSemana];
            const dataFormatada = dataStr.split('-').reverse().join('/');

            const marcsDia = porDia[dataStr] || [];

            // Fins de semana sem marcações = Folga
            if (marcsDia.length === 0) {
                if (diaSemana === 0 || diaSemana === 6) {
                    registros.push({
                        data: dataFormatada,
                        dia: diaNome,
                        entrada: '-',
                        saidaAlmoco: '-',
                        retornoAlmoco: '-',
                        saida: '-',
                        horas: '-',
                        status: 'folga'
                    });
                } else {
                    // Dia útil sem marcação = Falta (só conta se já passou)
                    if (d <= hoje) {
                        faltas++;
                        registros.push({
                            data: dataFormatada,
                            dia: diaNome,
                            entrada: '-',
                            saidaAlmoco: '-',
                            retornoAlmoco: '-',
                            saida: '-',
                            horas: '-',
                            status: 'falta'
                        });
                    }
                }
                continue;
            }

            // Há marcações neste dia - determinar entrada/saída/almoço
            // Se os tipos são explícitos (entrada, saida_almoco, etc.) usar diretamente
            // Se tipo = 'marcacao' (genérico), inferir pela posição (1ª=entrada, 2ª=saída_almoço, etc.)
            let entrada = null, saidaAlmoco = null, retornoAlmoco = null, saida = null;
            
            const explicitos = marcsDia.filter(m => m.tipo !== 'marcacao');
            const genericos = marcsDia.filter(m => m.tipo === 'marcacao');
            
            // Preencher com explícitos primeiro
            explicitos.forEach(m => {
                if (m.tipo === 'entrada' && !entrada) entrada = m.hora;
                else if (m.tipo === 'saida_almoco' && !saidaAlmoco) saidaAlmoco = m.hora;
                else if (m.tipo === 'retorno_almoco' && !retornoAlmoco) retornoAlmoco = m.hora;
                else if (m.tipo === 'saida' && !saida) saida = m.hora;
            });

            // Preencher slots vazios com genéricos (pela ordem cronológica)
            const slots = [
                { key: 'entrada', val: entrada },
                { key: 'saidaAlmoco', val: saidaAlmoco },
                { key: 'retornoAlmoco', val: retornoAlmoco },
                { key: 'saida', val: saida }
            ];
            
            let genIdx = 0;
            for (let s = 0; s < slots.length && genIdx < genericos.length; s++) {
                if (!slots[s].val) {
                    slots[s].val = genericos[genIdx].hora;
                    genIdx++;
                }
            }

            entrada = slots[0].val;
            saidaAlmoco = slots[1].val;
            retornoAlmoco = slots[2].val;
            saida = slots[3].val;

            // Calcular horas trabalhadas
            let horasStr = '-';
            let minutostrab = 0;
            
            if (entrada && saida) {
                const [eh, em] = entrada.split(':').map(Number);
                const [sh, sm] = saida.split(':').map(Number);
                let totalMin = (sh * 60 + sm) - (eh * 60 + em);
                
                // Descontar almoço (se houver saída e retorno de almoço)
                if (saidaAlmoco && retornoAlmoco) {
                    const [sah, sam] = saidaAlmoco.split(':').map(Number);
                    const [rah, ram] = retornoAlmoco.split(':').map(Number);
                    const almocoMin = (rah * 60 + ram) - (sah * 60 + sam);
                    totalMin -= almocoMin;
                }
                
                if (totalMin > 0) {
                    minutostrab = totalMin;
                    const hh = Math.floor(totalMin / 60);
                    const mm = totalMin % 60;
                    horasStr = mm > 0 ? `${hh}h${String(mm).padStart(2, '0')}` : `${hh}h`;
                }
            }

            // Determinar status
            let status = 'normal';
            if (entrada) {
                const [eh, em] = entrada.split(':').map(Number);
                const [ph, pm] = horarioEntradaPadrao.split(':').map(Number);
                const diffMin = (eh * 60 + em) - (ph * 60 + pm);
                if (diffMin > toleranciaMinutos) {
                    status = 'atraso';
                    atrasos++;
                }
            }

            if (entrada || saida) {
                diasTrabalhados++;
                totalMinutos += minutostrab;
            }

            registros.push({
                data: dataFormatada,
                dia: diaNome,
                entrada: entrada || '-',
                saidaAlmoco: saidaAlmoco || '-',
                retornoAlmoco: retornoAlmoco || '-',
                saida: saida || '-',
                horas: horasStr,
                status
            });
        }

        // Calcular total de horas
        const totalHoras = Math.floor(totalMinutos / 60);
        const totalMins = totalMinutos % 60;
        const horasTotais = totalMins > 0 ? `${totalHoras}h${String(totalMins).padStart(2, '0')}` : `${totalHoras}h`;

        res.json({
            success: true,
            funcionario: nomeFunc,
            periodo: { inicio, fim },
            resumo: {
                dias_trabalhados: diasTrabalhados,
                horas_trabalhadas: horasTotais,
                total_minutos: totalMinutos,
                atrasos,
                faltas
            },
            registros
        });

    } catch (error) {
        console.error('[ESPELHO-PONTO] Erro:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

    return router;
};
