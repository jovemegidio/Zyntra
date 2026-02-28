/**
 * Migração: Criar tabela diario_producao
 * Descrição: Tabela para registro das tarefas diárias dos operadores
 */

const mysql = require('mysql2/promise');

const config = {
    host: 'interchange.proxy.rlwy.net',
    port: 19396,
    user: 'root',
    password: 'iiilOZutDOnPCwxgiTKeMuEaIzSwplcu',
    database: 'railway'
};

async function runMigration() {
    let connection;
    
    try {
        console.log('🔗 Conectando ao banco de dados...');
        connection = await mysql.createConnection(config);
        console.log('✅ Conectado com sucesso!\n');
        
        // Criar tabela diario_producao
        console.log('📝 Criando tabela diario_producao...');
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS diario_producao (
                id INT AUTO_INCREMENT PRIMARY KEY,
                titulo VARCHAR(255) NOT NULL COMMENT 'Título da tarefa',
                descricao TEXT COMMENT 'Descrição detalhada da tarefa',
                data DATE NOT NULL COMMENT 'Data da tarefa',
                operador_id INT COMMENT 'ID do operador responsável',
                hora_inicio TIME COMMENT 'Hora de início da tarefa',
                hora_fim TIME COMMENT 'Hora de término da tarefa',
                status ENUM('pendente', 'em_andamento', 'concluido') DEFAULT 'pendente' COMMENT 'Status da tarefa',
                maquina_id INT COMMENT 'ID da máquina utilizada (opcional)',
                observacoes TEXT COMMENT 'Observações adicionais',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (operador_id) REFERENCES funcionarios(id) ON DELETE SET NULL,
                INDEX idx_data (data),
                INDEX idx_operador (operador_id),
                INDEX idx_status (status),
                INDEX idx_data_status (data, status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            COMMENT='Diário de Produção - Registro de tarefas diárias dos operadores'
        `);
        console.log('✅ Tabela diario_producao criada com sucesso!\n');
        
        // Verificar estrutura da tabela
        console.log('📋 Verificando estrutura da tabela...');
        const [columns] = await connection.execute('DESCRIBE diario_producao');
        console.log('Colunas criadas:');
        columns.forEach(col => {
            console.log(`   - ${col.Field}: ${col.Type} ${col.Null === 'NO' ? 'NOT NULL' : ''} ${col.Default ? `DEFAULT ${col.Default}` : ''}`);
        });
        
        console.log('\n✅ Migração concluída com sucesso!');
        
    } catch (error) {
        console.error('❌ Erro na migração:', error.message);
        process.exit(1);
    } finally {
        if (connection) {
            await connection.end();
            console.log('\n🔌 Conexão encerrada.');
        }
    }
}

runMigration();
