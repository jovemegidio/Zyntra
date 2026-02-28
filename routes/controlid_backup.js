/**
 * Rotas de integração com Control iD (Ponto Fácil)
 * Autenticação session-based (/login.fcgi) + fallback Basic Auth
 * Config server-side + histórico de importações
 */

require('dotenv').config();
const express = require('express');
const router = express.Router();
const axios = require('axios');
const mysql = require('mysql2/promise');

// Middleware de autenticação
const { authenticateToken } = require('../middleware/auth');

// Pool de conexão com o banco
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'railway',
    charset: 'utf8mb4',
    connectionLimit: 10,
    waitForConnections: true
});

// ==================== AUTO-CREATE TABLES ====================
(async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS controlid_config (
                id INT AUTO_INCREMENT PRIMARY KEY,
                ip VARCHAR(50) NOT NULL,
                porta INT DEFAULT 80,
                usuario VARCHAR(100) DEFAULT 'admin',
                senha_hash VARCHAR(255) DEFAULT NULL,
                modelo VARCHAR(100) DEFAULT NULL,
                serial_number VARCHAR(100) DEFAULT NULL,
                firmware VARCHAR(100) DEFAULT NULL,
                ultima_conexao DATETIME DEFAULT NULL,
                ativo BOOLEAN DEFAULT TRUE,
                criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
                atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        console.log('[Control iD] Tabela controlid_config verificada/criada');
    } catch (e) {
        console.error('[Control iD] Erro ao criar tabela controlid_config:', e.message);
    }
})();

// ==================== HELPER: Autenticação Control iD ====================
/**
 * Tenta autenticação session-based primeiro (/login.fcgi),
 * se falhar tenta Basic Auth como fallback
 */
async function getControlIdSession(baseUrl, user, password) {
    // Método 1: Session-based (Control iD moderno / Ponto Fácil)
    try {
        const loginResponse = await axios.post(`${baseUrl}/login.fcgi`, {
            login: user,
            password: password
        }, {
            timeout: 10000,
            headers: { 'Content-Type': 'application/json' }
        });

        if (loginResponse.data && loginResponse.data.session) {
            console.log('[Control iD] Autenticação session-based OK');
            return {
                method: 'session',
                session: loginResponse.data.session,
                getHeaders: () => ({
                    'Content-Type': 'application/json',
                    'Cookie': `session=${loginResponse.data.session}`
                }),
                getUrl: (endpoint) => `${baseUrl}/${endpoint}?session=${loginResponse.data.session}`
            };
        }
    } catch (e) {
        console.log('[Control iD] Session auth falhou, tentando Basic Auth...', e.message);
    }

    // Método 2: Basic Auth (modelos mais antigos)
    const auth = Buffer.from(`${user}:${password}`).toString('base64');
    return {
        method: 'basic',
        session: null,
        getHeaders: () => ({
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/json'
        }),
        getUrl: (endpoint) => `${baseUrl}/${endpoint}`
    };
}

// ==================== CONFIG ENDPOINTS ====================

/**
 * GET /api/rh/controlid/config
 * Buscar configuração salva do Control iD
 */
