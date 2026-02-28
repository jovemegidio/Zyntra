# RELATÓRIO: Varredura de Encoding/Ortografia — modules/\*_/_.html

## (Excluindo Zyntra-SGE)

**Data:** 2026-02-XX  
**Escopo:** Apenas texto visível ao usuário (títulos, labels, botões, headings, placeholders, mensagens de alerta, opções de select, cabeçalhos de tabela, textos de badge, exportações CSV/PDF).  
**Excluído:** nomes de variáveis JS, nomes de funções, classes CSS, caminhos de arquivos, comentários de desenvolvedor (exceto quando o comentário contém texto visível com erro).

---

## RESUMO EXECUTIVO

| Métrica                                        | Valor                                                    |
| ---------------------------------------------- | -------------------------------------------------------- |
| **Total de arquivos afetados**                 | 20                                                       |
| **Total de ocorrências com encoding quebrado** | ~120+                                                    |
| **Tipo principal de problema**                 | Corrupção de encoding (Latin-1/CP-1252 → UTF-8)          |
| **Tipo secundário**                            | Double-encoded UTF-8 (UTF-8 reinterpretado como Latin-1) |
| **Erros de ortografia puros (typos)**          | 0 encontrados                                            |

### Causa Raiz

Os arquivos foram salvos ou convertidos com encoding incorreto. Caracteres acentuados do Português (ç, ã, é, ó, í, ú, etc.) aparecem como `�` (replacement character U+FFFD) ou como mojibake duplo (`Ã³`, `Ã£`, `Ã§Ã£o`).

---

## ACHADOS POR ARQUIVO

### 1. modules/Compras/dashboard-executivo.html

| Linha | Texto Errado    | Texto Correto   | Contexto                              |
| ----- | --------------- | --------------- | ------------------------------------- |
| 449   | `Cota��es`      | `Cotações`      | `title="Cota��es"` (sidebar nav)      |
| 450   | `Requisi��es`   | `Requisições`   | `title="Requisi��es"` (sidebar nav)   |
| 451   | `Relat�rios`    | `Relatórios`    | `title="Relat�rios"` (sidebar nav)    |
| 453   | `Configura��es` | `Configurações` | `title="Configura��es"` (sidebar nav) |

---

### 2. modules/Compras/materias-primas.html

| Linha | Texto Errado                | Texto Correto               | Contexto                                  |
| ----- | --------------------------- | --------------------------- | ----------------------------------------- |
| 277   | `Requisi��es`               | `Requisições`               | `title="Requisi��es"` (sidebar nav)       |
| 278   | `Cota��es`                  | `Cotações`                  | `title="Cota��es"` (sidebar nav)          |
| 281   | `Mat�rias-Primas`           | `Matérias-Primas`           | `title="Mat�rias-Primas"` (sidebar nav)   |
| 484   | `Observa��es`               | `Observações`               | `<label>Observa��es</label>` (form label) |
| 485   | `Observa��es adicionais...` | `Observações adicionais...` | `placeholder="Observa��es adicionais..."` |

---

### 3. modules/Financeiro/index.html

| Linha | Texto Errado       | Texto Correto      | Contexto                               |
| ----- | ------------------ | ------------------ | -------------------------------------- |
| 303   | `Or�amentos`       | `Orçamentos`       | `title="Or�amentos"` (sidebar nav)     |
| 306   | `Concilia��o`      | `Conciliação`      | `title="Concilia��o"` (sidebar nav)    |
| 309   | `Relat�rios`       | `Relatórios`       | `title="Relat�rios"` (sidebar nav)     |
| 321   | `Configura��es`    | `Configurações`    | `title="Configura��es"` (sidebar nav)  |
| 435   | `T�tulos Vencidos` | `Títulos Vencidos` | Texto de card/KPI visível              |
| 437   | `Requer aten��o`   | `Requer atenção`   | Texto de badge/alerta visível          |
| 679   | `Sem descri��o`    | `Sem descrição`    | Fallback text em tabela (user-visible) |
| 702   | `Sem descri��o`    | `Sem descrição`    | Fallback text em tabela (user-visible) |

---

### 4. modules/Financeiro/contas-pagar.html

