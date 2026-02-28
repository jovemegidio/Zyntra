// Arquivo: resetar_todas_senhas.js
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const saltRounds = 10;

// Pega a nova senha padrão dos argumentos da linha de comando
const args = process.argv.slice(2);
if (args.length < 1) {
    console.error("\x1b[31m%s\x1b[0m", "ERRO: Você precisa fornecer a nova senha padrão."); // Mensagem em vermelho
    console.log("\x1b[33m%s\x1b[0m", "Exemplo de uso: node resetar_todas_senhas.js novasenha@2025"); // Mensagem em amarelo
    process.exit(1);
}

const newStandardPassword = args[0];

// Configure com os dados do seu banco
const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '@dminalu', // Sua senha do MySQL
    database: 'aluforce_vendas'
});

async function resetAllPasswords() {
    let connection;
    try {
        connection = await pool.getConnection();
        console.log("Conectado ao banco de dados para resetar todas as senhas.");

        // 1. Busca todos os usuários
        const [users] = await connection.query("SELECT id, email FROM usuarios");

        if (users.length === 0) {
            console.log("Nenhum usuário encontrado no banco de dados.");
            return;
        }

        console.log(`Iniciando a atualização de senha para ${users.length} usuário(s)...`);
        console.log(`Todos receberão a nova senha padrão: "${newStandardPassword}"`);

        // 2. Gera o hash da nova senha padrão (apenas uma vez)
        const hashedPassword = await bcrypt.hash(newStandardPassword, saltRounds);

        // 3. Para cada usuário, atualiza a senha no banco com o mesmo hash
        for (const user of users) {
            await connection.query(
                "UPDATE usuarios SET senha = ? WHERE id = ?",
                [hashedPassword, user.id]
            );
            console.log(` -> Senha do usuário ${user.email} atualizada.`);
        }

        console.log("\x1b[32m%s\x1b[0m", "🎉 Processo concluído! Todas as senhas foram redefinidas com sucesso.");

    } catch (error) {
        console.error("\x1b[31m%s\x1b[0m", "Ocorreu um erro durante o processo:", error);
    } finally {
        if (connection) connection.release();
        await pool.end();
    }
}

resetAllPasswords();