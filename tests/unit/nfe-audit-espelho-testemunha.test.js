'use strict';

process.env.NFE_AUDIT_VIGILANCIA = 'off';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const audit = require('../../services/nfe-confirmacao-audit.service');
const testemunha = require('../../services/nfe-audit-testemunha.service');

const VARS = ['NFE_AUDIT_HMAC_KEY', 'NFE_AUDIT_ANCHOR_DIR', 'NFE_AUDIT_TESTEMUNHA_EMAIL', 'NFE_AUDIT_TESTEMUNHA_WEBHOOK', 'NFE_AUDIT_TESTEMUNHA_HORAS'];
function novoAmbiente(extra = {}) {
    for (const v of VARS) delete process.env[v];
    process.env.NFE_AUDIT_ANCHOR_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nfe-esp-'));
    process.env.NFE_AUDIT_HMAC_KEY = 'chave-de-teste-nfe-audit-0123456789';
    Object.assign(process.env, extra);
}
const limpar = () => { for (const v of VARS) delete process.env[v]; };

function fakePool() {
    const rows = [];
    const conn = {
        async query(sql, params) {
            if (/GET_LOCK/.test(sql)) return [[{ ok: 1 }]];
            if (/RELEASE_LOCK/.test(sql)) return [[{}]];
            if (/SELECT hash_registro FROM/.test(sql)) {
                const ultimo = rows.filter(r => r.empresa_id === params[0]).slice(-1)[0];
                return [ultimo ? [{ hash_registro: ultimo.hash_registro }] : []];
            }
            if (/^INSERT INTO nfe_confirmacoes_emissao/.test(sql.trim())) {
                const cols = sql.match(/\(([^)]+)\) VALUES/)[1].split(',').map(s => s.trim());
                const row = { id: rows.length + 1 };
                cols.forEach((c, i) => { row[c] = params[i]; });
                rows.push(row);
                return [{ insertId: row.id }];
            }
            throw new Error('SQL inesperado: ' + sql);
        },
        release() {}
    };
    return {
        rows,
        async query(sql, params) {
            const s = sql.replace(/\s+/g, ' ').trim();
            if (/^(CREATE (TABLE|TRIGGER)|ALTER TABLE)/.test(s)) return [{}];
            if (/^SELECT \* FROM nfe_confirmacoes_emissao/.test(s)) return [rows.filter(r => r.empresa_id === params[0]).map(r => ({ ...r }))];
            if (/^SELECT DISTINCT empresa_id/.test(s)) return [[...new Set(rows.map(r => r.empresa_id))].map(empresa_id => ({ empresa_id }))];
            if (/GROUP BY empresa_id/.test(s)) {
                const g = new Map();
                for (const r of rows) { const a = g.get(r.empresa_id) || { empresa_id: r.empresa_id, registros: 0, ultimo_id: 0 }; a.registros++; a.ultimo_id = Math.max(a.ultimo_id, r.id); g.set(r.empresa_id, a); }
                return [[...g.values()]];
            }
            if (/^SELECT hash_registro, hash_alg, registrado_em_utc FROM/.test(s)) {
                const r = rows.find(x => x.id === params[0]);
                return [r ? [{ hash_registro: r.hash_registro, hash_alg: r.hash_alg, registrado_em_utc: r.registrado_em_utc }] : []];
            }
            return conn.query(sql, params);
        },
        async getConnection() { return conn; }
    };
}

async function gravar(pool, n) {
    for (let i = 0; i < n; i++) {
        await audit.registrar(pool, {
            evento: audit.EVENTOS.CONFIRMADO, categoria: 'VENDA', nfeId: 100 + i, usuarioId: 7 + i, usuarioNome: `Usuário ${i}`,
            ip: '203.0.113.9', numero: String(900 + i), cfops: ['5102'], xml: `<x>${i}</x>`
        });
    }
}

// ── Espelho ──────────────────────────────────────────────────────────────────
test('cada linha gravada também vai para o espelho, com o conteúdo completo e MAC', async () => {
    novoAmbiente();
    try {
        const pool = fakePool();
        await gravar(pool, 3);
        const linhas = fs.readFileSync(audit.arquivoEspelho(1), 'utf8').trim().split('\n').map(JSON.parse);
        assert.equal(linhas.length, 3);
        assert.deepEqual(linhas.map(l => l.id), [1, 2, 3]);
        assert.equal(linhas[1].r.usuario_nome, 'Usuário 1');
        assert.equal(linhas[1].r.hash_registro, pool.rows[1].hash_registro);
        assert.ok(linhas.every(l => l.m && l.m.length === 64));
    } finally { limpar(); }
});

