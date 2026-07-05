const express = require('express');
const router = express.Router();
const { query, run, get } = require('../database');

// ── AUDIT #005: validação de documento (aceita CNPJ 14 díg. OU CPF 11 díg. válidos) ──
function onlyDigits(s) { return String(s || '').replace(/\D/g, ''); }
function isValidCPF(cpf) {
    cpf = onlyDigits(cpf);
    if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
    let s = 0; for (let i = 0; i < 9; i++) s += +cpf[i] * (10 - i);
    let d = (s * 10) % 11; if (d === 10) d = 0; if (d !== +cpf[9]) return false;
    s = 0; for (let i = 0; i < 10; i++) s += +cpf[i] * (11 - i);
    d = (s * 10) % 11; if (d === 10) d = 0; return d === +cpf[10];
}
function isValidCNPJ(cnpj) {
    cnpj = onlyDigits(cnpj);
    if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
    const calc = (len) => {
        let p = len - 7, s = 0;
        for (let i = len; i >= 1; i--) { s += cnpj[len - i] * p--; if (p < 2) p = 9; }
        const r = s % 11; return r < 2 ? 0 : 11 - r;
    };
    return calc(12) === +cnpj[12] && calc(13) === +cnpj[13];
}
function isValidDoc(doc) {
    const d = onlyDigits(doc);
    return (d.length === 14 && isValidCNPJ(d)) || (d.length === 11 && isValidCPF(d));
}
// ── AUDIT #007: remove campos internos de integração da resposta pública ──
const CAMPOS_INTERNOS = ['omie_id', 'omie_codigo', 'omie_last_sync_at', 'omie_sync_status', 'omie_payload_hash', 'cnpj_hash'];
function stripInternal(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    const out = { ...obj };
    for (const k of Object.keys(out)) { if (CAMPOS_INTERNOS.includes(k) || /^omie_/.test(k)) delete out[k]; }
    return out;
}

// ── AUDIT 04/07: o modal de fornecedor coleta campos sem coluna na tabela; garante as
// colunas (ALTER aditivo, idempotente) antes de gravar. Se o usuário do banco não tiver
// privilégio de ALTER, grava apenas as colunas base — nunca bloqueia o cadastro.
const COLUNAS_EXTRAS = {
    telefone2: 'VARCHAR(20) NULL',
    email_financeiro: 'VARCHAR(100) NULL',
    whatsapp: 'VARCHAR(20) NULL',
    website: 'VARCHAR(255) NULL',
    cargo_contato: 'VARCHAR(100) NULL',
    banco: 'VARCHAR(100) NULL',
    agencia: 'VARCHAR(20) NULL',
    conta: 'VARCHAR(30) NULL',
    logo: 'VARCHAR(255) NULL',
    produtos_fornecidos: 'TEXT NULL',
    certificacoes: 'TEXT NULL'
};
let colunasExtrasOk = false;
async function garantirColunasExtras() {
    if (colunasExtrasOk) return true;
    try {
        const rows = await query(
            "SELECT COLUMN_NAME AS col FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fornecedores'"
        );
        const existentes = new Set(rows.map(r => r.col));
        for (const nome of Object.keys(COLUNAS_EXTRAS)) {
            if (!existentes.has(nome)) {
                await run('ALTER TABLE fornecedores ADD COLUMN ' + nome + ' ' + COLUNAS_EXTRAS[nome]);
            }
        }
        colunasExtrasOk = true;
    } catch (e) {
        console.error('[Fornecedores] Colunas extras indisponíveis (segue só com as base):', e.message);
    }
    return colunasExtrasOk;
}

// A tabela usa `ativo` (0/1); clientes antigos do modal enviam `status` ('ativo'/'inativo').
// Retorna null quando o request não informa nem um nem outro (PUT preserva o valor atual).
function normalizarAtivo(ativo, status) {
    if (ativo !== undefined && ativo !== null && ativo !== '') {
        return (ativo === true || ativo === 1 || ativo === '1' || ativo === 'true') ? 1 : 0;
    }
    if (status) return status === 'ativo' ? 1 : 0;
    return null;
}

function valorOuNull(v) { return v === undefined ? null : v; }

