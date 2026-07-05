#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { analyzeAll, MODULES } = require('./analyze-all-modules');

const ROOT = process.cwd();
const DATE = '2026-05-23';
const OUT_DIR = path.join('auditorias', 'analise-modulos');

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relPath), 'utf8'));
}

function writeReport(report, checks) {
  const lines = [];
  lines.push('# Relatorio de Teste - Analise Completa de Modulos');
  lines.push('');
  lines.push(`**Data:** ${DATE}`);
  lines.push('**Prompt aplicado:** PROMPT-TESTE-ANALISE-MODULOS-COMPLETA.md');
  lines.push('**Modo:** Validacao estatica local, sem servidor, sem banco e sem deploy');
  lines.push('');
  lines.push('## Sumario executivo');
  lines.push('');
  lines.push(`O prompt de teste foi aplicado com sucesso. O analisador processou ${report.summary.totalModules} modulos, gerou relatorios e manteve o diretorio de correcoes coerente com os achados. Score geral: ${report.summary.averageScore}%.`);
  lines.push('');
  lines.push('## Checks');
  lines.push('');
  lines.push('| Check | Status | Evidencia |');
  lines.push('|---|---|---|');
  checks.forEach((check) => {
    lines.push(`| ${check.name} | ${check.ok ? 'OK' : 'FALHA'} | ${check.evidence} |`);
  });
  lines.push('');
  lines.push('## Resultado resumido');
  lines.push('');
  lines.push('| Metrica | Valor |');
  lines.push('|---|---:|');
  lines.push(`| Modulos | ${report.summary.totalModules} |`);
  lines.push(`| Score geral | ${report.summary.averageScore}% |`);
  lines.push(`| Achados totais | ${report.summary.totalIssues} |`);
  lines.push(`| Critical | ${report.summary.criticalIssues} |`);
  lines.push(`| High | ${report.summary.highIssues} |`);
  lines.push(`| Medium | ${report.summary.mediumIssues} |`);
  lines.push(`| Low | ${report.summary.lowIssues} |`);
  lines.push('');
  lines.push('## Observacoes');
  lines.push('');
  lines.push('- O teste valida a integridade do analisador e dos artefatos.');
  lines.push('- Ele nao afirma que as funcionalidades passaram em runtime.');
  lines.push('- O proximo nivel de validacao e executar Playwright/API com servidor e credenciais reais.');
  lines.push('');

  const output = path.join(ROOT, OUT_DIR, `RELATORIO-TESTE-ANALISE-MODULOS-${DATE}.md`);
  fs.writeFileSync(output, `${lines.join('\n')}\n`, 'utf8');
  return output;
}

async function main() {
  const report = await analyzeAll({ module: 'all', outDir: OUT_DIR, date: DATE, verbose: false });
  const checks = [];

  const expectedFiles = [
    'analysis-results.json',
    'modules-summary.csv',
    `RELATORIO-ANALISE-MODULOS-${DATE}.md`,
  ];

  expectedFiles.forEach((file) => {
    const exists = fs.existsSync(path.join(ROOT, OUT_DIR, file));
    checks.push({ name: `Arquivo gerado: ${file}`, ok: exists, evidence: path.join(OUT_DIR, file).replace(/\\/g, '/') });
    assert.ok(exists, `Arquivo esperado nao encontrado: ${file}`);
  });

  const parsed = readJson(path.join(OUT_DIR, 'analysis-results.json'));
  const schemaChecks = [
    {
      name: 'Schema analysis-results.json',
      ok: Boolean(parsed.summary && Array.isArray(parsed.modules)),
      evidence: 'summary + modules presentes',
    },
    {
      name: 'Todos os modulos esperados analisados',
      ok: parsed.modules.length === MODULES.length,
      evidence: `${parsed.modules.length}/${MODULES.length} modulos`,
    },
    {
      name: 'Metricas por modulo preenchidas',
      ok: parsed.modules.every((mod) => mod.metrics && typeof mod.score === 'number' && Array.isArray(mod.issues)),
      evidence: 'score, metrics e issues presentes em todos',
    },
    {
      name: 'Endpoints ou arquivos detectados',
      ok: parsed.modules.some((mod) => mod.metrics.endpoints > 0) && parsed.modules.every((mod) => mod.metrics.files >= 0),
      evidence: 'ao menos um modulo com endpoint e todos com metrica de arquivos',
    },
    {
      name: 'Diretorio de correcoes',
      ok: fs.existsSync(path.join(ROOT, OUT_DIR, 'fixes')),
      evidence: path.join(OUT_DIR, 'fixes').replace(/\\/g, '/'),
    },
  ];

  schemaChecks.forEach((check) => {
    checks.push(check);
    assert.ok(check.ok, check.name);
  });

  const fixes = fs.readdirSync(path.join(ROOT, OUT_DIR, 'fixes')).filter((file) => file.startsWith('FIX-') && file.endsWith('.md'));
  const modulesWithIssues = parsed.modules.filter((mod) => mod.issues.length > 0).length;
  const fixCheck = {
    name: 'Arquivos FIX coerentes com achados',
    ok: fixes.length === modulesWithIssues,
    evidence: `${fixes.length} arquivos para ${modulesWithIssues} modulos com achados`,
  };
  checks.push(fixCheck);
  assert.ok(fixCheck.ok, fixCheck.name);

  const testReport = writeReport(report, checks);
  console.log(`Teste aplicado com sucesso: ${path.relative(ROOT, testReport)}`);
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