| Linha | Texto Errado  | Texto Correto | Contexto                            |
| ----- | ------------- | ------------- | ----------------------------------- |
| 394   | `Or�amentos`  | `Orçamentos`  | `title="Or�amentos"` (sidebar nav)  |
| 397   | `Concilia��o` | `Conciliação` | `title="Concilia��o"` (sidebar nav) |
| 400   | `Relat�rios`  | `Relatórios`  | `title="Relat�rios"` (sidebar nav)  |

---

### 5. modules/Financeiro/contas-receber.html

| Linha | Texto Errado                  | Texto Correto                 | Contexto                                          |
| ----- | ----------------------------- | ----------------------------- | ------------------------------------------------- |
| 1891  | `Or�amentos`                  | `Orçamentos`                  | `title="Or�amentos"` (sidebar nav)                |
| 1894  | `Concilia��o`                 | `Conciliação`                 | `title="Concilia��o"` (sidebar nav)               |
| 1897  | `Relat�rios`                  | `Relatórios`                  | `title="Relat�rios"` (sidebar nav)                |
| 3654  | `N�o informado`               | `Não informado`               | Fallback text visível (×3 ocorrências ~3653-3655) |
| 3656  | `descri��o` / `Sem descri��o` | `descrição` / `Sem descrição` | Propriedade JS + fallback visível ao usuário      |

---

### 6. modules/Financeiro/conciliacao.html

| Linha | Texto Errado  | Texto Correto | Contexto                            |
| ----- | ------------- | ------------- | ----------------------------------- |
| 363   | `Or�amentos`  | `Orçamentos`  | `title="Or�amentos"` (sidebar nav)  |
| 366   | `Concilia��o` | `Conciliação` | `title="Concilia��o"` (sidebar nav) |
| 369   | `Relat�rios`  | `Relatórios`  | `title="Relat�rios"` (sidebar nav)  |

---

### 7. modules/Financeiro/centros-custo.html

| Linha | Texto Errado  | Texto Correto | Contexto                            |
| ----- | ------------- | ------------- | ----------------------------------- |
| 237   | `Or�amentos`  | `Orçamentos`  | `title="Or�amentos"` (sidebar nav)  |
| 240   | `Concilia��o` | `Conciliação` | `title="Concilia��o"` (sidebar nav) |
| 243   | `Relat�rios`  | `Relatórios`  | `title="Relat�rios"` (sidebar nav)  |

---

### 8. modules/Financeiro/impostos.html

| Linha | Texto Errado                                                   | Texto Correto                                                  | Contexto                                        |
| ----- | -------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------- |
| 233   | `Or�amentos`                                                   | `Orçamentos`                                                   | `title="Or�amentos"` (sidebar nav)              |
| 236   | `Concilia��o`                                                  | `Conciliação`                                                  | `title="Concilia��o"` (sidebar nav)             |
| 239   | `Relat�rios`                                                   | `Relatórios`                                                   | `title="Relat�rios"` (sidebar nav)              |
| 251   | `Configura��es`                                                | `Configurações`                                                | `title="Configura��es"` (sidebar nav)           |
| 320   | `Configura��o de Impostos`                                     | `Configuração de Impostos`                                     | Heading `<h1>` da página                        |
| 321   | `configura��es tribut�rias`                                    | `configurações tributárias`                                    | Subtítulo `<p>` da página                       |
| 387   | `C�digo`                                                       | `Código`                                                       | Cabeçalho de tabela `<th>`                      |
| 389   | `Al�quota`                                                     | `Alíquota`                                                     | Cabeçalho de tabela `<th>`                      |
| 391   | `Base de C�lculo`                                              | `Base de Cálculo`                                              | Cabeçalho de tabela `<th>`                      |
| 392   | `A��es`                                                        | `Ações`                                                        | Cabeçalho de tabela `<th>`                      |
| 435   | `Identifica��o`                                                | `Identificação`                                                | Título de seção do formulário                   |
| 436   | `Obrigat�rio`                                                  | `Obrigatório`                                                  | Badge de seção visível                          |
| 440   | `C�digo`                                                       | `Código`                                                       | Label de campo do formulário                    |
| 458   | `Configura��o de C�lculo`                                      | `Configuração de Cálculo`                                      | Título de seção do formulário                   |
| 462   | `Configura��o de C�lculo`                                      | `Configuração de Cálculo`                                      | Título de seção (span)                          |
| 466   | `Al�quota (%)`                                                 | `Alíquota (%)`                                                 | Label de campo do formulário                    |
| 474   | `Base de C�lculo`                                              | `Base de Cálculo`                                              | Label de campo do formulário                    |
| 479   | `Servi�os Prestados`                                           | `Serviços Prestados`                                           | Opção de select visível                         |
| 483   | `Descri��o`                                                    | `Descrição`                                                    | Label de campo do formulário                    |
| 484   | `Descri��o detalhada do imposto e suas regras de aplica��o...` | `Descrição detalhada do imposto e suas regras de aplicação...` | Placeholder de textarea                         |
| 527   | `Circula��o de Mercadorias`                                    | `Circulação de Mercadorias`                                    | Nome de imposto (dados mock, visível na tabela) |
| 528   | `Servi�os`                                                     | `Serviços`                                                     | Nome de imposto (dados mock, visível na tabela) |
| 529   | `Integra��o Social`                                            | `Integração Social`                                            | Nome de imposto (dados mock, visível na tabela) |
| 530   | `Contribui��o para Financiamento...`                           | `Contribuição para Financiamento...`                           | Nome de imposto (dados mock, visível na tabela) |
| 531   | `Jur�dica`                                                     | `Jurídica`                                                     | Nome de imposto (dados mock, visível na tabela) |
| 532   | `Contribui��o Social sobre o Lucro L�quido`                    | `Contribuição Social sobre o Lucro Líquido`                    | Nome de imposto (dados mock, visível na tabela) |
| 634   | `Servi�os`                                                     | `Serviços`                                                     | Mapeamento formatarBase() (visível na tabela)   |

