/**
 * API DE BACKUP - ALUFORCE V.2
 * Gerenciamento de backups do sistema
 */

const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');

let pool;
let authenticateToken;

const BACKUP_DIR = path.join(__dirname, '..', 'backups');

/**
 * GET /api/backup/listar
 * Lista backups existentes
 */
router.get('/listar', async (req, res) => {
    try {
        // Garantir que diretório existe
        try {
            await fs.access(BACKUP_DIR);
        } catch {
            await fs.mkdir(BACKUP_DIR, { recursive: true });
        }

        const files = await fs.readdir(BACKUP_DIR);
        const backups = [];

        for (const file of files) {
            if (file.endsWith('.sql') || file.endsWith('.json')) {
                const stat = await fs.stat(path.join(BACKUP_DIR, file));
                backups.push({
                    nome: file,
                    tamanho: stat.size,
                    tamanho_formatado: formatSize(stat.size),
                    data: stat.mtime,
                    tipo: file.endsWith('.sql') ? 'SQL' : 'JSON'
                });
            }
        }

        // Ordenar por data (mais recente primeiro)
        backups.sort((a, b) => new Date(b.data) - new Date(a.data));

        res.json({ success: true, data: backups });
    } catch (error) {
        console.error('[BACKUP] Erro ao listar backups:', error);
        res.status(500).json({ success: false, error: 'Erro ao listar backups' });
    }
});

/**
 * POST /api/backup/criar
 * Cria um novo backup
 */