test('RECUPERAÇÃO: linhas apagadas do banco são reconstituídas do espelho com o conteúdo original', async () => {
    novoAmbiente();
    try {
        const pool = fakePool();
        await gravar(pool, 4);
        const originais = pool.rows.map(r => ({ ...r }));
        pool.rows.splice(1, 3); // apagam as linhas 2, 3 e 4 do banco

        const r = await audit.verificarCadeia(pool, 1, { verificarBanco: false });
        assert.equal(r.integra, false);
        assert.deepEqual(r.espelho.ausentesNoBanco, [2, 3, 4]);
        assert.equal(r.espelho.recuperaveis, 3);

        const rec = audit.recuperarDoEspelho(1);
        assert.equal(rec.adulteradas, 0);
        assert.deepEqual(rec.linhas.map(l => l.id), [1, 2, 3, 4]);
        for (const orig of originais) {
            const l = rec.linhas.find(x => x.id === orig.id);
            for (const campo of ['evento', 'nfe_id', 'usuario_id', 'usuario_nome', 'ip', 'numero', 'xml_sha256', 'registrado_em_utc', 'hash_anterior', 'hash_registro']) {
                assert.equal(l[campo], orig[campo], `campo ${campo} da linha ${orig.id}`);
            }
        }
    } finally { limpar(); }
});

test('espelho adulterado (edição sem a chave) é detectado pelo MAC e as linhas falsas não são recuperáveis', async () => {
    novoAmbiente();
    try {
        const pool = fakePool();
        await gravar(pool, 3);
        const arq = audit.arquivoEspelho(1);
        const linhas = fs.readFileSync(arq, 'utf8').trim().split('\n').map(JSON.parse);
        linhas[1].r.usuario_id = 999; // reescreve quem fez a operação
        fs.writeFileSync(arq, linhas.map(l => JSON.stringify(l)).join('\n') + '\n');

        const r = await audit.verificarCadeia(pool, 1, { verificarBanco: false });
        assert.equal(r.integra, false);
        assert.equal(r.motivo, 'ESPELHO_ADULTERADO');
        assert.equal(r.espelho.adulteradas, 1);
        const rec = audit.recuperarDoEspelho(1);
        assert.deepEqual(rec.linhas.map(l => l.id), [1, 3], 'a linha adulterada é descartada');
    } finally { limpar(); }
});

test('sem arquivo de espelho a cadeia continua verificável e o resumo informa quantas linhas ficaram sem cópia', async () => {
    novoAmbiente();
    try {
        const pool = fakePool();
        await gravar(pool, 3);
        fs.rmSync(audit.arquivoEspelho(1));
        const r = await audit.verificarCadeia(pool, 1, { verificarBanco: false });
        assert.equal(r.integra, true);
        assert.equal(r.espelho.existe, false);
        assert.equal(r.espelho.semEspelho, 3);
    } finally { limpar(); }
});

test('verificarCadeia informa qual chave está em uso, sem revelá-la', async () => {
    novoAmbiente();
    try {
        const pool = fakePool();
        await gravar(pool, 1);
        const r = await audit.verificarCadeia(pool, 1, { verificarBanco: false });
        assert.equal(r.chave.origem, 'dedicada');
        assert.match(r.chave.kid, /^[0-9a-f]{12}$/);
        assert.ok(!JSON.stringify(r).includes(process.env.NFE_AUDIT_HMAC_KEY));

        delete process.env.NFE_AUDIT_HMAC_KEY;
        process.env.JWT_SECRET = 'segredo-jwt-de-teste-com-mais-de-16-chars';
        assert.equal(audit.chaveInfo().origem, 'jwt');
        delete process.env.JWT_SECRET;
        assert.deepEqual(audit.chaveInfo(), { origem: 'nenhuma', kid: null });
    } finally { limpar(); delete process.env.JWT_SECRET; }
});

// ── Testemunha externa ───────────────────────────────────────────────────────
test('testemunha desligada por padrão (sem destinatário configurado)', async () => {
    novoAmbiente();
    try {
        const r = await testemunha.publicar(fakePool(), {});
        assert.deepEqual(r, { enviado: false, motivo: 'NAO_CONFIGURADA' });
    } finally { limpar(); }
});