---

### 9. modules/Financeiro/fluxo-caixa.html

| Linha | Texto Errado    | Texto Correto   | Contexto                            |
| ----- | --------------- | --------------- | ----------------------------------- |
| 217   | `Or�amentos`    | `Orçamentos`    | `title="Or�amentos"` (sidebar nav)  |
| 220   | `Concilia��o`   | `Conciliação`   | `title="Concilia��o"` (sidebar nav) |
| 223   | `Relat�rios`    | `Relatórios`    | `title="Relat�rios"` (sidebar nav)  |
| 641   | `Sem descri��o` | `Sem descrição` | Fallback text visível em tabela     |

---

### 10. modules/Financeiro/bancos.html

| Linha | Texto Errado  | Texto Correto | Contexto                            |
| ----- | ------------- | ------------- | ----------------------------------- |
| 1578  | `Or�amentos`  | `Orçamentos`  | `title="Or�amentos"` (sidebar nav)  |
| 1581  | `Concilia��o` | `Conciliação` | `title="Concilia��o"` (sidebar nav) |
| 1584  | `Relat�rios`  | `Relatórios`  | `title="Relat�rios"` (sidebar nav)  |

---

### 11. modules/Financeiro/orcamentos.html

| Linha | Texto Errado  | Texto Correto | Contexto                            |
| ----- | ------------- | ------------- | ----------------------------------- |
| 823   | `Or�amentos`  | `Orçamentos`  | `title="Or�amentos"` (sidebar nav)  |
| 826   | `Concilia��o` | `Conciliação` | `title="Concilia��o"` (sidebar nav) |
| 829   | `Relat�rios`  | `Relatórios`  | `title="Relat�rios"` (sidebar nav)  |

---

### 12. modules/Financeiro/plano-contas.html

| Linha | Texto Errado  | Texto Correto | Contexto                            |
| ----- | ------------- | ------------- | ----------------------------------- |
| 742   | `Or�amentos`  | `Orçamentos`  | `title="Or�amentos"` (sidebar nav)  |
| 745   | `Concilia��o` | `Conciliação` | `title="Concilia��o"` (sidebar nav) |
| 748   | `Relat�rios`  | `Relatórios`  | `title="Relat�rios"` (sidebar nav)  |

---

### 13. modules/Financeiro/public/fluxo_caixa.html

