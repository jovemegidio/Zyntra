// Arquivo: definir_nova_senha.js
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const saltRounds = 10;

// Pegando o e-mail e a nova senha dos argumentos da linha de comando
const args = process.argv.slice(2);
if (args.length < 2) {
    console.error("ERRO: Forneça o e-mail e a nova senha como argumentos.");
    console.log("Exemplo: node definir_nova_senha.js seu.email@aluforce.ind.br novaSenha123");
    process.exit(1);
}

const userEmail = args[0];
const newPlainPassword = args[1];

// Configure com os dados do seu banco
const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'nova_senha', // Sua senha do MySQL
    database: 'aluforce_vendas'
});

async function setNewPassword() {
    let connection;
    try {
        console.log(`Iniciando a atualização da senha para o usuário: ${userEmail}`);

        // Gera o hash da nova senha
        const hashedPassword = await bcrypt.hash(newPlainPassword, saltRounds);
        console.log("Hash da nova senha gerado com sucesso.");

        connection = await pool.getConnection();

        // Atualiza a senha no banco de dados
        const [result] = await connection.query(
            "UPDATE usuarios SET senha = ? WHERE email = ?",
            [hashedPassword, userEmail]
        );

        if (result.affectedRows === 0) {
            console.error(`ERRO: Nenhum usuário encontrado com o e-mail: ${userEmail}`);
        } else {
            console.log(`🎉 Senha para ${userEmail} foi atualizada com sucesso no banco de dados!`);
            console.log(`O usuário agora pode fazer login com a senha: ${newPlainPassword}`);
        }

    } catch (error) {
        console.error("Ocorreu um erro ao definir a nova senha:", error);
    } finally {
        if (connection) connection.release();
        await pool.end();
    }
}

setNewPassword();