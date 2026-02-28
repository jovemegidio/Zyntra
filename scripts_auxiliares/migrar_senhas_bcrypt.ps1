# ============================================
# SCRIPT DE MIGRAÇÃO DE SENHAS PARA BCRYPT
# Sistema ALUFORCE
# ============================================

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "MIGRAÇÃO DE SENHAS PARA BCRYPT" -ForegroundColor Cyan
Write-Host "Sistema ALUFORCE V2.0" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "⚠️  ATENÇÃO: Este script irá converter todas as senhas" -ForegroundColor Yellow
Write-Host "           em texto plano para hash bcrypt." -ForegroundColor Yellow
Write-Host ""
Write-Host "📝 Tabelas que serão processadas:" -ForegroundColor White
Write-Host "   - usuarios (servidor principal)" -ForegroundColor Gray
Write-Host "   - usuarios_pcp (módulo PCP)" -ForegroundColor Gray
Write-Host "   - usuarios_vendas (módulo Vendas)" -ForegroundColor Gray
Write-Host "   - usuarios_rh (módulo RH)" -ForegroundColor Gray
Write-Host "   - usuarios_financeiro (módulo Financeiro)" -ForegroundColor Gray
Write-Host ""

$confirmacao = Read-Host "Deseja continuar? (S/N)"
if ($confirmacao -ne "S" -and $confirmacao -ne "s") {
    Write-Host "❌ Operação cancelada." -ForegroundColor Red
    exit 0
}

Write-Host ""
Write-Host "🔐 Iniciando migração de senhas..." -ForegroundColor Yellow
Write-Host ""

# Criar script Node.js temporário para executar a migração
$scriptMigracao = @"
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
require('dotenv').config();

async function migrarSenhas() {
    const db = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '@dminalu',
        database: process.env.DB_NAME || 'aluforce_vendas',
        port: process.env.DB_PORT || 3306
    });

    console.log('✅ Conectado ao banco de dados');
    
    const tabelas = ['usuarios', 'usuarios_pcp', 'usuarios_vendas', 'usuarios_rh', 'usuarios_financeiro'];
    let totalMigrados = 0;
    let totalErros = 0;

    for (const tabela of tabelas) {
        try {
            // Verificar se a tabela existe
            const [tabelaExiste] = await db.query(
                \"SELECT COUNT(*) as existe FROM information_schema.tables WHERE table_schema = ? AND table_name = ?\",
                [process.env.DB_NAME || 'aluforce_vendas', tabela]
            );

            if (tabelaExiste[0].existe === 0) {
                console.log(\`⚠️  Tabela \${tabela} não encontrada - pulando...\`);
                continue;
            }

            // Buscar usuários com senhas em texto plano (sem \$2a\$ no início)
            const [usuarios] = await db.query(
                \"SELECT id, email, password FROM ?? WHERE password NOT LIKE '\$2a\$%' AND password NOT LIKE '\$2b\$%'\",
                [tabela]
            );

            if (usuarios.length === 0) {
                console.log(\`✅ \${tabela}: Nenhuma senha para migrar\`);
                continue;
            }

            console.log(\`🔄 \${tabela}: Migrando \${usuarios.length} senha(s)...\`);

            for (const usuario of usuarios) {
                try {
                    // Gerar hash bcrypt da senha atual
                    const hash = await bcrypt.hash(usuario.password, 10);
                    
                    // Atualizar no banco
                    await db.query(
                        \"UPDATE ?? SET password = ? WHERE id = ?\",
                        [tabela, hash, usuario.id]
                    );

                    totalMigrados++;
                    console.log(\`   ✓ \${usuario.email} - senha migrada\`);
                } catch (err) {
                    totalErros++;
                    console.error(\`   ✗ \${usuario.email} - erro: \${err.message}\`);
                }
            }
        } catch (err) {
            console.error(\`❌ Erro ao processar tabela \${tabela}: \${err.message}\`);
            totalErros++;
        }
    }

    await db.end();

    console.log('');
    console.log('========================================');
    console.log(\`✅ Migração concluída!\`);
    console.log(\`   📊 Total migrado: \${totalMigrados} senha(s)\`);
    console.log(\`   ⚠️  Total de erros: \${totalErros}\`);
    console.log('========================================');

    process.exit(totalErros > 0 ? 1 : 0);
}

migrarSenhas().catch(err => {
    console.error('❌ Erro fatal:', err);
    process.exit(1);
});
"@

# Salvar script temporário
$scriptMigracao | Out-File -FilePath "temp_migrar_senhas.js" -Encoding UTF8

# Executar script Node.js
node temp_migrar_senhas.js

# Capturar código de saída
$exitCode = $LASTEXITCODE

# Remover script temporário
Remove-Item "temp_migrar_senhas.js" -ErrorAction SilentlyContinue

Write-Host ""
if ($exitCode -eq 0) {
    Write-Host "✅ Migração concluída com sucesso!" -ForegroundColor Green
    Write-Host ""
    Write-Host "⚠️  IMPORTANTE:" -ForegroundColor Yellow
    Write-Host "   - Todas as senhas agora estão em bcrypt" -ForegroundColor White
    Write-Host "   - Reinicie todos os servidores" -ForegroundColor White
    Write-Host "   - Usuários devem fazer login normalmente" -ForegroundColor White
} else {
    Write-Host "⚠️  Migração concluída com alguns erros." -ForegroundColor Yellow
    Write-Host "   Verifique os logs acima para detalhes." -ForegroundColor Gray
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
