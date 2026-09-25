'use strict';

/**
 * GUARDA DE IMUTABILIDADE. O log de não repúdio da NF-e (nfe_confirmacoes_emissao) é
 * somente de inserção. Este teste varre o código da aplicação e FALHA se alguém escrever
 * um UPDATE, DELETE, TRUNCATE, DROP, REPLACE, INSERT ... ON DUPLICATE KEY ou um ALTER
 * destrutivo (DROP/MODIFY/CHANGE/RENAME COLUMN) contra essa tabela.
 *
 * Por que existe: com os triggers do MySQL, um UPDATE/DELETE escondido só estouraria em
 * produção, no meio de uma emissão. Sem os triggers, ele passaria calado e quebraria a
 * cadeia. Nos dois casos é melhor barrar na revisão.
 *
 * ALTER TABLE ... ADD COLUMN é permitido (evolução de schema sem mexer nas linhas).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '..', '..');
const TABELA = 'nfe_confirmacoes_emissao';
const REF = `(?:\`?${TABELA}\`?|\\$\\{\\s*TABELA\\s*\\})`;

const DESTRUTIVOS = [
    ['UPDATE', new RegExp(`\\bUPDATE\\s+${REF}`, 'i')],
    ['DELETE', new RegExp(`\\bDELETE\\s+FROM\\s+${REF}`, 'i')],
    ['TRUNCATE', new RegExp(`\\bTRUNCATE(?:\\s+TABLE)?\\s+${REF}`, 'i')],
    ['DROP TABLE', new RegExp(`\\bDROP\\s+TABLE(?:\\s+IF\\s+EXISTS)?\\s+${REF}`, 'i')],
    ['REPLACE INTO', new RegExp(`\\bREPLACE\\s+INTO\\s+${REF}`, 'i')],
    ['INSERT ... ON DUPLICATE KEY', new RegExp(`\\bINSERT\\s+(?:IGNORE\\s+)?INTO\\s+${REF}[^;\`]{0,1500}?ON\\s+DUPLICATE\\s+KEY`, 'i')],
    ['ALTER destrutivo', new RegExp(`\\bALTER\\s+TABLE\\s+${REF}\\s+(?:DROP|MODIFY|CHANGE|RENAME)\\b`, 'i')]
];

function violacoes(texto) {
    return DESTRUTIVOS.filter(([, re]) => re.test(texto)).map(([nome]) => nome);
}

// Pastas que não são código da aplicação (ou são enormes e irrelevantes para esta varredura).
const IGNORAR = new Set(['node_modules', 'public', 'uploads', 'logs', 'dist', 'build', 'coverage', '.git', 'tests', 'test',
    '_backups', '_deploy_tmp', '_deploy_dashv2', '_previews', '_vps_current', '_vps_audit_20260617', 'android', 'android-app',
    'App-Zyntra', 'Base', 'Ramificações', 'V0', 'Empresas', 'screenshots', 'assets', 'images', 'image', 'docs']);
const RAIZES = ['services', 'routes', 'middleware', 'src', 'utils', 'modules', 'database', 'controllers', 'jobs', 'scripts'];

function arquivosJs() {
    const achados = [];
    const pilha = RAIZES.map(r => path.join(RAIZ, r)).filter(p => fs.existsSync(p));
    while (pilha.length) {
        const dir = pilha.pop();
        let itens;
        try { itens = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { continue; }
        for (const it of itens) {
            if (it.isDirectory()) { if (!IGNORAR.has(it.name) && !it.name.startsWith('.') && !/^node_modules/.test(it.name)) pilha.push(path.join(dir, it.name)); }
            else if (it.isFile() && it.name.endsWith('.js') && !/\.bak|\.orig|\.min\.js$/.test(it.name)) achados.push(path.join(dir, it.name));
        }
    }
    return achados;
}

test('controle positivo: o detector reconhece SQL destrutivo contra a tabela do log', () => {
    const casos = {
        'UPDATE': `await pool.query('UPDATE ${TABELA} SET usuario_id = 1 WHERE id = 2')`,
        'DELETE': 'await pool.query(`DELETE FROM ${TABELA} WHERE id = ?`)',
        'TRUNCATE': `pool.query('TRUNCATE TABLE ${TABELA}')`,
        'DROP TABLE': `pool.query('DROP TABLE IF EXISTS \`${TABELA}\`')`,
        'REPLACE INTO': `pool.query('REPLACE INTO ${TABELA} (id) VALUES (1)')`,
        'INSERT ... ON DUPLICATE KEY': `pool.query('INSERT INTO ${TABELA} (id, x) VALUES (1, 2) ON DUPLICATE KEY UPDATE x = 3')`,
        'ALTER destrutivo': `pool.query('ALTER TABLE ${TABELA} DROP COLUMN hash_registro')`
    };
    for (const [esperado, sql] of Object.entries(casos)) {
        assert.ok(violacoes(sql).includes(esperado), `deveria detectar ${esperado}: ${sql}`);
    }
});

test('controle negativo: as operações legítimas do serviço e a migration de triggers não são acusadas', () => {
    const legitimos = [
        `pool.query('SELECT * FROM ${TABELA} WHERE empresa_id = ?')`,
        'conn.query(`INSERT INTO ${TABELA} (a, b) VALUES (?, ?)`)',
        'pool.query(`ALTER TABLE ${TABELA} ADD COLUMN hash_alg VARCHAR(16)`)',
        `CREATE TRIGGER trg_nfe_conf_no_update BEFORE UPDATE ON ${TABELA} FOR EACH ROW SIGNAL SQLSTATE '45000'`,
        `CREATE TRIGGER trg_nfe_conf_no_delete BEFORE DELETE ON ${TABELA} FOR EACH ROW SIGNAL SQLSTATE '45000'`,
        `DROP TRIGGER IF EXISTS trg_nfe_conf_no_update;`,
        `UPDATE nfes SET status = 'x' WHERE id = 1`,
        `DELETE FROM outra_tabela WHERE id = 1`
    ];
    for (const sql of legitimos) assert.deepEqual(violacoes(sql), [], `não deveria acusar: ${sql}`);
});

test('nenhum código da aplicação faz UPDATE/DELETE/TRUNCATE/DROP/REPLACE/ON DUPLICATE na tabela do log', () => {
    const problemas = [];
    let examinados = 0;
    let citam = 0;
    for (const arquivo of arquivosJs()) {
        let texto;
        try { texto = fs.readFileSync(arquivo, 'utf8'); } catch (_) { continue; }
        examinados++;
        if (!texto.includes(TABELA)) continue;
        citam++;
        const v = violacoes(texto);
        if (v.length) problemas.push(`${path.relative(RAIZ, arquivo)}: ${v.join(', ')}`);
    }
    assert.ok(examinados > 50, `a varredura precisa cobrir o código (examinou ${examinados} arquivos)`);
    assert.ok(citam >= 1, 'o serviço do log precisa ser encontrado pela varredura');
    assert.deepEqual(problemas, [], 'escrita destrutiva no log de não repúdio:\n' + problemas.join('\n'));
});
