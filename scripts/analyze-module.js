#!/usr/bin/env node
'use strict';

const { analyzeAll } = require('./analyze-all-modules');

function parseModule(argv) {
  const arg = argv.find((item) => item.startsWith('--module='));
  return arg ? arg.split('=')[1] : 'dashboard';
}

analyzeAll({
  module: parseModule(process.argv.slice(2)),
  outDir: 'auditorias/analise-modulos',
  date: '2026-05-23',
  verbose: true,
}).catch((err) => {
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
