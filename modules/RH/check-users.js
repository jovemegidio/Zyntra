const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database('./database.db', (err) => {
    if (err) {
        console.error('Erro ao conectar ao banco:', err.message);
        return;
    }
    console.log('Conectado ao banco SQLite');
});

// Verificar usuários existentes e seus roles
db.all('SELECT id, nome_completo, email, role FROM funcionarios LIMIT 10', (err, rows) => {
    if (err) {
        console.error('Erro ao consultar funcionários:', err.message);
        return;
    }
    
    console.log('=== FUNCIONÁRIOS NO BANCO ===');
    rows.forEach(row => {
        console.log(`ID: ${row.id}, Nome: ${row.nome_completo || 'N/A'}, Email: ${row.email}, Role: ${row.role || 'N/A'}`);
    });
    
    db.close((err) => {
        if (err) {
            console.error('Erro ao fechar banco:', err.message);
        }
        console.log('Conexão fechada.');
    });
});