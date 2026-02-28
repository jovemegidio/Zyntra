// Script para definir senha padrão "admin123" para todos os usuários
const bcrypt = require('bcrypt');
const mysql = require('mysql2');

// Configuração do banco (deve coincidir com o server.js)
const db = mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '@dminalu',
  database: process.env.DB_NAME || 'aluforce_vendas'
});

const SENHA_PADRAO = 'admin123';

async function atualizarSenhasPadrao() {
  try {
    console.log('🔐 Iniciando atualização de senhas padrão...');
    
    // Hash da senha padrão
    const hashSenhaPadrao = await bcrypt.hash(SENHA_PADRAO, 10);
    console.log(`📝 Hash gerado para "${SENHA_PADRAO}": ${hashSenhaPadrao}`);
    
    // Buscar todos os usuários
    db.query('SELECT id, email, nome_completo, role FROM funcionarios', async (err, users) => {
      if (err) {
        console.error('❌ Erro ao buscar usuários:', err);
        return;
      }
      
      console.log(`👥 Encontrados ${users.length} usuários`);
      
      // Atualizar senha de cada usuário
      const updatePromises = users.map(user => {
        return new Promise((resolve, reject) => {
          db.query(
            'UPDATE funcionarios SET senha = ? WHERE id = ?',
            [hashSenhaPadrao, user.id],
            (updateErr) => {
              if (updateErr) {
                console.error(`❌ Erro ao atualizar usuário ${user.email}:`, updateErr);
                reject(updateErr);
              } else {
                console.log(`✅ Senha atualizada: ${user.email} (${user.nome_completo}) - Role: ${user.role}`);
                resolve();
              }
            }
          );
        });
      });
      
      try {
        await Promise.all(updatePromises);
        console.log(`🎉 Todas as senhas foram atualizadas para "${SENHA_PADRAO}"`);
        console.log('📋 Usuários para teste:');
        users.forEach(user => {
          console.log(`   - ${user.email} | ${SENHA_PADRAO} | ${user.role}`);
        });
      } catch (error) {
        console.error('❌ Erro ao atualizar algumas senhas:', error);
      } finally {
        db.end();
      }
    });
    
  } catch (error) {
    console.error('❌ Erro geral:', error);
    db.end();
  }
}

// Função para criar usuários de teste se não existirem
async function criarUsuariosTeste() {
  const usuariosTeste = [
    {
      email: 'admin@aluforce.com',
      nome_completo: 'Administrator Sistema',
      role: 'admin',
      cpf: '000.000.000-00'
    },
    {
      email: 'funcionario@aluforce.com', 
      nome_completo: 'Funcionário Teste',
      role: 'funcionario',
      cpf: '111.111.111-11'
    },
    {
      email: 'rh@aluforce.com',
      nome_completo: 'Recursos Humanos',
      role: 'rh',
      cpf: '222.222.222-22'
    }
  ];
  
  const hashSenhaPadrao = await bcrypt.hash(SENHA_PADRAO, 10);
  
  console.log('👤 Criando usuários de teste...');
  
  for (const usuario of usuariosTeste) {
    const checkSql = 'SELECT id FROM funcionarios WHERE email = ?';
    
    db.query(checkSql, [usuario.email], (err, results) => {
      if (err) {
        console.error(`❌ Erro ao verificar usuário ${usuario.email}:`, err);
        return;
      }
      
      if (results.length > 0) {
        console.log(`ℹ️  Usuário já existe: ${usuario.email}`);
        return;
      }
      
      const insertSql = `INSERT INTO funcionarios 
        (email, senha, role, nome_completo, cpf, status, data_admissao) 
        VALUES (?, ?, ?, ?, ?, 'ativo', NOW())`;
        
      db.query(insertSql, [
        usuario.email,
        hashSenhaPadrao,
        usuario.role,
        usuario.nome_completo,
        usuario.cpf
      ], (insertErr) => {
        if (insertErr) {
          console.error(`❌ Erro ao criar usuário ${usuario.email}:`, insertErr);
        } else {
          console.log(`✅ Usuário criado: ${usuario.email} | ${SENHA_PADRAO} | ${usuario.role}`);
        }
      });
    });
  }
}

// Executar
console.log('🚀 Configurando senhas padrão do sistema...');
criarUsuariosTeste();
setTimeout(() => {
  atualizarSenhasPadrao();
}, 2000); // Aguarda 2 segundos para criação dos usuários