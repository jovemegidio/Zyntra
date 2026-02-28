/**
 * Script de Limpeza de Credenciais
 * Remove senhas hardcoded de scripts auxiliares
 * 
 * Executar: node scripts/cleanup-credentials.js
 */

const fs = require('fs');
const path = require('path');

// Padrões de credenciais para remover/substituir
const credentialPatterns = [
    // Senhas literais
    { pattern: /password:\s*['"]aluvendas01['"]/gi, replacement: "password: process.env.TEST_PASSWORD || 'CONFIGURE_ENV'" },
    { pattern: /password:\s*['"]admin123['"]/gi, replacement: "password: process.env.TEST_PASSWORD || 'CONFIGURE_ENV'" },
    { pattern: /password:\s*['"]aluvendasforce01['"]/gi, replacement: "password: process.env.TEST_PASSWORD || 'CONFIGURE_ENV'" },
    
    // DB passwords hardcoded
    { pattern: /password:\s*['"]aluvendas01['"],\s*database/gi, replacement: "password: process.env.DB_PASSWORD, database" },
    
    // Emails de teste com senhas
    { pattern: /email:\s*['"]simplesadmin@aluforce\.ind\.br['"],\s*password:\s*['"]admin123['"]/gi, 
      replacement: "email: process.env.TEST_ADMIN_EMAIL || 'test@example.com', password: process.env.TEST_PASSWORD || 'CONFIGURE_ENV'" },
];

// Diretórios para verificar
const dirsToCheck = [
    'scripts',
    'scripts_auxiliares',
    'tests',
];

// Arquivos para pular (backups, node_modules, etc)
const skipPatterns = [
    /node_modules/,
    /backups/,
    /\.git/,
    /\.min\.js$/,
];

function shouldSkip(filePath) {
    return skipPatterns.some(pattern => pattern.test(filePath));
}

function scanDirectory(dir, results = []) {
    if (!fs.existsSync(dir)) return results;
    
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (shouldSkip(fullPath)) continue;
        
        if (entry.isDirectory()) {
            scanDirectory(fullPath, results);
        } else if (entry.name.endsWith('.js')) {
            results.push(fullPath);
        }
    }
    
    return results;
}

function checkFileForCredentials(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const findings = [];
    
    for (const { pattern } of credentialPatterns) {
        const matches = content.match(pattern);
        if (matches) {
            findings.push({
                file: filePath,
                pattern: pattern.toString(),
                matches: matches.length,
                examples: matches.slice(0, 2)
            });
        }
    }
    
    return findings;
}

function cleanFile(filePath, dryRun = true) {
    let content = fs.readFileSync(filePath, 'utf8');
    let changed = false;
    
    for (const { pattern, replacement } of credentialPatterns) {
        if (pattern.test(content)) {
            content = content.replace(pattern, replacement);
            changed = true;
        }
    }
    
    if (changed && !dryRun) {
        fs.writeFileSync(filePath, content, 'utf8');
    }
    
    return changed;
}

async function main() {
    console.log('🔍 SCANNER DE CREDENCIAIS HARDCODED');
    console.log('═'.repeat(60));
    
    const rootDir = path.resolve(__dirname, '..');
    const allFiles = [];
    
    // Coletar arquivos
    for (const dir of dirsToCheck) {
        const fullDir = path.join(rootDir, dir);
        scanDirectory(fullDir, allFiles);
    }
    
    console.log(`\n📁 Verificando ${allFiles.length} arquivos JavaScript...`);
    
    // Verificar cada arquivo
    const allFindings = [];
    for (const file of allFiles) {
        const findings = checkFileForCredentials(file);
        if (findings.length > 0) {
            allFindings.push(...findings);
        }
    }
    
    // Relatório
    if (allFindings.length === 0) {
        console.log('\n✅ Nenhuma credencial hardcoded encontrada!');
        return;
    }
    
    console.log(`\n⚠️  ENCONTRADAS ${allFindings.length} ocorrências de credenciais:\n`);
    
    const filesAffected = new Set();
    for (const finding of allFindings) {
        filesAffected.add(finding.file);
        const relativePath = path.relative(rootDir, finding.file);
        console.log(`📄 ${relativePath}`);
        console.log(`   Padrão: ${finding.pattern}`);
        console.log(`   Ocorrências: ${finding.matches}`);
        console.log(`   Exemplo: ${finding.examples[0]?.substring(0, 80)}...`);
        console.log('');
    }
    
    console.log('─'.repeat(60));
    console.log(`\n📊 RESUMO:`);
    console.log(`   Arquivos afetados: ${filesAffected.size}`);
    console.log(`   Total de ocorrências: ${allFindings.length}`);
    
    // Perguntar se deseja limpar
    const args = process.argv.slice(2);
    const shouldClean = args.includes('--fix') || args.includes('--clean');
    
    if (shouldClean) {
        console.log('\n🧹 LIMPANDO CREDENCIAIS...');
        
        let cleaned = 0;
        for (const file of filesAffected) {
            if (cleanFile(file, false)) {
                const relativePath = path.relative(rootDir, file);
                console.log(`   ✅ ${relativePath}`);
                cleaned++;
            }
        }
        
        console.log(`\n✅ ${cleaned} arquivos limpos!`);
        console.log('\n📝 IMPORTANTE:');
        console.log('   1. Configure as variáveis de ambiente no .env:');
        console.log('      TEST_PASSWORD=sua_senha_de_teste');
        console.log('      TEST_ADMIN_EMAIL=email_admin_teste@aluforce.ind.br');
        console.log('   2. Verifique os arquivos modificados antes de commitar');
    } else {
        console.log('\n💡 Para limpar automaticamente, execute:');
        console.log('   node scripts/cleanup-credentials.js --fix');
    }
}

main().catch(console.error);
