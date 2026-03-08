-- ===========================================================================
-- Migration: Consolidar coluna de senha para senha_hash (canônica)
-- Data: 2026-03-02
-- Descrição: Copia dados de `senha` para `senha_hash` onde senha_hash está
--            vazia mas senha tem um hash bcrypt válido.
-- ===========================================================================

-- 1. Copiar hashes bcrypt de `senha` para `senha_hash` onde senha_hash é NULL/vazio
UPDATE usuarios
SET senha_hash = senha
WHERE (senha_hash IS NULL OR senha_hash = '')
  AND senha IS NOT NULL
  AND senha != ''
  AND senha LIKE '$2%';

-- 2. Copiar hashes bcrypt de `senha_hash` para `senha` (backwards-compat)
UPDATE usuarios
SET senha = senha_hash
WHERE (senha IS NULL OR senha = '')
  AND senha_hash IS NOT NULL
  AND senha_hash != ''
  AND senha_hash LIKE '$2%';

-- Nota: A coluna `senha` é mantida para backwards-compatibility com módulos
-- legados que ainda a referenciam. O código consolidado agora escreve sempre
-- em `senha_hash` como coluna canônica.
