# PROMPT DE TESTE - Analise Completa de Modulos

> Contexto: este prompt valida se a aplicacao de
> `PROMPT-ANALISE-MODULOS-COMPLETA.md` gerou um analisador reproduzivel para o
> Zyntra ERP, sem depender de servidor, banco, login ou deploy.

> Importante: este teste pode gerar/atualizar arquivos em
> `auditorias/analise-modulos/`, mas nao deve alterar codigo de produto,
> migrations, dados ou configuracoes de ambiente.

---

## Objetivo

Validar a integridade do analisador modulo por modulo, dos relatorios e dos
arquivos Markdown de correcao.

---

## Parte A - Scripts esperados

Confirmar a existencia dos arquivos:

- `scripts/analyze-all-modules.js`
- `scripts/analyze-module.js`
- `scripts/test-analise-modulos-completa.js`

Validar sintaxe:

```bash
node --check scripts/analyze-all-modules.js
node --check scripts/analyze-module.js
node --check scripts/test-analise-modulos-completa.js
```

Resultado esperado: todos retornam exit code 0.

---

## Parte B - Execucao da analise

Executar:

```bash
node scripts/analyze-all-modules.js --date=2026-05-23
```

Resultado esperado:

- Exit code 0.
- Analisa 13 modulos: Dashboard, Vendas, Faturamento, Financeiro, PCP,
  Compras, Estoque, RH, Admin, Relatorios, NFe, CRM e Logistica.
- Gera `auditorias/analise-modulos/analysis-results.json`.
- Gera `auditorias/analise-modulos/RELATORIO-ANALISE-MODULOS-2026-05-23.md`.
- Gera `auditorias/analise-modulos/modules-summary.csv`.
- Gera arquivos `FIX-*.md` dentro de `auditorias/analise-modulos/fixes/`
  para modulos com achados.

---

## Parte C - Validacao automatizada

Executar:

```bash
node scripts/test-analise-modulos-completa.js
```

Resultado esperado:

- Exit code 0.
- `analysis-results.json` contem `summary` e `modules`.
- Todos os modulos esperados foram analisados.
- Cada modulo tem `score`, `metrics` e `issues`.
- Ao menos um modulo possui endpoints detectados.
- O relatorio de teste
  `auditorias/analise-modulos/RELATORIO-TESTE-ANALISE-MODULOS-2026-05-23.md`
  e criado.

---

## Regras

- Nao iniciar servidor.
- Nao instalar dependencias.
- Nao conectar no banco.
- Nao fazer deploy.
- Nao aplicar automaticamente as correcoes sugeridas.
- Diferenciar claramente achados estaticos de falhas funcionais runtime.

---

**Fim do prompt de teste.**
