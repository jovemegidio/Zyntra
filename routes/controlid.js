/**
 * Rotas de integração com Control iD + RHiD Cloud API
 * 
 * Control iD (dispositivo local): session-based /login.fcgi + fallback Basic Auth
 * RHiD Cloud: https://www.rhid.com.br/v2/{service}.svc/{endpoint} com JWT
 * 
 * Endpoints existentes (backward compat):
 *   GET/POST  /config           - Configuração do dispositivo local
 *   POST      /test-connection  - Testar conexão com dispositivo
 *   POST      /import           - Importar via API do dispositivo
 *   POST      /ponto/import     - Importar de arquivo AFD/CSV
 *   GET       /importacoes      - Histórico de importações
 * 
 * Novos endpoints RHiD Cloud:
 *   GET/POST  /rhid/config              - Configuração do RHiD Cloud
 *   POST      /rhid/test                - Testar conexão com RHiD
 *   POST      /rhid/sync                - Sincronizar marcações do RHiD -> banco local
 *   GET       /rhid/employees           - Listar funcionários do RHiD
 *   GET       /rhid/devices             - Listar dispositivos no RHiD
 *   GET       /rhid/ultimasmarcacoes    - Últimas marcações em tempo real
 */

require('dotenv').config();
const express = require('express');
const router = express.Router();
const axios = require('axios');
const mysql = require('mysql2/promise');

const { authenticateToken } = require('../middleware/auth');

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

// ==================== RHID CLOUD CONFIG ====================
const RHID_BASE_URL = 'https://www.rhid.com.br/v2';

// Cache do token JWT do RHiD (válido ~4h)
let rhidTokenCache = {
    token: null,
    expiresAt: 0,
    customerId: null,
    customerDomain: null,
    maxUsers: null
};

// ==================== AUTO-CREATE TABLES ====================
(async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS controlid_config (
                id INT AUTO_INCREMENT PRIMARY KEY,
                ip VARCHAR(50) DEFAULT NULL,
                porta INT DEFAULT 80,
                usuario VARCHAR(100) DEFAULT 'admin',
                senha_hash VARCHAR(255) DEFAULT NULL,
                modelo VARCHAR(100) DEFAULT NULL,
                serial_number VARCHAR(100) DEFAULT NULL,
                firmware VARCHAR(100) DEFAULT NULL,
                ultima_conexao DATETIME DEFAULT NULL,
                ativo BOOLEAN DEFAULT TRUE,
                rhid_email VARCHAR(255) DEFAULT NULL,
                rhid_password VARCHAR(255) DEFAULT NULL,
                rhid_enabled BOOLEAN DEFAULT FALSE,
                rhid_auto_sync BOOLEAN DEFAULT FALSE,
                rhid_sync_interval INT DEFAULT 30,
                rhid_last_sync DATETIME DEFAULT NULL,
                criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
                atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        // Adicionar colunas RHiD se não existirem (para tabelas já existentes)
        const rhidColumns = [
            { name: 'rhid_email', type: 'VARCHAR(255) DEFAULT NULL' },
            { name: 'rhid_password', type: 'VARCHAR(255) DEFAULT NULL' },
            { name: 'rhid_enabled', type: 'BOOLEAN DEFAULT FALSE' },
            { name: 'rhid_auto_sync', type: 'BOOLEAN DEFAULT FALSE' },
            { name: 'rhid_sync_interval', type: 'INT DEFAULT 30' },
            { name: 'rhid_last_sync', type: 'DATETIME DEFAULT NULL' }
        ];

        for (const col of rhidColumns) {
            try {
                await pool.query(`ALTER TABLE controlid_config ADD COLUMN ${col.name} ${col.type}`);
                console.log('[RHiD] Coluna ' + col.name + ' adicionada');
            } catch (e) {
                // Coluna já existe - ok
            }
        }

        console.log('[Control iD + RHiD] Tabela controlid_config verificada/criada');
    } catch (e) {
        console.error('[Control iD] Erro ao criar tabela controlid_config:', e.message);
    }
})();

// ==================== RHID CLOUD HELPERS ====================

/**
 * Autenticar com o RHiD Cloud e obter token JWT
 */
async function rhidLogin(email, password, forceRefresh = false) {
    // Usar cache se válido
    if (!forceRefresh && rhidTokenCache.token && Date.now() < rhidTokenCache.expiresAt) {
        return rhidTokenCache.token;
    }

    console.log('[RHiD] Autenticando com', email);

    const response = await axios.post(RHID_BASE_URL + '/login.svc/', {
        email: email,
        password: password
    }, {
        timeout: 15000,
        headers: { 'Content-Type': 'application/json' }
    });

    if (!response.data || !response.data.accessToken) {
        throw new Error('Falha na autenticação RHiD: resposta inválida');
    }

    const token = response.data.accessToken;

    // Decodificar JWT para obter informações
    try {
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
        rhidTokenCache = {
            token: token,
            expiresAt: (payload.exp * 1000) - 300000, // 5 min antes de expirar
            customerId: payload.cidCustomerId,
            customerDomain: payload.cidCustomerDomain,
            maxUsers: payload.maxUsers
        };
    } catch (e) {
        rhidTokenCache = {
            token: token,
            expiresAt: Date.now() + (3 * 60 * 60 * 1000),
            customerId: null,
            customerDomain: null,
            maxUsers: null
        };
    }

    console.log('[RHiD] Autenticado com sucesso - Customer:', rhidTokenCache.customerDomain);
    return token;
}

