#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { runAudit } = require('./audit-templates-branding-chat');

const ROOT = process.cwd();
const DATE = '2026-05-23';
const OUT_DIR = path.join('auditorias', 'templates-branding-chat');

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relPath), 'utf8'));
}

function writeTestReport(report, checks) {
  const lines = [];
  lines.push('# Relatorio de Teste - Auditoria de Templates, Branding e Chat');
  lines.push('');
  lines.push(`**Data:** ${DATE}`);
  lines.push('**Prompt aplicado:** PROMPT-TESTE-AUDITORIA-TEMPLATES-BRANDING-CHAT.md');
  lines.push('**Modo:** Teste estatico local, sem servidor, sem banco e sem deploy');
  lines.push('');
  lines.push('## Sumario executivo');
  lines.push('');
  lines.push(`O prompt de teste foi aplicado com sucesso. O auditor gerou os relatorios esperados, leu ${report.templates.total} templates/documentos, ${report.branding.total} paginas de branding e ${report.chat.total} paginas para cobertura estatica do chat. Score geral: ${report.qualityScore}%.`);
  lines.push('');
  lines.push('## Validacoes do teste');
  lines.push('');
  lines.push('| Check | Status | Evidencia |');
  lines.push('|---|---|---|');
  checks.forEach((check) => {
    lines.push(`| ${check.name} | ${check.ok ? 'OK' : 'FALHA'} | ${check.evidence} |`);
  });
  lines.push('');
  lines.push('## Resultado resumido');
  lines.push('');
  lines.push('| Area | Resultado |');
  lines.push('|---|---:|');
  lines.push(`| Templates auditados | ${report.templates.total} |`);
  lines.push(`| Paginas de branding auditadas | ${report.branding.total} |`);
  lines.push(`| Paginas avaliadas para chat | ${report.chat.total} |`);
  lines.push(`| Paginas com chat direto | ${report.chat.pagesWithStaticChat} |`);
  lines.push(`| Score global do widget chat | ${report.chat.globalScore}% |`);
  lines.push(`| Score geral | ${report.qualityScore}% |`);
  lines.push('');
  lines.push('## Observacoes');
  lines.push('');
  lines.push('- O teste valida a integridade do auditor e dos artefatos gerados.');
  lines.push('- As nao conformidades de produto permanecem no relatorio de auditoria; este teste nao tenta corrigi-las.');
  lines.push('- Para validar interacao real do chat, ainda e necessario rodar Playwright com servidor, login e banco disponiveis.');
  lines.push('');

  const reportPath = path.join(ROOT, OUT_DIR, `RELATORIO-TESTE-AUDITORIA-TEMPLATES-BRANDING-CHAT-${DATE}.md`);
  fs.writeFileSync(reportPath, `${lines.join('\n')}\n`, 'utf8');
  return reportPath;
}

async function main() {
  const report = await runAudit({ scope: 'all', outDir: OUT_DIR, date: DATE });
  const checks = [];

  const expectedFiles = [
    'audit-full-report.json',
    'audit-templates-report.json',
    'audit-branding-report.json',
    'audit-chat-report.json',
    'audit-validation-matrix.json',
    `RELATORIO-AUDITORIA-TEMPLATES-BRANDING-CHAT-${DATE}.md`,
  ];

  expectedFiles.forEach((file) => {
    const fullPath = path.join(ROOT, OUT_DIR, file);
    const ok = fs.existsSync(fullPath);
    checks.push({ name: `Arquivo gerado: ${file}`, ok, evidence: path.join(OUT_DIR, file).replace(/\\/g, '/') });
    assert.ok(ok, `Arquivo esperado nao encontrado: ${file}`);
  });

  const full = readJson(path.join(OUT_DIR, 'audit-full-report.json'));
  const templates = readJson(path.join(OUT_DIR, 'audit-templates-report.json'));
  const branding = readJson(path.join(OUT_DIR, 'audit-branding-report.json'));
  const chat = readJson(path.join(OUT_DIR, 'audit-chat-report.json'));

  const schemaChecks = [
    {
      name: 'Schema audit-full-report.json',
      ok: Boolean(full.templates && full.branding && full.chat && Array.isArray(full.matrix)),
      evidence: 'templates, branding, chat e matrix presentes',
    },
    {
      name: 'Templates encontrados',
      ok: templates.total > 0,
      evidence: `${templates.total} templates/documentos`,
    },
    {
      name: 'Paginas de branding encontradas',
      ok: branding.total > 0,
      evidence: `${branding.total} paginas`,
    },
    {
      name: 'Widget de chat global valido',
      ok: chat.globalScore >= 85,
      evidence: `score global ${chat.globalScore}%`,
    },
    {
      name: 'Evidencia backend chat',
      ok: Array.isArray(chat.backendEvidence) && chat.backendEvidence.length > 0,
      evidence: `${chat.backendEvidence.length} arquivos`,
    },
  ];

  schemaChecks.forEach((check) => {
    checks.push(check);
    assert.ok(check.ok, check.name);
  });

  const testReportPath = writeTestReport(report, checks);
  console.log(`Teste aplicado com sucesso: ${path.relative(ROOT, testReportPath)}`);
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
