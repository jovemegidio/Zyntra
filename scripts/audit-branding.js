#!/usr/bin/env node
'use strict';

const { runAudit } = require('./audit-templates-branding-chat');

runAudit({ scope: 'branding', outDir: 'auditorias/templates-branding-chat', date: '2026-05-23' })
  .catch((err) => {
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