/**
 * Fazer chamada autenticada à API do RHiD
 */
async function rhidApiCall(service, endpoint, method, body, email, password) {
    method = method || 'GET';
    // Se não temos credenciais, buscar do banco
    if (!email || !password) {
        const [rows] = await pool.query(
            'SELECT rhid_email, rhid_password FROM controlid_config WHERE ativo = TRUE AND rhid_enabled = TRUE ORDER BY id DESC LIMIT 1'
        );
        if (rows.length === 0) throw new Error('RHiD Cloud não configurado');
        email = rows[0].rhid_email;
        password = Buffer.from(rows[0].rhid_password, 'base64').toString();
    }

    const token = await rhidLogin(email, password);
    var url = endpoint
        ? RHID_BASE_URL + '/' + service + '.svc/' + endpoint
        : RHID_BASE_URL + '/' + service + '.svc/';

    var config = {
        method: method,
        url: url,
        headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json'
        },
        timeout: 30000
    };

    if (body && (method === 'POST' || method === 'PUT')) {
        config.data = body;
    }

    const response = await axios(config);
    return response.data;
}

/**
 * Converter classificação de ponto do RHiD para tipo local
 */
function rhidClassToTipo(typeClassification, typeEntradaSaida) {
    if (typeClassification === '1' && typeEntradaSaida === 'E') return 'entrada';
    if (typeClassification === '3' && typeEntradaSaida === 'S') return 'saida_almoco';
    if (typeClassification === '4' && typeEntradaSaida === 'E') return 'retorno_almoco';
    if (typeClassification === '2' && typeEntradaSaida === 'S') return 'saida';
    if (typeEntradaSaida === 'E') return 'entrada';
    if (typeEntradaSaida === 'S') return 'saida';
    return 'marcacao';
}

/**
 * Converter dateTimeStr do RHiD (yyyyMMddHHmm) para data e hora
 */
function rhidParseDateTime(dateTimeStr) {
    if (!dateTimeStr || dateTimeStr.length < 12) return { data: null, hora: null };
    return {
        data: dateTimeStr.substring(0, 4) + '-' + dateTimeStr.substring(4, 6) + '-' + dateTimeStr.substring(6, 8),
        hora: dateTimeStr.substring(8, 10) + ':' + dateTimeStr.substring(10, 12)
    };
}

// ==================== RHID CLOUD ENDPOINTS ====================

/**
 * GET /api/rh/controlid/rhid/config
 * Buscar configuração do RHiD Cloud
 */