router.post('/criar', async (req, res) => {
    try {
        const { tabelas, tipo = 'json', descricao } = req.body;

        // Garantir que diretório existe
        try {
            await fs.access(BACKUP_DIR);
        } catch {
            await fs.mkdir(BACKUP_DIR, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filename = `backup_${timestamp}.${tipo}`;
        const filepath = path.join(BACKUP_DIR, filename);

        if (tipo === 'json') {
            const backup = {
                created_at: new Date().toISOString(),
                descricao: descricao || 'Backup automático',
                tabelas: {}
            };

            // Listar tabelas para backup
            let tabelasParaBackup = tabelas;
            if (!tabelasParaBackup || tabelasParaBackup.length === 0) {
                const [rows] = await pool.query('SHOW TABLES');
                tabelasParaBackup = rows.map(r => Object.values(r)[0]);
            }

            // Fazer backup de cada tabela
            for (const tabela of tabelasParaBackup) {
                try {
                    const [dados] = await pool.query(`SELECT * FROM \`${tabela}\``);
                    backup.tabelas[tabela] = dados;
                } catch (err) {
                    console.warn(`[BACKUP] Náo foi possível fazer backup de ${tabela}:`, err.message);
                }
            }

            await fs.writeFile(filepath, JSON.stringify(backup, null, 2), 'utf8');
        } else {
            // Backup SQL simples
            let sql = `-- Backup ALUFORCE\n-- Data: ${new Date().toISOString()}\n\n`;
            
            const [rows] = await pool.query('SHOW TABLES');
            const tabelasList = rows.map(r => Object.values(r)[0]);

            for (const tabela of tabelasList) {
                try {
                    const [dados] = await pool.query(`SELECT * FROM \`${tabela}\``);
                    if (dados.length > 0) {
                        sql += `\n-- Tabela: ${tabela}\n`;
                        for (const row of dados) {
                            const cols = Object.keys(row).map(k => `\`${k}\``).join(', ');
                            const vals = Object.values(row).map(v => {
                                if (v === null) return 'NULL';
                                if (typeof v === 'number') return v;
                                return `'${String(v).replace(/'/g, "''")}'`;
                            }).join(', ');
                            sql += `INSERT INTO \`${tabela}\` (${cols}) VALUES (${vals});\n`;
                        }
                    }
                } catch (err) {
                    sql += `-- Erro ao exportar ${tabela}: ${err.message}\n`;
                }
            }

            await fs.writeFile(filepath, sql, 'utf8');
        }

        // Registrar backup no histórico
        await registrarHistorico(pool, 'criar', filename, descricao);

        const stat = await fs.stat(filepath);
        res.json({ 
            success: true, 
            message: 'Backup criado com sucesso',
            data: {
                nome: filename,
                tamanho: stat.size,
                tamanho_formatado: formatSize(stat.size)
            }
        });
    } catch (error) {
        console.error('[BACKUP] Erro ao criar backup:', error);
        res.status(500).json({ success: false, error: 'Erro ao criar backup' });
    }
});

/**
 * DELETE /api/backup/:nome
 * Remove um backup
 */
router.delete('/:nome', async (req, res) => {
    try {
        const { nome } = req.params;
        const filepath = path.join(BACKUP_DIR, nome);

        // Validar que está no diretório correto
        if (!filepath.startsWith(BACKUP_DIR)) {
            return res.status(403).json({ success: false, error: 'Acesso negado' });
        }

        await fs.unlink(filepath);
        await registrarHistorico(pool, 'excluir', nome);

        res.json({ success: true, message: 'Backup removido com sucesso' });
    } catch (error) {
        console.error('[BACKUP] Erro ao remover backup:', error);
        res.status(500).json({ success: false, error: 'Erro ao remover backup' });
    }
});

/**
 * GET /api/backup/download/:nome
 * Download de um backup
 */
router.get('/download/:nome', async (req, res) => {
    try {
        const { nome } = req.params;
        const filepath = path.join(BACKUP_DIR, nome);

        // Validar que está no diretório correto
        if (!filepath.startsWith(BACKUP_DIR)) {
            return res.status(403).json({ success: false, error: 'Acesso negado' });
        }

        res.download(filepath, nome);
    } catch (error) {
        console.error('[BACKUP] Erro ao fazer download:', error);
        res.status(500).json({ success: false, error: 'Erro ao fazer download' });
    }
});

/**
 * GET /api/backup/historico
 * Histórico de backups
 */
router.get('/historico', async (req, res) => {
    try {
        const [historico] = await pool.query(`
            SELECT * FROM backup_historico 
            ORDER BY created_at DESC 
            LIMIT 100
        `);
        res.json({ success: true, data: historico });
    } catch (error) {
        // Se tabela náo existir, retorna vazio
        res.json({ success: true, data: [] });
    }
});

/**
 * GET /api/backup/estatisticas
 * Estatísticas de backups
 */
router.get('/estatisticas', async (req, res) => {
    try {
        try {
            await fs.access(BACKUP_DIR);
        } catch {
            return res.json({
                success: true,
                data: { total: 0, tamanho_total: 0, ultimo_backup: null }
            });
        }

        const files = await fs.readdir(BACKUP_DIR);
        let tamanhoTotal = 0;
        let ultimoBackup = null;

        for (const file of files) {
            if (file.endsWith('.sql') || file.endsWith('.json')) {
                const stat = await fs.stat(path.join(BACKUP_DIR, file));
                tamanhoTotal += stat.size;
                if (!ultimoBackup || stat.mtime > ultimoBackup) {
                    ultimoBackup = stat.mtime;
                }
            }
        }

        res.json({
            success: true,
            data: {
                total: files.filter(f => f.endsWith('.sql') || f.endsWith('.json')).length,
                tamanho_total: tamanhoTotal,
                tamanho_formatado: formatSize(tamanhoTotal),
                ultimo_backup: ultimoBackup
            }
        });
    } catch (error) {
        console.error('[BACKUP] Erro ao buscar estatísticas:', error);
        res.status(500).json({ success: false, error: 'Erro ao buscar estatísticas' });
    }
});

// Funções auxiliares
function formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

async function registrarHistorico(pool, acao, arquivo, descricao = null) {
    try {
        await pool.query(`
            INSERT INTO backup_historico (acao, arquivo, descricao, created_at)
            VALUES (?, ?, ?, NOW())
        `, [acao, arquivo, descricao]);
    } catch (error) {
        // Ignorar se tabela náo existir
    }
}

// Criar tabela de histórico se náo existir
async function ensureTable() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS backup_historico (
                id INT AUTO_INCREMENT PRIMARY KEY,
                acao VARCHAR(50) NOT NULL,
                arquivo VARCHAR(255),
                descricao TEXT,
                usuario_id INT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('[BACKUP] ✅ Tabela backup_historico verificada/criada');
    } catch (error) {
        console.error('[BACKUP] Erro ao criar tabela:', error.message);
    }
}

module.exports = function(deps) {
    pool = deps.pool;
    authenticateToken = deps.authenticateToken;
    ensureTable();
    return router;
};
