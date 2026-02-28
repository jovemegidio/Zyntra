// Script para instalar o schema do banco de dados
require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

async function installDatabase() {
  let connection;
  
  try {
    console.log('🔌 Conectando ao MySQL...');
    
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      multipleStatements: true
    });
    
    console.log('✅ Conectado com sucesso!');
    
    // Criar banco de dados se não existir
    console.log(`📦 Criando banco de dados ${process.env.DB_NAME}...`);
    await connection.query(`CREATE DATABASE IF NOT EXISTS ${process.env.DB_NAME} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    console.log('✅ Banco de dados criado/verificado!');
    
    // Selecionar o banco
    await connection.query(`USE ${process.env.DB_NAME}`);
    
    // Ler e executar o schema
    console.log('📝 Lendo arquivo schema.sql...');
    const schemaPath = path.join(__dirname, 'database', 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    
    console.log('🔨 Criando tabelas...');
    await connection.query(schema);
    
    console.log('✅ Tabelas criadas com sucesso!');
    
    // Verificar tabelas criadas
    const [tables] = await connection.query('SHOW TABLES');
    console.log(`📊 Tabelas criadas (${tables.length}):`);
    tables.forEach(table => {
      const tableName = Object.values(table)[0];
      console.log(`   ✓ ${tableName}`);
    });
    
    console.log('🎉 Instalação do banco de dados concluída com sucesso!');
    
  } catch (error) {
    console.error('❌ Erro durante a instalação:', error.message);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

installDatabase();