router.get('/rhid/config', authenticateToken, async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT id, rhid_email, rhid_enabled, rhid_auto_sync, rhid_sync_interval, rhid_last_sync FROM controlid_config WHERE ativo = TRUE ORDER BY id DESC LIMIT 1'
        );
        res.json({ success: true, config: rows.length > 0 ? rows[0] : null });
    } catch (error) {
        console.error('[RHiD] Erro ao buscar config:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/rh/controlid/rhid/config
 * Salvar configuração do RHiD Cloud
 */
router.post('/rhid/config', authenticateToken, async (req, res) => {
    try {
        const { email, password, enabled, autoSync, syncInterval } = req.body;
        var isEnabled = enabled !== undefined ? enabled : true;
        var isAutoSync = autoSync !== undefined ? autoSync : false;
        var interval = syncInterval || 30;

        if (!email) {
            return res.status(400).json({ success: false, message: 'Email é obrigatório' });
        }

        const [existing] = await pool.query('SELECT id FROM controlid_config WHERE ativo = TRUE LIMIT 1');
        var encPassword = password ? Buffer.from(password).toString('base64') : null;

        if (existing.length > 0) {
            var updateFields = ['rhid_email = ?', 'rhid_enabled = ?', 'rhid_auto_sync = ?', 'rhid_sync_interval = ?', 'atualizado_em = NOW()'];
            var updateValues = [email, isEnabled, isAutoSync, interval];
            if (encPassword) {
                updateFields.push('rhid_password = ?');
                updateValues.push(encPassword);
            }
            updateValues.push(existing[0].id);
            await pool.query('UPDATE controlid_config SET ' + updateFields.join(', ') + ' WHERE id = ?', updateValues);
        } else {
            await pool.query(
                'INSERT INTO controlid_config (ip, porta, usuario, senha_hash, rhid_email, rhid_password, rhid_enabled, rhid_auto_sync, rhid_sync_interval, ativo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)',
                ['0.0.0.0', 443, 'admin', '', email, encPassword, isEnabled, isAutoSync, interval]
            );
        }

        // Limpar cache do token
        rhidTokenCache = { token: null, expiresAt: 0, customerId: null, customerDomain: null, maxUsers: null };

        res.json({ success: true, message: 'Configuração RHiD salva com sucesso' });
    } catch (error) {
        console.error('[RHiD] Erro ao salvar config:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/rh/controlid/rhid/test
 * Testar conexão com RHiD Cloud
 */
router.post('/rhid/test', authenticateToken, async (req, res) => {
    try {
        var email = req.body.email;
        var password = req.body.password;

        if (!email || !password) {
            const [rows] = await pool.query(
                'SELECT rhid_email, rhid_password FROM controlid_config WHERE ativo = TRUE AND rhid_enabled = TRUE ORDER BY id DESC LIMIT 1'
            );
            if (rows.length === 0) {
                return res.json({ success: false, message: 'RHiD Cloud não configurado. Informe email e senha.' });
            }
            email = rows[0].rhid_email;
            password = Buffer.from(rows[0].rhid_password, 'base64').toString();
        }

        // Autenticar
        await rhidLogin(email, password, true);

        // Buscar dispositivos e funcionários
        var devicesRaw = await rhidApiCall('customerdb/device', 'a', 'GET', null, email, password);
        var personsRaw = await rhidApiCall('customerdb/person', 'a', 'GET', null, email, password);

        console.log('[RHiD] Devices response type:', typeof devicesRaw, Array.isArray(devicesRaw) ? 'array(' + devicesRaw.length + ')' : (devicesRaw ? Object.keys(devicesRaw).join(',') : 'null'));
        console.log('[RHiD] Persons response type:', typeof personsRaw, Array.isArray(personsRaw) ? 'array(' + personsRaw.length + ')' : (personsRaw ? Object.keys(personsRaw).join(',') : 'null'));

        // O RHiD pode retornar array direto ou {data: [...]} ou {result: [...]}
        var deviceList = Array.isArray(devicesRaw) ? devicesRaw : (devicesRaw && devicesRaw.data ? devicesRaw.data : (devicesRaw && devicesRaw.result ? devicesRaw.result : []));
        var personList = Array.isArray(personsRaw) ? personsRaw : (personsRaw && personsRaw.data ? personsRaw.data : (personsRaw && personsRaw.result ? personsRaw.result : []));
        var activePersons = personList.filter(function(p) { return p.status === 1; });

        res.json({
            success: true,
            connection: {
                authenticated: true,
                customerDomain: rhidTokenCache.customerDomain,
                customerId: rhidTokenCache.customerId,
                maxUsers: rhidTokenCache.maxUsers
            },
            devices: deviceList.map(function(d) {
                return {
                    id: d.id,
                    name: d.name,
                    host: d.host,
                    port: d.port,
                    serial: d.serialNumber,
                    model: d.model === 5 ? 'iDFace' : (d.model === 4 ? 'iDAccess' : 'Control iD #' + d.model),
                    online: d.isOnline || false
                };
            }),
            employees: {
                total: personList.length,
                active: activePersons.length,
                inactive: personList.length - activePersons.length
            }
        });

    } catch (error) {
        console.error('[RHiD] Erro ao testar conexão:', error.message);
        var message = 'Falha na conexão com RHiD Cloud';
        if (error.response && (error.response.status === 401 || error.response.status === 403)) {
            message = 'Email ou senha incorretos';
        } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
            message = 'Servidor RHiD indisponível';
        }
        res.json({ success: false, message: message });
    }
});

/**
 * GET /api/rh/controlid/rhid/devices
 */
router.get('/rhid/devices', authenticateToken, async (req, res) => {
    try {
        var devices = await rhidApiCall('customerdb/device', 'a');
        var deviceList = Array.isArray(devices) ? devices : (devices && devices.data ? devices.data : (devices && devices.result ? devices.result : []));
        res.json({
            success: true,
            devices: deviceList.map(function(d) {
                return {
                    id: d.id, name: d.name, host: d.host, port: d.port,
                    serial: d.serialNumber,
                    model: d.model === 5 ? 'iDFace' : (d.model === 4 ? 'iDAccess' : 'Control iD #' + d.model),
                    online: d.isOnline || false, deviceCode: d.deviceCode
                };
            })
        });
    } catch (error) {
        console.error('[RHiD] Erro ao listar devices:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/rh/controlid/rhid/employees
 */
router.get('/rhid/employees', authenticateToken, async (req, res) => {
    try {
        var persons = await rhidApiCall('customerdb/person', 'a');
        var personList = Array.isArray(persons) ? persons : (persons && persons.data ? persons.data : (persons && persons.result ? persons.result : []));
        res.json({
            success: true,
            employees: personList.map(function(p) {
                return {
                    id: p.id, name: p.name,
                    pis: p.pis ? String(p.pis) : null,
                    cpf: p.cpf ? String(p.cpf) : null,
                    status: p.status === 1 ? 'Ativo' : 'Inativo',
                    registration: p.registration || null
                };
            })
        });
    } catch (error) {
        console.error('[RHiD] Erro ao listar employees:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/rh/controlid/rhid/ultimasmarcacoes
 * Últimas marcações em tempo real do RHiD
 */
router.get('/rhid/ultimasmarcacoes', authenticateToken, async (req, res) => {
    try {
        var data = await rhidApiCall('util', 'ultimasmarcacoes');
        var entries = Array.isArray(data) ? data : (data && data.data ? data.data : (data && data.result ? data.result : []));
        res.json({
            success: true,
            marcacoes: entries.map(function(e) {
                return {
                    name: e.name, dateTime: e.dateTime, photo: e.photo || null,
                    personId: e.idPerson, type: e.type || 'marcacao'
                };
            })
        });
    } catch (error) {
        console.error('[RHiD] Erro ao buscar últimas marcações:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/rh/controlid/rhid/sync
 * Sincronizar marcações do RHiD Cloud -> banco local
 * Body: { dateStart: "2026-02-01", dateEnd: "2026-02-11", employeeId?: number }
 */
router.post('/rhid/sync', authenticateToken, async (req, res) => {
    try {
        var dateStart = req.body.dateStart;
        var dateEnd = req.body.dateEnd;
        var employeeId = req.body.employeeId;

        if (!dateStart || !dateEnd) {
            return res.status(400).json({ success: false, message: 'Data início e data fim são obrigatórios' });
        }

        console.log('[RHiD Sync] Período: ' + dateStart + ' a ' + dateEnd);

        // 1. Buscar todos os funcionários do RHiD
        var persons = await rhidApiCall('customerdb/person', 'a');
        var personList = Array.isArray(persons) ? persons : (persons && persons.data ? persons.data : (persons && persons.result ? persons.result : []));
        var activePersons = personList.filter(function(p) { return p.status === 1; });

        console.log('[RHiD Sync] Persons response: ' + (Array.isArray(persons) ? 'array' : typeof persons) + ', total: ' + personList.length + ', ativos: ' + activePersons.length);

        if (activePersons.length === 0) {
            return res.json({ success: false, message: 'Nenhum funcionário ativo encontrado no RHiD' });
        }

        console.log('[RHiD Sync] ' + activePersons.length + ' funcionários ativos no RHiD');

        // 2. Converter datas para formato RHiD (yyyyMMdd)
        var ini = dateStart.replace(/-/g, '');
        var fim = dateEnd.replace(/-/g, '');

        // 3. Definir quais IDs buscar
        var personIds = activePersons.map(function(p) { return p.id; });

        // Se filtro de funcionário local, filtrar por PIS ou nome
        if (employeeId) {
            var [funcLocal] = await pool.query(
                'SELECT pis_pasep, nome_completo FROM funcionarios WHERE id = ?', [employeeId]
            );
            if (funcLocal.length > 0) {
                var pisLocal = funcLocal[0].pis_pasep;
                var nomeLocal = (funcLocal[0].nome_completo || '').toUpperCase();
                personIds = activePersons
                    .filter(function(p) {
                        if (pisLocal && p.pis && String(p.pis) === String(pisLocal)) return true;
                        if (nomeLocal && p.name && p.name.toUpperCase().indexOf(nomeLocal.split(' ')[0]) >= 0) return true;
                        return false;
                    })
                    .map(function(p) { return p.id; });

                if (personIds.length === 0) {
                    return res.json({
                        success: false,
                        message: 'Funcionário "' + funcLocal[0].nome_completo + '" não encontrado no RHiD. Verifique se o PIS está cadastrado.'
                    });
                }
            }
        }

        // 4. Buscar marcações detalhadas via apuracao_ponto
        // RHiD API limita ~31 dias por chamada, então dividimos em chunks mensais
        var BATCH_SIZE = 20;
        var MAX_DAYS = 28; // chunk seguro de dias
        var allRecords = [];

        // Gerar chunks de datas (28 dias cada)
        var dateChunks = [];
        var chunkStart = new Date(dateStart + 'T00:00:00');
        var finalEnd = new Date(dateEnd + 'T00:00:00');
        while (chunkStart < finalEnd) {
            var chunkEnd = new Date(chunkStart);
            chunkEnd.setDate(chunkEnd.getDate() + MAX_DAYS);
            if (chunkEnd > finalEnd) chunkEnd = finalEnd;
            dateChunks.push({
                ini: chunkStart.toISOString().slice(0, 10).replace(/-/g, ''),
                fim: chunkEnd.toISOString().slice(0, 10).replace(/-/g, '')
            });
            chunkStart = new Date(chunkEnd);
            chunkStart.setDate(chunkStart.getDate() + 1);
        }

        console.log('[RHiD Sync] ' + dateChunks.length + ' chunks de datas: ' + dateChunks.map(function(c) { return c.ini + '-' + c.fim; }).join(', '));

        for (var ch = 0; ch < dateChunks.length; ch++) {
            var chunk = dateChunks[ch];
            console.log('[RHiD Sync] Processando chunk ' + (ch + 1) + '/' + dateChunks.length + ': ' + chunk.ini + ' a ' + chunk.fim);

        for (var i = 0; i < personIds.length; i += BATCH_SIZE) {
            var batch = personIds.slice(i, i + BATCH_SIZE);
            try {
                var apuracao = await rhidApiCall('report', 'apuracao_ponto', 'POST', {
                    idPerson: batch,
                    ini: chunk.ini,
                    fim: chunk.fim
                });

                var apuracaoList = Array.isArray(apuracao) ? apuracao : (apuracao && apuracao.data ? apuracao.data : (apuracao && apuracao.result ? apuracao.result : []));
                console.log('[RHiD Sync] Chunk ' + (ch + 1) + ' Batch ' + (i / BATCH_SIZE + 1) + ': ' + apuracaoList.length + ' day-records retornados');

                if (Array.isArray(apuracaoList)) {
                    for (var d = 0; d < apuracaoList.length; d++) {
                        var dayRecord = apuracaoList[d];
                        if (dayRecord.listAfdtManutencao && dayRecord.listAfdtManutencao.length > 0) {
                            for (var p = 0; p < dayRecord.listAfdtManutencao.length; p++) {
                                var punch = dayRecord.listAfdtManutencao[p];
                                if (punch.oculto) continue;
                                var parsed = rhidParseDateTime(punch.dateTimeStr);
                                if (!parsed.data || !parsed.hora) continue;

                                allRecords.push({
                                    pis: dayRecord.pis ? String(dayRecord.pis) : null,
                                    nome: dayRecord.name,
                                    data: parsed.data,
                                    hora: parsed.hora,
                                    tipo: rhidClassToTipo(punch._typeClassification, punch._typeEntradaSaida),
                                    idAfd: punch.idAfd,
                                    idPerson: punch.idPerson,
                                    horasTrabalhadas: dayRecord.totalHorasTrabalhadas
                                });
                            }
                        }
                    }
                }
            } catch (batchErr) {
                console.error('[RHiD Sync] Erro no batch ' + i + '-' + (i + BATCH_SIZE) + ' chunk ' + (ch + 1) + ':', batchErr.message);
            }
        }
        } // fim dateChunks loop

        console.log('[RHiD Sync] ' + allRecords.length + ' marcações encontradas no RHiD');

        if (allRecords.length === 0) {
            try {
                await pool.query(
                    'INSERT INTO ponto_importacoes (data_inicio, data_fim, total_registros, registros_sucesso, registros_duplicados, registros_erro, origem, usuario_id, status, criado_em) VALUES (?, ?, 0, 0, 0, 0, \'rhid_cloud\', ?, \'concluido\', NOW())',
                    [dateStart, dateEnd, req.user ? req.user.id : null]
                );
            } catch (e) { /* ok */ }

            return res.json({
                success: true,
                summary: { total: 0, success: 0, duplicates: 0, errors: 0 },
                records: [],
                message: 'Nenhuma marcação encontrada no período selecionado'
            });
        }

        // 5. Pré-carregar mapa de funcionários locais por PIS e nome
        var [funcionariosLocais] = await pool.query(
            'SELECT id, nome_completo, pis_pasep FROM funcionarios WHERE (status = "Ativo" OR ativo = 1)'
        );
        var funcPorPis = {};
        var funcPorNome = {};
        for (var f = 0; f < funcionariosLocais.length; f++) {
            var func = funcionariosLocais[f];
            if (func.pis_pasep) funcPorPis[String(func.pis_pasep).replace(/[.\-]/g, '')] = func;
            if (func.nome_completo) funcPorNome[func.nome_completo.toUpperCase().trim()] = func;
        }

        // 6. Salvar no banco local
        var successCount = 0;
        var duplicateCount = 0;
        var errorCount = 0;

        for (var r = 0; r < allRecords.length; r++) {
            var record = allRecords[r];
            try {
                // Verificar duplicata
                var [existing] = await pool.query(
                    'SELECT id FROM ponto_marcacoes WHERE pis = ? AND data = ? AND hora = ?',
                    [record.pis, record.data, record.hora]
                );

                if (existing.length > 0) {
                    duplicateCount++;
                    record.status = 'warning';
                    record.statusText = 'Duplicado';
                    continue;
                }

                // Encontrar funcionário local por PIS ou nome
                var funcId = null;
                var pisClean = record.pis ? String(record.pis).replace(/[.\-]/g, '') : null;

                if (pisClean && funcPorPis[pisClean]) {
                    funcId = funcPorPis[pisClean].id;
                } else if (record.nome) {
                    var nomeUp = record.nome.toUpperCase().trim();
                    if (funcPorNome[nomeUp]) {
                        funcId = funcPorNome[nomeUp].id;
                    } else {
                        // Match parcial pelo primeiro e último nome
                        var partes = nomeUp.split(' ');
                        var keys = Object.keys(funcPorNome);
                        for (var k = 0; k < keys.length; k++) {
                            if (partes[0] && keys[k].indexOf(partes[0]) === 0 && partes.length > 1 && keys[k].indexOf(partes[partes.length - 1]) >= 0) {
                                funcId = funcPorNome[keys[k]].id;
                                break;
                            }
                        }
                    }
                }

                await pool.query(
                    'INSERT INTO ponto_marcacoes (funcionario_id, pis, data, hora, tipo, origem, observacao, criado_em) VALUES (?, ?, ?, ?, ?, \'rhid_cloud\', ?, NOW())',
                    [funcId, record.pis, record.data, record.hora, record.tipo, record.nome ? 'RHiD: ' + record.nome : null]
                );

                successCount++;
                record.status = 'success';
                record.statusText = 'Importado';
                record.funcionario_id = funcId;
            } catch (err) {
                console.error('[RHiD Sync] Erro ao salvar registro:', err.message);
                errorCount++;
                record.status = 'error';
                record.statusText = 'Erro';
            }
        }

        // 7. Gravar histórico de importação
        try {
            await pool.query(
                'INSERT INTO ponto_importacoes (data_inicio, data_fim, total_registros, registros_sucesso, registros_duplicados, registros_erro, origem, usuario_id, status, criado_em) VALUES (?, ?, ?, ?, ?, ?, \'rhid_cloud\', ?, \'concluido\', NOW())',
                [dateStart, dateEnd, allRecords.length, successCount, duplicateCount, errorCount, req.user ? req.user.id : null]
            );
        } catch (histErr) {
            console.error('[RHiD Sync] Erro ao gravar histórico:', histErr.message);
        }

        // Atualizar última sync
        try {
            await pool.query('UPDATE controlid_config SET rhid_last_sync = NOW() WHERE ativo = TRUE LIMIT 1');
        } catch (e) { /* ok */ }

        console.log('[RHiD Sync] Concluído: ' + successCount + ' importados, ' + duplicateCount + ' duplicados, ' + errorCount + ' erros');

        res.json({
            success: true,
            summary: {
                total: allRecords.length,
                success: successCount,
                duplicates: duplicateCount,
                errors: errorCount
            },
            records: allRecords.slice(0, 200).map(function(r) {
                return {
                    data: r.data, hora: r.hora, nome: r.nome, pis: r.pis,
                    tipo: r.tipo, status: r.status, statusText: r.statusText
                };
            })
        });

    } catch (error) {
        console.error('[RHiD Sync] Erro na sincronização:', error.message);
        res.status(500).json({ success: false, message: 'Erro ao sincronizar: ' + error.message });
    }
});

// ==================== EXISTING CONFIG ENDPOINTS ====================

router.get('/config', authenticateToken, async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT id, ip, porta, usuario, modelo, serial_number, firmware, ultima_conexao, ativo, rhid_email, rhid_enabled, rhid_auto_sync, rhid_sync_interval, rhid_last_sync FROM controlid_config WHERE ativo = TRUE ORDER BY id DESC LIMIT 1'
        );
        res.json({ success: true, config: rows.length > 0 ? rows[0] : null });
    } catch (error) {
        console.error('[Control iD] Erro ao buscar config:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

router.post('/config', authenticateToken, async (req, res) => {
    try {
        const { ip, porta, usuario, senha } = req.body;
        var port = porta || 80;
        var user = usuario || 'admin';
        if (!ip) return res.status(400).json({ success: false, message: 'IP é obrigatório' });

        const [existing] = await pool.query('SELECT id FROM controlid_config WHERE ativo = TRUE LIMIT 1');
        if (existing.length > 0) {
            await pool.query(
                'UPDATE controlid_config SET ip = ?, porta = ?, usuario = ?, senha_hash = ?, atualizado_em = NOW() WHERE id = ?',
                [ip, port, user, senha ? Buffer.from(senha).toString('base64') : null, existing[0].id]
            );
        } else {
            await pool.query(
                'INSERT INTO controlid_config (ip, porta, usuario, senha_hash) VALUES (?, ?, ?, ?)',
                [ip, port, user, senha ? Buffer.from(senha).toString('base64') : null]
            );
        }
        res.json({ success: true, message: 'Configuração salva com sucesso' });
    } catch (error) {
        console.error('[Control iD] Erro ao salvar config:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==================== EXISTING TEST CONNECTION ====================

async function getControlIdSession(baseUrl, user, password) {
    try {
        var loginResponse = await axios.post(baseUrl + '/login.fcgi', {
            login: user, password: password
        }, { timeout: 10000, headers: { 'Content-Type': 'application/json' } });

        if (loginResponse.data && loginResponse.data.session) {
            var session = loginResponse.data.session;
            return {
                method: 'session', session: session,
                getHeaders: function() { return { 'Content-Type': 'application/json', 'Cookie': 'session=' + session }; },
                getUrl: function(ep) { return baseUrl + '/' + ep + '?session=' + session; }
            };
        }
    } catch (e) {
        console.log('[Control iD] Session auth falhou, tentando Basic Auth...', e.message);
    }

    var auth = Buffer.from(user + ':' + password).toString('base64');
    return {
        method: 'basic', session: null,
        getHeaders: function() { return { 'Authorization': 'Basic ' + auth, 'Content-Type': 'application/json' }; },
        getUrl: function(ep) { return baseUrl + '/' + ep; }
    };
}

router.post('/test-connection', authenticateToken, async (req, res) => {
    try {
        var ip = req.body.ip;
        var port = req.body.port || 80;
        var user = req.body.user || 'admin';
        var password = req.body.password || 'admin';
        if (!ip) return res.status(400).json({ success: false, message: 'IP do equipamento é obrigatório' });

        var baseUrl = 'http://' + ip + ':' + port;
        var authSession = await getControlIdSession(baseUrl, user, password);

        var response = await axios.get(authSession.getUrl('system_information.fcgi'), { headers: authSession.getHeaders(), timeout: 10000 });

        if (response.data) {
            var usersCount = 0, recordsCount = 0;
            try {
                var usersResp = await axios.post(authSession.getUrl('user.fcgi') + (authSession.method === 'session' ? '&' : '?') + 'request=count', {}, { headers: authSession.getHeaders(), timeout: 5000 });
                usersCount = (usersResp.data && usersResp.data.count) || 0;
                var logsResp = await axios.post(authSession.getUrl('access_log.fcgi') + (authSession.method === 'session' ? '&' : '?') + 'request=count', {}, { headers: authSession.getHeaders(), timeout: 5000 });
                recordsCount = (logsResp.data && logsResp.data.count) || 0;
            } catch (e) { /* ok */ }

            return res.json({
                success: true,
                device: {
                    model: response.data.product_model || response.data.model || 'Control iD',
                    serial: response.data.serial || response.data.device_id || '-',
                    firmware: response.data.firmware || response.data.version || '-',
                    users: usersCount, records: recordsCount, authMethod: authSession.method
                }
            });
        }
        res.json({ success: false, message: 'Resposta inválida do equipamento' });
    } catch (error) {
        console.error('[Control iD] Erro ao testar conexão:', error.message);
        var msg = 'Não foi possível conectar ao equipamento';
        if (error.code === 'ECONNREFUSED') msg = 'Conexão recusada.';
        else if (error.code === 'ETIMEDOUT') msg = 'Tempo limite excedido.';
        else if (error.response && error.response.status === 401) msg = 'Usuário ou senha incorretos.';
        res.json({ success: false, message: msg });
    }
});

// ==================== EXISTING IMPORT ENDPOINTS ====================

router.post('/import', authenticateToken, async (req, res) => {
    try {
        var ip = req.body.ip, port = req.body.port || 80, user = req.body.user || 'admin';
        var password = req.body.password, dateStart = req.body.dateStart, dateEnd = req.body.dateEnd, employeeId = req.body.employeeId;
        if (!ip || !dateStart || !dateEnd) return res.status(400).json({ success: false, message: 'IP, data início e data fim são obrigatórios' });

        var baseUrl = 'http://' + ip + ':' + port;
        var authSession = await getControlIdSession(baseUrl, user, password);

        var logsResponse = await axios.post(
            authSession.getUrl('access_log.fcgi') + (authSession.method === 'session' ? '&' : '?') + 'request=load',
            {
                initial_date: { day: parseInt(dateStart.split('-')[2]), month: parseInt(dateStart.split('-')[1]), year: parseInt(dateStart.split('-')[0]) },
                final_date: { day: parseInt(dateEnd.split('-')[2]), month: parseInt(dateEnd.split('-')[1]), year: parseInt(dateEnd.split('-')[0]) }
            },
            { headers: authSession.getHeaders(), timeout: 60000 }
        );

        var logs = (logsResponse.data && logsResponse.data.access_logs) || [];
        var usersResponse = await axios.post(authSession.getUrl('user.fcgi') + (authSession.method === 'session' ? '&' : '?') + 'request=load', {}, { headers: authSession.getHeaders(), timeout: 30000 });
        var users = (usersResponse.data && usersResponse.data.users) || [];
        var usersMap = {};
        users.forEach(function(u) { usersMap[u.id] = { name: u.name, pis: u.pis_number || u.registration || '' }; });

        var records = logs.map(function(log) {
            var userData = usersMap[log.user_id] || {};
            var timestamp = new Date(log.time * 1000);
            return { data: timestamp.toISOString().split('T')[0], hora: timestamp.toTimeString().substring(0, 5), nome: userData.name || 'Desconhecido', pis: userData.pis, event: log.event };
        });

        var filteredRecords = records;
        if (employeeId) {
            var [funcionario] = await pool.query('SELECT pis_pasep as pis FROM funcionarios WHERE id = ?', [employeeId]);
            if (funcionario.length > 0 && funcionario[0].pis) {
                filteredRecords = records.filter(function(r) { return r.pis === funcionario[0].pis; });
            }
        }

        var successCount = 0, duplicateCount = 0, errorCount = 0;
        for (var i = 0; i < filteredRecords.length; i++) {
            var rec = filteredRecords[i];
            try {
                var [ex] = await pool.query('SELECT id FROM ponto_marcacoes WHERE pis = ? AND data = ? AND hora = ?', [rec.pis, rec.data, rec.hora]);
                if (ex.length > 0) { duplicateCount++; rec.status = 'warning'; rec.statusText = 'Duplicado'; continue; }
                await pool.query('INSERT INTO ponto_marcacoes (funcionario_id, pis, data, hora, tipo, origem, criado_em) VALUES ((SELECT id FROM funcionarios WHERE pis_pasep = ? LIMIT 1), ?, ?, ?, ?, \'control_id\', NOW())', [rec.pis, rec.pis, rec.data, rec.hora, rec.event || 'marcacao']);
                successCount++; rec.status = 'success'; rec.statusText = 'Importado';
            } catch (err) { errorCount++; rec.status = 'error'; rec.statusText = 'Erro'; }
        }

        try {
            await pool.query('INSERT INTO ponto_importacoes (data_inicio, data_fim, total_registros, registros_sucesso, registros_duplicados, registros_erro, origem, usuario_id, ip_equipamento, status, criado_em) VALUES (?, ?, ?, ?, ?, ?, \'control_id\', ?, ?, \'concluido\', NOW())', [dateStart, dateEnd, filteredRecords.length, successCount, duplicateCount, errorCount, req.user ? req.user.id : null, ip]);
        } catch (e) { /* ok */ }

        res.json({ success: true, summary: { total: filteredRecords.length, success: successCount, duplicates: duplicateCount, errors: errorCount }, records: filteredRecords.slice(0, 100) });
    } catch (error) {
        console.error('[Control iD] Erro na importação:', error.message);
        res.status(500).json({ success: false, message: 'Erro ao importar: ' + error.message });
    }
});

router.post('/ponto/import', authenticateToken, async (req, res) => {
    try {
        var records = req.body.records, dateStart = req.body.dateStart, dateEnd = req.body.dateEnd;
        if (!records || records.length === 0) return res.status(400).json({ success: false, message: 'Nenhum registro para importar' });

        var successCount = 0, duplicateCount = 0, errorCount = 0;
        for (var i = 0; i < records.length; i++) {
            var rec = records[i];
            try {
                var [ex] = await pool.query('SELECT id FROM ponto_marcacoes WHERE pis = ? AND data = ? AND hora = ?', [rec.pis, rec.data, rec.hora]);
                if (ex.length > 0) { duplicateCount++; rec.status = 'warning'; rec.statusText = 'Duplicado'; continue; }
                var [func] = await pool.query('SELECT id, nome_completo FROM funcionarios WHERE pis_pasep = ?', [rec.pis]);
                var funcId = func.length > 0 ? func[0].id : null;
                rec.nome = func.length > 0 ? func[0].nome_completo : rec.nome || 'Não identificado';
                await pool.query('INSERT INTO ponto_marcacoes (funcionario_id, pis, data, hora, tipo, origem, criado_em) VALUES (?, ?, ?, ?, \'marcacao\', \'arquivo\', NOW())', [funcId, rec.pis, rec.data, rec.hora]);
                successCount++; rec.status = 'success'; rec.statusText = 'Importado';
            } catch (err) { errorCount++; rec.status = 'error'; rec.statusText = 'Erro'; }
        }

        try {
            await pool.query('INSERT INTO ponto_importacoes (data_inicio, data_fim, total_registros, registros_sucesso, registros_duplicados, registros_erro, origem, usuario_id, status, criado_em) VALUES (?, ?, ?, ?, ?, ?, \'arquivo_afd\', ?, \'concluido\', NOW())', [dateStart || null, dateEnd || null, records.length, successCount, duplicateCount, errorCount, req.user ? req.user.id : null]);
        } catch (e) { /* ok */ }

        res.json({ success: true, summary: { total: records.length, success: successCount, duplicates: duplicateCount, errors: errorCount }, records: records.slice(0, 100) });
    } catch (error) {
        console.error('[Control iD] Erro na importação de arquivo:', error.message);
        res.status(500).json({ success: false, message: 'Erro ao importar: ' + error.message });
    }
});

// ==================== HISTÓRICO ====================

router.get('/importacoes', authenticateToken, async (req, res) => {
    try {
        var limite = parseInt(req.query.limite || 50);
        const [importacoes] = await pool.query(
            'SELECT pi.id, pi.origem as tipo, pi.data_inicio as periodo_inicio, pi.data_fim as periodo_fim, pi.total_registros, pi.registros_sucesso as importados, pi.registros_duplicados as duplicados, pi.registros_erro as erros, pi.ip_equipamento, pi.status, pi.criado_em, COALESCE(u.nome, u.nome_completo, \'Sistema\') as usuario_nome FROM ponto_importacoes pi LEFT JOIN usuarios u ON pi.usuario_id = u.id ORDER BY pi.criado_em DESC LIMIT ?',
            [limite]
        );
        res.json({ success: true, importacoes: importacoes });
    } catch (error) {
        console.error('[Control iD] Erro ao buscar importações:', error.message);
        try {
            var lim = parseInt(req.query.limite || 50);
            const [importacoes] = await pool.query('SELECT * FROM ponto_importacoes ORDER BY criado_em DESC LIMIT ?', [lim]);
            res.json({ success: true, importacoes: importacoes });
        } catch (e2) {
            res.status(500).json({ success: false, message: error.message });
        }
    }
});

module.exports = router;