// ============ LISTAR FORNECEDORES ============
router.get('/', async (req, res) => {
    try {
        const { search, ativo, limit = 50, offset = 0 } = req.query;
        
        let sql = 'SELECT * FROM fornecedores WHERE 1=1';
        const params = [];
        const searchParam = search ? `%${search}%` : null;
        
        if (search) {
            sql += ' AND (razao_social LIKE ? OR nome_fantasia LIKE ? OR cnpj LIKE ?)';
            params.push(searchParam, searchParam, searchParam);
        }
        
        if (ativo !== undefined) {
            sql += ' AND ativo = ?';
            params.push(ativo === 'true' ? 1 : 0);
        }
        
        sql += ' ORDER BY razao_social LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
        const fornecedores = (await query(sql, params)).map(stripInternal);

        const countSql = 'SELECT COUNT(*) as total FROM fornecedores WHERE 1=1' +
            (search ? ' AND (razao_social LIKE ? OR nome_fantasia LIKE ? OR cnpj LIKE ?)' : '') +
            (ativo !== undefined ? ' AND ativo = ?' : '');
        const countParams = search ? [searchParam, searchParam, searchParam] : [];
        if (ativo !== undefined) countParams.push(ativo === 'true' ? 1 : 0);
        
        const { total } = await get(countSql, countParams);
        
        res.json({
            fornecedores,
            total,
            limit: parseInt(limit),
            offset: parseInt(offset)
        });
    } catch (error) {
        console.error('Erro ao listar fornecedores:', error);
        res.status(500).json({ error: 'Erro ao buscar fornecedores' });
    }
});

// ============ OBTER FORNECEDOR ============
router.get('/:id', async (req, res) => {
    try {
        const fornecedor = await get('SELECT * FROM fornecedores WHERE id = ?', [req.params.id]);
        
        if (!fornecedor) {
            return res.status(404).json({ error: 'Fornecedor não encontrado' });
        }

        res.json(stripInternal(fornecedor));
    } catch (error) {
        console.error('Erro ao obter fornecedor:', error);
        res.status(500).json({ error: 'Erro ao buscar fornecedor' });
    }
});

// ============ CRIAR FORNECEDOR ============
router.post('/', async (req, res) => {
    try {
        const {
            razao_social, nome_fantasia, cnpj,
            ie, inscricao_estadual,
            endereco, bairro, cidade, estado, cep,
            telefone, email, contato_principal, contato,
            condicoes_pagamento, prazo_entrega_padrao, prazo_entrega,
            observacoes, ativo, status,
            categoria, avaliacao, chave_pix, nome,
            telefone2, email_financeiro, whatsapp, website, cargo_contato,
            banco, agencia, conta, logo, produtos_fornecidos, certificacoes
        } = req.body;

        if (!razao_social || !cnpj) {
            return res.status(400).json({ error: 'Razão social e CNPJ são obrigatórios' });
        }

        // AUDIT #005: rejeitar documento inválido (aceita CNPJ ou CPF de PF, com dígitos verificadores)
        if (!isValidDoc(cnpj)) {
            return res.status(400).json({ error: 'CNPJ/CPF inválido — verifique os dígitos (14 díg. p/ CNPJ ou 11 p/ CPF)' });
        }

        // Verificar se CNPJ já existe
        const existente = await get('SELECT id FROM fornecedores WHERE cnpj = ?', [cnpj]);
        if (existente) {
            return res.status(400).json({ error: 'CNPJ já cadastrado' });
        }

        const ativoNorm = normalizarAtivo(ativo, status);
        const colunas = [
            'razao_social', 'nome_fantasia', 'cnpj', 'ie',
            'endereco', 'bairro', 'cidade', 'estado', 'cep',
            'telefone', 'email', 'contato_principal', 'contato', 'nome',
            'condicoes_pagamento', 'prazo_entrega_padrao',
            'observacoes', 'ativo', 'categoria', 'avaliacao', 'chave_pix'
        ];
        const valores = [
            razao_social, valorOuNull(nome_fantasia), cnpj, ie || inscricao_estadual || null,
            valorOuNull(endereco), bairro || null, valorOuNull(cidade), valorOuNull(estado), valorOuNull(cep),
            valorOuNull(telefone), valorOuNull(email), valorOuNull(contato_principal), contato || contato_principal || null, nome || razao_social,
            valorOuNull(condicoes_pagamento), prazo_entrega_padrao || prazo_entrega || 0,
            valorOuNull(observacoes), ativoNorm === null ? 1 : ativoNorm, categoria || 'Geral', avaliacao || 0, chave_pix || null
        ];
        if (await garantirColunasExtras()) {
            colunas.push('telefone2', 'email_financeiro', 'whatsapp', 'website', 'cargo_contato',
                'banco', 'agencia', 'conta', 'logo', 'produtos_fornecidos', 'certificacoes');
            valores.push(valorOuNull(telefone2), valorOuNull(email_financeiro), valorOuNull(whatsapp),
                valorOuNull(website), valorOuNull(cargo_contato), valorOuNull(banco), valorOuNull(agencia),
                valorOuNull(conta), valorOuNull(logo), valorOuNull(produtos_fornecidos), valorOuNull(certificacoes));
        }

        const result = await run(
            'INSERT INTO fornecedores (' + colunas.join(', ') + ') VALUES (' + colunas.map(() => '?').join(', ') + ')',
            valores
        );
        
        res.status(201).json({
            id: result.id,
            message: 'Fornecedor criado com sucesso'
        });
    } catch (error) {
        console.error('Erro ao criar fornecedor:', error);
        res.status(500).json({ error: 'Erro ao criar fornecedor' });
    }
});

