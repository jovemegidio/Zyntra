#!/usr/bin/env node

/**
 * SCRIPT DE CONFIGURAÇÁO DE PRODUÇÁO - ALUFORCE v2.0
 * Configura automaticamente o ambiente de produção
 */

const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');

class ProductionSetup {
    constructor() {
        this.rootDir = process.cwd();
        this.logsDir = process.env.LOGS_DIR || './logs';
        this.backupDir = process.env.BACKUP_DIR || './backups';
        this.tempDir = process.env.TEMP_DIR || './temp_excel';
        this.templateDir = process.env.EXCEL_TEMPLATE_DIR || './modules/PCP';
    }

    async setup() {
        console.log('🚀 CONFIGURANDO AMBIENTE DE PRODUÇÁO - ALUFORCE v2.0');
        console.log('================================================');

        try {
            await this.createDirectories();
            await this.setupDatabase();
            await this.setupLogs();
            await this.setupBackups();
            await this.setupTemplates();
            await this.setupPermissions();
            await this.setupHealthCheck();
            await this.validateSetup();
            
            console.log('✅ CONFIGURAÇÁO DE PRODUÇÁO CONCLUÍDA COM SUCESSO!');
            console.log('🎯 Sistema pronto para deploy em produção');
            
        } catch (error) {
            console.error('❌ Erro na configuração:', error.message);
            process.exit(1);
        }
    }

    async createDirectories() {
        console.log('📁 Criando estrutura de diretórios...');
        
        const dirs = [
            this.logsDir,
            this.backupDir,
            this.tempDir,
            path.join(this.rootDir, 'uploads'),
            path.join(this.rootDir, 'reports'),
            path.join(this.rootDir, 'cache'),
            path.join(this.rootDir, 'monitoring')
        ];

        for (const dir of dirs) {
            try {
                await fs.mkdir(dir, { recursive: true });
                console.log(`   ✅ ${dir}`);
            } catch (error) {
                console.log(`   ⚠️  ${dir} (já existe)`);
            }
        }
    }

    async setupDatabase() {
        console.log('🗃️  Configurando banco de dados...');
        
        try {
            // Verificar conectividade do banco
            const mysql = require('mysql2/promise');
            const connection = await mysql.createConnection({
                host: process.env.DB_HOST || 'localhost',
                port: process.env.DB_PORT || 3306,
                user: process.env.DB_USER || 'root',
                password: process.env.DB_PASSWORD
            });

            console.log('   ✅ Conexão com banco estabelecida');
            
            // Criar banco se não existir
            await connection.execute(`CREATE DATABASE IF NOT EXISTS ${process.env.DB_NAME}`);
            console.log(`   ✅ Banco ${process.env.DB_NAME} verificado/criado`);
            
            await connection.end();
            
        } catch (error) {
            console.log(`   ⚠️  Erro na configuração do banco: ${error.message}`);
        }
    }

    async setupLogs() {
        console.log('📋 Configurando sistema de logs...');
        
        const logConfig = {
            level: process.env.LOG_LEVEL || 'info',
            maxSize: process.env.LOG_MAX_SIZE || '100MB',
            maxFiles: process.env.LOG_MAX_FILES || 10,
            compress: process.env.LOG_COMPRESS === 'true'
        };

        await fs.writeFile(
            path.join(this.logsDir, 'config.json'),
            JSON.stringify(logConfig, null, 2)
        );

        console.log('   ✅ Configuração de logs criada');
        console.log(`   📊 Nível: ${logConfig.level}`);
        console.log(`   📦 Tamanho máximo: ${logConfig.maxSize}`);
        console.log(`   🗂️  Arquivos máximos: ${logConfig.maxFiles}`);
    }