router.get('/config', authenticateToken, async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT id, ip, porta, usuario, modelo, serial_number, firmware, ultima_conexao, ativo FROM controlid_config WHERE ativo = TRUE ORDER BY id DESC LIMIT 1'
        );

        if (rows.length > 0) {
            res.json({ success: true, config: rows[0] });
        } else {
            res.json({ success: true, config: null });
        }
    } catch (error) {
        console.error('[Control iD] Erro ao buscar config:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/rh/controlid/config
 * Salvar configuração do Control iD
 */
router.post('/config', authenticateToken, async (req, res) => {
    try {
        const { ip, porta = 80, usuario = 'admin', senha } = req.body;

        if (!ip) {
            return res.status(400).json({ success: false, message: 'IP é obrigatório' });
        }

        // Verificar se já existe config ativa
        const [existing] = await pool.query('SELECT id FROM controlid_config WHERE ativo = TRUE LIMIT 1');

        if (existing.length > 0) {
            // Atualizar existente
            await pool.query(
                `UPDATE controlid_config SET ip = ?, porta = ?, usuario = ?, senha_hash = ?, atualizado_em = NOW() WHERE id = ?`,
                [ip, porta, usuario, senha ? Buffer.from(senha).toString('base64') : null, existing[0].id]
            );
        } else {
            // Criar nova
            await pool.query(
                `INSERT INTO controlid_config (ip, porta, usuario, senha_hash) VALUES (?, ?, ?, ?)`,
                [ip, porta, usuario, senha ? Buffer.from(senha).toString('base64') : null]
            );
        }

        res.json({ success: true, message: 'Configuração salva com sucesso' });
    } catch (error) {
        console.error('[Control iD] Erro ao salvar config:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==================== TEST CONNECTION ====================

/**
 * POST /api/rh/controlid/test-connection
 * Testar conexão com equipamento Control iD
 */
router.post('/test-connection', authenticateToken, async (req, res) => {
    try {
        const { ip, port = 80, user = 'admin', password = 'admin' } = req.body;

        if (!ip) {
            return res.status(400).json({ success: false, message: 'IP do equipamento é obrigatório' });
        }

        const baseUrl = `http://${ip}:${port}`;
        
        // Autenticação inteligente: session-based → fallback Basic Auth
        const authSession = await getControlIdSession(baseUrl, user, password);
        
        // Buscar informações do dispositivo
        const response = await axios.get(
            authSession.getUrl('system_information.fcgi'),
            { headers: authSession.getHeaders(), timeout: 10000 }
        );

        if (response.data) {
            let usersCount = 0;
            let recordsCount = 0;

            try {
                const usersResp = await axios.post(
                    authSession.getUrl('user.fcgi') + (authSession.method === 'session' ? '&' : '?') + 'request=count',
                    {},
                    { headers: authSession.getHeaders(), timeout: 5000 }
                );
                usersCount = usersResp.data?.count || 0;

                const logsResp = await axios.post(
                    authSession.getUrl('access_log.fcgi') + (authSession.method === 'session' ? '&' : '?') + 'request=count',
                    {},
                    { headers: authSession.getHeaders(), timeout: 5000 }
                );
                recordsCount = logsResp.data?.count || 0;
            } catch (e) {
                console.log('[Control iD] Não foi possível obter contagens:', e.message);
            }

            const deviceData = {
                model: response.data.product_model || response.data.model || 'Control iD',
                serial: response.data.serial || response.data.device_id || '-',
                firmware: response.data.firmware || response.data.version || '-',
                users: usersCount,
                records: recordsCount,
                lastRecord: '-',
                authMethod: authSession.method
            };

            // Atualizar config no banco com info do dispositivo
            try {
                const [existing] = await pool.query('SELECT id FROM controlid_config WHERE ip = ? AND ativo = TRUE LIMIT 1', [ip]);
                if (existing.length > 0) {
                    await pool.query(
                        `UPDATE controlid_config SET modelo = ?, serial_number = ?, firmware = ?, ultima_conexao = NOW() WHERE id = ?`,
                        [deviceData.model, deviceData.serial, deviceData.firmware, existing[0].id]
                    );
                }
            } catch (e) {
                console.log('[Control iD] Erro ao atualizar info do device:', e.message);
            }

            return res.json({ success: true, device: deviceData });
        }

        res.json({ success: false, message: 'Resposta inválida do equipamento' });

    } catch (error) {
        console.error('[Control iD] Erro ao testar conexão:', error.message);
        
        let message = 'Não foi possível conectar ao equipamento';
        if (error.code === 'ECONNREFUSED') {
            message = 'Conexão recusada. Verifique o IP e porta.';
        } else if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
            message = 'Tempo limite excedido. O equipamento pode estar offline ou inacessível.';
        } else if (error.response?.status === 401) {
            message = 'Usuário ou senha incorretos.';
        }

        res.json({ success: false, message });
    }
});

// ==================== IMPORT FROM API ====================

/**
 * POST /api/rh/controlid/import
 * Importar registros de ponto do Control iD via API
 */
router.post('/import', authenticateToken, async (req, res) => {
    try {
        const { ip, port = 80, user = 'admin', password, dateStart, dateEnd, employeeId } = req.body;

        if (!ip || !dateStart || !dateEnd) {
            return res.status(400).json({ 
                success: false, 
                message: 'IP, data início e data fim são obrigatórios' 
            });
        }

        const baseUrl = `http://${ip}:${port}`;
        const authSession = await getControlIdSession(baseUrl, user, password);

        // Buscar logs de acesso no período
        const logsResponse = await axios.post(
            authSession.getUrl('access_log.fcgi') + (authSession.method === 'session' ? '&' : '?') + 'request=load',
            {
                initial_date: { day: parseInt(dateStart.split('-')[2]), month: parseInt(dateStart.split('-')[1]), year: parseInt(dateStart.split('-')[0]) },
                final_date: { day: parseInt(dateEnd.split('-')[2]), month: parseInt(dateEnd.split('-')[1]), year: parseInt(dateEnd.split('-')[0]) }
            },
            { headers: authSession.getHeaders(), timeout: 60000 }
        );

        const logs = logsResponse.data?.access_logs || [];

        // Buscar lista de usuários
        const usersResponse = await axios.post(
            authSession.getUrl('user.fcgi') + (authSession.method === 'session' ? '&' : '?') + 'request=load',
            {},
            { headers: authSession.getHeaders(), timeout: 30000 }
        );
        const users = usersResponse.data?.users || [];

        const usersMap = {};
        users.forEach(u => {
            usersMap[u.id] = {
                name: u.name,
                pis: u.pis_number || u.registration || ''
            };
        });

        // Processar registros
        const records = logs.map(log => {
            const userData = usersMap[log.user_id] || {};
            const timestamp = new Date(log.time * 1000);
            
            return {
                data: timestamp.toISOString().split('T')[0],
                hora: timestamp.toTimeString().substring(0, 5),
                userId: log.user_id,
                nome: userData.name || 'Desconhecido',
                pis: userData.pis,
                event: log.event,
                deviceId: log.device_id
            };
        });

        // Filtrar por funcionário se especificado
        let filteredRecords = records;
        if (employeeId) {
            const [funcionario] = await pool.query(
                'SELECT pis_pasep as pis FROM funcionarios WHERE id = ?',
                [employeeId]
            );
            if (funcionario.length > 0 && funcionario[0].pis) {
                filteredRecords = records.filter(r => r.pis === funcionario[0].pis);
            }
        }

        // Salvar no banco
        let successCount = 0;
        let duplicateCount = 0;
        let errorCount = 0;

        for (const record of filteredRecords) {
            try {
                const [existing] = await pool.query(
                    'SELECT id FROM ponto_marcacoes WHERE pis = ? AND data = ? AND hora = ?',
                    [record.pis, record.data, record.hora]
                );

                if (existing.length > 0) {
                    duplicateCount++;
                    record.status = 'warning';
                    record.statusText = 'Duplicado';
                    continue;
                }

                await pool.query(
                    `INSERT INTO ponto_marcacoes (funcionario_id, pis, data, hora, tipo, origem, criado_em)
                     VALUES (
                        (SELECT id FROM funcionarios WHERE pis_pasep = ? LIMIT 1),
                        ?, ?, ?, ?, 'control_id', NOW()
                     )`,
                    [record.pis, record.pis, record.data, record.hora, record.event || 'marcacao']
                );

                successCount++;
                record.status = 'success';
                record.statusText = 'Importado';
            } catch (err) {
                console.error('[Control iD] Erro ao salvar registro:', err.message);
                errorCount++;
                record.status = 'error';
                record.statusText = 'Erro';
            }
        }

        // Bug #5 fix: Gravar no histórico de importações
        try {
            await pool.query(
                `INSERT INTO ponto_importacoes (data_inicio, data_fim, total_registros, registros_sucesso, registros_duplicados, registros_erro, origem, usuario_id, ip_equipamento, status, criado_em)
                 VALUES (?, ?, ?, ?, ?, ?, 'control_id', ?, ?, 'concluido', NOW())`,
                [dateStart, dateEnd, filteredRecords.length, successCount, duplicateCount, errorCount, req.user?.id || null, ip]
            );
        } catch (histErr) {
            console.error('[Control iD] Erro ao gravar histórico:', histErr.message);
        }

        res.json({
            success: true,
            summary: {
                total: filteredRecords.length,
                success: successCount,
                duplicates: duplicateCount,
                errors: errorCount
            },
            records: filteredRecords.slice(0, 100)
        });

    } catch (error) {
        console.error('[Control iD] Erro na importação:', error.message);
        res.status(500).json({ 
            success: false, 
            message: 'Erro ao importar registros: ' + error.message 
        });
    }
});

// ==================== IMPORT FROM FILE (AFD/CSV) ====================

/**
 * POST /api/rh/controlid/ponto/import
 * Importar registros de arquivo AFD ou CSV
 */
router.post('/ponto/import', authenticateToken, async (req, res) => {
    try {
        const { records, dateStart, dateEnd, employeeId } = req.body;

        if (!records || records.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Nenhum registro para importar' 
            });
        }

        let successCount = 0;
        let duplicateCount = 0;
        let errorCount = 0;

        for (const record of records) {
            try {
                const [existing] = await pool.query(
                    'SELECT id FROM ponto_marcacoes WHERE pis = ? AND data = ? AND hora = ?',
                    [record.pis, record.data, record.hora]
                );

                if (existing.length > 0) {
                    duplicateCount++;
                    record.status = 'warning';
                    record.statusText = 'Duplicado';
                    continue;
                }

                const [funcionario] = await pool.query(
                    'SELECT id, nome_completo FROM funcionarios WHERE pis_pasep = ?',
                    [record.pis]
                );

                const funcionarioId = funcionario.length > 0 ? funcionario[0].id : null;
                const nome = funcionario.length > 0 ? funcionario[0].nome_completo : record.nome || 'Não identificado';

                await pool.query(
                    `INSERT INTO ponto_marcacoes (funcionario_id, pis, data, hora, tipo, origem, criado_em)
                     VALUES (?, ?, ?, ?, 'marcacao', 'arquivo', NOW())`,
                    [funcionarioId, record.pis, record.data, record.hora]
                );

                successCount++;
                record.status = 'success';
                record.statusText = 'Importado';
                record.nome = nome;
            } catch (err) {
                console.error('[Control iD] Erro ao salvar registro:', err.message);
                errorCount++;
                record.status = 'error';
                record.statusText = 'Erro';
            }
        }

        // Bug #5 fix: Gravar no histórico de importações
        try {
            await pool.query(
                `INSERT INTO ponto_importacoes (data_inicio, data_fim, total_registros, registros_sucesso, registros_duplicados, registros_erro, origem, usuario_id, status, criado_em)
                 VALUES (?, ?, ?, ?, ?, ?, 'arquivo_afd', ?, 'concluido', NOW())`,
                [dateStart || null, dateEnd || null, records.length, successCount, duplicateCount, errorCount, req.user?.id || null]
            );
        } catch (histErr) {
            console.error('[Control iD] Erro ao gravar histórico:', histErr.message);
        }

        res.json({
            success: true,
            summary: {
                total: records.length,
                success: successCount,
                duplicates: duplicateCount,
                errors: errorCount
            },
            records: records.slice(0, 100)
        });

    } catch (error) {
        console.error('[Control iD] Erro na importação de arquivo:', error.message);
        res.status(500).json({ 
            success: false, 
            message: 'Erro ao importar registros: ' + error.message 
        });
    }
});

// ==================== HISTÓRICO DE IMPORTAÇÕES ====================

/**
 * GET /api/rh/controlid/importacoes
 * Buscar histórico de importações
 */
router.get('/importacoes', authenticateToken, async (req, res) => {
    try {
        const { limite = 50 } = req.query;

        const [importacoes] = await pool.query(`
            SELECT 
                pi.id,
                pi.origem as tipo,
                pi.data_inicio as periodo_inicio,
                pi.data_fim as periodo_fim,
                pi.total_registros,
                pi.registros_sucesso as importados,
                pi.registros_duplicados as duplicados,
                pi.registros_erro as erros,
                pi.ip_equipamento,
                pi.status,
                pi.criado_em,
                COALESCE(u.nome, u.nome_completo, 'Sistema') as usuario_nome
            FROM ponto_importacoes pi
            LEFT JOIN usuarios u ON pi.usuario_id = u.id
            ORDER BY pi.criado_em DESC
            LIMIT ?
        `, [parseInt(limite)]);

        res.json({ success: true, importacoes });
    } catch (error) {
        console.error('[Control iD] Erro ao buscar importações:', error.message);
        try {
            const [importacoes] = await pool.query(
                'SELECT * FROM ponto_importacoes ORDER BY criado_em DESC LIMIT ?',
                [parseInt(req.query.limite || 50)]
            );
            res.json({ success: true, importacoes });
        } catch (e2) {
            res.status(500).json({ success: false, message: error.message });
        }
    }
});

module.exports = router;