test('testemunha envia o hash de cabeça por e-mail e respeita o intervalo', async () => {
    novoAmbiente({ NFE_AUDIT_TESTEMUNHA_EMAIL: 'auditoria@empresa.com, outro@empresa.com' });
    try {
        const pool = fakePool();
        await gravar(pool, 3);
        const enviados = [];
        const enviar = async (canal, msg, cfg) => { enviados.push({ canal, msg, cfg }); };
        const t0 = Date.parse('2026-09-25T12:00:00Z');

        const r1 = await testemunha.publicar(pool, { agora: t0, enviar });
        assert.equal(r1.enviado, true);
        assert.deepEqual(r1.canais, ['email']);
        assert.deepEqual(enviados[0].cfg.emails, ['auditoria@empresa.com', 'outro@empresa.com']);
        const cabeca = pool.rows[2].hash_registro;
        assert.match(enviados[0].msg.texto, new RegExp(cabeca));
        assert.match(enviados[0].msg.texto, /3 registro\(s\), último id 3/);
        assert.match(enviados[0].msg.texto, /verificação: ÍNTEGRA/);
        assert.equal(enviados[0].msg.json.cabecas[0].hashCabeca, cabeca);
        assert.ok(!enviados[0].msg.texto.includes(process.env.NFE_AUDIT_HMAC_KEY), 'a chave nunca sai do servidor');

        const r2 = await testemunha.publicar(pool, { agora: t0 + 3600e3, enviar });
        assert.deepEqual([r2.enviado, r2.motivo], [false, 'AINDA_NAO_E_HORA']);
        const r3 = await testemunha.publicar(pool, { agora: t0 + 25 * 3600e3, enviar });
        assert.equal(r3.enviado, true);
        assert.equal(enviados.length, 2);
    } finally { limpar(); }
});

test('testemunha: falha detectada gera alerta imediato (mesmo antes do intervalo), no máximo 1 por hora', async () => {
    novoAmbiente({ NFE_AUDIT_TESTEMUNHA_EMAIL: 'auditoria@empresa.com' });
    try {
        const pool = fakePool();
        await gravar(pool, 3);
        const enviados = [];
        const enviar = async (canal, msg) => { enviados.push(msg); };
        const t0 = Date.parse('2026-09-25T12:00:00Z');
        await testemunha.publicar(pool, { agora: t0, enviar }); // envio periódico normal

        pool.rows[1].usuario_id = 999; // adulteração
        const r = await testemunha.publicar(pool, { agora: t0 + 600e3, enviar, falha: true });
        assert.equal(r.enviado, true);
        assert.equal(r.falha, true);
        assert.match(enviados[1].assunto, /ALERTA/);
        assert.match(enviados[1].texto, /FALHA \(HASH_NAO_CONFERE, linha 2\)/);

        const r2 = await testemunha.publicar(pool, { agora: t0 + 1200e3, enviar, falha: true });
        assert.deepEqual([r2.enviado, r2.motivo], [false, 'AINDA_NAO_E_HORA'], 'alerta repetido dentro de 1h é suprimido');
        const r3 = await testemunha.publicar(pool, { agora: t0 + 600e3 + 3601e3, enviar, falha: true });
        assert.equal(r3.enviado, true);
    } finally { limpar(); }
});

test('testemunha: sem registros não envia; falha de canal nunca lança e não consome o intervalo', async () => {
    novoAmbiente({ NFE_AUDIT_TESTEMUNHA_EMAIL: 'a@b.com', NFE_AUDIT_TESTEMUNHA_WEBHOOK: 'https://exemplo.invalid/hook' });
    const erro = console.error; console.error = () => {};
    try {
        const vazio = fakePool();
        assert.deepEqual(await testemunha.publicar(vazio, { enviar: async () => {} }), { enviado: false, motivo: 'SEM_REGISTROS' });

        const pool = fakePool();
        await gravar(pool, 1);
        const falhando = async () => { throw new Error('smtp fora do ar'); };
        const r = await testemunha.publicar(pool, { enviar: falhando });
        assert.equal(r.enviado, false);
        assert.deepEqual(r.erros.map(e => e.canal), ['email', 'webhook']);

        const canais = [];
        const r2 = await testemunha.publicar(pool, { enviar: async canal => { canais.push(canal); } });
        assert.equal(r2.enviado, true, 'como nada foi enviado antes, o intervalo não foi consumido');
        assert.deepEqual(canais, ['email', 'webhook']);
    } finally { console.error = erro; limpar(); }
});

// ── Vigilância ───────────────────────────────────────────────────────────────
test('vigilância dá alerta crítico quando o log foi adulterado e não lança', async () => {
    novoAmbiente();
    const erro = console.error; const avisos = []; console.error = (...a) => avisos.push(a.join(' '));
    try {
        const pool = fakePool();
        await gravar(pool, 3);
        await audit.vigiarUmaVez(pool);
        assert.equal(avisos.filter(a => /ALERTA-CRITICO/.test(a)).length, 0, 'íntegro: sem alerta');

        pool.rows[1].usuario_id = 999;
        await audit.vigiarUmaVez(pool);
        const alerta = avisos.find(a => /ALERTA-CRITICO/.test(a));
        assert.ok(alerta);
        assert.match(alerta, /HASH_NAO_CONFERE na linha 2/);
    } finally { console.error = erro; limpar(); }
});
