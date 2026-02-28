// =================================================================
// ROTAS API CLIENTES - ALUFORCE v2.0
// CRUD de clientes
// =================================================================
'use strict';

const express = require('express');
const router = express.Router();

// Função para criar as rotas (recebe pool e middlewares)
function createClientesRouter(pool, authenticateToken, registrarAuditLog) {
    
    // GET /api/clientes - Buscar clientes (autocomplete ou gestão)
    router.get('/', authenticateToken, async (req, res) => {
        try {
            const { termo, busca, gestao, limite } = req.query;
            const termoBusca = termo || busca;
            const limiteResultados = parseInt(limite) || 50;
            
            // Modo gestão: retorna todos os campos
            if (gestao === 'true' || gestao === '1') {
                console.log('✅ Buscando clientes para gestão...');
                
                let query = `SELECT * FROM clientes ORDER BY nome`;
                const [clientes] = await pool.query(query);
                
                const clientesFormatados = clientes.map(cliente => ({
                    id: cliente.id,
                    nome: cliente.nome || cliente.razao_social || cliente.nome_fantasia || '',
                    contato: cliente.contato || cliente.nome_contato || '',
                    cnpj: cliente.cnpj || cliente.cnpj_cpf || '',
                    cpf: cliente.cpf || '',
                    inscricao_estadual: cliente.inscricao_estadual || cliente.ie || '',
                    telefone: cliente.telefone || cliente.fone || '',
                    celular: cliente.celular || '',
                    email: cliente.email || '',
                    email_nfe: cliente.email_nfe || cliente.email || '',
                    cep: cliente.cep || '',
                    endereco: cliente.endereco || cliente.logradouro || '',
                    numero: cliente.numero || '',
                    bairro: cliente.bairro || '',
                    cidade: cliente.cidade || '',
                    uf: cliente.uf || cliente.estado || '',
                    ativo: cliente.ativo === 1 || cliente.ativo === true,
                    data_criacao: cliente.data_criacao,
                    data_atualizacao: cliente.data_atualizacao
                }));
                
                return res.json(clientesFormatados);
            }
            
            // Modo autocomplete
            console.log('✅ Buscando clientes para autocomplete...');
            
            let query = `SELECT id, 
                COALESCE(razao_social, nome) as razao_social,
                COALESCE(nome_fantasia, nome) as nome,
                COALESCE(cnpj_cpf, cnpj, cpf, '') as cnpj_cpf,
                COALESCE(cidade, '') as cidade,
                COALESCE(estado, '') as uf,
                telefone, email
                FROM clientes WHERE (ativo = 1 OR ativo IS NULL)`;
            let params = [];
            
            if (termoBusca && termoBusca.length >= 2) {
                query += ` AND (
                    razao_social LIKE ? OR 
                    nome_fantasia LIKE ? OR 
                    nome LIKE ? OR 
                    cnpj_cpf LIKE ? OR 
                    cnpj LIKE ?
                )`;
                const termoLike = `%${termoBusca}%`;
                params = [termoLike, termoLike, termoLike, termoLike, termoLike];
            }
            
            query += ` ORDER BY COALESCE(razao_social, nome) LIMIT ${limiteResultados}`;
            
            const [clientes] = await pool.query(query, params);
            
            const clientesFormatados = clientes.map(cliente => ({
                id: cliente.id,
                razao_social: cliente.razao_social || cliente.nome || '',
                nome: cliente.nome || cliente.razao_social || '',
                cnpj_cpf: cliente.cnpj_cpf || cliente.cnpj || cliente.cpf || '',
                cidade: cliente.cidade || '',
                uf: cliente.uf || '',
                telefone: cliente.telefone || '',
                email: cliente.email || ''
            }));
            
            res.json({ success: true, data: clientesFormatados, total: clientesFormatados.length });
            
        } catch (error) {
            console.error('❌ Erro ao buscar clientes:', error);
            res.status(500).json({ error: 'Erro ao buscar clientes' });
        }
    });

    // POST /api/clientes - Criar cliente
    router.post('/', authenticateToken, async (req, res) => {
        try {
            const {
                nome, nome_fantasia, contato, cnpj, cpf, inscricao_estadual, inscricao_municipal,
                telefone, celular, email, email_nfe, website, limite_credito, complemento,
                cep, endereco, numero, bairro, cidade, uf, ativo
            } = req.body;
            
            if (!nome) {
                return res.status(400).json({ error: 'Nome é obrigatório' });
            }
            
            const [result] = await pool.query(`
                INSERT INTO clientes (
                    nome, razao_social, nome_fantasia, contato, cnpj, cpf, inscricao_estadual, inscricao_municipal,
                    telefone, celular, email, email_nfe, website, limite_credito,
                    cep, endereco, logradouro, numero, complemento, bairro, cidade, estado, ativo
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                nome, nome, nome_fantasia || null, contato || null, cnpj || null, cpf || null, inscricao_estadual || null, inscricao_municipal || null,
                telefone || null, celular || null, email || null, email_nfe || null, website || null, limite_credito || null,
                cep || null, endereco || null, endereco || null, numero || null, complemento || null, bairro || null, cidade || null, uf || null,
                ativo !== undefined ? (ativo ? 1 : 0) : 1
            ]);
            
            // Audit log
            if (registrarAuditLog) {
                registrarAuditLog({
                    usuario: req.user?.nome || 'Usuário',
                    usuarioId: req.user?.id,
                    acao: 'Criar',
                    modulo: 'Clientes',
                    descricao: `Criou cliente: ${nome} ${cnpj ? '(CNPJ: ' + cnpj + ')' : ''}`,
                    ip: req.ip
                });
            }
            
            console.log(`✅ Cliente criado com ID: ${result.insertId}`);
            res.status(201).json({ id: result.insertId, message: 'Cliente criado com sucesso' });
            
        } catch (error) {
            console.error('❌ Erro ao criar cliente:', error);
            res.status(500).json({ error: 'Erro ao criar cliente', message: error.message });
        }
    });

    // PUT /api/clientes/:id - Atualizar cliente
    router.put('/:id', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const {
                nome, nome_fantasia, contato, cnpj, cpf, inscricao_estadual, inscricao_municipal,
                telefone, celular, email, email_nfe, website, limite_credito, complemento,
                cep, endereco, numero, bairro, cidade, uf, ativo
            } = req.body;
            
            if (!nome) {
                return res.status(400).json({ error: 'Nome é obrigatório' });
            }
            
            const [result] = await pool.query(`
                UPDATE clientes SET
                    nome = ?, razao_social = ?, nome_fantasia = ?, contato = ?, cnpj = ?, cpf = ?, inscricao_estadual = ?, inscricao_municipal = ?,
                    telefone = ?, celular = ?, email = ?, email_nfe = ?, website = ?, limite_credito = ?,
                    cep = ?, endereco = ?, logradouro = ?, numero = ?, complemento = ?, bairro = ?, cidade = ?, estado = ?, ativo = ?,
                    data_atualizacao = NOW()
                WHERE id = ?
            `, [
                nome, nome, nome_fantasia || null, contato || null, cnpj || null, cpf || null, inscricao_estadual || null, inscricao_municipal || null,
                telefone || null, celular || null, email || null, email_nfe || null, website || null, limite_credito || null,
                cep || null, endereco || null, endereco || null, numero || null, complemento || null, bairro || null, cidade || null, uf || null,
                ativo !== undefined ? (ativo ? 1 : 0) : 1,
                id
            ]);
            
            if (result.affectedRows === 0) {
                return res.status(404).json({ error: 'Cliente não encontrado' });
            }
            
            // Audit log
            if (registrarAuditLog) {
                registrarAuditLog({
                    usuario: req.user?.nome || 'Usuário',
                    usuarioId: req.user?.id,
                    acao: 'Editar',
                    modulo: 'Clientes',
                    descricao: `Atualizou cliente ID: ${id} - ${nome}`,
                    ip: req.ip
                });
            }
            
            res.json({ message: 'Cliente atualizado com sucesso' });
            
        } catch (error) {
            console.error('❌ Erro ao atualizar cliente:', error);
            res.status(500).json({ error: 'Erro ao atualizar cliente' });
        }
    });

    // DELETE /api/clientes/:id - Excluir cliente
    router.delete('/:id', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            
            const [result] = await pool.query('DELETE FROM clientes WHERE id = ?', [id]);
            
            if (result.affectedRows === 0) {
                return res.status(404).json({ error: 'Cliente não encontrado' });
            }
            
            // Audit log
            if (registrarAuditLog) {
                registrarAuditLog({
                    usuario: req.user?.nome || 'Usuário',
                    usuarioId: req.user?.id,
                    acao: 'Excluir',
                    modulo: 'Clientes',
                    descricao: `Excluiu cliente ID: ${id}`,
                    ip: req.ip
                });
            }
            
            res.json({ message: 'Cliente excluído com sucesso' });
            
        } catch (error) {
            console.error('❌ Erro ao excluir cliente:', error);
            res.status(500).json({ error: 'Erro ao excluir cliente' });
        }
    });

    // GET /api/clientes/:id - Buscar cliente por ID
    router.get('/:id', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            
            const [clientes] = await pool.query('SELECT * FROM clientes WHERE id = ?', [id]);
            
            if (clientes.length === 0) {
                return res.status(404).json({ error: 'Cliente não encontrado' });
            }
            
            res.json(clientes[0]);
            
        } catch (error) {
            console.error('❌ Erro ao buscar cliente:', error);
            res.status(500).json({ error: 'Erro ao buscar cliente' });
        }
    });

    return router;
}

module.exports = createClientesRouter;
