'use strict';

/**
 * Imutabilidade do log de não repúdio da NF-e (tabela nfe_confirmacoes_emissao):
 * triggers BEFORE UPDATE / BEFORE DELETE que fazem qualquer alteração ou exclusão falhar
 * com SQLSTATE 45000 — para QUALQUER usuário (o trigger dispara também para o root).
 *
 * POR QUE É UM SCRIPT À PARTE: o usuário da aplicação tem ALL no schema, mas com
 * log_bin=1 e log_bin_trust_function_creators=0 o MySQL só permite criar trigger com
 * SUPER, que a aplicação não tem. O `CREATE TRIGGER` que o serviço tenta na
 * inicialização falha ("[NFE-AUDIT] trigger não criada"). Este script gera o SQL para o
 * root do MySQL aplicar UMA VEZ por instância (é idempotente).
 *
 * USO (no servidor, como quem tem a senha do root do MySQL):
 *
 *     node database/migrations/20260925_nfe_confirmacoes_emissao_imutavel.js | mysql -u root -p aluforce_vendas
 *
 * Pré-requisito: a tabela já existe (o serviço a cria no primeiro uso).
 *
 * Limites, para não prometer o que não entrega:
 *   - TRUNCATE e DROP TABLE não disparam trigger — quem tem privilégio para isso é
 *     detectado pela cadeia HMAC + âncoras fora do banco (ver services/nfe-confirmacao-audit.service.js);
 *   - quem tem privilégio de TRIGGER pode dar DROP TRIGGER; a vigilância do serviço alerta
 *     se os triggers sumirem (verificarTriggers).
 */

const MENSAGEM = 'Log de emissão de NF-e é somente de inserção';

const SQL = [
    'DROP TRIGGER IF EXISTS trg_nfe_conf_no_update;',
    'DROP TRIGGER IF EXISTS trg_nfe_conf_no_delete;',
    `CREATE TRIGGER trg_nfe_conf_no_update BEFORE UPDATE ON nfe_confirmacoes_emissao
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '${MENSAGEM}';`,
    `CREATE TRIGGER trg_nfe_conf_no_delete BEFORE DELETE ON nfe_confirmacoes_emissao
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '${MENSAGEM}';`
].join('\n') + '\n';

module.exports = { SQL };

if (require.main === module) process.stdout.write(SQL);