| Linha | Texto Errado                      | Texto Correto                     | Contexto                                            |
| ----- | --------------------------------- | --------------------------------- | --------------------------------------------------- |
| 351   | `m.descri��o`                     | `m.descrição`                     | Propriedade JS renderizada na tabela (user-visible) |
| 353   | `Sa�da`                           | `Saída`                           | Texto de badge visível                              |
| 363   | `Descri��o`                       | `Descrição`                       | Cabeçalho CSV export (visível ao baixar)            |
| 366   | `m.descri��o`                     | `m.descrição`                     | Valor CSV export                                    |
| 383   | `Per�odo` / `Descri��o` / `Sa�da` | `Período` / `Descrição` / `Saída` | Cabeçalhos PDF export (visíveis)                    |
| ~383  | `m.descri��o`                     | `m.descrição`                     | Valor PDF export                                    |

---

### 14. modules/Financeiro/public/contas_bancarias.html

| Linha | Texto Errado                 | Texto Correto                | Contexto                     |
| ----- | ---------------------------- | ---------------------------- | ---------------------------- |
| 352   | `Descri��o *`                | `Descrição *`                | Label de campo no formulário |
| 352   | `Descri��o da movimenta��o`  | `Descrição da movimentação`  | Placeholder de input         |
| 371   | `Extrato Banc�rio`           | `Extrato Bancário`           | Título de modal `<h3>`       |
| 372   | `Movimenta��es da conta`     | `Movimentações da conta`     | Subtítulo de modal           |
| 381   | `At�`                        | `Até`                        | Label de filtro de data      |
| 386   | `Sa�das`                     | `Saídas`                     | Opção de select              |
| 393   | `Sa�das`                     | `Saídas`                     | Label de resumo              |
| 394   | `Saldo Per�odo`              | `Saldo Período`              | Label de resumo              |
| 403   | `Transfer�ncia entre Contas` | `Transferência entre Contas` | Título de modal              |
| 417   | `Descri��o`                  | `Descrição`                  | Label de campo               |
| 417   | `Transfer�ncia entre contas` | `Transferência entre contas` | Placeholder de input         |
| 652   | `Extrato Banc�rio`           | `Extrato Bancário`           | Título PDF export            |
| 652   | `Descri��o`                  | `Descrição`                  | Cabeçalho PDF export         |

---

### 15. modules/Financeiro/public/contas_pagar.html

| Linha | Texto Errado            | Texto Correto           | Contexto                       |
| ----- | ----------------------- | ----------------------- | ------------------------------ |
| 754   | `descri��o, fornecedor` | `descrição, fornecedor` | Placeholder de busca           |
| 809   | `Descri��o`             | `Descrição`             | Cabeçalho de tabela `<th>`     |
| 848   | `Descri��o *`           | `Descrição *`           | Label de campo no formulário   |
| 849   | `descri��o`             | `descrição`             | ID + placeholder de input      |
| 948   | `Descri��o da Conta`    | `Descrição da Conta`    | Label em modal de visualização |
| 1118  | `Sem Descri��o`         | `Sem Descrição`         | Fallback text visível          |
| 1314  | `Descri��o`             | `Descrição`             | Cabeçalho CSV export           |

---

### 16. modules/Financeiro/public/contas_receber.html

| Linha | Texto Errado         | Texto Correto        | Contexto                       |
| ----- | -------------------- | -------------------- | ------------------------------ |
| 306   | `descri��o, cliente` | `descrição, cliente` | Placeholder de busca           |
| 357   | `Descri��o`          | `Descrição`          | Cabeçalho de tabela `<th>`     |
| 387   | `Descri��o`          | `Descrição`          | Label em modal de visualização |
| 432   | `Descri��o *`        | `Descrição *`        | Label de campo no formulário   |
| 433   | `Servi�o prestado`   | `Serviço prestado`   | Placeholder de input           |
| 628   | `Sem Descri��o`      | `Sem Descrição`      | Fallback text visível          |
| 805   | `Descri��o`          | `Descrição`          | Cabeçalho CSV export           |

---

### 17. modules/Financeiro/public/index.html