    async setupBackups() {
        console.log('💾 Configurando sistema de backup...');
        
        const backupScript = `#!/bin/bash
# Script de backup automático - ALUFORCE v2.0
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${this.backupDir}/backup_aluforce_$DATE.sql"

# Backup do banco de dados
mysqldump -u ${process.env.DB_USER} -p${process.env.DB_PASSWORD} ${process.env.DB_NAME} > $BACKUP_FILE

# Compressão do backup
gzip $BACKUP_FILE

# Limpeza de backups antigos (manter apenas os últimos 30 dias)
find ${this.backupDir} -name "backup_aluforce_*.sql.gz" -mtime +30 -delete

echo "Backup concluído: $BACKUP_FILE.gz"
`;

        await fs.writeFile(
            path.join(this.backupDir, 'backup.sh'),
            backupScript
        );

        console.log('   ✅ Script de backup criado');
        console.log(`   📅 Retenção: ${process.env.BACKUP_RETENTION_DAYS || 30} dias`);
    }

    async setupTemplates() {
        console.log('📊 Validando templates Excel...');
        
        const templatePath = path.join(this.templateDir, 'Ordem de Produção.xlsx');
        
        try {
            await fs.access(templatePath);
            const stats = await fs.stat(templatePath);
            console.log(`   ✅ Template principal: ${stats.size} bytes`);
            
            // Criar backup do template
            const backupPath = path.join(this.templateDir, 'Ordem de Produção.backup.xlsx');
            await fs.copyFile(templatePath, backupPath);
            console.log('   ✅ Backup do template criado');
            
        } catch (error) {
            console.log(`   ❌ Template não encontrado: ${templatePath}`);
            throw new Error('Template Excel obrigatório não encontrado');
        }
    }

    async setupPermissions() {
        console.log('🔐 Configurando permissões...');
        
        if (process.platform !== 'win32') {
            try {
                execSync(`chmod 755 ${this.backupDir}/backup.sh`);
                execSync(`chmod 755 ${this.rootDir}/scripts/*.js`);
                console.log('   ✅ Permissões de execução configuradas');
            } catch (error) {
                console.log('   ⚠️  Erro ao configurar permissões:', error.message);
            }
        } else {
            console.log('   ✅ Sistema Windows - permissões não aplicáveis');
        }
    }

    async setupHealthCheck() {
        console.log('🏥 Configurando health check...');
        
        const healthCheckScript = `
const http = require('http');

function healthCheck() {
    const options = {
        hostname: 'localhost',
        port: ${process.env.PORT || 3000},
        path: '/health',
        method: 'GET',
        timeout: 5000
    };

    const req = http.request(options, (res) => {
        if (res.statusCode === 200) {
            console.log('✅ Health check OK');
        } else {
            console.log(\`❌ Health check falhou: \${res.statusCode}\`);
            process.exit(1);
        }
    });

    req.on('timeout', () => {
        console.log('❌ Health check timeout');
        process.exit(1);
    });

    req.on('error', (error) => {
        console.log(\`❌ Health check erro: \${error.message}\`);
        process.exit(1);
    });

    req.end();
}

healthCheck();
`;

        await fs.writeFile(
            path.join(this.rootDir, 'scripts', 'health-check.js'),
            healthCheckScript
        );

        console.log('   ✅ Script de health check criado');
    }

    async validateSetup() {
        console.log('🔍 Validando configuração...');
        
        const validations = [
            { name: 'Logs directory', check: () => fs.access(this.logsDir) },
            { name: 'Backup directory', check: () => fs.access(this.backupDir) },
            { name: 'Temp directory', check: () => fs.access(this.tempDir) },
            { name: 'Template Excel', check: () => fs.access(path.join(this.templateDir, 'Ordem de Produção.xlsx')) },
            { name: 'Server.js', check: () => fs.access(path.join(this.rootDir, 'server.js')) },
            { name: 'Package.json', check: () => fs.access(path.join(this.rootDir, 'package.json')) }
        ];

        for (const validation of validations) {
            try {
                await validation.check();
                console.log(`   ✅ ${validation.name}`);
            } catch (error) {
                console.log(`   ❌ ${validation.name}: ${error.message}`);
                throw new Error(`Validação falhou: ${validation.name}`);
            }
        }
    }
}

// Executar se chamado diretamente
if (require.main === module) {
    const setup = new ProductionSetup();
    setup.setup();
}

module.exports = ProductionSetup;