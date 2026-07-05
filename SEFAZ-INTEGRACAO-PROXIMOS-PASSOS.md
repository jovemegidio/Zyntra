# Integração SEFAZ — Status atual e próximos passos

**Data:** 2026-05-26
**Empresa com cert:** Aluforce (CNPJ 68.192.475/0001-60, vence 2027-03-25)
**Labor Energy / Labor Eletric:** sem certificado A1

---

## O que está pronto agora ✅

| Componente | Arquivo | Status |
|------------|---------|--------|
| Upload de .pfx via UI | `public/config-modals.html#modal-certificado` | ✅ |
| Validação do PFX (CNPJ, validade) | `routes/pcp/configuracoes-routes.js#L2506` (node-forge) | ✅ |
| Persistência segura (BLOB + senha base64) | tabela `nfe_configuracoes` | ✅ |
| Botão "Testar SEFAZ-SP" no modal | `public/config-modals.html` | ✅ NOVO |
| Endpoint `GET /api/nfe/sefaz/status` | `routes/nfe-routes.js` | ✅ NOVO |
| Serviço SEFAZ (load cert + consStatServ) | `services/sefaz.service.js` | ✅ NOVO |
| Chave/protocolo SIMULADOS para NF-e | `routes/nfe-routes.js#gerarChaveSimulada` | ✅ (fallback) |

**Como usar agora:**

1. Login no sistema da Aluforce
2. Configurações → Certificado Digital
3. Selecionar arquivo `.pfx`, digitar senha, Salvar
4. Clicar em "Testar Status SEFAZ-SP"
5. Resposta esperada (cert válido + SEFAZ online):
   ```
   ✅ SEFAZ Online
   cStat 107 — Servico em Operacao
   Ambiente: homologacao | CNPJ: 68.192.475/0001-60
   Versão: SP_NFE_PL_009_V4 | 2026-05-26T...
   ```

Se aparecer **cStat=107**, o pipeline cert → TLS → SEFAZ está 100% funcional.

---

## O que falta para transmissão real de NF-e ⚠️

A consulta de status não exige assinatura digital. A **transmissão real de NF-e** sim. Cada etapa abaixo é trabalho real, não placeholder:

### 1. Geração de XML NF-e conforme NT 2024.002 (3-5 dias)
- Cerca de 60 campos obrigatórios + 100 condicionais
- Tags: `infNFe`, `ide`, `emit`, `dest`, `det` (por item), `total`, `transp`, `cobr`, `pag`, `infAdic`
- Cálculo correto de impostos: ICMS (CST, alíquota, base, ST), IPI, PIS, COFINS
- Validação contra XSD oficial: `procNFe_v4.00.xsd`
- Tratamento de NCM, CFOP por destinatário/finalidade

### 2. Assinatura Digital XML (1-2 dias)
- Algoritmo: RSA-SHA1 (exigência SEFAZ, não SHA256)
- Canonicalização: c14n exclusiva
- Bibliotecas Node: `xml-crypto` ou implementação manual com `crypto` + `node-forge`
- Inserir bloco `<Signature>` dentro de `<infNFe>`
- Validar assinatura com OpenSSL antes de transmitir

### 3. Transmissão SOAP (1 dia)
- WebService: `nfeAutorizacao4` (SP homologação ou produção)
- Envelope SOAP 1.2 com `nfeDadosMsg`
- Resposta síncrona (`indSinc=1`) ou assíncrona (`indSinc=0` + `nfeRetAutorizacao4`)
- Tratamento de cStat: 100 (autorizada), 110 (denegada), 204 (duplicada), 539 (rejeitada)

### 4. Eventos e contingência (1-2 dias)
- Cancelamento (`nfeRecepcaoEvento4` evento 110111)
- Carta de Correção (evento 110110)
- Inutilização de numeração (`nfeInutilizacao4`)
- Contingência off-line (SVC-AN/SVC-RS) quando SP cai

### 5. DANFE PDF (1-2 dias)
- Geração de PDF com barcode (chave 44 dígitos em Code128)
- Layout oficial DANFE (NT 2017/002 atualizado)
- Dependência: `pdfkit` (já instalado) ou template HTML → puppeteer

### 6. Testes em homologação (1-2 dias)
- Bateria de NF-e modelo: venda interna, venda interestadual, devolução
- Validar com SEFAZ-SP até cStat=100 consistente
- Só depois mudar `nfe_configuracoes.ambiente` para `'producao'`

**Estimativa total: 8-14 dias de desenvolvimento + 2-3 dias de testes**

---

## Recomendações estratégicas 💡

**Se prazo é curto:** considerar API de terceiro (FocusNFe, NFe.io, Sieg). Vantagens:
- R$ 30-80/mês
- Integração em ~2-4 horas (REST API simples)
- Eles cuidam de SEFAZ + DANFE + manutenção das XSDs
- Já testado em produção

**Se prazo é flexível e querem autonomia:** seguir o plano acima.

**Custos comparativos:**

| Opção | Custo inicial | Custo mensal | Tempo |
|-------|--------------|--------------|-------|
| Implementação própria | 8-14 dias dev | R$ 0 (custo SEFAZ certificado já pago) | longo |
| FocusNFe API | ~R$ 0 | R$ 39,90 (até 100 NFes) | curto |
| NFe.io | ~R$ 0 | R$ 49 (até 50 NFes) | curto |
| WebmaniaBR | ~R$ 0 | R$ 70 | curto |

---

## Próxima ação sugerida

1. **Cliente faz upload do .pfx** via Configurações → Certificado Digital
2. **Cliente clica "Testar Status SEFAZ-SP"** para validar que o cert lê ok
3. Com base no resultado, decide:
   - cStat=107 → cert OK, escolher entre implementação própria ou API de terceiro
   - erro → corrigir cert antes de qualquer integração