// ============ ATUALIZAR FORNECEDOR ============
router.put('/:id', async (req, res) => {
    try {
        const {
            razao_social, nome_fantasia, cnpj,
            ie, inscricao_estadual,
            endereco, bairro, cidade, estado, cep,
            telefone, email, contato_principal, contato,
            condicoes_pagamento, prazo_entrega_padrao, prazo_entrega,
            observacoes, ativo, status,
            categoria, avaliacao, chave_pix, nome,
            telefone2, email_financeiro, whatsapp, website, cargo_contato,
            banco, agencia, conta, logo, produtos_fornecidos, certificacoes
        } = req.body;

        // AUDIT #005: valida documento no update também
        if (cnpj !== undefined && cnpj !== null && cnpj !== '' && !isValidDoc(cnpj)) {
            return res.status(400).json({ error: 'CNPJ/CPF inválido — verifique os dígitos (14 díg. p/ CNPJ ou 11 p/ CPF)' });
        }

        // COALESCE: request sem `ativo`/`status` preserva o valor atual (o modal antigo
        // enviava só `status`, que era descartado e derrubava o bind de `ativo`)
        let sql = `
            UPDATE fornecedores SET
                razao_social = ?, nome_fantasia = ?, cnpj = ?, ie = ?,
                endereco = ?, bairro = ?, cidade = ?, estado = ?, cep = ?,
                telefone = ?, email = ?, contato_principal = ?, contato = ?, nome = ?,
                condicoes_pagamento = ?, prazo_entrega_padrao = ?,
                observacoes = ?, ativo = COALESCE(?, ativo),
                categoria = ?, avaliacao = ?, chave_pix = ?`;
        const params = [
            razao_social, valorOuNull(nome_fantasia), cnpj, ie || inscricao_estadual || null,
            valorOuNull(endereco), bairro || null, valorOuNull(cidade), valorOuNull(estado), valorOuNull(cep),
            valorOuNull(telefone), valorOuNull(email), valorOuNull(contato_principal), contato || contato_principal || null, nome || razao_social,
            valorOuNull(condicoes_pagamento), prazo_entrega_padrao || prazo_entrega || 0,
            valorOuNull(observacoes), normalizarAtivo(ativo, status),
            categoria || 'Geral', avaliacao || 0, chave_pix || null
        ];
        if (await garantirColunasExtras()) {
            sql += `,
                telefone2 = ?, email_financeiro = ?, whatsapp = ?, website = ?, cargo_contato = ?,
                banco = ?, agencia = ?, conta = ?, logo = ?, produtos_fornecidos = ?, certificacoes = ?`;
            params.push(valorOuNull(telefone2), valorOuNull(email_financeiro), valorOuNull(whatsapp),
                valorOuNull(website), valorOuNull(cargo_contato), valorOuNull(banco), valorOuNull(agencia),
                valorOuNull(conta), valorOuNull(logo), valorOuNull(produtos_fornecidos), valorOuNull(certificacoes));
        }
        sql += `,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?`;
        params.push(req.params.id);

        const result = await run(sql, params);
        
        if (result.changes === 0) {
            return res.status(404).json({ error: 'Fornecedor não encontrado' });
        }
        
        res.json({ message: 'Fornecedor atualizado com sucesso' });
    } catch (error) {
        console.error('Erro ao atualizar fornecedor:', error);
        res.status(500).json({ error: 'Erro ao atualizar fornecedor' });
    }
});

// ============ EXCLUIR FORNECEDOR (SOFT-DELETE) ============
router.delete('/:id', async (req, res) => {
    try {
        // Verificar se há pedidos de compra ativos vinculados
        const pedidosVinculados = await get(
            `SELECT COUNT(*) as total FROM pedidos_compra 
             WHERE fornecedor_id = ? AND status NOT IN ('cancelado', 'recebido')`,
            [req.params.id]
        );
        
        if (pedidosVinculados && pedidosVinculados.total > 0) {
            return res.status(400).json({ 
                error: `Fornecedor possui ${pedidosVinculados.total} pedido(s) de compra ativo(s). Finalize ou cancele antes de excluir.` 
            });
        }
        
        // Soft-delete: desativa em vez de remover fisicamente
        const result = await run(
            'UPDATE fornecedores SET ativo = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?', 
            [req.params.id]
        );
        
        if (result.changes === 0) {
            return res.status(404).json({ error: 'Fornecedor não encontrado' });
        }
        
        res.json({ message: 'Fornecedor desativado com sucesso' });
    } catch (error) {
        console.error('Erro ao excluir fornecedor:', error);
        res.status(500).json({ error: 'Erro ao excluir fornecedor' });
    }
});

module.exports = router;