| Linha | Texto Errado                    | Texto Correto                   | Contexto                                              |
| ----- | ------------------------------- | ------------------------------- | ----------------------------------------------------- |
| 508   | `descri��o` / `Sem Descri��o`   | `descrição` / `Sem Descrição`   | Prop JS + fallback (visível em tabela de vencimentos) |
| 541   | `descri��o` / `Sem Descri��o`   | `descrição` / `Sem Descrição`   | Prop JS + fallback (visível em tabela de lançamentos) |
| 636   | `Descri��o`                     | `Descrição`                     | Label de campo                                        |
| 636   | `Transfer�ncia para pagamentos` | `Transferência para pagamentos` | Placeholder de input                                  |
| 670   | `Transfer�ncia entre contas`    | `Transferência entre contas`    | Texto default de descrição (visível)                  |

---

### 18. modules/NFe/index.html

| Linha | Texto Errado     | Texto Correto    | Contexto                                |
| ----- | ---------------- | ---------------- | --------------------------------------- |
| 1090  | `% de aprova��o` | `% de aprovação` | Texto de tendência/badge (user-visible) |

---

### 19. modules/PCP/modal-produto-rico.html ⚠️ DOUBLE-ENCODED UTF-8

| Linha | Texto Errado               | Texto Correto             | Contexto                         |
| ----- | -------------------------- | ------------------------- | -------------------------------- |
| 369   | `Local de Estoque PadrÃ£o` | `Local de Estoque Padrão` | Opção de select (mojibake duplo) |
| 371   | `DepÃ³sito SecundÃ¡rio`    | `Depósito Secundário`     | Opção de select (mojibake duplo) |
| 372   | `Ãrea de ProduÃ§Ã£o`       | `Área de Produção`        | Opção de select (mojibake duplo) |

---

### 20. modules/Admin/public/pages/permissoes.html

| Linha | Texto Errado    | Texto Correto   | Contexto                     |
| ----- | --------------- | --------------- | ---------------------------- |
| 540   | `Log�stica`     | `Logística`     | Label de permissão (visível) |
| 545   | `P�ginas`       | `Páginas`       | Label de permissão (visível) |
| 547   | `Or�amentos`    | `Orçamentos`    | Label de permissão (visível) |
| 549   | `Relat�rios`    | `Relatórios`    | Label de permissão (visível) |
| 550   | `Exporta��o`    | `Exportação`    | Label de permissão (visível) |
| 551   | `Configura��es` | `Configurações` | Label de permissão (visível) |
| 552   | `Funcion�rios`  | `Funcionários`  | Label de permissão (visível) |
| 554   | `F�rias`        | `Férias`        | Label de permissão (visível) |
| 555   | `Produ��o`      | `Produção`      | Label de permissão (visível) |
| 560   | `T�tulos`       | `Títulos`       | Label de permissão (visível) |
| 563   | `Concilia��o`   | `Conciliação`   | Label de permissão (visível) |
| 567   | `Cota��es`      | `Cotações`      | Label de permissão (visível) |

---

## RECOMENDAÇÕES

### 1. Correção em Massa (Encoding)

A GRANDE MAIORIA dos problemas é corrupção de encoding, não erros de digitação. A solução ideal:

1. **Abrir cada arquivo afetado** em um editor que permita selecionar encoding (ex: VS Code → "Reopen with Encoding" → selecionar `Windows 1252` ou `Latin-1`).
2. **Salvar como UTF-8** (sem BOM).
3. Alternativamente, usar `iconv` em batch:
    ```bash
    iconv -f WINDOWS-1252 -t UTF-8 arquivo.html > arquivo_utf8.html
    ```

### 2. Para o arquivo PCP/modal-produto-rico.html (double-encoded)

Este arquivo precisa de tratamento diferente — foi codificado em UTF-8 duas vezes. Solução:

```bash
iconv -f UTF-8 -t LATIN1 modal-produto-rico.html | iconv -f UTF-8 -t UTF-8 > fixed.html
```

Ou corrigir manualmente as 3 linhas (369, 371, 372).

### 3. Prevenção

- Configurar `.editorconfig` com `charset = utf-8`
- Configurar VS Code workspace settings: `"files.encoding": "utf8"`
- Adicionar `<meta charset="UTF-8">` em todos os HTMLs (a maioria já tem)

---

## ERROS DE ORTOGRAFIA PUROS (TYPOS)

**Nenhum erro de ortografia puro foi encontrado.** Todas as 7 baterias de busca por erros comuns de digitação em português (selecione vs selecione, necessario vs necesario, obrigatório vs obrigatorio, etc.) retornaram zero resultados.
