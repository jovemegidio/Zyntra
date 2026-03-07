/**
 * RH (Recursos Humanos) ROUTES - Extracted from server.js (Lines 14570-16490)
 * Funcionarios, atividades, ponto, ferias, holerites
 * @module routes/rh-routes
 */
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const bcrypt = require('bcryptjs');

module.exports = function createRHRoutes(deps) {
    const { pool, authenticateToken, authorizeArea, authorizeAdmin, writeAuditLog, jwt, JWT_SECRET } = deps;
    const router = express.Router();

    // --- Standard requires for extracted routes ---
    const { body, param, query, validationResult } = require('express-validator');
    const path = require('path');
    const multer = require('multer');
    const fs = require('fs');

    // Upload dir: em produção (VPS) salvar em /var/www/uploads/RH, em dev em public/uploads/RH
    const uploadDir = process.platform !== 'win32'
        ? '/var/www/uploads/RH'
        : path.join(__dirname, '..', 'public', 'uploads', 'RH');

    const rhStorage = multer.diskStorage({
        destination: (req, file, cb) => {
            let subfolder = 'outros';
            if (file.fieldname === 'foto') subfolder = 'fotos';
            if (file.fieldname === 'holerite') subfolder = 'holerites';
            if (file.fieldname === 'atestado') subfolder = 'atestados';
            if (file.fieldname === 'arquivo') subfolder = 'importacoes';
            const dest = path.join(uploadDir, subfolder);
            if (!fs.existsSync(dest)) {
                fs.mkdirSync(dest, { recursive: true });
            }
            cb(null, dest);
        },
        filename: (req, file, cb) => {
            const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
            const unique = `${file.fieldname}-${Date.now()}-${Math.floor(Math.random() * 1e9)}${ext}`;
            cb(null, unique);
        }
    });
    const upload = multer({ storage: rhStorage, limits: { fileSize: 10 * 1024 * 1024 } });
    const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
    const validate = (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ message: 'Dados inválidos', errors: errors.array() });
        next();
    };

    // LGPD crypto (optional — fallback to identity if not available)
    let lgpdCrypto = null;
    try {
        lgpdCrypto = require('../lgpd-crypto');
    } catch (e) {
        console.warn('[RH] lgpd-crypto não disponível — campos PII não serão descriptografados');
    }

    router.use(authenticateToken);
    router.use(authorizeArea('rh'));

    // Rota /me para o RH retornar dados do usuário logado
    router.get('/me', async (req, res) => {
        try {
            if (!req.user) {
                return res.status(401).json({ message: 'Não autenticado' });
            }

            // Buscar dados completos do usuário no banco com JOIN para foto do funcionário
            const [[dbUser]] = await pool.query(
                `SELECT u.id, u.nome, u.email, u.role, u.is_admin,
                        u.permissoes_rh as permissoes, u.foto, u.avatar,
                        f.foto_perfil_url as foto_funcionario
                 FROM usuarios u
                 LEFT JOIN funcionarios f ON u.email = f.email
                 WHERE u.id = ?`,
                [req.user.id]
            );

            if (!dbUser) {
                return res.status(404).json({ message: 'Usuário não encontrado' });
            }

            // Parse permissões
            let permissoes = [];
            if (dbUser.permissoes) {
                try {
                    permissoes = JSON.parse(dbUser.permissoes);
                } catch (e) {
                    console.error('[API/RH/ME] Erro ao parsear permissoes:', e);
                    permissoes = [];
                }
            }

            // Determinar a foto (prioridade: avatar > foto > foto_funcionario)
            const fotoUsuario = dbUser.avatar || dbUser.foto || dbUser.foto_funcionario || "/avatars/default.webp";

            // Retornar dados completos do usuário
            res.json({
                user: {
                    id: dbUser.id,
                    nome: dbUser.nome,
                    email: dbUser.email,
                    role: dbUser.role,
                    avatar: fotoUsuario,
                    foto: fotoUsuario,
                    foto_perfil_url: fotoUsuario,
                    is_admin: dbUser.is_admin,
                    permissoes: permissoes
                }
            });
        } catch (error) {
            console.error('[API/RH/ME] Erro ao buscar usuário:', error);
            res.status(500).json({ message: 'Erro ao buscar dados do usuário' });
        }
    });

    // ROTAS: CRUD básico de funcionários (opera sobre a tabela `usuarios`)
    // Criar funcionário (admin apenas)
    router.post('/funcionarios', [
        authorizeAdmin,
        body('nome_completo').trim().notEmpty().withMessage('Nome completo é obrigatório')
            .isLength({ min: 3, max: 255 }).withMessage('Nome deve ter entre 3 e 255 caracteres'),
        body('email').trim().notEmpty().withMessage('Email é obrigatório')
            .isEmail().withMessage('Email inválido')
            .normalizeEmail(),
        body('senha').notEmpty().withMessage('Senha é obrigatória')
            .isLength({ min: 10 }).withMessage('Senha deve ter no mínimo 10 caracteres')
            .matches(/[A-Z]/).withMessage('Senha deve conter letra maiúscula')
            .matches(/[a-z]/).withMessage('Senha deve conter letra minúscula')
            .matches(/[0-9]/).withMessage('Senha deve conter número')
            .matches(/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/).withMessage('Senha deve conter caractere especial'),
        body('role').optional().isIn(['user', 'admin']).withMessage('Role deve ser user ou admin'),
        validate
    ], async (req, res, next) => {
        try {
            const { nome_completo, email, senha, role } = req.body;
            const hashed = await bcrypt.hash(senha, 10);
            try {
                const [result] = await pool.query('INSERT INTO usuarios (nome, email, senha_hash, password_hash, role) VALUES (?, ?, ?, ?, ?)', [nome_completo, email, hashed, hashed, role || 'user']);
                res.status(201).json({ id: result.insertId });
            } catch (err) {
                if (err && err.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Email já cadastrado.' });
                throw err;
            }
        } catch (error) { next(error); }
    });

    // Listar funcionários (admin apenas) - busca da tabela funcionarios
    router.get('/funcionarios', authorizeAdmin, async (req, res, next) => {
        try {
            const { status, departamento, search, limit = 100, offset = 0 } = req.query;

            let sql = `
                SELECT
                    id, nome_completo, email, cpf, rg, telefone,
                    cargo, departamento, status, role,
                    data_nascimento, data_admissao,
                    estado_civil, nacionalidade, naturalidade,
                    endereco, foto_perfil_url, foto_thumb_url,
                    pis_pasep, ctps_numero, ctps_serie,
                    banco, agencia, conta_corrente,
                    tipo_chave_pix, chave_pix,
                    dependentes, cnh, certificado_reservista,
                    titulo_eleitor, zona_eleitoral, secao_eleitoral,
                    filiacao_mae, filiacao_pai, dados_conjuge
                FROM funcionarios
                WHERE 1=1
            `;
            const params = [];

            if (status) {
                sql += ' AND status = ?';
                params.push(status);
            }
            if (departamento) {
                sql += ' AND departamento = ?';
                params.push(departamento);
            }
            if (search) {
                sql += ' AND (nome_completo LIKE ? OR email LIKE ? OR cargo LIKE ? OR cpf LIKE ?)';
                const searchTerm = `%${search}%`;
                params.push(searchTerm, searchTerm, searchTerm, searchTerm);
            }

            sql += ' ORDER BY nome_completo ASC LIMIT ? OFFSET ?';
            params.push(parseInt(limit), parseInt(offset));

            const [rows] = await pool.query(sql, params);

            // Buscar contagens para estatísticas
            const [[stats]] = await pool.query(`
                SELECT
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'Ativo' OR status = 'ativo' THEN 1 ELSE 0 END) as ativos,
                    SUM(CASE WHEN MONTH(data_nascimento) = MONTH(CURRENT_DATE()) THEN 1 ELSE 0 END) as aniversariantes,
                    SUM(CASE WHEN MONTH(data_admissao) = MONTH(CURRENT_DATE()) AND YEAR(data_admissao) = YEAR(CURRENT_DATE()) THEN 1 ELSE 0 END) as admissoes_mes
                FROM funcionarios
            `);

            // Buscar lista de departamentos únicos
            const [deptRows] = await pool.query('SELECT DISTINCT departamento FROM funcionarios WHERE departamento IS NOT NULL AND departamento != "" ORDER BY departamento');
            const departamentos = deptRows.map(r => r.departamento);

            // Buscar lista de cargos únicos
            const [cargoRows] = await pool.query('SELECT DISTINCT cargo FROM funcionarios WHERE cargo IS NOT NULL AND cargo != "" ORDER BY cargo');
            const cargos = cargoRows.map(r => r.cargo);

            // Descriptografar CPF/RG (LGPD)
            const _dec = lgpdCrypto ? lgpdCrypto.decryptPII : (v => v);
            rows.forEach(r => {
                if (r.cpf) r.cpf = _dec(r.cpf);
                if (r.rg) r.rg = _dec(r.rg);
            });

            res.json({
                funcionarios: rows,
                stats: stats || { total: 0, ativos: 0, aniversariantes: 0, admissoes_mes: 0 },
                departamentos,
                cargos
            });
        } catch (error) {
            console.error('Erro ao listar funcionários:', error);
            next(error);
        }
    });

    // API para listar cargos com estatísticas
    router.get('/cargos', authorizeAdmin, async (req, res, next) => {
        try {
            // Buscar cargos únicos com contagem de funcionários e departamentos
            const [rows] = await pool.query(`
                SELECT
                    cargo as nome,
                    departamento,
                    COUNT(*) as total_funcionarios,
                    CASE
                        WHEN cargo LIKE '%Diretor%' OR cargo LIKE '%Gerente%' THEN 'Executivo'
                        WHEN cargo LIKE '%Gerente%' OR cargo LIKE '%Coordenador%' OR cargo LIKE '%Supervisor%' THEN 'Gerencial'
                        WHEN cargo LIKE '%Analista%' OR cargo LIKE '%Tecnico%' THEN 'Técnico'
                        ELSE 'Operacional'
                    END as nivel,
                    CASE
                        WHEN cargo LIKE '%Diretor%' THEN '1210-05'
                        WHEN cargo LIKE '%Gerente%' THEN '1421-05'
                        WHEN cargo LIKE '%Analista%' THEN '2521-05'
                        WHEN cargo LIKE '%Tecnico%' THEN '3132-05'
                        WHEN cargo LIKE '%Operador%' THEN '8111-10'
                        WHEN cargo LIKE '%Consultor%' THEN '3541-25'
                        WHEN cargo LIKE '%Vendedor%' THEN '5211-10'
                        WHEN cargo LIKE '%Comprador%' THEN '3542-05'
                        WHEN cargo LIKE '%Auxiliar%' THEN '5143-20'
                        WHEN cargo LIKE '%Assistente%' THEN '4110-10'
                        ELSE '9999-00'
                    END as cbo
                FROM funcionarios
                WHERE cargo IS NOT NULL AND cargo != ''
                GROUP BY cargo, departamento
                ORDER BY cargo
            `);

            // Adicionar IDs sequenciais
            const cargosComId = rows.map((c, index) => ({
                id: index + 1,
                ...c
            }));

            res.json({
                success: true,
                data: cargosComId,
                total: cargosComId.length
            });
        } catch (error) {
            console.error('Erro ao listar cargos:', error);
            next(error);
        }
    });

    // Buscar funcionário por ID (próprio usuário ou admin/RH)
    // NOTA: Se o usuário chegou até aqui, já passou pelo authorizeArea('rh')
    router.get('/funcionarios/:id', async (req, res, next) => {
        try {
            const { id } = req.params;

            // Verificar se é admin ou RH
            const userRole = (req.user.role || '').toLowerCase();
            const isAdmin = userRole === 'admin' || req.user.is_admin === 1 || req.user.is_admin === true || req.user.is_admin === '1';
            const isRH = userRole === 'rh' || userRole === 'recursos humanos';

            // Verificar se é o próprio usuário (por email na tabela funcionarios)
            let isSelf = false;
            if (req.user.email) {
                try {
                    const [selfCheck] = await pool.query('SELECT id FROM funcionarios WHERE id = ? AND email = ?', [id, req.user.email]);
                    isSelf = selfCheck.length > 0;
                } catch (e) { /* ignora erro */ }
            }
            if (!isSelf) isSelf = Number(req.user.id) === parseInt(id);

            const hasRHAccess = isAdmin || isRH || req.isConsultoria === true;

            if (!isSelf && !hasRHAccess) {
                console.log(`[RH] Acesso negado funcionário ${id} - User: ${req.user.nome || req.user.email}, Role: ${userRole}`);
                return res.status(403).json({ message: 'Acesso negado' });
            }

            // Buscar dados na tabela funcionarios (mais completa)
            const [rows] = await pool.query(`
                SELECT
                    id, nome_completo, email, cpf, rg, telefone,
                    data_nascimento, data_admissao, cargo, departamento,
                    endereco, cep, cidade, estado, bairro, status,
                    estado_civil, nacionalidade, naturalidade, sexo,
                    filiacao_mae, filiacao_pai, dados_conjuge,
                    pis_pasep, ctps, ctps_numero, ctps_serie,
                    titulo_eleitor, zona_eleitoral, secao_eleitoral,
                    certificado_reservista, cnh,
                    banco, agencia, conta_corrente, dados_bancarios,
                    tipo_chave_pix, chave_pix,
                    foto_perfil_url, foto_thumb_url,
                    dependentes, role, salario, tipo_contrato,
                    data_reajuste, ultimo_reajuste,
                    data_demissao, motivo_demissao,
                    vt_ativo, vt_tipo_transporte, vt_valor_diario,
                    vt_qtd_passagens, vt_linhas, vt_dias_desconto,
                    vt_mes_referencia, vt_motivo_desconto
                FROM funcionarios
                WHERE id = ?
            `, [id]);

            if (rows.length === 0) {
                // Se não encontrou na tabela funcionarios, buscar na tabela usuarios
                const [userRows] = await pool.query(`
                    SELECT
                        id, nome as nome_completo, email, role,
                        '' as telefone, null as data_nascimento, '' as departamento,
                        '' as apelido, '' as bio, foto
                    FROM usuarios
                    WHERE id = ?
                `, [id]);

                if (userRows.length === 0) {
                    return res.status(404).json({ message: 'Funcionário não encontrado' });
                }

                return res.json(userRows[0]);
            }

            // Descriptografar CPF/RG (LGPD)
            const _dec = lgpdCrypto ? lgpdCrypto.decryptPII : (v => v);
            if (rows[0].cpf) rows[0].cpf = _dec(rows[0].cpf);
            if (rows[0].rg) rows[0].rg = _dec(rows[0].rg);

            res.json(rows[0]);
        } catch (error) {
            console.error('Erro ao buscar funcionário:', error);
            next(error);
        }
    });

    // Deletar funcionário por id (admin apenas)
    router.delete('/funcionarios/:id', [
        authorizeAdmin,
        param('id').isInt({ min: 1 }).withMessage('ID do funcionário inválido'),
        validate
    ], async (req, res, next) => {
        try {
            const { id } = req.params;

            // Verificar se o funcionário existe
            const [funcionario] = await pool.query('SELECT id FROM funcionarios WHERE id = ?', [id]);
            if (funcionario.length === 0) {
                // Tenta verificar na tabela usuarios
                const [usuario] = await pool.query('SELECT id FROM usuarios WHERE id = ?', [id]);
                if (usuario.length === 0) {
                    return res.status(404).json({ message: 'Funcionário não encontrado.' });
                }
                // Deleta da tabela usuarios
                await pool.query('DELETE FROM usuarios WHERE id = ?', [id]);
                return res.status(204).send();
            }

            // AUDIT-FIX HIGH-003: Use explicit cascade list + transaction instead of dynamic FK lookup
            const connection = await pool.getConnection();
            try {
                await connection.beginTransaction();

                // Explicit list of known FK tables for funcionarios (avoids dynamic table name injection)
                const fkCascadeTables = [
                    { table: 'ponto_registros', column: 'funcionario_id' },
                    { table: 'ponto_alteracoes', column: 'funcionario_id' },
                    { table: 'rh_holerites_gestao', column: 'funcionario_id' },
                    { table: 'folha_pagamento', column: 'funcionario_id' },
                    { table: 'ferias', column: 'funcionario_id' },
                    { table: 'afastamentos', column: 'funcionario_id' },
                    { table: 'advertencias', column: 'funcionario_id' },
                    { table: 'documentos_funcionario', column: 'funcionario_id' },
                    { table: 'historico_cargos', column: 'funcionario_id' },
                    { table: 'treinamentos_participantes', column: 'funcionario_id' },
                    { table: 'beneficios_funcionario', column: 'funcionario_id' },
                    { table: 'avaliacoes_desempenho', column: 'funcionario_id' },
                    { table: 'esocial_eventos', column: 'funcionario_id' }
                ];

                for (const fk of fkCascadeTables) {
                    try {
                        await connection.query(`DELETE FROM \`${fk.table}\` WHERE \`${fk.column}\` = ?`, [id]);
                    } catch (err) {
                        // Ignore table-not-found errors (1146), fail on anything else
                        if (err.errno !== 1146) throw err;
                    }
                }

                // Agora deleta o funcionário
                const [result] = await connection.query('DELETE FROM funcionarios WHERE id = ?', [id]);
                if (result.affectedRows === 0) {
                    await connection.rollback();
                    connection.release();
                    return res.status(404).json({ message: 'Funcionário não encontrado.' });
                }

                await connection.commit();
                connection.release();
                res.status(204).send();
            } catch (txnErr) {
                await connection.rollback();
                connection.release();
                throw txnErr;
            }
        } catch (error) { next(error); }
    });

    // Atualizar funcionário por id (admin apenas)
    router.put('/funcionarios/:id', [
        authorizeAdmin,
        param('id').isInt({ min: 1 }).withMessage('ID do funcionário inválido'),
        validate
    ], async (req, res, next) => {
        try {
            const { id } = req.params;
            const {
                nome_completo, email, cpf, rg, telefone,
                cargo, departamento, status,
                data_nascimento, data_admissao,
                estado_civil, nacionalidade, naturalidade,
                endereco, pis_pasep, ctps_numero, ctps_serie,
                banco, agencia, conta_corrente,
                dependentes, cnh, certificado_reservista,
                titulo_eleitor, zona_eleitoral, secao_eleitoral,
                filiacao_mae, filiacao_pai, dados_conjuge,
                bairro, cidade, estado, cep,
                // Campos adicionais (v2 - fix PUT handler)
                sexo, salario, data_reajuste, ultimo_reajuste,
                tipo_chave_pix, chave_pix, senha_texto,
                data_demissao, motivo_demissao,
                vt_ativo, vt_tipo_transporte, vt_valor_diario,
                vt_qtd_passagens, vt_linhas, vt_dias_desconto,
                vt_mes_referencia, vt_motivo_desconto
            } = req.body;

            // AUDIT-FIX R-06: NUNCA armazenar senha em texto plano
            // Se senha_texto foi enviada, hashear com bcrypt ou rejeitar a operação
            let senhaHasheada = null; // null = não atualizar campo senha
            if (senha_texto && senha_texto.trim()) {
                try {
                    const bcrypt = require('bcryptjs');
                    senhaHasheada = await bcrypt.hash(senha_texto.trim(), 12);
                } catch (hashErr) {
                    console.error('Erro ao hashear senha:', hashErr);
                    return res.status(500).json({ message: 'Erro ao processar senha. Operação cancelada por segurança.' });
                }
            }

            // Processar vt_ativo como boolean → int
            const vtAtivoInt = vt_ativo === true || vt_ativo === 'true' || vt_ativo === 1 ? 1 : (vt_ativo === false || vt_ativo === 'false' || vt_ativo === 0 ? 0 : vt_ativo);

            // FIX: Converter strings vazias para NULL em campos ENUM e DATE
            // MySQL ENUM rejeita '' (empty string) → causa "Data truncated"
            const emptyToNull = (v) => (v === '' || v === undefined) ? null : v;

            // Sanitizar todos os campos que são ENUM ou DATE no MySQL
            const safeSexo = emptyToNull(sexo);
            const safeTipoChavePix = emptyToNull(tipo_chave_pix);
            const safeDataNasc = emptyToNull(data_nascimento);
            const safeDataAdm = emptyToNull(data_admissao);
            const safeDataReajuste = emptyToNull(data_reajuste);
            const safeDataDemissao = emptyToNull(data_demissao);
            const safeEstadoCivil = emptyToNull(estado_civil);
            const safeSalario = emptyToNull(salario);
            const safeVtValorDiario = emptyToNull(vt_valor_diario);

            const [result] = await pool.query(`
                UPDATE funcionarios SET
                    nome_completo = COALESCE(?, nome_completo),
                    email = COALESCE(?, email),
                    cpf = COALESCE(?, cpf),
                    rg = COALESCE(?, rg),
                    telefone = COALESCE(?, telefone),
                    cargo = COALESCE(?, cargo),
                    departamento = COALESCE(?, departamento),
                    status = COALESCE(?, status),
                    data_nascimento = COALESCE(?, data_nascimento),
                    data_admissao = COALESCE(?, data_admissao),
                    estado_civil = COALESCE(?, estado_civil),
                    nacionalidade = COALESCE(?, nacionalidade),
                    naturalidade = COALESCE(?, naturalidade),
                    endereco = COALESCE(?, endereco),
                    bairro = COALESCE(?, bairro),
                    cidade = COALESCE(?, cidade),
                    estado = COALESCE(?, estado),
                    cep = COALESCE(?, cep),
                    pis_pasep = COALESCE(?, pis_pasep),
                    ctps_numero = COALESCE(?, ctps_numero),
                    ctps_serie = COALESCE(?, ctps_serie),
                    banco = COALESCE(?, banco),
                    agencia = COALESCE(?, agencia),
                    conta_corrente = COALESCE(?, conta_corrente),
                    dependentes = COALESCE(?, dependentes),
                    cnh = COALESCE(?, cnh),
                    certificado_reservista = COALESCE(?, certificado_reservista),
                    titulo_eleitor = COALESCE(?, titulo_eleitor),
                    zona_eleitoral = COALESCE(?, zona_eleitoral),
                    secao_eleitoral = COALESCE(?, secao_eleitoral),
                    filiacao_mae = COALESCE(?, filiacao_mae),
                    filiacao_pai = COALESCE(?, filiacao_pai),
                    dados_conjuge = COALESCE(?, dados_conjuge),
                    sexo = COALESCE(?, sexo),
                    salario = COALESCE(?, salario),
                    data_reajuste = COALESCE(?, data_reajuste),
                    ultimo_reajuste = COALESCE(?, ultimo_reajuste),
                    tipo_chave_pix = COALESCE(?, tipo_chave_pix),
                    chave_pix = COALESCE(?, chave_pix),
                    senha = COALESCE(?, senha),
                    senha_texto = NULL, -- AUDIT-FIX R-06: Limpar campo plaintext legado
                    data_demissao = COALESCE(?, data_demissao),
                    motivo_demissao = COALESCE(?, motivo_demissao),
                    vt_ativo = COALESCE(?, vt_ativo),
                    vt_tipo_transporte = COALESCE(?, vt_tipo_transporte),
                    vt_valor_diario = COALESCE(?, vt_valor_diario),
                    vt_qtd_passagens = COALESCE(?, vt_qtd_passagens),
                    vt_linhas = COALESCE(?, vt_linhas),
                    vt_dias_desconto = COALESCE(?, vt_dias_desconto),
                    vt_mes_referencia = COALESCE(?, vt_mes_referencia),
                    vt_motivo_desconto = COALESCE(?, vt_motivo_desconto)
                WHERE id = ?
            `, [
                emptyToNull(nome_completo), emptyToNull(email), emptyToNull(cpf), emptyToNull(rg), emptyToNull(telefone),
                emptyToNull(cargo), emptyToNull(departamento), emptyToNull(status),
                safeDataNasc, safeDataAdm,
                safeEstadoCivil, emptyToNull(nacionalidade), emptyToNull(naturalidade),
                emptyToNull(endereco), emptyToNull(bairro), emptyToNull(cidade), emptyToNull(estado), emptyToNull(cep),
                emptyToNull(pis_pasep), emptyToNull(ctps_numero), emptyToNull(ctps_serie),
                emptyToNull(banco), emptyToNull(agencia), emptyToNull(conta_corrente),
                emptyToNull(dependentes), emptyToNull(cnh), emptyToNull(certificado_reservista),
                emptyToNull(titulo_eleitor), emptyToNull(zona_eleitoral), emptyToNull(secao_eleitoral),
                emptyToNull(filiacao_mae), emptyToNull(filiacao_pai), emptyToNull(dados_conjuge),
                safeSexo, safeSalario, safeDataReajuste, emptyToNull(ultimo_reajuste),
                safeTipoChavePix, emptyToNull(chave_pix), senhaHasheada,
                safeDataDemissao, emptyToNull(motivo_demissao),
                vtAtivoInt, emptyToNull(vt_tipo_transporte), safeVtValorDiario,
                emptyToNull(vt_qtd_passagens), emptyToNull(vt_linhas), emptyToNull(vt_dias_desconto),
                emptyToNull(vt_mes_referencia), emptyToNull(vt_motivo_desconto),
                id
            ]);

            if (result.affectedRows === 0) {
                return res.status(404).json({ message: 'Funcionário não encontrado.' });
            }

            res.json({ message: 'Funcionário atualizado com sucesso!' });
        } catch (error) {
            console.error('Erro ao atualizar funcionário:', error);
            next(error);
        }
    });

    // Criar funcionário na tabela funcionarios (admin apenas)
    router.post('/funcionarios/novo', [
        authorizeAdmin,
        body('nome_completo').trim().notEmpty().withMessage('Nome completo é obrigatório'),
        body('email').trim().notEmpty().withMessage('Email é obrigatório').isEmail().withMessage('Email inválido'),
        body('cpf').trim().notEmpty().withMessage('CPF é obrigatório'),
        validate
    ], async (req, res, next) => {
        try {
            const {
                nome_completo, email, cpf, rg, telefone, sexo,
                cargo, departamento, status = 'Ativo',
                data_nascimento, data_admissao,
                estado_civil, nacionalidade, naturalidade,
                endereco, pis_pasep, ctps_numero, ctps_serie,
                banco, tipo_chave_pix, chave_pix, agencia, conta_corrente,
                dependentes, cnh, certificado_reservista,
                titulo_eleitor, zona_eleitoral, secao_eleitoral,
                filiacao_mae, filiacao_pai, dados_conjuge,
                bairro, cidade, estado, cep
            } = req.body;

            // Gerar senha temporária aleatória segura (12 chars)
            const crypto = require('crypto');
            const senhaTemp = crypto.randomBytes(8).toString('base64').slice(0, 12);

            // Hash da senha
            const hashed = await bcrypt.hash(senhaTemp, 10);

            const [result] = await pool.query(`
                INSERT INTO funcionarios (
                    nome_completo, email, senha, password_hash, cpf, rg, telefone, sexo,
                    cargo, departamento, status, role,
                    data_nascimento, data_admissao,
                    estado_civil, nacionalidade, naturalidade,
                    endereco, pis_pasep, ctps_numero, ctps_serie,
                    banco, tipo_chave_pix, chave_pix, agencia, conta_corrente,
                    dependentes, cnh, certificado_reservista,
                    titulo_eleitor, zona_eleitoral, secao_eleitoral,
                    filiacao_mae, filiacao_pai, dados_conjuge,
                    bairro, cidade, estado, cep,
                    forcar_troca_senha
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'funcionario', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
            `, [
                nome_completo, email, hashed, hashed, cpf, rg, telefone,
                (sexo === '' ? null : sexo) || null,
                cargo, departamento, status,
                data_nascimento || null, data_admissao || null,
                estado_civil || null, nacionalidade, naturalidade,
                endereco, pis_pasep, ctps_numero, ctps_serie,
                banco, (tipo_chave_pix === '' ? null : tipo_chave_pix) || null,
                chave_pix || null, agencia, conta_corrente,
                dependentes || 0, cnh, certificado_reservista,
                titulo_eleitor, zona_eleitoral, secao_eleitoral,
                filiacao_mae, filiacao_pai, dados_conjuge,
                bairro || null, cidade || null, estado || null, cep || null
            ]);

            // Retorna senha temporária para o admin informar ao funcionário
            // A flag forcar_troca_senha=1 já está setada no INSERT
            res.status(201).json({
                id: result.insertId,
                message: 'Funcionário criado com sucesso!',
                senhaTemporaria: senhaTemp,
                avisoSenha: 'Esta senha deve ser alterada no primeiro login'
            });
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY') {
                return res.status(409).json({ message: 'Email ou CPF já cadastrado.' });
            }
            console.error('Erro ao criar funcionário:', error);
            next(error);
        }
    });

    // Upload de foto do funcionário
    router.post('/funcionarios/:id/foto', [
        authorizeAdmin,
        param('id').isInt({ min: 1 }).withMessage('ID do funcionário inválido'),
        validate
    ], upload.single('foto'), async (req, res, next) => {
        try {
            const { id } = req.params;

            if (!req.file) {
                return res.status(400).json({ message: 'Nenhuma foto enviada.' });
            }

            console.log('📸 Upload de foto recebido:', req.file);

            // O multer com diskStorage já salvou com extensão na pasta correta
            const nomeArquivo = req.file.filename;
            const ext = path.extname(nomeArquivo).toLowerCase();
            const caminhoFoto = `/uploads/RH/fotos/${nomeArquivo}`;

            // Criar thumbnail (200x200)
            let thumbUrl = caminhoFoto; // fallback se sharp falhar
            try {
                const sharp = require('sharp');
                const thumbName = ext ? nomeArquivo.replace(ext, `-thumb${ext}`) : `${nomeArquivo}-thumb.jpg`;
                const thumbPath = path.join(path.dirname(req.file.path), thumbName);
                thumbUrl = `/uploads/RH/fotos/${thumbName}`;

                await sharp(req.file.path)
                    .resize(200, 200, { fit: 'cover' })
                    .toFile(thumbPath);
                console.log('✅ Thumbnail criado:', thumbPath);
            } catch (sharpErr) {
                console.error('⚠️ Erro ao criar thumbnail:', sharpErr.message);
                thumbUrl = caminhoFoto; // usar foto original como thumb
            }

            // Atualizar foto no banco (apenas colunas que existem: foto_perfil_url e foto_thumb_url)
            await pool.query('UPDATE funcionarios SET foto_perfil_url = ?, foto_thumb_url = ? WHERE id = ?', [caminhoFoto, thumbUrl, id]);
            console.log('✅ Foto atualizada no banco para funcionário:', id);

            // ==================== HOOK: Sync foto para RHiD via Browser ====================
            try {
                const rhidSync = require('../services/rhid-browser-sync');
                const syncStatus = rhidSync.getStatus();
                if (syncStatus.browserActive) {
                    const [funcData] = await pool.query(
                        'SELECT nome_completo, pis_pasep FROM funcionarios WHERE id = ?', [id]
                    );
                    if (funcData.length > 0) {
                        const absolutePhotoPath = req.file.path; // caminho absoluto do arquivo salvo
                        rhidSync.queuePhotoUpdate(
                            funcData[0].nome_completo,
                            funcData[0].pis_pasep,
                            absolutePhotoPath
                        );
                        console.log('[FOTO→RHiD] Sync enfileirado para funcionário #' + id);
                    }
                }
            } catch (syncErr) {
                console.error('[FOTO→RHiD] Erro ao enfileirar sync:', syncErr.message);
            }
            // =================================================================================

            res.json({
                message: 'Foto atualizada com sucesso!',
                foto: caminhoFoto,
                foto_url: caminhoFoto,
                foto_thumb_url: thumbUrl
            });
        } catch (error) {
            console.error('Erro ao fazer upload da foto:', error);
            next(error);
        }
    });

    // Importar funcionários via CSV/Excel (admin apenas)
    router.post('/funcionarios/importar', [
        authorizeAdmin
    ], upload.single('arquivo'), async (req, res, next) => {
        try {
            if (!req.file) {
                return res.status(400).json({ message: 'Arquivo não enviado.' });
            }

            // Por enquanto retorna sucesso - a implementação completa depende da lib de parsing
            res.json({
                message: 'Arquivo recebido. Processamento em desenvolvimento.',
                filename: req.file.filename
            });
        } catch (error) {
            console.error('Erro ao importar funcionários:', error);
            next(error);
        }
    });

    // HOLERITES
    router.get('/funcionarios/:id/holerites', async (req, res, next) => {
        try {
            const [rows] = await pool.query('SELECT * FROM holerites WHERE funcionario_id = ? ORDER BY mes_referencia DESC', [req.params.id]);
            // A tabela já tem arquivo_url pronta; apenas garantir que está preenchida
            rows.forEach(h => {
                if (!h.arquivo_url && h.arquivo) {
                    h.arquivo_url = `/uploads/holerites/${h.arquivo}`;
                }
            });
            res.json(rows);
        } catch (e) { next(e); }
    });
    router.post('/funcionarios/:id/holerites', [
        authorizeAdmin,
        param('id').isInt({ min: 1 }).withMessage('ID do funcionário inválido'),
        body('mes_referencia').notEmpty().withMessage('Mês de referência é obrigatório')
            .matches(/^\d{4}-\d{2}$/).withMessage('Formato inválido. Use YYYY-MM'),
        validate
    ], upload.single('holerite'), async (req, res, next) => {
        try {
            if (!req.file) return res.status(400).json({ message: 'Arquivo não enviado.' });
            const { mes_referencia } = req.body;
            await pool.query(
                'INSERT INTO holerites (funcionario_id, mes_referencia, arquivo_url, competencia) VALUES (?, ?, ?, ?)',
                [req.params.id, mes_referencia, `/uploads/RH/holerites/${req.file.filename}`, mes_referencia]
            );
            res.status(201).json({ message: 'Holerite anexado!' });
        } catch (e) { next(e); }
    });

    // ATESTADOS
    router.get('/atestados', async (req, res, next) => {
        try {
            const funcionario_id = req.query.funcionario_id || req.user.id;
            const [rows] = await pool.query('SELECT * FROM atestados WHERE funcionario_id = ? ORDER BY data_atestado DESC', [funcionario_id]);
            // A tabela já tem arquivo_url; apenas garantir que está preenchida
            rows.forEach(a => {
                if (!a.arquivo_url && a.arquivo) {
                    a.arquivo_url = `/uploads/atestados/${a.arquivo}`;
                }
            });
            res.json(rows);
        } catch (e) { next(e); }
    });

    // Buscar meus atestados (usuário logado)
    router.get('/meus-atestados', async (req, res, next) => {
        try {
            const funcionarioId = req.user.id;

            const [rows] = await pool.query(`
                SELECT * FROM atestados
                WHERE funcionario_id = ?
                ORDER BY created_at DESC
            `, [funcionarioId]);

            rows.forEach(a => {
                if (a.arquivo) a.arquivo_url = `/uploads/atestados/${a.arquivo}`;
            });

            res.json(rows);
        } catch (e) {
            console.error('Erro ao buscar atestados:', e);
            next(e);
        }
    });

    // Buscar atestados de um funcionário específico (admin)
    router.get('/funcionarios/:id/atestados', async (req, res, next) => {
        try {
            const funcionarioId = req.params.id;

            // AUDIT-FIX ARCH-002: Removed duplicate CREATE TABLE atestados (kept in POST route with more columns)

            // Verificar e adicionar colunas que podem faltar
            const colunasExtras = [
                "ALTER TABLE atestados ADD COLUMN IF NOT EXISTS dias_afastamento INT",
                "ALTER TABLE atestados ADD COLUMN IF NOT EXISTS tipo VARCHAR(100) DEFAULT 'Atestado Médico'",
                "ALTER TABLE atestados ADD COLUMN IF NOT EXISTS cid VARCHAR(20)",
                "ALTER TABLE atestados ADD COLUMN IF NOT EXISTS motivo_recusa TEXT",
                "ALTER TABLE atestados ADD COLUMN IF NOT EXISTS aprovado_por INT",
                "ALTER TABLE atestados ADD COLUMN IF NOT EXISTS data_aprovacao DATETIME"
            ];

            for (const sql of colunasExtras) {
                try { await pool.query(sql); } catch (e) { /* coluna já existe */ }
            }

            const [rows] = await pool.query(`
                SELECT a.*, f.nome_completo as funcionario_nome
                FROM atestados a
                LEFT JOIN funcionarios f ON a.funcionario_id = f.id
                WHERE a.funcionario_id = ?
                ORDER BY a.created_at DESC
            `, [funcionarioId]);

            rows.forEach(a => {
                if (a.arquivo) a.arquivo_url = `/uploads/atestados/${a.arquivo}`;
            });

            res.json(rows);
        } catch (e) {
            console.error('Erro ao buscar atestados:', e);
            next(e);
        }
    });

    // Aprovar atestado
    router.put('/atestados/:id/aprovar', [authorizeAdmin], async (req, res, next) => {
        try {
            const { id } = req.params;
            await pool.query(
                'UPDATE atestados SET status = ?, aprovado_por = ?, data_aprovacao = NOW() WHERE id = ?',
                ['Aprovado', req.user.id, id]
            );
            res.json({ message: 'Atestado aprovado com sucesso!' });
        } catch (e) { next(e); }
    });

    // Recusar atestado
    router.put('/atestados/:id/recusar', [authorizeAdmin], async (req, res, next) => {
        try {
            const { id } = req.params;
            const { motivo } = req.body;
            await pool.query(
                'UPDATE atestados SET status = ?, motivo_recusa = ?, aprovado_por = ?, data_aprovacao = NOW() WHERE id = ?',
                ['Recusado', motivo || '', req.user.id, id]
            );
            res.json({ message: 'Atestado recusado.' });
        } catch (e) { next(e); }
    });

    router.post('/atestados', upload.single('arquivo'), async (req, res, next) => {
        try {
            if (!req.file) return res.status(400).json({ message: 'Arquivo não enviado.' });

            const funcionario_id = req.body.funcionario_id || req.user.id;
            const data_inicio = req.body.data_inicio;
            const data_fim = req.body.data_fim;
            const nome_medico = req.body.nome_medico || null;
            const crm = req.body.crm || null;
            const tipo_atestado = req.body.tipo_atestado || null;
            const cid = req.body.cid || null;
            const observacoes = req.body.observacoes || null;
            const data_atestado = new Date().toISOString().slice(0, 10);

            // Criar tabela se não existir com todos os campos
            await pool.query(`
                CREATE TABLE IF NOT EXISTS atestados (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    funcionario_id INT NOT NULL,
                    data_atestado DATE,
                    data_inicio DATE,
                    data_fim DATE,
                    arquivo VARCHAR(255),
                    nome_medico VARCHAR(255),
                    crm VARCHAR(50),
                    tipo_atestado VARCHAR(100),
                    cid VARCHAR(20),
                    observacoes TEXT,
                    status VARCHAR(20) DEFAULT 'Pendente',
                    aprovado_por INT,
                    data_aprovacao DATETIME,
                    motivo_recusa TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Adicionar colunas se não existirem (para tabelas já criadas)
            const colunasExtras = [
                'ALTER TABLE atestados ADD COLUMN IF NOT EXISTS nome_medico VARCHAR(255)',
                'ALTER TABLE atestados ADD COLUMN IF NOT EXISTS crm VARCHAR(50)',
                'ALTER TABLE atestados ADD COLUMN IF NOT EXISTS tipo_atestado VARCHAR(100)',
                'ALTER TABLE atestados ADD COLUMN IF NOT EXISTS cid VARCHAR(20)'
            ];
            for (const sql of colunasExtras) {
                try { await pool.query(sql); } catch (e) { /* coluna já existe */ }
            }

            await pool.query(
                `INSERT INTO atestados
                (funcionario_id, data_atestado, data_inicio, data_fim, arquivo_url, nome_medico, crm, tipo_atestado, cid, observacoes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [funcionario_id, data_atestado, data_inicio || null, data_fim || null,
                 `/uploads/RH/atestados/${req.file.filename}`,
                 nome_medico, crm, tipo_atestado, cid, observacoes]
            );

            res.status(201).json({ message: 'Atestado enviado com sucesso!' });
        } catch (e) {
            console.error('Erro ao enviar atestado:', e);
            next(e);
        }
    });

    // AVISOS
    router.get('/avisos', async (req, res, next) => {
        try {
            // Garantir que tabela existe
            await pool.query(`
                CREATE TABLE IF NOT EXISTS avisos (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    titulo VARCHAR(255),
                    mensagem TEXT,
                    conteudo TEXT,
                    tipo VARCHAR(50) DEFAULT 'info',
                    usuario_id INT,
                    lido BOOLEAN DEFAULT FALSE,
                    data_publicacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
            `);

            // Adicionar colunas se não existirem (para tabelas antigas)
            try {
                await pool.query(`ALTER TABLE avisos ADD COLUMN IF NOT EXISTS tipo VARCHAR(50) DEFAULT 'info'`);
                await pool.query(`ALTER TABLE avisos ADD COLUMN IF NOT EXISTS conteudo TEXT`);
                await pool.query(`ALTER TABLE avisos ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);
            } catch (e) { /* Colunas já existem ou DB não suporta IF NOT EXISTS */ }

            // Query segura - usando apenas colunas existentes
            const [rows] = await pool.query(`
                SELECT
                    id,
                    titulo,
                    COALESCE(conteudo, '') as conteudo,
                    COALESCE(tipo, 'info') as tipo,
                    COALESCE(data_publicacao, NOW()) as data_publicacao
                FROM avisos
                ORDER BY data_publicacao DESC
                LIMIT 50
            `);
            res.json(rows);
        } catch (e) { next(e); }
    });
    router.post('/avisos', [
        authorizeAdmin,
        body('titulo').trim().notEmpty().withMessage('Título é obrigatório')
            .isLength({ max: 255 }).withMessage('Título muito longo (máx 255 caracteres)'),
        body('conteudo').trim().notEmpty().withMessage('Conteúdo é obrigatório')
            .isLength({ max: 5000 }).withMessage('Conteúdo muito longo (máx 5000 caracteres)'),
        validate
    ], async (req, res, next) => {
        try {
            const { titulo, conteudo } = req.body;
            await pool.query('INSERT INTO avisos (titulo, conteudo, data_publicacao) VALUES (?, ?, NOW())', [titulo, conteudo]);
            res.status(201).json({ message: 'Aviso publicado!' });
        } catch (e) { next(e); }
    });
    router.delete('/avisos/:id', [
        authorizeAdmin,
        param('id').isInt({ min: 1 }).withMessage('ID do aviso inválido'),
        validate
    ], async (req, res, next) => {
        try {
            const [result] = await pool.query('DELETE FROM avisos WHERE id = ?', [req.params.id]);
            if (result.affectedRows === 0) return res.status(404).json({ message: 'Aviso não encontrado.' });
            res.status(204).send();
        } catch (e) { next(e); }
    });

    // =====================================================
    // SOLICITAÇÕES RH
    // =====================================================

    // Criar tabela de solicitações se não existir
    async function criarTabelaSolicitacoes() {
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS rh_solicitacoes (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    funcionario_id INT,
                    funcionario_nome VARCHAR(255),
                    funcionario_email VARCHAR(255),
                    tipo VARCHAR(100) NOT NULL,
                    categoria VARCHAR(100),
                    assunto VARCHAR(255),
                    descricao TEXT,
                    prioridade VARCHAR(20) DEFAULT 'normal',
                    status VARCHAR(30) DEFAULT 'Pendente',
                    anexo VARCHAR(255),
                    resposta TEXT,
                    respondido_por INT,
                    data_resposta DATETIME,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                )
            `);
        } catch (e) {
            console.error('Erro ao criar tabela rh_solicitacoes:', e);
        }
    }
    criarTabelaSolicitacoes();

    // Listar solicitações do usuário logado
    // Buscar solicitações de um funcionário específico (por ID)
    router.get('/funcionarios/:id/solicitacoes', async (req, res, next) => {
        try {
            const { id } = req.params;
            const [rows] = await pool.query(`
                SELECT * FROM rh_solicitacoes
                WHERE funcionario_id = ?
                ORDER BY created_at DESC
            `, [id]);

            const stats = {
                total: rows.length,
                pendentes: rows.filter(r => r.status === 'Pendente').length,
                em_analise: rows.filter(r => r.status === 'Em Análise').length,
                aprovadas: rows.filter(r => r.status === 'Aprovada' || r.status === 'Aprovado').length,
                recusadas: rows.filter(r => r.status === 'Recusada' || r.status === 'Recusado').length
            };

            res.json({ solicitacoes: rows, stats });
        } catch (e) {
            console.error('Erro ao buscar solicitações do funcionário:', e);
            next(e);
        }
    });

    router.get('/solicitacoes', async (req, res, next) => {
        try {
            const userEmail = req.user.email;
            const [rows] = await pool.query(`
                SELECT * FROM rh_solicitacoes
                WHERE funcionario_email = ?
                ORDER BY created_at DESC
            `, [userEmail]);

            // Calcular estatísticas
            const stats = {
                total: rows.length,
                pendentes: rows.filter(r => r.status === 'Pendente').length,
                em_analise: rows.filter(r => r.status === 'Em Análise').length,
                aprovadas: rows.filter(r => r.status === 'Aprovada' || r.status === 'Aprovado').length,
                recusadas: rows.filter(r => r.status === 'Recusada' || r.status === 'Recusado').length
            };

            res.json({ solicitacoes: rows, stats });
        } catch (e) {
            console.error('Erro ao listar solicitações:', e);
            next(e);
        }
    });

    // Listar todas as solicitações (admin)
    router.get('/solicitacoes/todas', authorizeAdmin, async (req, res, next) => {
        try {
            const { status, tipo } = req.query;
            let sql = 'SELECT id, tipo, categoria, assunto, descricao, status, prioridade, funcionario_id, funcionario_email, funcionario_nome, created_at, updated_at FROM rh_solicitacoes WHERE 1=1';
            const params = [];

            if (status) {
                sql += ' AND status = ?';
                params.push(status);
            }
            if (tipo) {
                sql += ' AND tipo = ?';
                params.push(tipo);
            }

            sql += ' ORDER BY created_at DESC LIMIT 300';

            const [rows] = await pool.query(sql, params);
            res.json(rows);
        } catch (e) { next(e); }
    });

    // Criar nova solicitação
    router.post('/solicitacoes', upload.single('anexo'), async (req, res, next) => {
        try {
            const { tipo, categoria, assunto, descricao, prioridade, funcionario_id } = req.body;
            const userEmail = req.user.email;
            const userName = req.user.nome || req.user.apelido || 'Usuário';

            // Definir assunto automaticamente se não fornecido
            let assuntoFinal = assunto;
            if (!assuntoFinal && tipo && categoria) {
                assuntoFinal = `${tipo} - ${categoria}`;
            } else if (!assuntoFinal && tipo) {
                assuntoFinal = tipo;
            }

            const anexoFile = req.file ? req.file.filename : null;

            const [result] = await pool.query(`
                INSERT INTO rh_solicitacoes
                (funcionario_id, funcionario_nome, funcionario_email, tipo, categoria, assunto, descricao, prioridade, anexo)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [funcionario_id || null, userName, userEmail, tipo, categoria, assuntoFinal, descricao, prioridade || 'normal', anexoFile]);

            res.status(201).json({
                message: 'Solicitação enviada com sucesso!',
                id: result.insertId
            });
        } catch (e) {
            console.error('Erro ao criar solicitação:', e);
            next(e);
        }
    });

    // Atualizar status da solicitação (admin)
    router.put('/solicitacoes/:id/status', authorizeAdmin, async (req, res, next) => {
        try {
            const { id } = req.params;
            const { status, resposta } = req.body;

            await pool.query(`
                UPDATE rh_solicitacoes
                SET status = ?, resposta = ?, respondido_por = ?, data_resposta = NOW()
                WHERE id = ?
            `, [status, resposta || null, req.user.id, id]);

            res.json({ message: 'Status atualizado com sucesso!' });
        } catch (e) { next(e); }
    });

    // Deletar solicitação
    router.delete('/solicitacoes/:id', async (req, res, next) => {
        try {
            const { id } = req.params;
            const userEmail = req.user.email;

            // Verificar se a solicitação pertence ao usuário
            const [rows] = await pool.query('SELECT * FROM rh_solicitacoes WHERE id = ?', [id]);
            if (rows.length === 0) {
                return res.status(404).json({ message: 'Solicitação não encontrada.' });
            }

            // Admin pode deletar qualquer solicitação
            const isAdmin = req.user.role === 'admin' || ['rh@aluforce.ind.br', 'ti@aluforce.ind.br'].includes(userEmail.toLowerCase());
            if (rows[0].funcionario_email !== userEmail && !isAdmin) {
                return res.status(403).json({ message: 'Sem permissão para deletar esta solicitação.' });
            }

            await pool.query('DELETE FROM rh_solicitacoes WHERE id = ?', [id]);
            res.json({ message: 'Solicitação deletada.' });
        } catch (e) { next(e); }
    });

    // DASHBOARD RH
    router.get('/dashboard', async (req, res, next) => {
        try {
            const [[{ totalFuncionarios = 0 } = {}]] = await pool.query('SELECT COUNT(*) AS totalFuncionarios FROM funcionarios');
            const [aniversariantes] = await pool.query('SELECT id, nome_completo, data_nascimento FROM funcionarios WHERE MONTH(data_nascimento) = MONTH(CURRENT_DATE())');
            res.json({ stats: { totalFuncionarios }, aniversariantes });
        } catch (e) { next(e); }
    });

    // AVISOS/NOTIFICAÇÕES - ROTA DUPLICADA REMOVIDA (já existe acima)
    // A rota principal de avisos está definida anteriormente no código

    router.get('/avisos/stream', async (req, res, next) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        // Enviar comentário inicial para manter conexão
        res.write(': connected\n\n');

        const interval = setInterval(() => {
            res.write('data: {"type":"ping"}\n\n');
        }, 30000);

        req.on('close', () => {
            clearInterval(interval);
        });
    });

    router.post('/avisos/sse-handshake', async (req, res, next) => {
        try {
            res.json({ success: true });
        } catch (e) {
            res.json({ success: false });
        }
    });

    // STATUS DE DOCUMENTOS DO FUNCIONÁRIO
    router.get('/funcionarios/:id/doc-status', async (req, res, next) => {
        try {
            const { id } = req.params;

            // Verificar se é o próprio usuário ou admin
            if (req.user.id !== parseInt(id) && req.user.role !== 'admin' && req.user.is_admin !== 1) {
                return res.status(403).json({ message: 'Acesso negado' });
            }

            // Buscar status de documentos
            const [rows] = await pool.query(`
                SELECT
                    CASE WHEN cpf IS NOT NULL AND cpf != '' THEN 1 ELSE 0 END as cpf_ok,
                    CASE WHEN rg IS NOT NULL AND rg != '' THEN 1 ELSE 0 END as rg_ok,
                    CASE WHEN ctps IS NOT NULL AND ctps != '' THEN 1 ELSE 0 END as ctps_ok,
                    CASE WHEN pis_pasep IS NOT NULL AND pis_pasep != '' THEN 1 ELSE 0 END as pis_ok,
                    CASE WHEN titulo_eleitor IS NOT NULL AND titulo_eleitor != '' THEN 1 ELSE 0 END as titulo_ok,
                    CASE WHEN certificado_reservista IS NOT NULL AND certificado_reservista != '' THEN 1 ELSE 0 END as reservista_ok,
                    CASE WHEN cnh IS NOT NULL AND cnh != '' THEN 1 ELSE 0 END as cnh_ok
                FROM funcionarios
                WHERE id = ?
            `, [id]);

            if (rows.length === 0) {
                return res.json({
                    cpf_ok: 0, rg_ok: 0, ctps_ok: 0, pis_ok: 0,
                    titulo_ok: 0, reservista_ok: 0, cnh_ok: 0
                });
            }

            res.json(rows[0]);
        } catch (error) {
            console.error('Erro ao buscar status de documentos:', error);
            res.json({
                cpf_ok: 0, rg_ok: 0, ctps_ok: 0, pis_ok: 0,
                titulo_ok: 0, reservista_ok: 0, cnh_ok: 0
            });
        }
    });

    // ============================================================
    // GESTÃO DE HOLERITES (COMPLETA)
    // ============================================================

    // AUDIT-FIX ARCH-002: rh_holerites_gestao DDL moved to database/migrations/startup-tables.js
    // Table is created at server startup via runMigrations(). No inline DDL here.

    // GET /api/rh/holerites/eventos/padrao - Eventos padrão de folha
    router.get('/holerites/eventos/padrao', async (req, res) => {
        try {
            const eventosPadrao = [
                { codigo: '001', descricao: 'Salário Base', tipo: 'provento' },
                { codigo: '002', descricao: 'Horas Extras 50%', tipo: 'provento' },
                { codigo: '003', descricao: 'Horas Extras 100%', tipo: 'provento' },
                { codigo: '004', descricao: 'Adicional Noturno', tipo: 'provento' },
                { codigo: '005', descricao: 'Adicional Insalubridade', tipo: 'provento' },
                { codigo: '006', descricao: 'Adicional Periculosidade', tipo: 'provento' },
                { codigo: '007', descricao: 'Comissões', tipo: 'provento' },
                { codigo: '008', descricao: 'Gratificação', tipo: 'provento' },
                { codigo: '009', descricao: 'DSR s/ Horas Extras', tipo: 'provento' },
                { codigo: '010', descricao: 'Férias', tipo: 'provento' },
                { codigo: '011', descricao: '1/3 Férias', tipo: 'provento' },
                { codigo: '012', descricao: '13º Salário', tipo: 'provento' },
                { codigo: '013', descricao: 'Salário Família', tipo: 'provento' },
                { codigo: '014', descricao: 'Ajuda de Custo', tipo: 'provento' },
                { codigo: '015', descricao: 'Prêmio Assiduidade', tipo: 'provento' },
                { codigo: '050', descricao: 'INSS', tipo: 'desconto' },
                { codigo: '051', descricao: 'IRRF', tipo: 'desconto' },
                { codigo: '052', descricao: 'Vale-Transporte (6%)', tipo: 'desconto' },
                { codigo: '053', descricao: 'Vale-Refeição', tipo: 'desconto' },
                { codigo: '054', descricao: 'Plano de Saúde', tipo: 'desconto' },
                { codigo: '055', descricao: 'Plano Odontológico', tipo: 'desconto' },
                { codigo: '056', descricao: 'Contribuição Sindical', tipo: 'desconto' },
                { codigo: '057', descricao: 'Faltas/Atrasos', tipo: 'desconto' },
                { codigo: '058', descricao: 'Adiantamento Salarial', tipo: 'desconto' },
                { codigo: '059', descricao: 'Empréstimo Consignado', tipo: 'desconto' },
                { codigo: '060', descricao: 'Pensão Alimentícia', tipo: 'desconto' },
                { codigo: '061', descricao: 'Seguro de Vida', tipo: 'desconto' }
            ];
            res.json(eventosPadrao);
        } catch (error) {
            console.error('Erro ao buscar eventos padrão:', error);
            res.status(500).json({ message: 'Erro ao buscar eventos padrão' });
        }
    });

    // GET /api/rh/holerites/relatorio/visualizacoes - Relatório
    router.get('/holerites/relatorio/visualizacoes', authorizeAdmin, async (req, res) => {
        try {
            const { mes, ano } = req.query;
            let sql = `
                SELECT h.*, f.nome_completo as funcionario_nome, f.cpf, f.cargo, f.departamento
                FROM rh_holerites_gestao h
                JOIN funcionarios f ON f.id = h.funcionario_id
                WHERE h.status = 'publicado'
            `;
            const params = [];
            if (mes) { sql += ' AND h.mes = ?'; params.push(parseInt(mes)); }
            if (ano) { sql += ' AND h.ano = ?'; params.push(parseInt(ano)); }
            sql += ' ORDER BY f.nome_completo';

            const [rows] = await pool.query(sql, params);

            // Gerar HTML do relatório
            const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Relatório de Visualizações</title>
            <style>body{font-family:Arial;margin:20px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:8px;font-size:12px}th{background:#8b5cf6;color:white}tr:nth-child(even){background:#f5f3ff}.ok{color:green}.no{color:red}h1{color:#1e293b;font-size:18px}</style></head>
            <body><h1>Relatório de Visualizações - Holerites ${mes || ''}/${ano || ''}</h1>
            <table><thead><tr><th>Funcionário</th><th>Cargo</th><th>Depto</th><th>Mês/Ano</th><th>Visualizado</th><th>Visualizações</th><th>1ª Visualização</th><th>Confirmado</th></tr></thead><tbody>
            ${rows.map(r => `<tr><td>${r.funcionario_nome}</td><td>${r.cargo || '-'}</td><td>${r.departamento || '-'}</td><td>${String(r.mes).padStart(2,'0')}/${r.ano}</td>
            <td class="${r.visualizado ? 'ok' : 'no'}">${r.visualizado ? '✅ Sim' : '❌ Não'}</td>
            <td>${r.total_visualizacoes || 0}</td><td>${r.data_primeira_visualizacao ? new Date(r.data_primeira_visualizacao).toLocaleString('pt-BR') : '-'}</td>
            <td class="${r.confirmado_recebimento ? 'ok' : 'no'}">${r.confirmado_recebimento ? '✅' : '❌'}</td></tr>`).join('')}
            </tbody></table><p style="margin-top:20px;color:#64748b;font-size:12px">Total: ${rows.length} holerites | Gerado em ${new Date().toLocaleString('pt-BR')}</p></body></html>`;

            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(html);
        } catch (error) {
            console.error('Erro ao gerar relatório:', error);
            res.status(500).json({ message: 'Erro ao gerar relatório' });
        }
    });

    // GET /api/rh/holerites/meu-ultimo - Último holerite publicado do funcionário logado (sem exigir admin)
    router.get('/holerites/meu-ultimo', async (req, res) => {
        try {
            const userId = req.user?.id;
            if (!userId) return res.status(401).json({ message: 'Não autenticado' });

            // Buscar funcionario_id do usuário logado (tabela não tem user_id, usar email ou id direto)
            const userEmail = req.user?.email;
            const [funcRows] = await pool.query(
                'SELECT id FROM funcionarios WHERE id = ? OR email = ?',
                [userId, userEmail || '']
            );
            const funcionarioId = funcRows.length > 0 ? funcRows[0].id : userId;

            // Buscar o holerite publicado mais recente
            const [rows] = await pool.query(
                `SELECT h.id, h.mes, h.ano, h.salario_liquido, h.total_proventos, h.total_descontos, h.status, h.visualizado
                 FROM rh_holerites_gestao h
                 WHERE h.funcionario_id = ? AND h.status = 'publicado'
                 ORDER BY h.ano DESC, h.mes DESC
                 LIMIT 1`,
                [funcionarioId]
            );

            if (rows.length === 0) {
                return res.json({ encontrado: false });
            }

            res.json({ encontrado: true, holerite: rows[0] });
        } catch (error) {
            console.error('Erro ao buscar último holerite:', error);
            res.status(500).json({ message: 'Erro ao buscar último holerite' });
        }
    });

    // GET /api/rh/holerites - Listar holerites com filtros
    router.get('/holerites', authorizeAdmin, async (req, res) => {
        try {
            const { funcionario_id, mes, ano, status } = req.query;

            let sql = `
                SELECT h.*, f.nome_completo as funcionario_nome, f.cpf, f.cargo, f.departamento
                FROM rh_holerites_gestao h
                JOIN funcionarios f ON f.id = h.funcionario_id
                WHERE 1=1
            `;
            const params = [];

            if (funcionario_id) { sql += ' AND h.funcionario_id = ?'; params.push(parseInt(funcionario_id)); }
            if (mes) { sql += ' AND h.mes = ?'; params.push(parseInt(mes)); }
            if (ano) { sql += ' AND h.ano = ?'; params.push(parseInt(ano)); }
            if (status) { sql += ' AND h.status = ?'; params.push(status); }

            sql += ' ORDER BY h.ano DESC, h.mes DESC, f.nome_completo ASC';
            const [holerites] = await pool.query(sql, params);

            // Parse JSON fields
            holerites.forEach(h => {
                try { h.proventos = typeof h.proventos === 'string' ? JSON.parse(h.proventos) : (h.proventos || []); } catch(e) { h.proventos = []; }
                try { h.descontos = typeof h.descontos === 'string' ? JSON.parse(h.descontos) : (h.descontos || []); } catch(e) { h.descontos = []; }
            });

            // Stats — AUDIT-FIX HIGH-009: parameterized instead of inline concatenation
            let statsSql = `
                SELECT
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'publicado' THEN 1 ELSE 0 END) as publicados,
                    SUM(CASE WHEN status = 'rascunho' THEN 1 ELSE 0 END) as rascunhos,
                    SUM(CASE WHEN visualizado = 1 THEN 1 ELSE 0 END) as visualizados
                FROM rh_holerites_gestao
                WHERE 1=1
            `;
            const statsParams = [];
            if (ano) { statsSql += ' AND ano = ?'; statsParams.push(parseInt(ano)); }
            if (mes) { statsSql += ' AND mes = ?'; statsParams.push(parseInt(mes)); }
            const [[stats]] = await pool.query(statsSql, statsParams);

            res.json({ holerites, stats: stats || { total: 0, publicados: 0, rascunhos: 0, visualizados: 0 } });
        } catch (error) {
            console.error('Erro ao listar holerites:', error);
            res.status(500).json({ message: 'Erro ao listar holerites' });
        }
    });

    // GET /api/rh/holerites/download?mes=X&ano=Y - Download do holerite pelo mês/ano do funcionário logado
    // IMPORTANTE: deve ficar ANTES de /holerites/:id para não ser capturada como :id="download"
    router.get('/holerites/download', async (req, res) => {
        try {
            const { mes, ano } = req.query;
            if (!mes || !ano) {
                return res.status(400).json({ message: 'Parâmetros mes e ano são obrigatórios' });
            }

            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({ message: 'Usuário não autenticado' });
            }

            // Buscar funcionario_id do usuário logado (tabela não tem user_id, usar email ou id direto)
            const userEmail = req.user?.email;
            const [funcRows] = await pool.query(
                'SELECT id FROM funcionarios WHERE id = ? OR email = ?',
                [userId, userEmail || '']
            );
            const funcionarioId = funcRows.length > 0 ? funcRows[0].id : userId;

            // Buscar o holerite
            const [rows] = await pool.query(
                `SELECT h.id, h.arquivo_pdf, f.nome_completo, h.mes, h.ano
                 FROM rh_holerites_gestao h
                 JOIN funcionarios f ON f.id = h.funcionario_id
                 WHERE h.funcionario_id = ? AND h.mes = ? AND h.ano = ? AND h.status = 'publicado'
                 ORDER BY h.created_at DESC LIMIT 1`,
                [funcionarioId, parseInt(mes), parseInt(ano)]
            );

            if (rows.length === 0 || !rows[0].arquivo_pdf) {
                return res.status(404).json({ message: 'Holerite não encontrado para o período informado' });
            }

            const h = rows[0];
            const absolutePath = process.platform !== 'win32'
                ? path.join('/var/www', h.arquivo_pdf)
                : path.join(__dirname, '..', 'public', h.arquivo_pdf);

            if (!fs.existsSync(absolutePath)) {
                return res.status(404).json({ message: 'Arquivo PDF não encontrado no servidor' });
            }

            const meses = ['','Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
            const nomeArquivo = `Holerite_${h.nome_completo.replace(/\s+/g, '_')}_${meses[h.mes]}_${h.ano}.pdf`;

            res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);
            res.setHeader('Content-Type', 'application/pdf');
            fs.createReadStream(absolutePath).pipe(res);
        } catch (error) {
            console.error('Erro ao baixar holerite por período:', error);
            res.status(500).json({ message: 'Erro ao baixar holerite' });
        }
    });

    // GET /api/rh/holerites/:id - Buscar holerite por ID
    router.get('/holerites/:id', async (req, res) => {
        try {
            const [rows] = await pool.query(`
                SELECT h.*, f.nome_completo as funcionario_nome, f.cpf, f.cargo, f.departamento
                FROM rh_holerites_gestao h
                JOIN funcionarios f ON f.id = h.funcionario_id
                WHERE h.id = ?
            `, [req.params.id]);

            if (rows.length === 0) return res.status(404).json({ message: 'Holerite não encontrado' });

            const h = rows[0];
            try { h.proventos = typeof h.proventos === 'string' ? JSON.parse(h.proventos) : (h.proventos || []); } catch(e) { h.proventos = []; }
            try { h.descontos = typeof h.descontos === 'string' ? JSON.parse(h.descontos) : (h.descontos || []); } catch(e) { h.descontos = []; }

            // Se é o próprio funcionário visualizando, registrar visualização
            if (req.user && req.user.id === h.funcionario_id) {
                const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress || '';
                if (!h.visualizado) {
                    await pool.query(`UPDATE rh_holerites_gestao SET visualizado = 1, data_primeira_visualizacao = NOW(), data_ultima_visualizacao = NOW(), total_visualizacoes = 1, ip_visualizacao = ? WHERE id = ?`, [ip, h.id]);
                } else {
                    await pool.query(`UPDATE rh_holerites_gestao SET data_ultima_visualizacao = NOW(), total_visualizacoes = total_visualizacoes + 1, ip_visualizacao = ? WHERE id = ?`, [ip, h.id]);
                }
            }

            res.json(h);
        } catch (error) {
            console.error('Erro ao buscar holerite:', error);
            res.status(500).json({ message: 'Erro ao buscar holerite' });
        }
    });

    // POST /api/rh/holerites - Criar holerite
    router.post('/holerites', authorizeAdmin, async (req, res) => {
        try {
            const { funcionario_id, mes, ano, proventos, descontos, status } = req.body;

            if (!funcionario_id || !mes || !ano) {
                return res.status(400).json({ message: 'Funcionário, mês e ano são obrigatórios' });
            }

            const totalProventos = (proventos || []).reduce((sum, p) => sum + (parseFloat(p.valor) || 0), 0);
            const totalDescontos = (descontos || []).reduce((sum, d) => sum + (parseFloat(d.valor) || 0), 0);
            const salarioLiquido = totalProventos - totalDescontos;

            const [result] = await pool.query(`
                INSERT INTO rh_holerites_gestao (funcionario_id, mes, ano, proventos, descontos, total_proventos, total_descontos, salario_liquido, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                funcionario_id, parseInt(mes), parseInt(ano),
                JSON.stringify(proventos || []), JSON.stringify(descontos || []),
                totalProventos, totalDescontos, salarioLiquido,
                status || 'rascunho'
            ]);

            res.json({ message: 'Holerite criado com sucesso!', id: result.insertId });
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY') {
                return res.status(400).json({ message: 'Já existe um holerite para este funcionário neste período' });
            }
            console.error('Erro ao criar holerite:', error);
            res.status(500).json({ message: 'Erro ao criar holerite' });
        }
    });

    // POST /api/rh/holerites/gerar - geração em lote via modal do dashboard RH
    router.post('/holerites/gerar', authorizeAdmin, async (req, res) => {
        try {
            const {
                competencia,
                tipo_geracao,
                filtro_departamento,
                filtro_funcionario,
                formato_saida,
                dias_trabalhados,
                horas_extras,
                faltas,
                outros_descontos,
                observacoes_holerite
            } = req.body || {};

            if (!competencia || !/^\d{4}-\d{2}$/.test(String(competencia))) {
                return res.status(400).json({ message: 'Competência inválida. Use YYYY-MM.' });
            }

            const [anoStr, mesStr] = String(competencia).split('-');
            const ano = parseInt(anoStr, 10);
            const mes = parseInt(mesStr, 10);

            let sql = `
                SELECT id, nome_completo, email, cargo, departamento,
                       COALESCE(salario, salario_base, 0) AS salario_base
                FROM funcionarios
                WHERE (status = 'Ativo' OR status = 'ativo' OR ativo = 1)
            `;
            const params = [];

            if (tipo_geracao === 'departamento') {
                if (!filtro_departamento) {
                    return res.status(400).json({ message: 'Departamento é obrigatório para este tipo de geração.' });
                }
                sql += ' AND departamento = ?';
                params.push(filtro_departamento);
            }

            if (tipo_geracao === 'funcionario') {
                if (!filtro_funcionario) {
                    return res.status(400).json({ message: 'Funcionário é obrigatório para este tipo de geração.' });
                }
                sql += ' AND id = ?';
                params.push(parseInt(filtro_funcionario, 10));
            }

            sql += ' ORDER BY nome_completo ASC';
            const [funcionarios] = await pool.query(sql, params);

            if (!funcionarios.length) {
                return res.status(404).json({ message: 'Nenhum funcionário encontrado para os filtros selecionados.' });
            }

            const dias = Number(dias_trabalhados || 30);
            const horasExtras = Number(horas_extras || 0);
            const faltasDias = Number(faltas || 0);
            const outros = Number(outros_descontos || 0);

            let arquivosGerados = 0;
            let emailsEnviados = 0;
            const detalhes = [];

            for (const f of funcionarios) {
                const salarioBase = Number(f.salario_base || 0);
                const valorHora = salarioBase > 0 ? salarioBase / 220 : 0;
                const totalHorasExtras = horasExtras * valorHora * 1.5;
                const descontoFaltas = faltasDias * (salarioBase / 30);

                const totalProventos = Math.max(0, salarioBase + totalHorasExtras);
                const inss = totalProventos * 0.11;
                const baseIrrf = Math.max(0, totalProventos - inss);
                const irrf = baseIrrf > 2259.2 ? baseIrrf * 0.075 : 0;
                const totalDescontos = Math.max(0, inss + irrf + descontoFaltas + outros);
                const salarioLiquido = Math.max(0, totalProventos - totalDescontos);

                const proventos = [
                    { codigo: '001', descricao: 'Salário Base', referencia: `${dias} dias`, valor: Number(salarioBase.toFixed(2)) },
                    { codigo: '002', descricao: 'Horas Extras', referencia: `${horasExtras}h`, valor: Number(totalHorasExtras.toFixed(2)) }
                ];

                const descontos = [
                    { codigo: '050', descricao: 'INSS', referencia: '', valor: Number(inss.toFixed(2)) },
                    { codigo: '051', descricao: 'IRRF', referencia: '', valor: Number(irrf.toFixed(2)) },
                    { codigo: '052', descricao: 'Faltas', referencia: `${faltasDias} dia(s)`, valor: Number(descontoFaltas.toFixed(2)) },
                    { codigo: '099', descricao: 'Outros Descontos', referencia: '', valor: Number(outros.toFixed(2)) }
                ];

                const [exists] = await pool.query(
                    'SELECT id FROM rh_holerites_gestao WHERE funcionario_id = ? AND mes = ? AND ano = ? LIMIT 1',
                    [f.id, mes, ano]
                );

                if (exists.length) {
                    await pool.query(`
                        UPDATE rh_holerites_gestao
                        SET proventos = ?,
                            descontos = ?,
                            total_proventos = ?,
                            total_descontos = ?,
                            salario_liquido = ?,
                            observacoes = ?,
                            updated_at = NOW()
                        WHERE id = ?
                    `, [
                        JSON.stringify(proventos),
                        JSON.stringify(descontos),
                        Number(totalProventos.toFixed(2)),
                        Number(totalDescontos.toFixed(2)),
                        Number(salarioLiquido.toFixed(2)),
                        observacoes_holerite || null,
                        exists[0].id
                    ]);
                } else {
                    await pool.query(`
                        INSERT INTO rh_holerites_gestao
                            (funcionario_id, mes, ano, proventos, descontos, total_proventos, total_descontos, salario_liquido, status, observacoes)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'rascunho', ?)
                    `, [
                        f.id,
                        mes,
                        ano,
                        JSON.stringify(proventos),
                        JSON.stringify(descontos),
                        Number(totalProventos.toFixed(2)),
                        Number(totalDescontos.toFixed(2)),
                        Number(salarioLiquido.toFixed(2)),
                        observacoes_holerite || null
                    ]);
                }

                arquivosGerados += 1;
                if (String(formato_saida || '').toLowerCase() === 'email') {
                    // Placeholder de envio: contabiliza elegíveis para manter compatibilidade com UI.
                    if (f.email) emailsEnviados += 1;
                }

                detalhes.push({ funcionario_id: f.id, nome: f.nome_completo, departamento: f.departamento });
            }

            const resultado = {
                success: true,
                competencia,
                total_funcionarios: funcionarios.length,
                arquivos_gerados: arquivosGerados,
                emails_enviados: emailsEnviados,
                detalhes
            };

            if (String(formato_saida || '').toLowerCase() !== 'email') {
                resultado.download_url = `/RH/holerites.html?competencia=${encodeURIComponent(competencia)}`;
            }

            return res.json(resultado);
        } catch (error) {
            console.error('Erro ao gerar holerites em lote:', error);
            return res.status(500).json({ message: 'Erro ao gerar holerites em lote', error: error.message });
        }
    });

    // PUT /api/rh/holerites/:id - Atualizar holerite
    router.put('/holerites/:id', authorizeAdmin, async (req, res) => {
        try {
            const { funcionario_id, mes, ano, proventos, descontos, status } = req.body;

            const totalProventos = (proventos || []).reduce((sum, p) => sum + (parseFloat(p.valor) || 0), 0);
            const totalDescontos = (descontos || []).reduce((sum, d) => sum + (parseFloat(d.valor) || 0), 0);
            const salarioLiquido = totalProventos - totalDescontos;

            const [result] = await pool.query(`
                UPDATE rh_holerites_gestao SET
                    funcionario_id = COALESCE(?, funcionario_id),
                    mes = COALESCE(?, mes),
                    ano = COALESCE(?, ano),
                    proventos = ?,
                    descontos = ?,
                    total_proventos = ?,
                    total_descontos = ?,
                    salario_liquido = ?,
                    status = COALESCE(?, status)
                WHERE id = ?
            `, [
                funcionario_id, mes ? parseInt(mes) : null, ano ? parseInt(ano) : null,
                JSON.stringify(proventos || []), JSON.stringify(descontos || []),
                totalProventos, totalDescontos, salarioLiquido,
                status, req.params.id
            ]);

            if (result.affectedRows === 0) return res.status(404).json({ message: 'Holerite não encontrado' });
            res.json({ message: 'Holerite atualizado com sucesso!' });
        } catch (error) {
            console.error('Erro ao atualizar holerite:', error);
            res.status(500).json({ message: 'Erro ao atualizar holerite' });
        }
    });

    // DELETE /api/rh/holerites/:id - Excluir holerite
    router.delete('/holerites/:id', authorizeAdmin, async (req, res) => {
        try {
            const [result] = await pool.query('DELETE FROM rh_holerites_gestao WHERE id = ?', [req.params.id]);
            if (result.affectedRows === 0) return res.status(404).json({ message: 'Holerite não encontrado' });
            res.json({ message: 'Holerite excluído com sucesso!' });
        } catch (error) {
            console.error('Erro ao excluir holerite:', error);
            res.status(500).json({ message: 'Erro ao excluir holerite' });
        }
    });

    // POST /api/rh/holerites/:id/visualizar - Registrar visualização do holerite
    router.post('/holerites/:id/visualizar', async (req, res) => {
        try {
            const [rows] = await pool.query('SELECT id, visualizado FROM rh_holerites_gestao WHERE id = ?', [req.params.id]);
            if (rows.length === 0) return res.status(404).json({ message: 'Holerite não encontrado' });

            const h = rows[0];
            const ip = req.headers['x-forwarded-for'] || req.connection?.remoteAddress || '';

            if (!h.visualizado) {
                await pool.query(
                    `UPDATE rh_holerites_gestao SET visualizado = 1, data_primeira_visualizacao = NOW(), data_ultima_visualizacao = NOW(), total_visualizacoes = 1, ip_visualizacao = ? WHERE id = ?`,
                    [ip, h.id]
                );
            } else {
                await pool.query(
                    `UPDATE rh_holerites_gestao SET data_ultima_visualizacao = NOW(), total_visualizacoes = total_visualizacoes + 1, ip_visualizacao = ? WHERE id = ?`,
                    [ip, h.id]
                );
            }

            res.json({ success: true, message: 'Visualização registrada' });
        } catch (error) {
            console.error('Erro ao registrar visualização do holerite:', error);
            res.status(500).json({ message: 'Erro ao registrar visualização' });
        }
    });

    // POST /api/rh/holerites/:id/publicar - Publicar holerite
    router.post('/holerites/:id/publicar', authorizeAdmin, async (req, res) => {
        try {
            const [result] = await pool.query(
                'UPDATE rh_holerites_gestao SET status = ? WHERE id = ?',
                ['publicado', req.params.id]
            );
            if (result.affectedRows === 0) return res.status(404).json({ message: 'Holerite não encontrado' });
            res.json({ message: 'Holerite publicado com sucesso!' });
        } catch (error) {
            console.error('Erro ao publicar holerite:', error);
            res.status(500).json({ message: 'Erro ao publicar holerite' });
        }
    });

    // ============================================================
    // IMPORTAÇÃO DE HOLERITES EM LOTE (PDF CONSOLIDADO)
    // ============================================================

    // POST /api/rh/holerites/importar-pdf - Importar PDF consolidado e separar por funcionário
    router.post('/holerites/importar-pdf', authorizeAdmin, upload.single('pdf'), async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({ message: 'Nenhum arquivo PDF enviado' });
            }

            const { mes, ano, publicar_automaticamente } = req.body;
            if (!mes || !ano) {
                // Limpar arquivo temporário
                if (req.file.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
                return res.status(400).json({ message: 'Mês e ano são obrigatórios' });
            }

            let pdfParse, PDFLibDocument;
            try {
                pdfParse = require('pdf-parse');
            } catch (e) {
                if (req.file.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
                return res.status(500).json({ message: 'Biblioteca pdf-parse não instalada no servidor' });
            }
            try {
                PDFLibDocument = require('pdf-lib').PDFDocument;
            } catch (e) {
                if (req.file.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
                return res.status(500).json({ message: 'Biblioteca pdf-lib não instalada no servidor. Execute: npm install pdf-lib' });
            }

            const pdfBuffer = fs.readFileSync(req.file.path);

            // 1) Extrair texto página a página usando pdf-parse custom pagerender
            const pages = [];
            const customRender = function(pageData) {
                let text = '';
                const textContent = pageData.getTextContent();
                return textContent.then(function(content) {
                    content.items.forEach(function(item) {
                        text += item.str + ' ';
                    });
                    return text;
                });
            };

            // Primeiro, extrair texto geral para obter nº de páginas
            const pdfData = await pdfParse(pdfBuffer);
            const totalPages = pdfData.numpages;

            // 2) Carregar o PDF com pdf-lib para manipulação de páginas
            const pdfDoc = await PDFLibDocument.load(pdfBuffer);
            const allPages = pdfDoc.getPages();

            // 3) Extrair texto página a página usando a API do pdf-parse com paginação
            // Abordagem: usar pdf-parse com page render customizado para cada página
            const pageTexts = [];
            for (let i = 0; i < totalPages; i++) {
                // Criar PDF de página única para extrair texto
                const singlePageDoc = await PDFLibDocument.create();
                const [copiedPage] = await singlePageDoc.copyPages(pdfDoc, [i]);
                singlePageDoc.addPage(copiedPage);
                const singlePageBytes = await singlePageDoc.save();
                const singlePageData = await pdfParse(Buffer.from(singlePageBytes));
                pageTexts.push(singlePageData.text || '');
            }

            // 4) Buscar todos os funcionários ativos para matching
            const [funcionarios] = await pool.query(`
                SELECT id, nome_completo, cpf, cargo, departamento, salario_base
                FROM funcionarios
                WHERE ativo = 1 OR status = 'ativo'
                ORDER BY nome_completo
            `);

            if (funcionarios.length === 0) {
                if (req.file.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
                return res.status(400).json({ message: 'Nenhum funcionário ativo cadastrado' });
            }

            // 5) Normalizar nomes para comparação
            function normalizeStr(str) {
                return (str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
            }
            function normalizeCPF(cpf) {
                return (cpf || '').replace(/[^\d]/g, '');
            }

            // 6) Agrupar páginas por funcionário
            // Estratégia: cada página (ou bloco de páginas seguidas) pertence a um funcionário
            // Identificar pelo nome completo ou CPF presente no texto
            const pageAssignments = []; // { pageIndex, funcionarioId, funcionarioNome, matched_by }

            for (let i = 0; i < pageTexts.length; i++) {
                const text = pageTexts[i];
                const normalText = normalizeStr(text);
                let matched = null;
                let matchedBy = '';

                // Tentar match por CPF primeiro (mais preciso)
                for (const func of funcionarios) {
                    const cpfLimpo = normalizeCPF(func.cpf);
                    if (cpfLimpo && cpfLimpo.length >= 11 && text.replace(/[^\d]/g, '').includes(cpfLimpo)) {
                        matched = func;
                        matchedBy = 'CPF';
                        break;
                    }
                }

                // Se não encontrou por CPF, tentar por nome completo
                if (!matched) {
                    for (const func of funcionarios) {
                        const normalNome = normalizeStr(func.nome_completo);
                        if (normalNome && normalNome.length > 5 && normalText.includes(normalNome)) {
                            matched = func;
                            matchedBy = 'Nome';
                            break;
                        }
                    }
                }

                // Se não encontrou pelo nome completo, tentar pelo primeiro + último nome
                if (!matched) {
                    for (const func of funcionarios) {
                        const partes = normalizeStr(func.nome_completo).split(/\s+/);
                        if (partes.length >= 2) {
                            const primeiroUltimo = partes[0] + ' ' + partes[partes.length - 1];
                            if (normalText.includes(primeiroUltimo)) {
                                matched = func;
                                matchedBy = 'Nome parcial';
                                break;
                            }
                        }
                    }
                }

                pageAssignments.push({
                    pageIndex: i,
                    funcionarioId: matched ? matched.id : null,
                    funcionarioNome: matched ? matched.nome_completo : null,
                    matchedBy: matchedBy,
                    textPreview: text.substring(0, 200).replace(/\n/g, ' ')
                });
            }

            // 7) Agrupar páginas consecutivas do mesmo funcionário
            const groups = [];
            let currentGroup = null;

            for (const pa of pageAssignments) {
                if (!currentGroup || currentGroup.funcionarioId !== pa.funcionarioId) {
                    if (currentGroup) groups.push(currentGroup);
                    currentGroup = {
                        funcionarioId: pa.funcionarioId,
                        funcionarioNome: pa.funcionarioNome,
                        matchedBy: pa.matchedBy,
                        pages: [pa.pageIndex],
                        textPreview: pa.textPreview
                    };
                } else {
                    currentGroup.pages.push(pa.pageIndex);
                }
            }
            if (currentGroup) groups.push(currentGroup);

            // 8) Criar diretório para holerites PDFs
            const holeriteDir = process.platform !== 'win32'
                ? '/var/www/uploads/RH/holerites'
                : path.join(__dirname, '..', 'public', 'uploads', 'RH', 'holerites');
            if (!fs.existsSync(holeriteDir)) {
                fs.mkdirSync(holeriteDir, { recursive: true });
            }

            // 9) Processar cada grupo identificado
            const resultados = {
                total_paginas: totalPages,
                total_grupos: groups.length,
                importados: 0,
                nao_identificados: 0,
                erros: [],
                detalhes: []
            };

            const mesInt = parseInt(mes);
            const anoInt = parseInt(ano);
            const statusHolerite = publicar_automaticamente === 'true' || publicar_automaticamente === true ? 'publicado' : 'rascunho';

            for (const group of groups) {
                if (!group.funcionarioId) {
                    resultados.nao_identificados++;
                    resultados.detalhes.push({
                        paginas: group.pages.map(p => p + 1),
                        status: 'nao_identificado',
                        motivo: 'Funcionário não identificado no texto',
                        preview: group.textPreview
                    });
                    continue;
                }

                try {
                    // Criar PDF individual com as páginas do funcionário
                    const individualDoc = await PDFLibDocument.create();
                    for (const pageIdx of group.pages) {
                        const [copiedPage] = await individualDoc.copyPages(pdfDoc, [pageIdx]);
                        individualDoc.addPage(copiedPage);
                    }
                    const individualBytes = await individualDoc.save();

                    // Salvar arquivo
                    const fileName = `holerite_${group.funcionarioId}_${anoInt}_${String(mesInt).padStart(2, '0')}_${Date.now()}.pdf`;
                    const filePath = path.join(holeriteDir, fileName);
                    fs.writeFileSync(filePath, individualBytes);

                    // URL relativa para o arquivo
                    const arquivoUrl = process.platform !== 'win32'
                        ? `/uploads/RH/holerites/${fileName}`
                        : `/uploads/RH/holerites/${fileName}`;

                    // Extrair valores do texto (tentativa de parse dos proventos/descontos)
                    const textData = pageTexts[group.pages[0]] || '';
                    const extractedData = extrairDadosHolerite(textData);

                    // Verificar se já existe holerite para este funcionário/período
                    const [existing] = await pool.query(
                        'SELECT id FROM rh_holerites_gestao WHERE funcionario_id = ? AND mes = ? AND ano = ?',
                        [group.funcionarioId, mesInt, anoInt]
                    );

                    let holeriteId;
                    if (existing.length > 0) {
                        // Atualizar existente - adicionar arquivo PDF
                        holeriteId = existing[0].id;
                        await pool.query(`
                            UPDATE rh_holerites_gestao SET
                                arquivo_pdf = ?,
                                updated_at = NOW()
                            WHERE id = ?
                        `, [arquivoUrl, holeriteId]);

                        resultados.detalhes.push({
                            paginas: group.pages.map(p => p + 1),
                            funcionario: group.funcionarioNome,
                            funcionario_id: group.funcionarioId,
                            status: 'atualizado',
                            motivo: 'Holerite já existia - PDF anexado',
                            matchedBy: group.matchedBy
                        });
                    } else {
                        // Criar novo holerite
                        const proventos = extractedData.proventos.length > 0 ? extractedData.proventos :
                            [{ codigo: '001', descricao: 'Salário Base', referencia: '220h', valor: 0 }];
                        const descontos = extractedData.descontos.length > 0 ? extractedData.descontos :
                            [{ codigo: '050', descricao: 'INSS', referencia: '', valor: 0 },
                             { codigo: '051', descricao: 'IRRF', referencia: '', valor: 0 }];

                        const totalProventos = proventos.reduce((s, p) => s + (parseFloat(p.valor) || 0), 0);
                        const totalDescontos = descontos.reduce((s, d) => s + (parseFloat(d.valor) || 0), 0);

                        const [insertResult] = await pool.query(`
                            INSERT INTO rh_holerites_gestao
                                (funcionario_id, mes, ano, proventos, descontos, total_proventos, total_descontos, salario_liquido, status, arquivo_pdf)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `, [
                            group.funcionarioId, mesInt, anoInt,
                            JSON.stringify(proventos), JSON.stringify(descontos),
                            totalProventos, totalDescontos, totalProventos - totalDescontos,
                            statusHolerite, arquivoUrl
                        ]);
                        holeriteId = insertResult.insertId;

                        resultados.detalhes.push({
                            paginas: group.pages.map(p => p + 1),
                            funcionario: group.funcionarioNome,
                            funcionario_id: group.funcionarioId,
                            status: 'importado',
                            matchedBy: group.matchedBy,
                            holerite_id: holeriteId
                        });
                    }

                    // Também salvar na tabela legada de holerites (para o portal do funcionário com PDF)
                    try {
                        await pool.query(`
                            INSERT INTO holerites (funcionario_id, competencia, arquivo_url, data_upload)
                            VALUES (?, ?, ?, NOW())
                            ON DUPLICATE KEY UPDATE arquivo_url = VALUES(arquivo_url), data_upload = NOW()
                        `, [group.funcionarioId, `${anoInt}-${String(mesInt).padStart(2, '0')}`, arquivoUrl]);
                    } catch (legacyErr) {
                        // Ignorar erro da tabela legada — não é crítico
                        console.warn('[HOLERITE IMPORT] Aviso ao salvar na tabela legada:', legacyErr.message);
                    }

                    resultados.importados++;

                } catch (groupErr) {
                    console.error(`[HOLERITE IMPORT] Erro ao processar grupo do funcionário ${group.funcionarioNome}:`, groupErr);
                    resultados.erros.push({
                        funcionario: group.funcionarioNome,
                        paginas: group.pages.map(p => p + 1),
                        erro: groupErr.message
                    });
                }
            }

            // Limpar arquivo original temporário
            if (req.file.path && fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }

            console.log(`[HOLERITE IMPORT] Importação concluída: ${resultados.importados} importados, ${resultados.nao_identificados} não identificados de ${totalPages} páginas`);

            res.json({
                message: `Importação concluída! ${resultados.importados} holerites processados de ${totalPages} páginas.`,
                resultados
            });

        } catch (error) {
            console.error('[HOLERITE IMPORT] Erro geral:', error);
            if (req.file && req.file.path && fs.existsSync(req.file.path)) {
                try { fs.unlinkSync(req.file.path); } catch(e) {}
            }
            res.status(500).json({ message: 'Erro ao importar PDF: ' + error.message });
        }
    });

    // Função auxiliar: extrair dados de proventos/descontos do texto do holerite
    function extrairDadosHolerite(text) {
        const proventos = [];
        const descontos = [];

        // Padrões comuns em holerites brasileiros
        // Tenta identificar linhas com: código | descrição | referência | valor
        const lines = text.split('\n');
        let section = 'unknown'; // proventos, descontos, unknown

        for (const line of lines) {
            const upper = line.toUpperCase().trim();
            if (upper.includes('PROVENTO') || upper.includes('VENCIMENTO') || upper.includes('CRÉDITO')) {
                section = 'proventos';
                continue;
            }
            if (upper.includes('DESCONTO') || upper.includes('DEDUÇÃO') || upper.includes('DÉBITO')) {
                section = 'descontos';
                continue;
            }
            if (upper.includes('LÍQUIDO') || upper.includes('TOTAL') || upper.includes('FGTS')) {
                section = 'unknown';
                continue;
            }

            // Tentar extrair valor (último número da linha, formato brasileiro)
            const valorMatch = line.match(/(\d{1,3}(?:\.\d{3})*,\d{2})\s*$/);
            if (valorMatch && section !== 'unknown') {
                const valorStr = valorMatch[1].replace(/\./g, '').replace(',', '.');
                const valor = parseFloat(valorStr);
                if (valor > 0) {
                    // Extrair código e descrição
                    const beforeValue = line.substring(0, line.lastIndexOf(valorMatch[1])).trim();
                    const codeMatch = beforeValue.match(/^(\d{1,4})\s+(.*)/);

                    const item = {
                        codigo: codeMatch ? codeMatch[1].padStart(3, '0') : '000',
                        descricao: codeMatch ? codeMatch[2].trim() : beforeValue,
                        referencia: '',
                        valor: valor
                    };

                    // Tentar separar referência da descrição
                    const refMatch = item.descricao.match(/(.*?)\s+(\d+[.,]?\d*\s*[hH%]?)\s*$/);
                    if (refMatch) {
                        item.descricao = refMatch[1].trim();
                        item.referencia = refMatch[2].trim();
                    }

                    if (section === 'proventos') {
                        proventos.push(item);
                    } else {
                        descontos.push(item);
                    }
                }
            }
        }

        return { proventos, descontos };
    }

    // POST /api/rh/holerites/:id/confirmar - Confirmar recebimento pelo funcionário
    router.post('/holerites/:id/confirmar', async (req, res) => {
        try {
            const [result] = await pool.query(
                'UPDATE rh_holerites_gestao SET confirmado_recebimento = 1, data_confirmacao = NOW() WHERE id = ?',
                [req.params.id]
            );
            if (result.affectedRows === 0) return res.status(404).json({ message: 'Holerite não encontrado' });
            res.json({ message: 'Recebimento confirmado com sucesso!' });
        } catch (error) {
            console.error('Erro ao confirmar recebimento:', error);
            res.status(500).json({ message: 'Erro ao confirmar recebimento' });
        }
    });

    // GET /api/rh/holerites/:id/download-pdf - Download do PDF individual do holerite
    router.get('/holerites/:id/download-pdf', async (req, res) => {
        try {
            const [rows] = await pool.query(
                'SELECT h.arquivo_pdf, f.nome_completo, h.mes, h.ano FROM rh_holerites_gestao h JOIN funcionarios f ON f.id = h.funcionario_id WHERE h.id = ?',
                [req.params.id]
            );
            if (rows.length === 0 || !rows[0].arquivo_pdf) {
                return res.status(404).json({ message: 'PDF não encontrado para este holerite' });
            }

            const h = rows[0];
            const absolutePath = process.platform !== 'win32'
                ? path.join('/var/www', h.arquivo_pdf)
                : path.join(__dirname, '..', 'public', h.arquivo_pdf);

            if (!fs.existsSync(absolutePath)) {
                return res.status(404).json({ message: 'Arquivo PDF não encontrado no servidor' });
            }

            const meses = ['','Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
            const nomeArquivo = `Holerite_${h.nome_completo.replace(/\s+/g, '_')}_${meses[h.mes]}_${h.ano}.pdf`;

            res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);
            res.setHeader('Content-Type', 'application/pdf');
            fs.createReadStream(absolutePath).pipe(res);
        } catch (error) {
            console.error('Erro ao baixar PDF:', error);
            res.status(500).json({ message: 'Erro ao baixar PDF' });
        }
    });

    // GET /api/rh/atividades - Atividades recentes do módulo RH
    router.get('/atividades', async (req, res) => {
        try {
            const limit = req.query.limit ? Math.min(50, Math.max(1, parseInt(req.query.limit, 10))) : 10;
            const atividades = [];

            // 1. Últimas admissões (últimos 90 dias)
            try {
                const [admissoes] = await pool.query(`
                    SELECT nome_completo, cargo, data_admissao as created_at,
                           'fa-user-plus' as icone, '#10b981' as cor
                    FROM funcionarios
                    WHERE data_admissao >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
                    ORDER BY data_admissao DESC LIMIT 5
                `);
                admissoes.forEach(a => {
                    a.titulo = 'Admissão: ' + (a.nome_completo || '') + (a.cargo ? ' (' + a.cargo + ')' : '');
                    delete a.nome_completo; delete a.cargo;
                });
                atividades.push(...admissoes);
            } catch(e) { /* ignore */ }

            // 2. Últimos desligamentos (últimos 90 dias)
            try {
                const [desligamentos] = await pool.query(`
                    SELECT nome_completo, data_demissao as created_at,
                           'fa-user-minus' as icone, '#ef4444' as cor
                    FROM funcionarios
                    WHERE data_demissao IS NOT NULL AND data_demissao >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
                    ORDER BY data_demissao DESC LIMIT 3
                `);
                desligamentos.forEach(d => {
                    d.titulo = 'Desligamento: ' + (d.nome_completo || '');
                    delete d.nome_completo;
                });
                atividades.push(...desligamentos);
            } catch(e) { /* ignore */ }

            // 3. Últimos holerites enviados
            try {
                const [holerites] = await pool.query(`
                    SELECT f.nome_completo, h.data_upload as created_at,
                           'fa-file-invoice-dollar' as icone, '#3b82f6' as cor
                    FROM holerites h JOIN funcionarios f ON h.funcionario_id = f.id
                    WHERE h.data_upload >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
                    ORDER BY h.data_upload DESC LIMIT 3
                `);
                holerites.forEach(h => {
                    h.titulo = 'Holerite disponível: ' + (h.nome_completo || '');
                    delete h.nome_completo;
                });
                atividades.push(...holerites);
            } catch(e) { /* ignore */ }

            // 4. Avisos/comunicados recentes
            try {
                const [avisos] = await pool.query(`
                    SELECT titulo, COALESCE(created_at, data_publicacao) as created_at, 'fa-bullhorn' as icone, '#f59e0b' as cor
                    FROM avisos WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
                       OR data_publicacao >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
                    ORDER BY COALESCE(created_at, data_publicacao) DESC LIMIT 3
                `);
                atividades.push(...avisos);
            } catch(e) { /* ignore */ }

            // Ordenar por data e limitar
            atividades.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            res.json(atividades.slice(0, limit));
        } catch (error) {
            console.error('Erro ao buscar atividades RH:', error);
            res.status(500).json({ message: 'Erro ao buscar atividades' });
        }
    });


    // ==========================================
    // ROTAS DE FÉRIAS
    // ==========================================

    // GET /ferias/saldo/:funcionarioId - Saldo de férias do funcionário
    router.get('/ferias/saldo/:funcionarioId', async (req, res) => {
        try {
            const { funcionarioId } = req.params;

            // Buscar períodos aquisitivos do funcionário
            const [periodos] = await pool.query(`
                SELECT id, funcionario_id, data_inicio, data_fim,
                       dias_direito, dias_gozados, dias_vendidos, dias_disponivel,
                       data_limite_gozo, vencido, status, created_at, updated_at
                FROM ferias_periodos
                WHERE funcionario_id = ?
                ORDER BY data_inicio DESC
            `, [funcionarioId]);

            // Calcular totais
            let totalDisponivel = 0;
            let proximoVencimento = null;

            periodos.forEach(p => {
                if (p.status === 'ativo') {
                    totalDisponivel += (p.dias_disponivel || 0);
                    if (p.data_limite_gozo && (!proximoVencimento || new Date(p.data_limite_gozo) < new Date(proximoVencimento))) {
                        proximoVencimento = p.data_limite_gozo;
                    }
                }
            });

            res.json({
                total_dias_disponivel: totalDisponivel,
                proximo_vencimento: proximoVencimento,
                periodos: periodos
            });
        } catch (error) {
            console.error('Erro ao buscar saldo de férias:', error);
            res.status(500).json({ message: 'Erro ao buscar saldo de férias' });
        }
    });

    // GET /ferias/minhas/:funcionarioId - Histórico de solicitações de férias
    router.get('/ferias/minhas/:funcionarioId', async (req, res) => {
        try {
            const { funcionarioId } = req.params;

            const [solicitacoes] = await pool.query(`
                SELECT s.id, s.funcionario_id, s.periodo_aquisitivo_inicio, s.periodo_aquisitivo_fim,
                       s.data_inicio, s.data_fim, s.dias_solicitados, s.dias_corridos,
                       s.tipo, s.fracao, s.dias_abono, s.valor_terco_ferias, s.valor_abono,
                       s.adiantamento_13, s.status, s.solicitado_em, s.aprovado_por,
                       s.aprovado_em, s.motivo_reprovacao, s.observacoes, s.observacoes_rh,
                       s.created_at, s.updated_at,
                       f.nome_completo as aprovado_por_nome
                FROM ferias_solicitacoes s
                LEFT JOIN funcionarios f ON s.aprovado_por = f.id
                WHERE s.funcionario_id = ?
                ORDER BY s.solicitado_em DESC, s.created_at DESC
            `, [funcionarioId]);

            res.json({
                solicitacoes: solicitacoes,
                total: solicitacoes.length
            });
        } catch (error) {
            console.error('Erro ao buscar solicitações de férias:', error);
            res.status(500).json({ message: 'Erro ao buscar solicitações de férias' });
        }
    });

    // GET /ferias/dashboard - KPIs para gestão administrativa de férias
    router.get('/ferias/dashboard', authorizeAdmin, async (req, res) => {
        try {
            const [[resumoSolicitacoes]] = await pool.query(`
                SELECT
                    SUM(CASE WHEN status = 'pendente' THEN 1 ELSE 0 END) AS total_pendentes,
                    SUM(CASE WHEN status = 'aprovada' AND MONTH(COALESCE(aprovado_em, updated_at, created_at)) = MONTH(CURRENT_DATE())
                        AND YEAR(COALESCE(aprovado_em, updated_at, created_at)) = YEAR(CURRENT_DATE()) THEN 1 ELSE 0 END) AS aprovadas_mes,
                    SUM(CASE WHEN status = 'reprovada' AND MONTH(COALESCE(aprovado_em, updated_at, created_at)) = MONTH(CURRENT_DATE())
                        AND YEAR(COALESCE(aprovado_em, updated_at, created_at)) = YEAR(CURRENT_DATE()) THEN 1 ELSE 0 END) AS reprovadas_mes
                FROM ferias_solicitacoes
            `);

            let vencendo30Dias = 0;
            try {
                const [[vencendo]] = await pool.query(`
                    SELECT COUNT(*) AS total
                    FROM ferias_periodos
                    WHERE status = 'ativo'
                      AND data_limite_gozo IS NOT NULL
                      AND data_limite_gozo BETWEEN CURRENT_DATE() AND DATE_ADD(CURRENT_DATE(), INTERVAL 30 DAY)
                `);
                vencendo30Dias = Number(vencendo?.total || 0);
            } catch (_) {
                vencendo30Dias = 0;
            }

            const resumo = {
                total_pendentes: Number(resumoSolicitacoes?.total_pendentes || 0),
                aprovadas_mes: Number(resumoSolicitacoes?.aprovadas_mes || 0),
                reprovadas_mes: Number(resumoSolicitacoes?.reprovadas_mes || 0),
                vencendo_30_dias: vencendo30Dias
            };

            res.json({ resumo });
        } catch (error) {
            console.error('Erro ao buscar dashboard de férias:', error);
            res.status(500).json({ message: 'Erro ao buscar dashboard de férias' });
        }
    });

    // GET /ferias/pendentes - lista de solicitações pendentes para aprovação
    router.get('/ferias/pendentes', authorizeAdmin, async (req, res) => {
        try {
            const { departamento } = req.query;

            let sql = `
                SELECT
                    s.id,
                    s.funcionario_id,
                    s.data_inicio,
                    s.data_fim,
                    s.dias_solicitados,
                    s.tipo,
                    s.status,
                    s.observacoes,
                    s.solicitado_em,
                    f.nome_completo AS funcionario_nome,
                    f.departamento
                FROM ferias_solicitacoes s
                LEFT JOIN funcionarios f ON f.id = s.funcionario_id
                WHERE s.status = 'pendente'
            `;
            const params = [];

            if (departamento) {
                sql += ' AND f.departamento = ?';
                params.push(departamento);
            }

            sql += ' ORDER BY COALESCE(s.solicitado_em, s.created_at) DESC';

            const [rows] = await pool.query(sql, params);
            res.json(rows);
        } catch (error) {
            console.error('Erro ao buscar pendentes de férias:', error);
            res.status(500).json({ message: 'Erro ao buscar pendentes de férias' });
        }
    });

    // GET /ferias/calendario - calendário de férias (aprovadas e pendentes)
    router.get('/ferias/calendario', authorizeAdmin, async (req, res) => {
        try {
            const [rows] = await pool.query(`
                SELECT
                    s.id,
                    s.funcionario_id,
                    s.data_inicio,
                    s.data_fim,
                    s.status,
                    f.nome_completo AS funcionario_nome,
                    f.departamento
                FROM ferias_solicitacoes s
                LEFT JOIN funcionarios f ON f.id = s.funcionario_id
                WHERE s.status IN ('pendente', 'aprovada', 'reprovada', 'cancelada')
                ORDER BY s.data_inicio ASC
            `);

            res.json(rows);
        } catch (error) {
            console.error('Erro ao buscar calendário de férias:', error);
            res.status(500).json({ message: 'Erro ao buscar calendário de férias' });
        }
    });

    // POST /ferias/aprovar - aprovar solicitação de férias
    router.post('/ferias/aprovar', authorizeAdmin, async (req, res) => {
        try {
            const { solicitacao_id, observacoes_rh } = req.body;

            if (!solicitacao_id) {
                return res.status(400).json({ message: 'solicitacao_id é obrigatório' });
            }

            const [result] = await pool.query(`
                UPDATE ferias_solicitacoes
                SET status = 'aprovada',
                    aprovado_por = ?,
                    aprovado_em = NOW(),
                    observacoes_rh = ?,
                    updated_at = NOW()
                WHERE id = ?
                  AND status = 'pendente'
            `, [req.user?.id || null, observacoes_rh || null, solicitacao_id]);

            if (!result.affectedRows) {
                return res.status(404).json({ message: 'Solicitação pendente não encontrada' });
            }

            res.json({ success: true, message: 'Solicitação aprovada com sucesso' });
        } catch (error) {
            console.error('Erro ao aprovar férias:', error);
            res.status(500).json({ message: 'Erro ao aprovar férias' });
        }
    });

    // POST /ferias/reprovar - reprovar solicitação de férias
    router.post('/ferias/reprovar', authorizeAdmin, async (req, res) => {
        try {
            const { solicitacao_id, motivo_reprovacao } = req.body;

            if (!solicitacao_id || !motivo_reprovacao) {
                return res.status(400).json({ message: 'solicitacao_id e motivo_reprovacao são obrigatórios' });
            }

            const [result] = await pool.query(`
                UPDATE ferias_solicitacoes
                SET status = 'reprovada',
                    aprovado_por = ?,
                    aprovado_em = NOW(),
                    motivo_reprovacao = ?,
                    updated_at = NOW()
                WHERE id = ?
                  AND status = 'pendente'
            `, [req.user?.id || null, motivo_reprovacao, solicitacao_id]);

            if (!result.affectedRows) {
                return res.status(404).json({ message: 'Solicitação pendente não encontrada' });
            }

            res.json({ success: true, message: 'Solicitação reprovada' });
        } catch (error) {
            console.error('Erro ao reprovar férias:', error);
            res.status(500).json({ message: 'Erro ao reprovar férias' });
        }
    });

    // POST /ferias/cancelar - cancelar solicitação de férias (próprio usuário ou admin)
    router.post('/ferias/cancelar', async (req, res) => {
        try {
            const { solicitacao_id } = req.body;

            if (!solicitacao_id) {
                return res.status(400).json({ message: 'solicitacao_id é obrigatório' });
            }

            const [rows] = await pool.query(
                'SELECT id, funcionario_id, status FROM ferias_solicitacoes WHERE id = ? LIMIT 1',
                [solicitacao_id]
            );

            if (!rows.length) {
                return res.status(404).json({ message: 'Solicitação não encontrada' });
            }

            const solicitacao = rows[0];
            if (String(solicitacao.status).toLowerCase() !== 'pendente') {
                return res.status(400).json({ message: 'Somente solicitações pendentes podem ser canceladas' });
            }

            const role = String(req.user?.role || '').toLowerCase();
            const isAdmin = role === 'admin' || req.user?.is_admin === 1 || req.user?.is_admin === true || req.user?.is_admin === '1';
            const isOwner = Number(req.user?.id) === Number(solicitacao.funcionario_id);

            if (!isAdmin && !isOwner) {
                return res.status(403).json({ message: 'Sem permissão para cancelar esta solicitação' });
            }

            await pool.query(
                `UPDATE ferias_solicitacoes
                 SET status = 'cancelada', updated_at = NOW()
                 WHERE id = ?`,
                [solicitacao_id]
            );

            res.json({ success: true, message: 'Solicitação cancelada com sucesso' });
        } catch (error) {
            console.error('Erro ao cancelar férias:', error);
            res.status(500).json({ message: 'Erro ao cancelar férias' });
        }
    });

    // NOTA: Rotas de ponto (marcações, ajustes, histórico) são fornecidas
    // pelo módulo rh-extras.js montado em routes/index.js

    // ==========================================
    // ROTAS DE AVALIAÇÕES
    // ==========================================

    // POST /api/rh/avaliacoes - Enviar auto-avaliação
    router.post('/avaliacoes', async (req, res) => {
        try {
            const userId = req.user?.id;
            if (!userId) return res.status(401).json({ message: 'Não autenticado' });

            const { nota_pessoal, pontos_fortes, pontos_melhoria, objetivos, comentarios } = req.body;

            if (!nota_pessoal && nota_pessoal !== 0) {
                return res.status(400).json({ message: 'A nota pessoal é obrigatória' });
            }

            // Criar tabela se não existir (DDL idempotente)
            await pool.query(`
                CREATE TABLE IF NOT EXISTS rh_avaliacoes (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    funcionario_id INT NOT NULL,
                    tipo ENUM('autoavaliacao','gestor','360') DEFAULT 'autoavaliacao',
                    nota_pessoal DECIMAL(3,1),
                    pontos_fortes TEXT,
                    pontos_melhoria TEXT,
                    objetivos TEXT,
                    comentarios TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    INDEX idx_funcionario (funcionario_id),
                    INDEX idx_created (created_at)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            `);

            const [result] = await pool.query(`
                INSERT INTO rh_avaliacoes (funcionario_id, tipo, nota_pessoal, pontos_fortes, pontos_melhoria, objetivos, comentarios)
                VALUES (?, 'autoavaliacao', ?, ?, ?, ?, ?)
            `, [userId, nota_pessoal, pontos_fortes || null, pontos_melhoria || null, objetivos || null, comentarios || null]);

            res.status(201).json({ success: true, id: result.insertId, message: 'Auto-avaliação enviada com sucesso!' });
        } catch (error) {
            console.error('Erro ao salvar auto-avaliação:', error);
            res.status(500).json({ message: 'Erro ao enviar auto-avaliação' });
        }
    });

    // GET /api/rh/avaliacoes - Listar avaliações do funcionário logado
    router.get('/avaliacoes', async (req, res) => {
        try {
            const userId = req.user?.id;

            // Verificar se a tabela existe
            const [tables] = await pool.query("SHOW TABLES LIKE 'rh_avaliacoes'");
            if (tables.length === 0) return res.json([]);

            const [avaliacoes] = await pool.query(
                'SELECT * FROM rh_avaliacoes WHERE funcionario_id = ? ORDER BY created_at DESC',
                [userId]
            );
            res.json(avaliacoes);
        } catch (error) {
            console.error('Erro ao buscar avaliações:', error);
            res.status(500).json({ message: 'Erro ao buscar avaliações' });
        }
    });

    // ==========================================
    // AVALIAÇÕES DE DESEMPENHO (Enterprise)
    // ==========================================

    // Helper: verifica se usuário é admin
    function isAdminRH(user) {
        const role = (user?.role || '').toLowerCase().trim();
        return role === 'admin' || user?.is_admin === 1 || user?.is_admin === true || user?.is_admin === '1';
    }

    // Helper: verifica se é gestor ou admin
    function isGestorOuAdmin(user) {
        if (isAdminRH(user)) return true;
        const role = (user?.role || '').toLowerCase().trim();
        const cargo = (user?.cargo || '').toLowerCase().trim();
        return ['gestor', 'gerente', 'coordenador', 'supervisor', 'diretor', 'manager'].some(r => role.includes(r) || cargo.includes(r));
    }

    // GET /api/rh/avaliacoes/periodos - Listar períodos de avaliação
    router.get('/avaliacoes/periodos', authenticateToken, async (req, res) => {
        try {
            const [periodos] = await pool.query('SELECT * FROM rh_periodos_avaliacao ORDER BY data_inicio DESC');
            res.json(periodos);
        } catch (error) {
            console.error('Erro ao listar períodos:', error);
            res.status(500).json({ error: 'Erro ao listar períodos de avaliação' });
        }
    });

    // GET /api/rh/avaliacoes/competencias - Listar competências
    router.get('/avaliacoes/competencias', authenticateToken, async (req, res) => {
        try {
            const [competencias] = await pool.query('SELECT * FROM rh_competencias WHERE ativo = TRUE ORDER BY categoria, nome');
            res.json(competencias);
        } catch (error) {
            console.error('Erro ao listar competências:', error);
            res.status(500).json({ error: 'Erro ao listar competências' });
        }
    });

    // POST /api/rh/avaliacoes/criar - Criar avaliação de desempenho
    router.post('/avaliacoes/criar', authenticateToken, async (req, res) => {
        const {
            funcionario_id, periodo_id, avaliador_id, tipo_avaliacao,
            pontos_fortes, pontos_melhoria, comentarios_avaliador, competencias
        } = req.body;

        const userFuncId = Number(req.user.funcionario_id || req.user.id);
        const funcionarioId = Number(funcionario_id);
        const avaliadorId = Number(avaliador_id);
        const ehAutoavaliacao = funcionarioId === userFuncId && avaliadorId === userFuncId;

        if (!ehAutoavaliacao && !isGestorOuAdmin(req.user)) {
            return res.status(403).json({ message: 'Acesso negado. Apenas gestores/administradores podem criar avaliações de colaboradores.' });
        }

        if (!isAdminRH(req.user) && avaliadorId !== userFuncId) {
            return res.status(403).json({ message: 'Acesso negado. O avaliador deve ser o usuário autenticado.' });
        }

        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();

            const [result] = await conn.query(`
                INSERT INTO rh_avaliacoes_desempenho
                (funcionario_id, período_id, avaliador_id, tipo_avaliacao, data_avaliacao, status,
                 pontos_fortes, pontos_melhoria, comentarios_avaliador)
                VALUES (?, ?, ?, ?, CURDATE(), 'RASCUNHO', ?, ?, ?)
            `, [funcionario_id, periodo_id, avaliador_id, tipo_avaliacao, pontos_fortes, pontos_melhoria, comentarios_avaliador]);

            const avaliacaoId = result.insertId;

            if (competencias && competencias.length > 0) {
                for (const comp of competencias) {
                    await conn.query(`
                        INSERT INTO rh_avaliacao_itens (avaliacao_id, competencia_id, nota, peso, comentario)
                        VALUES (?, ?, ?, ?, ?)
                    `, [avaliacaoId, comp.competencia_id, comp.nota, comp.peso || 1.0, comp.comentario || null]);
                }
            }

            await conn.commit();
            res.json({ success: true, id: avaliacaoId });
        } catch (error) {
            await conn.rollback();
            console.error('Erro ao criar avaliação:', error);
            res.status(500).json({ error: 'Erro ao criar avaliação' });
        } finally {
            conn.release();
        }
    });

    // GET /api/rh/avaliacoes/funcionario/:id - Buscar avaliações de um funcionário
    router.get('/avaliacoes/funcionario/:id', authenticateToken, async (req, res) => {
        try {
            const userFuncId = Number(req.user.funcionario_id || req.user.id);
            if (Number(req.params.id) !== userFuncId && !isAdminRH(req.user)) {
                return res.status(403).json({ message: 'Acesso negado. Você só pode visualizar suas próprias avaliações.' });
            }

            const [avaliacoes] = await pool.query(`
                SELECT a.*, p.nome AS periodo_nome,
                       av.nome_completo AS avaliador_nome
                FROM rh_avaliacoes_desempenho a
                LEFT JOIN rh_periodos_avaliacao p ON a.período_id = p.id
                LEFT JOIN funcionarios av ON a.avaliador_id = av.id
                WHERE a.funcionario_id = ?
                ORDER BY a.data_avaliacao DESC
            `, [req.params.id]);

            res.json(avaliacoes);
        } catch (error) {
            console.error('Erro ao buscar avaliações do funcionário:', error);
            res.status(500).json({ error: 'Erro ao buscar avaliações' });
        }
    });

    // GET /api/rh/avaliacoes/dashboard - Dashboard de avaliações (admin)
    router.get('/avaliacoes/dashboard', authenticateToken, async (req, res) => {
        try {
            const [[stats]] = await pool.query(`
                SELECT
                    (SELECT COUNT(*) FROM rh_avaliacoes_desempenho WHERE status = 'CONCLUIDA') AS avaliacoes_concluidas,
                    (SELECT COUNT(*) FROM rh_avaliacoes_desempenho WHERE status = 'RASCUNHO') AS avaliacoes_pendentes,
                    (SELECT COUNT(*) FROM rh_periodos_avaliacao WHERE ativo = TRUE) AS periodos_ativos,
                    (SELECT COUNT(*) FROM rh_competencias WHERE ativo = TRUE) AS competencias_ativas
            `);
            res.json(stats);
        } catch (error) {
            console.error('Erro ao buscar dashboard avaliações:', error);
            res.status(500).json({ error: 'Erro ao buscar dados do dashboard' });
        }
    });

    // GET /api/rh/avaliacoes/:id - Detalhes de uma avaliação com itens
    router.get('/avaliacoes/:id', authenticateToken, async (req, res) => {
        try {
            const [avaliacoes] = await pool.query(`
                SELECT a.*, f.nome_completo AS funcionario_nome, f.cargo,
                       av.nome_completo AS avaliador_nome, p.nome AS periodo_nome
                FROM rh_avaliacoes_desempenho a
                INNER JOIN funcionarios f ON a.funcionario_id = f.id
                LEFT JOIN funcionarios av ON a.avaliador_id = av.id
                LEFT JOIN rh_periodos_avaliacao p ON a.período_id = p.id
                WHERE a.id = ?
            `, [req.params.id]);

            if (avaliacoes.length === 0) {
                return res.status(404).json({ error: 'Avaliação não encontrada' });
            }

            const userFuncId = Number(req.user.funcionario_id || req.user.id);
            const avaliacao = avaliacoes[0];
            const podeVisualizar = isAdminRH(req.user) ||
                Number(avaliacao.funcionario_id) === userFuncId ||
                Number(avaliacao.avaliador_id) === userFuncId;

            if (!podeVisualizar) {
                return res.status(403).json({ message: 'Acesso negado.' });
            }

            const [itens] = await pool.query(`
                SELECT ai.*, c.nome AS competencia_nome, c.categoria
                FROM rh_avaliacao_itens ai
                INNER JOIN rh_competencias c ON ai.competencia_id = c.id
                WHERE ai.avaliacao_id = ?
                ORDER BY c.categoria, c.nome
            `, [req.params.id]);

            res.json({ avaliacao: avaliacoes[0], itens });
        } catch (error) {
            console.error('Erro ao buscar detalhes da avaliação:', error);
            res.status(500).json({ error: 'Erro ao buscar detalhes' });
        }
    });

    // PUT /api/rh/avaliacoes/:id/finalizar - Finalizar avaliação
    router.put('/avaliacoes/:id/finalizar', authenticateToken, async (req, res) => {
        const { comentarios_avaliado } = req.body;
        try {
            const [rows] = await pool.query(
                'SELECT id, funcionario_id, avaliador_id FROM rh_avaliacoes_desempenho WHERE id = ?',
                [req.params.id]
            );

            if (!rows || rows.length === 0) {
                return res.status(404).json({ error: 'Avaliação não encontrada' });
            }

            const userFuncId = Number(req.user.funcionario_id || req.user.id);
            const registro = rows[0];
            const podeFinalizar = isAdminRH(req.user) ||
                Number(registro.funcionario_id) === userFuncId ||
                Number(registro.avaliador_id) === userFuncId;

            if (!podeFinalizar) {
                return res.status(403).json({ message: 'Acesso negado.' });
            }

            await pool.query(
                'UPDATE rh_avaliacoes_desempenho SET status = ?, comentarios_avaliado = ? WHERE id = ?',
                ['CONCLUIDA', comentarios_avaliado, req.params.id]
            );

            res.json({ success: true });
        } catch (error) {
            console.error('Erro ao finalizar avaliação:', error);
            res.status(500).json({ error: 'Erro ao finalizar avaliação' });
        }
    });

    // ==========================================
    // ROTAS DE BENEFÍCIOS
    // ==========================================

    // GET /api/rh/beneficios - Listar benefícios
    router.get('/beneficios', async (req, res) => {
        try {
            // Criar tabela se não existir
            await pool.query(`
                CREATE TABLE IF NOT EXISTS rh_beneficios (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    nome VARCHAR(255) NOT NULL,
                    descricao TEXT,
                    icone VARCHAR(50) DEFAULT 'fa-gift',
                    cor VARCHAR(20) DEFAULT '#3b82f6',
                    tipo ENUM('saude','alimentacao','transporte','educacao','outros') DEFAULT 'outros',
                    valor DECIMAL(10,2) DEFAULT 0,
                    ativo TINYINT(1) DEFAULT 1,
                    criado_por INT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            `);

            const [beneficios] = await pool.query('SELECT * FROM rh_beneficios ORDER BY nome');
            res.json(beneficios);
        } catch (error) {
            console.error('Erro ao listar benefícios:', error);
            res.status(500).json({ message: 'Erro ao listar benefícios' });
        }
    });

    // POST /api/rh/beneficios - Criar benefício
    router.post('/beneficios', authorizeAdmin, async (req, res) => {
        try {
            const { nome, descricao, icone, cor, tipo, valor } = req.body;
            if (!nome) return res.status(400).json({ message: 'Nome é obrigatório' });

            const [result] = await pool.query(
                'INSERT INTO rh_beneficios (nome, descricao, icone, cor, tipo, valor, criado_por) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [nome, descricao || null, icone || 'fa-gift', cor || '#3b82f6', tipo || 'outros', valor || 0, req.user?.id]
            );
            res.status(201).json({ success: true, id: result.insertId, message: 'Benefício criado!' });
        } catch (error) {
            console.error('Erro ao criar benefício:', error);
            res.status(500).json({ message: 'Erro ao criar benefício' });
        }
    });

    // PUT /api/rh/beneficios/:id - Atualizar benefício
    router.put('/beneficios/:id', authorizeAdmin, async (req, res) => {
        try {
            const { nome, descricao, icone, cor, tipo, valor, ativo } = req.body;
            const [result] = await pool.query(
                'UPDATE rh_beneficios SET nome = ?, descricao = ?, icone = ?, cor = ?, tipo = ?, valor = ?, ativo = ? WHERE id = ?',
                [nome, descricao, icone, cor, tipo, valor, ativo !== undefined ? ativo : 1, req.params.id]
            );
            if (result.affectedRows === 0) return res.status(404).json({ message: 'Benefício não encontrado' });
            res.json({ success: true, message: 'Benefício atualizado!' });
        } catch (error) {
            console.error('Erro ao atualizar benefício:', error);
            res.status(500).json({ message: 'Erro ao atualizar benefício' });
        }
    });

    // DELETE /api/rh/beneficios/:id - Excluir benefício
    router.delete('/beneficios/:id', authorizeAdmin, async (req, res) => {
        try {
            const [result] = await pool.query('DELETE FROM rh_beneficios WHERE id = ?', [req.params.id]);
            if (result.affectedRows === 0) return res.status(404).json({ message: 'Benefício não encontrado' });
            res.json({ success: true, message: 'Benefício excluído!' });
        } catch (error) {
            console.error('Erro ao excluir benefício:', error);
            res.status(500).json({ message: 'Erro ao excluir benefício' });
        }
    });

    // ============================================================
    // CONFIGURAÇÕES RH - Folha de Pagamento e Ponto Eletrônico
    // ============================================================

    // GET /api/rh/configuracoes/folha-pagamento
    router.get('/configuracoes/folha-pagamento', async (req, res) => {
        try {
            const [rows] = await pool.query(
                "SELECT chave, valor FROM rh_configuracoes WHERE categoria = 'folha_pagamento'"
            );
            const config = {};
            rows.forEach(r => { config[r.chave] = r.valor; });
            // Defaults se não existir no DB
            res.json({
                success: true,
                data: {
                    dia_fechamento: config.dia_fechamento || '25',
                    dia_pagamento: config.dia_pagamento || '5',
                    inss_patronal: config.inss_patronal || '20',
                    fgts: config.fgts || '8',
                    vale_transporte: config.vale_transporte || '6',
                    vale_refeicao: config.vale_refeicao || '20'
                }
            });
        } catch (error) {
            console.error('Erro ao carregar config folha:', error);
            // Retornar defaults em caso de erro (tabela pode não existir)
            res.json({
                success: true,
                data: {
                    dia_fechamento: '25', dia_pagamento: '5',
                    inss_patronal: '20', fgts: '8',
                    vale_transporte: '6', vale_refeicao: '20'
                }
            });
        }
    });

    // PUT /api/rh/configuracoes/folha-pagamento
    router.put('/configuracoes/folha-pagamento', authorizeAdmin, async (req, res) => {
        try {
            const { dia_fechamento, dia_pagamento, inss_patronal, fgts, vale_transporte, vale_refeicao } = req.body;
            const configs = { dia_fechamento, dia_pagamento, inss_patronal, fgts, vale_transporte, vale_refeicao };
            
            // Criar tabela se não existir
            await pool.query(`
                CREATE TABLE IF NOT EXISTS rh_configuracoes (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    categoria VARCHAR(50) NOT NULL,
                    chave VARCHAR(100) NOT NULL,
                    valor TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    UNIQUE KEY idx_cat_chave (categoria, chave)
                )
            `);

            for (const [chave, valor] of Object.entries(configs)) {
                if (valor !== undefined) {
                    await pool.query(
                        `INSERT INTO rh_configuracoes (categoria, chave, valor) VALUES ('folha_pagamento', ?, ?)
                         ON DUPLICATE KEY UPDATE valor = VALUES(valor)`,
                        [chave, valor]
                    );
                }
            }
            res.json({ success: true, message: 'Configurações da folha salvas!' });
        } catch (error) {
            console.error('Erro ao salvar config folha:', error);
            res.status(500).json({ message: 'Erro ao salvar configurações' });
        }
    });

    // GET /api/rh/configuracoes/ponto-eletrônico
    router.get('/configuracoes/ponto-eletrônico', async (req, res) => {
        try {
            const [rows] = await pool.query(
                "SELECT chave, valor FROM rh_configuracoes WHERE categoria = 'ponto_eletrônico'"
            );
            const config = {};
            rows.forEach(r => { config[r.chave] = r.valor; });
            res.json({
                success: true,
                data: {
                    entrada: config.entrada || '08:00',
                    saida_almoco: config.saida_almoco || '12:00',
                    retorno_almoco: config.retorno_almoco || '13:00',
                    saida: config.saida || '17:00',
                    tolerancia_atraso: config.tolerancia_atraso || 'true',
                    horas_extras_auto: config.horas_extras_auto || 'true',
                    notificar_gestores: config.notificar_gestores || 'false'
                }
            });
        } catch (error) {
            console.error('Erro ao carregar config ponto:', error);
            res.json({
                success: true,
                data: {
                    entrada: '08:00', saida_almoco: '12:00',
                    retorno_almoco: '13:00', saida: '17:00',
                    tolerancia_atraso: 'true', horas_extras_auto: 'true',
                    notificar_gestores: 'false'
                }
            });
        }
    });

    // PUT /api/rh/configuracoes/ponto-eletrônico
    router.put('/configuracoes/ponto-eletrônico', authorizeAdmin, async (req, res) => {
        try {
            const { entrada, saida_almoco, retorno_almoco, saida, tolerancia_atraso, horas_extras_auto, notificar_gestores } = req.body;
            const configs = { entrada, saida_almoco, retorno_almoco, saida, tolerancia_atraso, horas_extras_auto, notificar_gestores };
            
            await pool.query(`
                CREATE TABLE IF NOT EXISTS rh_configuracoes (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    categoria VARCHAR(50) NOT NULL,
                    chave VARCHAR(100) NOT NULL,
                    valor TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    UNIQUE KEY idx_cat_chave (categoria, chave)
                )
            `);

            for (const [chave, valor] of Object.entries(configs)) {
                if (valor !== undefined) {
                    await pool.query(
                        `INSERT INTO rh_configuracoes (categoria, chave, valor) VALUES ('ponto_eletrônico', ?, ?)
                         ON DUPLICATE KEY UPDATE valor = VALUES(valor)`,
                        [chave, valor]
                    );
                }
            }
            res.json({ success: true, message: 'Configurações do ponto salvas!' });
        } catch (error) {
            console.error('Erro ao salvar config ponto:', error);
            res.status(500).json({ message: 'Erro ao salvar configurações' });
        }
    });

    return router;
};
