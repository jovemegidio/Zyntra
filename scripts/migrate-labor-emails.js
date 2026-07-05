/**
 * Migração: unificar emails das duas instâncias Labor sob @labor.com.br
 *
 * O que faz:
 *   1. labor_eletric_vendas.usuarios: emails *@laboreletric.com.br → *@labor.com.br
 *   2. labor_energy_vendas.usuarios:  emails *@energy.com.br       → *@labor.com.br
 *   3. Reseta senha de TODOS os usuários ativos das duas bases para "alu0103"
 *   4. Limpa contagem de tentativas e desbloqueia contas
 *
 * Como rodar (na VPS, /var/www/aluforce):
 *   DB_HOST=localhost DB_USER=aluforce DB_PASS='<senha>' \
 *     node scripts/migrate-labor-emails.js
 *
 * Para um dry-run (mostra o que faria sem alterar):
 *   DRY_RUN=1 DB_HOST=... node scripts/migrate-labor-emails.js
 */
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');

const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_USER = process.env.DB_USER || 'aluforce';
const DB_PASS = process.env.DB_PASS;
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const NEW_PASSWORD = 'alu0103';

if (!DB_PASS) {
    console.error('ERRO: variável de ambiente DB_PASS não definida.');
    console.error('Uso: DB_HOST=localhost DB_USER=aluforce DB_PASS=<senha> node scripts/migrate-labor-emails.js');
    process.exit(1);
}

const TARGETS = [
    { db: 'labor_eletric_vendas', oldDomain: '@laboreletric.com.br' },
    { db: 'labor_energy_vendas',  oldDomain: '@energy.com.br' },
];

async function run() {
    const pool = mysql.createPool({
        host: DB_HOST,
        user: DB_USER,
        password: DB_PASS,
        connectionLimit: 4,
    });

    console.log(`\n=== Migração Labor → @labor.com.br ===`);
    console.log(`Modo: ${DRY_RUN ? 'DRY-RUN (nada será alterado)' : 'EXECUÇÃO REAL'}`);
    console.log(`Senha nova: ${NEW_PASSWORD}\n`);

    const hash = await bcrypt.hash(NEW_PASSWORD, 10);

    for (const { db, oldDomain } of TARGETS) {
        try {
            // 1) Preview: quantos usuários têm o domínio antigo
            const [previewRows] = await pool.query(
                `SELECT id, email FROM ${db}.usuarios WHERE email LIKE ? AND ativo=1`,
                [`%${oldDomain}`]
            );
            console.log(`\n[${db}] ${previewRows.length} usuário(s) com ${oldDomain}:`);
            previewRows.slice(0, 10).forEach(u => {
                const newEmail = u.email.replace(oldDomain, '@labor.com.br');
                console.log(`   ${u.email}  →  ${newEmail}`);
            });
            if (previewRows.length > 10) console.log(`   ... e mais ${previewRows.length - 10}.`);

            if (DRY_RUN) continue;

            // 2) Renomeia emails
            const [rEmail] = await pool.query(
                `UPDATE ${db}.usuarios
                    SET email = REPLACE(email, ?, '@labor.com.br')
                  WHERE email LIKE ? AND ativo=1`,
                [oldDomain, `%${oldDomain}`]
            );
            console.log(`[${db}] emails renomeados: ${rEmail.affectedRows}`);

            // 3) Reseta senha + destrava todos os usuários ativos
            const [rPwd] = await pool.query(
                `UPDATE ${db}.usuarios
                    SET senha_hash=?, password_hash=?,
                        login_attempts=0, locked_until=NULL
                  WHERE ativo=1`,
                [hash, hash]
            );
            console.log(`[${db}] senhas redefinidas: ${rPwd.affectedRows}`);
        } catch (err) {
            console.error(`[${db}] FALHOU:`, err.message);
        }
    }

    await pool.end();
    console.log(`\n=== Concluído ===`);
}

run().catch(e => { console.error('FATAL:', e); process.exit(1); });
