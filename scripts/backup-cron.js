/**
 * ALUFORCE ERP — Automated Database Backup (Cron)
 * 
 * Runs daily mysqldump, compresses with gzip, retains N days, and
 * logs success/failure to the application log directory.
 * 
 * Usage:
 *   - Standalone: node scripts/backup-cron.js
 *   - PM2:        pm2 start scripts/backup-cron.js --name aluforce-backup
 *   - Import:     require('./scripts/backup-cron').startBackupSchedule()
 * 
 * Environment Variables:
 *   DB_HOST, DB_USER, DB_PASSWORD, DB_NAME  — MySQL credentials
 *   BACKUP_CRON       — cron expression (default: '0 2 * * *' = 2 AM daily)
 *   BACKUP_RETAIN_DAYS — days to keep old backups (default: 30)
 *   BACKUP_DIR         — output directory (default: ./backups/automated)
 * 
 * @module scripts/backup-cron
 */

'use strict';

const cron = require('node-cron');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// ── Configuration ──────────────────────────────────────────────
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const CONFIG = {
    db: {
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        name: process.env.DB_NAME || 'aluforce_db',
        port: process.env.DB_PORT || 3306,
    },
    cron: process.env.BACKUP_CRON || '0 2 * * *',         // 2 AM daily
    retainDays: parseInt(process.env.BACKUP_RETAIN_DAYS) || 30,
    backupDir: process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups', 'automated'),
    logDir: path.join(__dirname, '..', 'logs'),
};

// ── Helpers ────────────────────────────────────────────────────
function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function log(level, message) {
    const ts = new Date().toISOString();
    const line = `[${ts}] [BACKUP] [${level}] ${message}`;
    console.log(line);

    try {
        ensureDir(CONFIG.logDir);
        const logFile = path.join(CONFIG.logDir, 'backup.log');
        fs.appendFileSync(logFile, line + '\n');
    } catch (_) { /* silent */ }
}

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Backup Execution ───────────────────────────────────────────
function runBackup() {
    const start = Date.now();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `${CONFIG.db.name}_${timestamp}.sql.gz`;
    const filepath = path.join(CONFIG.backupDir, filename);

    ensureDir(CONFIG.backupDir);

    log('INFO', `Starting backup: ${CONFIG.db.name}@${CONFIG.db.host}:${CONFIG.db.port}`);

    try {
        // Build mysqldump command with best practices
        const dumpCmd = [
            'mysqldump',
            `--host=${CONFIG.db.host}`,
            `--port=${CONFIG.db.port}`,
            `--user=${CONFIG.db.user}`,
            CONFIG.db.password ? `--password=${CONFIG.db.password}` : '',
            '--single-transaction',       // Consistent snapshot for InnoDB
            '--routines',                  // Include stored procedures/functions
            '--triggers',                  // Include triggers
            '--events',                    // Include events
            '--set-gtid-purged=OFF',       // Avoid GTID issues on restore
            '--column-statistics=0',       // Compatibility
            '--quick',                     // Stream large tables
            '--compress',                  // Compress protocol
            CONFIG.db.name,
        ].filter(Boolean).join(' ');

        // Determine compression command (prefer gzip)
        const isWindows = process.platform === 'win32';
        const compressCmd = isWindows
            ? `${dumpCmd} > "${filepath.replace('.gz', '')}"`
            : `${dumpCmd} | gzip > "${filepath}"`;

        execSync(compressCmd, {
            timeout: 600000,  // 10 min timeout
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, MYSQL_PWD: CONFIG.db.password },
        });

        // On Windows, compress separately
        if (isWindows) {
            const rawFile = filepath.replace('.gz', '');
            if (fs.existsSync(rawFile)) {
                try {
                    execSync(`powershell -Command "Compress-Archive -Path '${rawFile}' -DestinationPath '${rawFile}.zip' -Force"`, { timeout: 120000 });
                    fs.unlinkSync(rawFile);
                    log('INFO', `Compressed with PowerShell: ${rawFile}.zip`);
                } catch (_) {
                    log('WARN', 'Could not compress backup (gzip/powershell not available). Raw SQL kept.');
                }
            }
        }

        // Get file size
        const actualFile = fs.existsSync(filepath) ? filepath : filepath.replace('.gz', '');
        const stats = fs.existsSync(actualFile) ? fs.statSync(actualFile) : null;
        const size = stats ? formatBytes(stats.size) : 'unknown';
        const durationSec = ((Date.now() - start) / 1000).toFixed(1);

        log('INFO', `✅ Backup complete: ${filename} (${size}) in ${durationSec}s`);

        // Cleanup old backups
        cleanupOldBackups();

        return { success: true, file: filename, size, duration: durationSec };
    } catch (err) {
        const durationSec = ((Date.now() - start) / 1000).toFixed(1);
        log('ERROR', `❌ Backup failed after ${durationSec}s: ${err.message}`);
        return { success: false, error: err.message, duration: durationSec };
    }
}

// ── Cleanup Old Backups ────────────────────────────────────────
function cleanupOldBackups() {
    try {
        const files = fs.readdirSync(CONFIG.backupDir);
        const now = Date.now();
        const maxAgeMs = CONFIG.retainDays * 24 * 60 * 60 * 1000;
        let removed = 0;

        for (const file of files) {
            if (!file.startsWith(CONFIG.db.name)) continue;
            const filepath = path.join(CONFIG.backupDir, file);
            const stat = fs.statSync(filepath);

            if ((now - stat.mtimeMs) > maxAgeMs) {
                fs.unlinkSync(filepath);
                removed++;
                log('INFO', `🗑️ Removed old backup: ${file} (age > ${CONFIG.retainDays}d)`);
            }
        }

        if (removed > 0) {
            log('INFO', `🗑️ Cleanup: removed ${removed} old backup(s)`);
        }
    } catch (err) {
        log('WARN', `Cleanup error: ${err.message}`);
    }
}

// ── Schedule ───────────────────────────────────────────────────
function startBackupSchedule() {
    if (!cron.validate(CONFIG.cron)) {
        log('ERROR', `Invalid cron expression: ${CONFIG.cron}`);
        return null;
    }

    log('INFO', `📅 Backup schedule started: "${CONFIG.cron}" (retain ${CONFIG.retainDays} days)`);
    log('INFO', `📂 Backup directory: ${CONFIG.backupDir}`);
    log('INFO', `🎯 Database: ${CONFIG.db.name}@${CONFIG.db.host}:${CONFIG.db.port}`);

    const task = cron.schedule(CONFIG.cron, () => {
        log('INFO', '⏰ Cron triggered — starting scheduled backup...');
        runBackup();
    }, {
        timezone: 'America/Sao_Paulo',
    });

    return task;
}

// ── Exports ────────────────────────────────────────────────────
module.exports = { startBackupSchedule, runBackup, cleanupOldBackups };

// ── Standalone Execution ───────────────────────────────────────
if (require.main === module) {
    const args = process.argv.slice(2);

    if (args.includes('--now') || args.includes('--run')) {
        // Run backup immediately
        log('INFO', '🚀 Running backup NOW (manual trigger)...');
        const result = runBackup();
        process.exit(result.success ? 0 : 1);
    } else {
        // Start cron scheduler
        startBackupSchedule();
        log('INFO', '🔄 Backup daemon running. Press Ctrl+C to stop.');
    }
}
