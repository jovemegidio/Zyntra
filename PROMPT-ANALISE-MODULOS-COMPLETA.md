# 🔍 PROMPT DE ANÁLISE COMPLETA: MÓDULO POR MÓDULO
## AUDITORIA FUNCIONAL E GERAÇÃO AUTOMÁTICA DE CORREÇÕES

---

**Objetivo:** Analisar profundamente cada módulo do sistema Zyntra ERP, identificar todos os erros funcionais, bugs, problemas de integração e gerar automaticamente arquivos Markdown com instruções detalhadas de correção para cada erro encontrado.

**Auditor:** Senior Software Engineer | QA Specialist | DevOps Engineer  
**Data:** Maio 2026  
**Sistema:** Zyntra ERP v2.4.0  
**Escopo:** Análise funcional completa de todos os módulos

---

## 📋 ÍNDICE

1. [Metodologia de Análise](#1-metodologia-de-análise)
2. [Módulos a Analisar](#2-módulos-a-analisar)
3. [Checklist de Testes por Módulo](#3-checklist-de-testes-por-módulo)
4. [Script de Análise Automatizada](#4-script-de-análise-automatizada)
5. [Geração de Arquivos de Correção](#5-geração-de-arquivos-de-correção)
6. [Estrutura dos Arquivos de Correção](#6-estrutura-dos-arquivos-de-correção)

---

## 🎯 1. METODOLOGIA DE ANÁLISE

### 1.1 ABORDAGEM

Para cada módulo, realizar:

1. **Análise Estática**
   - Verificar estrutura de arquivos
   - Analisar código-fonte
   - Identificar imports/exports quebrados
   - Verificar rotas definidas

2. **Análise Dinâmica**
   - Testar funcionalidades principais
   - Verificar CRUD completo
   - Testar integrações
   - Validar permissões

3. **Análise de Integração**
   - Verificar comunicação entre módulos
   - Testar fluxos end-to-end
   - Validar consistência de dados

4. **Análise de Performance**
   - Medir tempo de resposta
   - Identificar queries lentas
   - Verificar memory leaks

### 1.2 CRITÉRIOS DE ERRO

**Classificação de Erros:**

- 🔴 **CRÍTICO**: Sistema não funciona, dados corrompidos, segurança comprometida
- 🟠 **ALTO**: Funcionalidade principal quebrada, impacto significativo
- 🟡 **MÉDIO**: Funcionalidade secundária com problemas, workaround possível
- 🔵 **BAIXO**: Problema estético, melhoria de UX, otimização

---

## 📦 2. MÓDULOS A ANALISAR

### Lista Completa de Módulos

1. **Dashboard** - Painel principal
2. **Vendas** - Gestão de vendas e pedidos
3. **Faturamento** - Emissão de notas fiscais
4. **Financeiro** - Contas a pagar/receber, fluxo de caixa
5. **PCP** - Planejamento e Controle de Produção
6. **Compras** - Gestão de compras e fornecedores
7. **Estoque** - Controle de estoque e movimentações
8. **RH** - Recursos Humanos e folha de pagamento
9. **Admin** - Administração de usuários e sistema
10. **Relatórios** - Geração de relatórios gerenciais
11. **NFe** - Integração com SEFAZ
12. **CRM** - Gestão de relacionamento com clientes
13. **Logística** - Gestão de entregas e transportes

---

## ✅ 3. CHECKLIST DE TESTES POR MÓDULO

### 3.1 MÓDULO: DASHBOARD

**Localização:** `modules/Admin/` ou `/dashboard`

#### Funcionalidades a Testar

```markdown
## DASHBOARD - CHECKLIST DE TESTES

### Carregamento da Página
- [ ] Página carrega sem erros 404/500
- [ ] Tempo de carregamento < 3 segundos
- [ ] Sem erros no console do navegador
- [ ] Sem erros no log do servidor

### Widgets/Cards
- [ ] Card "Vendas do Mês" exibe dados corretos
- [ ] Card "Pedidos Pendentes" exibe dados corretos
- [ ] Card "Contas a Receber" exibe dados corretos
- [ ] Card "Estoque Baixo" exibe dados corretos
- [ ] Todos os valores monetários formatados (R$ X.XXX,XX)
- [ ] Todas as datas formatadas (DD/MM/YYYY)

### Gráficos
- [ ] Gráfico de vendas renderiza corretamente
- [ ] Gráfico de faturamento renderiza corretamente
- [ ] Dados dos gráficos correspondem ao período selecionado
- [ ] Legendas dos gráficos visíveis e corretas
- [ ] Gráficos responsivos (mobile/tablet)

### Filtros
- [ ] Filtro de período funciona
- [ ] Filtro de empresa funciona (multi-company)
- [ ] Dados atualizam ao mudar filtros
- [ ] Filtros persistem ao recarregar página

### Ações Rápidas
- [ ] Botão "Novo Pedido" redireciona corretamente
- [ ] Botão "Nova Venda" redireciona corretamente
- [ ] Botão "Lançar Conta" redireciona corretamente
- [ ] Todos os links funcionam

### Notificações
- [ ] Notificações carregam
- [ ] Badge de contador atualiza
- [ ] Clicar em notificação redireciona corretamente
- [ ] Marcar como lida funciona

### Performance
- [ ] Queries executam em < 1 segundo
- [ ] Sem N+1 queries
- [ ] Cache funcionando (se implementado)
- [ ] Sem memory leaks

### Permissões
- [ ] Usuário admin vê todos os dados
- [ ] Usuário vendedor vê apenas seus dados
- [ ] Usuário financeiro vê apenas dados financeiros
- [ ] Acesso negado para usuários sem permissão
```



### 3.2 MÓDULO: VENDAS

**Localização:** `modules/Vendas/`

#### Funcionalidades a Testar

```markdown
## VENDAS - CHECKLIST DE TESTES

### Listagem de Pedidos
- [ ] Lista carrega todos os pedidos
- [ ] Paginação funciona
- [ ] Ordenação por coluna funciona
- [ ] Busca/filtro funciona
- [ ] Status dos pedidos exibidos corretamente
- [ ] Valores formatados corretamente

### Criar Novo Pedido
- [ ] Formulário abre sem erros
- [ ] Seleção de cliente funciona
- [ ] Busca de produtos funciona
- [ ] Adicionar item ao pedido funciona
- [ ] Remover item do pedido funciona
- [ ] Cálculo de totais correto
- [ ] Aplicação de desconto funciona
- [ ] Cálculo de frete funciona
- [ ] Validação de campos obrigatórios
- [ ] Salvar pedido funciona
- [ ] Pedido salvo no banco de dados

### Editar Pedido
- [ ] Carregar dados do pedido
- [ ] Editar itens funciona
- [ ] Alterar quantidades funciona
- [ ] Recalcular totais funciona
- [ ] Salvar alterações funciona
- [ ] Histórico de alterações registrado

### Aprovar Pedido
- [ ] Botão "Aprovar" visível para usuários autorizados
- [ ] Aprovação altera status do pedido
- [ ] Notificação enviada ao vendedor
- [ ] Estoque reservado (se aplicável)
- [ ] Log de auditoria registrado

### Cancelar Pedido
- [ ] Botão "Cancelar" visível
- [ ] Justificativa obrigatória
- [ ] Cancelamento altera status
- [ ] Estoque liberado (se reservado)
- [ ] Notificação enviada

### Imprimir Pedido
- [ ] PDF gerado corretamente
- [ ] Todos os dados presentes
- [ ] Logo da empresa exibido
- [ ] Formatação adequada
- [ ] Download funciona

### Integração com Outros Módulos
- [ ] Pedido aprovado aparece no Faturamento
- [ ] Pedido reserva estoque
- [ ] Pedido gera contas a receber
- [ ] Comissão calculada para vendedor

### Permissões
- [ ] Vendedor vê apenas seus pedidos
- [ ] Gerente vê todos os pedidos
- [ ] Apenas gerente pode aprovar
- [ ] Apenas admin pode cancelar pedido aprovado
```

### 3.3 MÓDULO: FATURAMENTO

**Localização:** `modules/Faturamento/`

```markdown
## FATURAMENTO - CHECKLIST DE TESTES

### Listagem de Pedidos Pendentes
- [ ] Lista carrega pedidos aprovados não faturados
- [ ] Filtros funcionam
- [ ] Ordenação funciona
- [ ] Dados do cliente completos

### Gerar NFe
- [ ] Formulário de NFe abre
- [ ] Dados do pedido carregam
- [ ] Natureza da operação selecionável
- [ ] Transportadora selecionável
- [ ] Tipo de frete selecionável
- [ ] Cálculo de impostos correto
- [ ] NFe salva no banco
- [ ] Número sequencial correto
- [ ] Pedido marcado como faturado

### Transmitir NFe
- [ ] XML gerado corretamente
- [ ] Assinatura digital funciona
- [ ] Transmissão para SEFAZ funciona
- [ ] Chave de acesso retornada
- [ ] Protocolo salvo
- [ ] Status atualizado para "Autorizada"
- [ ] Tratamento de erros da SEFAZ

### Cancelar NFe
- [ ] Justificativa obrigatória (mín 15 caracteres)
- [ ] Prazo de 24h validado
- [ ] Cancelamento enviado à SEFAZ
- [ ] Status atualizado para "Cancelada"
- [ ] Pedido volta para status anterior

### Imprimir DANFE
- [ ] PDF gerado
- [ ] Layout padrão SEFAZ
- [ ] Código de barras legível
- [ ] QR Code funcional (NFCe)
- [ ] Todas as informações presentes

### Consultar NFe
- [ ] Consulta na SEFAZ funciona
- [ ] Status atualizado
- [ ] XML de retorno salvo

### Relatórios
- [ ] Relatório de notas emitidas
- [ ] Relatório de notas canceladas
- [ ] Filtros por período funcionam
- [ ] Exportação para Excel/PDF
```



### 3.4 MÓDULO: FINANCEIRO

**Localização:** `modules/Financeiro/`

```markdown
## FINANCEIRO - CHECKLIST DE TESTES

### Contas a Receber
- [ ] Listagem carrega
- [ ] Filtros por status funcionam
- [ ] Filtros por data funcionam
- [ ] Criar novo título funciona
- [ ] Editar título funciona
- [ ] Baixar título (receber) funciona
- [ ] Estornar baixa funciona
- [ ] Cálculo de juros/multa correto
- [ ] Cálculo de desconto correto
- [ ] Relatório de inadimplência

### Contas a Pagar
- [ ] Listagem carrega
- [ ] Criar novo título funciona
- [ ] Editar título funciona
- [ ] Pagar título funciona
- [ ] Estornar pagamento funciona
- [ ] Agendamento de pagamento funciona
- [ ] Integração com bancos (se aplicável)

### Fluxo de Caixa
- [ ] Visualização diária funciona
- [ ] Visualização semanal funciona
- [ ] Visualização mensal funciona
- [ ] Projeção de saldo funciona
- [ ] Lançamentos manuais funcionam
- [ ] Categorização de lançamentos
- [ ] Gráficos renderizam
- [ ] Exportação funciona

### Conciliação Bancária
- [ ] Importação de OFX funciona
- [ ] Importação de extrato funciona
- [ ] Conciliação automática funciona
- [ ] Conciliação manual funciona
- [ ] Diferenças identificadas
- [ ] Relatório de conciliação

### Bancos
- [ ] Cadastro de banco funciona
- [ ] Edição de banco funciona
- [ ] Saldo atualizado
- [ ] Movimentações registradas
- [ ] Transferências entre bancos

### Relatórios Financeiros
- [ ] DRE (Demonstração de Resultado)
- [ ] Fluxo de Caixa Realizado
- [ ] Fluxo de Caixa Projetado
- [ ] Contas a Receber por Cliente
- [ ] Contas a Pagar por Fornecedor
- [ ] Inadimplência
```

### 3.5 MÓDULO: PCP (PRODUÇÃO)

**Localização:** `modules/PCP/`

```markdown
## PCP - CHECKLIST DE TESTES

### Ordens de Produção
- [ ] Listagem carrega
- [ ] Criar OP a partir de pedido funciona
- [ ] Criar OP manual funciona
- [ ] Editar OP funciona
- [ ] Iniciar produção funciona
- [ ] Pausar produção funciona
- [ ] Finalizar produção funciona
- [ ] Cancelar OP funciona
- [ ] Imprimir OP funciona

### Estrutura de Produtos (BOM)
- [ ] Cadastrar estrutura funciona
- [ ] Editar estrutura funciona
- [ ] Adicionar componentes funciona
- [ ] Remover componentes funciona
- [ ] Cálculo de custo funciona
- [ ] Explosão de materiais funciona
- [ ] Visualização em árvore funciona

### Apontamentos de Produção
- [ ] Registrar apontamento funciona
- [ ] Editar apontamento funciona
- [ ] Calcular tempo de produção
- [ ] Registrar refugo/perda funciona
- [ ] Atualizar estoque funciona
- [ ] Relatório de produtividade

### Roteiros de Produção
- [ ] Cadastrar roteiro funciona
- [ ] Editar roteiro funciona
- [ ] Sequência de operações correta
- [ ] Tempo estimado vs realizado
- [ ] Centro de trabalho atribuído

### Planejamento
- [ ] MRP (Cálculo de necessidades)
- [ ] Sugestão de compras
- [ ] Sugestão de produção
- [ ] Capacidade de produção
- [ ] Sequenciamento de OPs

### Kanban (se implementado)
- [ ] Visualização de cards funciona
- [ ] Arrastar e soltar funciona
- [ ] Status atualiza
- [ ] Filtros funcionam
```

### 3.6 MÓDULO: COMPRAS

**Localização:** `modules/Compras/`

```markdown
## COMPRAS - CHECKLIST DE TESTES

### Pedidos de Compra
- [ ] Listagem carrega
- [ ] Criar pedido funciona
- [ ] Editar pedido funciona
- [ ] Aprovar pedido funciona
- [ ] Cancelar pedido funciona
- [ ] Enviar pedido por email funciona
- [ ] Imprimir pedido funciona

### Cotações
- [ ] Criar cotação funciona
- [ ] Adicionar fornecedores funciona
- [ ] Registrar propostas funciona
- [ ] Comparar propostas funciona
- [ ] Gerar pedido a partir de cotação

### Fornecedores
- [ ] Cadastrar fornecedor funciona
- [ ] Editar fornecedor funciona
- [ ] Inativar fornecedor funciona
- [ ] Histórico de compras funciona
- [ ] Avaliação de fornecedor funciona

### Recebimento de Mercadorias
- [ ] Registrar recebimento funciona
- [ ] Conferência de quantidades
- [ ] Conferência de qualidade
- [ ] Divergências registradas
- [ ] Estoque atualizado
- [ ] Nota fiscal vinculada

### Solicitações de Compra
- [ ] Criar solicitação funciona
- [ ] Aprovar solicitação funciona
- [ ] Gerar pedido a partir de solicitação
- [ ] Notificações funcionam
```

### 3.7 MÓDULO: ESTOQUE

**Localização:** `modules/Estoque/`

```markdown
## ESTOQUE - CHECKLIST DE TESTES

### Produtos
- [ ] Listagem carrega
- [ ] Cadastrar produto funciona
- [ ] Editar produto funciona
- [ ] Inativar produto funciona
- [ ] Upload de imagem funciona
- [ ] Código de barras gerado
- [ ] Categorização funciona

### Movimentações
- [ ] Entrada manual funciona
- [ ] Saída manual funciona
- [ ] Transferência entre depósitos funciona
- [ ] Ajuste de estoque funciona
- [ ] Histórico de movimentações
- [ ] Rastreabilidade (lote/série)

### Inventário
- [ ] Criar inventário funciona
- [ ] Contagem funciona
- [ ] Divergências identificadas
- [ ] Ajuste automático funciona
- [ ] Relatório de inventário

### Depósitos/Locais
- [ ] Cadastrar depósito funciona
- [ ] Editar depósito funciona
- [ ] Saldo por depósito correto
- [ ] Transferências registradas

### Alertas
- [ ] Alerta de estoque mínimo funciona
- [ ] Alerta de estoque máximo funciona
- [ ] Alerta de validade (se aplicável)
- [ ] Notificações enviadas

### Relatórios
- [ ] Posição de estoque
- [ ] Movimentações por período
- [ ] Curva ABC
- [ ] Giro de estoque
- [ ] Produtos sem movimentação
```



---

## 🤖 4. SCRIPT DE ANÁLISE AUTOMATIZADA

### 4.1 SCRIPT PRINCIPAL

```javascript
// scripts/analyze-all-modules.js

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const axios = require('axios');

const MODULES = [
    {
        name: 'Dashboard',
        url: '/dashboard',
        tests: require('./tests/dashboard.tests.js')
    },
    {
        name: 'Vendas',
        url: '/vendas',
        tests: require('./tests/vendas.tests.js')
    },
    {
        name: 'Faturamento',
        url: '/faturamento',
        tests: require('./tests/faturamento.tests.js')
    },
    {
        name: 'Financeiro',
        url: '/financeiro',
        tests: require('./tests/financeiro.tests.js')
    },
    {
        name: 'PCP',
        url: '/pcp',
        tests: require('./tests/pcp.tests.js')
    },
    {
        name: 'Compras',
        url: '/compras',
        tests: require('./tests/compras.tests.js')
    },
    {
        name: 'Estoque',
        url: '/estoque',
        tests: require('./tests/estoque.tests.js')
    },
    {
        name: 'RH',
        url: '/rh',
        tests: require('./tests/rh.tests.js')
    },
    {
        name: 'Admin',
        url: '/admin',
        tests: require('./tests/admin.tests.js')
    },
    {
        name: 'Relatórios',
        url: '/relatorios',
        tests: require('./tests/relatorios.tests.js')
    }
];

class ModuleAnalyzer {
    constructor() {
        this.browser = null;
        this.page = null;
        this.baseUrl = process.env.BASE_URL || 'http://localhost:3000';
        this.results = {
            timestamp: new Date().toISOString(),
            modules: [],
            summary: {
                total: 0,
                passed: 0,
                failed: 0,
                errors: []
            }
        };
    }

    async init() {
        this.browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        this.page = await this.browser.newPage();
        
        // Configurar console logging
        this.page.on('console', msg => {
            if (msg.type() === 'error') {
                console.log('❌ Console Error:', msg.text());
            }
        });
        
        // Configurar error logging
        this.page.on('pageerror', error => {
            console.log('❌ Page Error:', error.message);
        });
        
        await this.login();
    }

    async login() {
        console.log('🔐 Realizando login...');
        await this.page.goto(`${this.baseUrl}/login`);
        await this.page.type('#email', process.env.TEST_USER || 'admin@aluforce.com.br');
        await this.page.type('#password', process.env.TEST_PASSWORD || 'senha123');
        await this.page.click('button[type="submit"]');
        await this.page.waitForNavigation();
        console.log('✅ Login realizado com sucesso');
    }

    async analyzeModule(module) {
        console.log(`\n📦 Analisando módulo: ${module.name}`);
        
        const moduleResult = {
            name: module.name,
            url: module.url,
            status: 'passed',
            tests: [],
            errors: [],
            warnings: [],
            performance: {}
        };

        try {
            // Navegar para o módulo
            const startTime = Date.now();
            await this.page.goto(`${this.baseUrl}${module.url}`, {
                waitUntil: 'networkidle2',
                timeout: 30000
            });
            const loadTime = Date.now() - startTime;
            moduleResult.performance.loadTime = loadTime;

            console.log(`   ⏱️  Tempo de carregamento: ${loadTime}ms`);

            // Verificar erros de console
            const consoleErrors = [];
            this.page.on('console', msg => {
                if (msg.type() === 'error') {
                    consoleErrors.push(msg.text());
                }
            });

            // Executar testes específicos do módulo
            if (module.tests) {
                for (const test of module.tests) {
                    const testResult = await this.runTest(test);
                    moduleResult.tests.push(testResult);
                    
                    if (!testResult.passed) {
                        moduleResult.status = 'failed';
                        moduleResult.errors.push({
                            test: test.name,
                            error: testResult.error,
                            severity: test.severity || 'medium'
                        });
                    }
                }
            }

            // Verificar elementos básicos
            await this.checkBasicElements(moduleResult);

            // Verificar APIs
            await this.checkAPIs(module, moduleResult);

            // Tirar screenshot
            await this.page.screenshot({
                path: `analysis-screenshots/${module.name.toLowerCase().replace(/\s+/g, '-')}.png`,
                fullPage: true
            });

        } catch (error) {
            console.log(`   ❌ Erro ao analisar módulo: ${error.message}`);
            moduleResult.status = 'error';
            moduleResult.errors.push({
                test: 'Module Load',
                error: error.message,
                severity: 'critical'
            });
        }

        this.results.modules.push(moduleResult);
        this.results.summary.total++;
        
        if (moduleResult.status === 'passed') {
            this.results.summary.passed++;
            console.log(`   ✅ Módulo ${module.name}: PASSOU`);
        } else {
            this.results.summary.failed++;
            console.log(`   ❌ Módulo ${module.name}: FALHOU`);
        }

        return moduleResult;
    }

    async checkBasicElements(moduleResult) {
        // Verificar título da página
        const title = await this.page.title();
        if (!title || title === '') {
            moduleResult.warnings.push('Título da página vazio');
        }

        // Verificar se há h1
        const h1 = await this.page.$('h1');
        if (!h1) {
            moduleResult.warnings.push('Título principal (h1) não encontrado');
        }

        // Verificar se há tabela (para módulos de listagem)
        const table = await this.page.$('table');
        if (!table) {
            moduleResult.warnings.push('Tabela não encontrada (esperado para módulo de listagem)');
        }

        // Verificar botões de ação
        const buttons = await this.page.$$('button, .btn');
        if (buttons.length === 0) {
            moduleResult.warnings.push('Nenhum botão encontrado');
        }
    }

    async checkAPIs(module, moduleResult) {
        // Interceptar requisições de API
        const apiCalls = [];
        
        this.page.on('response', response => {
            const url = response.url();
            if (url.includes('/api/')) {
                apiCalls.push({
                    url: url,
                    status: response.status(),
                    ok: response.ok()
                });
            }
        });

        // Aguardar um pouco para capturar chamadas de API
        await this.page.waitForTimeout(2000);

        // Verificar se há erros de API
        const failedAPIs = apiCalls.filter(api => !api.ok);
        if (failedAPIs.length > 0) {
            failedAPIs.forEach(api => {
                moduleResult.errors.push({
                    test: 'API Call',
                    error: `API falhou: ${api.url} (Status: ${api.status})`,
                    severity: 'high'
                });
            });
        }

        moduleResult.performance.apiCalls = apiCalls.length;
    }

    async runTest(test) {
        try {
            const result = await test.fn(this.page);
            return {
                name: test.name,
                passed: result.passed,
                error: result.error || null,
                duration: result.duration || 0
            };
        } catch (error) {
            return {
                name: test.name,
                passed: false,
                error: error.message,
                duration: 0
            };
        }
    }

    async generateReports() {
        console.log('\n📊 Gerando relatórios...');

        // Salvar resultado completo em JSON
        fs.writeFileSync(
            'analysis-results.json',
            JSON.stringify(this.results, null, 2)
        );

        // Gerar relatório resumido
        this.generateSummaryReport();

        // Gerar arquivos de correção para cada erro
        await this.generateFixFiles();

        console.log('✅ Relatórios gerados com sucesso!');
    }

    generateSummaryReport() {
        const summary = `
# 📊 RELATÓRIO DE ANÁLISE DE MÓDULOS
## Zyntra ERP - Análise Funcional Completa

**Data:** ${new Date(this.results.timestamp).toLocaleString('pt-BR')}

---

## RESUMO EXECUTIVO

- **Total de Módulos:** ${this.results.summary.total}
- **✅ Módulos OK:** ${this.results.summary.passed}
- **❌ Módulos com Problemas:** ${this.results.summary.failed}
- **📈 Taxa de Sucesso:** ${((this.results.summary.passed / this.results.summary.total) * 100).toFixed(2)}%

---

## DETALHES POR MÓDULO

${this.results.modules.map(m => `
### ${m.status === 'passed' ? '✅' : '❌'} ${m.name}

- **URL:** ${m.url}
- **Status:** ${m.status.toUpperCase()}
- **Tempo de Carregamento:** ${m.performance.loadTime}ms
- **Testes Executados:** ${m.tests.length}
- **Erros Encontrados:** ${m.errors.length}
- **Avisos:** ${m.warnings.length}

${m.errors.length > 0 ? `
#### Erros:
${m.errors.map(e => `- [${e.severity.toUpperCase()}] ${e.test}: ${e.error}`).join('\n')}
` : ''}

${m.warnings.length > 0 ? `
#### Avisos:
${m.warnings.map(w => `- ${w}`).join('\n')}
` : ''}
`).join('\n')}

---

## PRÓXIMOS PASSOS

${this.results.summary.failed > 0 ? `
1. Revisar arquivos de correção gerados em \`fixes/\`
2. Priorizar correções por severidade (CRITICAL > HIGH > MEDIUM > LOW)
3. Implementar correções
4. Re-executar análise para validar
` : `
✅ Todos os módulos estão funcionando corretamente!
`}

---

**Relatório gerado automaticamente por:** analyze-all-modules.js
`;

        fs.writeFileSync('RELATORIO-ANALISE-MODULOS.md', summary);
    }

    async generateFixFiles() {
        console.log('\n📝 Gerando arquivos de correção...');

        // Criar diretório de correções
        if (!fs.existsSync('fixes')) {
            fs.mkdirSync('fixes');
        }

        for (const module of this.results.modules) {
            if (module.errors.length > 0) {
                await this.createFixFile(module);
            }
        }
    }

    async createFixFile(module) {
        const fileName = `fixes/FIX-${module.name.toUpperCase().replace(/\s+/g, '-')}.md`;
        
        const content = `
# 🔧 CORREÇÃO: ${module.name}
## Arquivo de Correção Gerado Automaticamente

**Data de Geração:** ${new Date().toLocaleString('pt-BR')}  
**Módulo:** ${module.name}  
**URL:** ${module.url}  
**Total de Erros:** ${module.errors.length}

---

## 📋 SUMÁRIO DE ERROS

${module.errors.map((e, i) => `${i + 1}. [${e.severity.toUpperCase()}] ${e.test}`).join('\n')}

---

${module.errors.map((error, index) => this.generateErrorFix(error, index + 1, module)).join('\n\n---\n\n')}

---

## ✅ CHECKLIST DE VALIDAÇÃO

Após implementar as correções, validar:

- [ ] Módulo carrega sem erros
- [ ] Todas as funcionalidades testadas funcionam
- [ ] Sem erros no console do navegador
- [ ] Sem erros no log do servidor
- [ ] Performance adequada (< 3s de carregamento)
- [ ] Testes automatizados passam
- [ ] Re-executar análise: \`node scripts/analyze-all-modules.js\`

---

**Arquivo gerado por:** analyze-all-modules.js
`;

        fs.writeFileSync(fileName, content);
        console.log(`   ✅ Arquivo criado: ${fileName}`);
    }

    generateErrorFix(error, number, module) {
        return `
## ERRO ${number}: ${error.test}

### 🔴 Severidade: ${error.severity.toUpperCase()}

### 📝 Descrição do Erro

\`\`\`
${error.error}
\`\`\`

### 🔍 Análise

${this.analyzeError(error, module)}

### 🛠️ Solução Proposta

${this.proposeSolution(error, module)}

### 📂 Arquivos Afetados

${this.identifyAffectedFiles(error, module)}

### 🧪 Como Testar

1. Implementar a correção
2. Reiniciar o servidor
3. Acessar: \`${module.url}\`
4. Verificar se o erro não ocorre mais
5. Testar funcionalidade relacionada

### 📸 Evidência

Screenshot: \`analysis-screenshots/${module.name.toLowerCase().replace(/\s+/g, '-')}.png\`
`;
    }

    analyzeError(error, module) {
        // Análise baseada no tipo de erro
        if (error.error.includes('404')) {
            return `
**Causa Provável:** Rota ou recurso não encontrado.

**Possíveis Causas:**
- Rota não definida no servidor
- Arquivo estático não encontrado
- URL incorreta no frontend
- Middleware bloqueando acesso
`;
        } else if (error.error.includes('500')) {
            return `
**Causa Provável:** Erro interno do servidor.

**Possíveis Causas:**
- Erro de sintaxe no código
- Exceção não tratada
- Erro de banco de dados
- Variável undefined
`;
        } else if (error.error.includes('API')) {
            return `
**Causa Provável:** Falha na comunicação com API.

**Possíveis Causas:**
- Endpoint não implementado
- Erro de validação
- Erro de autenticação/autorização
- Timeout de requisição
`;
        } else {
            return `
**Causa Provável:** Erro funcional no módulo.

**Recomendação:** Analisar logs do servidor e console do navegador para mais detalhes.
`;
        }
    }

    proposeSolution(error, module) {
        // Propor solução baseada no tipo de erro
        if (error.error.includes('404')) {
            return `
\`\`\`javascript
// 1. Verificar se a rota está definida
// server.js ou routes/${module.name.toLowerCase()}.js

app.get('/api/${module.name.toLowerCase()}/...', authenticateToken, async (req, res) => {
    try {
        // Implementar lógica
        res.json({ success: true, data: [] });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
\`\`\`

2. Verificar se o arquivo estático existe no caminho correto
3. Verificar se a URL no frontend está correta
`;
        } else if (error.error.includes('500')) {
            return `
\`\`\`javascript
// 1. Adicionar try-catch para capturar erro

try {
    // Código que está falhando
} catch (error) {
    console.error('Erro no módulo ${module.name}:', error);
    res.status(500).json({ 
        success: false, 
        message: 'Erro ao processar requisição' 
    });
}
\`\`\`

2. Verificar logs do servidor para stack trace completo
3. Adicionar validações de dados
4. Verificar conexão com banco de dados
`;
        } else {
            return `
1. Analisar logs detalhados
2. Reproduzir erro manualmente
3. Adicionar logs de debug
4. Implementar correção específica
5. Adicionar testes para prevenir regressão
`;
        }
    }

    identifyAffectedFiles(error, module) {
        const moduleName = module.name.toLowerCase();
        return `
**Prováveis arquivos afetados:**

- \`modules/${module.name}/server.js\`
- \`modules/${module.name}/routes/*.js\`
- \`modules/${module.name}/public/pages/*.html\`
- \`modules/${module.name}/public/js/*.js\`
- \`server.js\` (rotas principais)

**Para localizar o arquivo exato:**

\`\`\`bash
# Buscar por texto relacionado ao erro
grep -r "${error.test}" modules/${module.name}/

# Buscar por rotas
grep -r "app.get.*${moduleName}" .

# Verificar logs
tail -f logs/error.log
\`\`\`
`;
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
        }
    }
}

// Executar análise
async function main() {
    console.log('🚀 Iniciando análise completa de módulos...\n');

    // Criar diretório de screenshots
    if (!fs.existsSync('analysis-screenshots')) {
        fs.mkdirSync('analysis-screenshots');
    }

    const analyzer = new ModuleAnalyzer();
    
    try {
        await analyzer.init();

        for (const module of MODULES) {
            await analyzer.analyzeModule(module);
        }

        await analyzer.generateReports();

        console.log('\n✅ Análise concluída com sucesso!');
        console.log('\n📄 Arquivos gerados:');
        console.log('   - analysis-results.json');
        console.log('   - RELATORIO-ANALISE-MODULOS.md');
        console.log('   - fixes/FIX-*.md (para cada módulo com erros)');
        console.log('   - analysis-screenshots/*.png');

    } catch (error) {
        console.error('\n❌ Erro durante análise:', error);
    } finally {
        await analyzer.close();
    }
}

// Executar
main().catch(console.error);
```



---

## 📝 5. GERAÇÃO DE ARQUIVOS DE CORREÇÃO

### 5.1 ESTRUTURA DOS ARQUIVOS

Cada erro encontrado gera um arquivo Markdown individual com:

1. **Identificação do Erro**
2. **Análise da Causa Raiz**
3. **Solução Proposta (código)**
4. **Arquivos Afetados**
5. **Instruções de Teste**
6. **Checklist de Validação**

### 5.2 EXEMPLO DE ARQUIVO GERADO

```markdown
# 🔧 CORREÇÃO: VENDAS
## Arquivo de Correção Gerado Automaticamente

**Data de Geração:** 23/05/2026 14:30:00  
**Módulo:** Vendas  
**URL:** /vendas  
**Total de Erros:** 3

---

## 📋 SUMÁRIO DE ERROS

1. [CRITICAL] API Call Failed - GET /api/vendas/pedidos
2. [HIGH] Botão "Novo Pedido" não funciona
3. [MEDIUM] Filtro de data não aplica corretamente

---

## ERRO 1: API Call Failed - GET /api/vendas/pedidos

### 🔴 Severidade: CRITICAL

### 📝 Descrição do Erro

\`\`\`
API falhou: http://localhost:3000/api/vendas/pedidos (Status: 500)
\`\`\`

### 🔍 Análise

**Causa Provável:** Erro interno do servidor.

**Possíveis Causas:**
- Erro de sintaxe no código
- Exceção não tratada
- Erro de banco de dados
- Variável undefined

### 🛠️ Solução Proposta

\`\`\`javascript
// routes/vendas.js ou server.js

app.get('/api/vendas/pedidos', authenticateToken, async (req, res) => {
    try {
        const { status, data_inicio, data_fim, cliente_id } = req.query;
        
        // Construir query com filtros
        let query = `
            SELECT 
                p.*,
                c.nome as cliente_nome,
                u.nome as vendedor_nome
            FROM pedidos p
            LEFT JOIN clientes c ON p.cliente_id = c.id
            LEFT JOIN usuarios u ON p.vendedor_id = u.id
            WHERE p.deleted_at IS NULL
        `;
        
        const params = [];
        
        if (status) {
            query += ' AND p.status = ?';
            params.push(status);
        }
        
        if (data_inicio && data_fim) {
            query += ' AND p.data_pedido BETWEEN ? AND ?';
            params.push(data_inicio, data_fim);
        }
        
        if (cliente_id) {
            query += ' AND p.cliente_id = ?';
            params.push(cliente_id);
        }
        
        query += ' ORDER BY p.data_pedido DESC LIMIT 100';
        
        const [pedidos] = await pool.query(query, params);
        
        res.json({
            success: true,
            pedidos: pedidos,
            total: pedidos.length
        });
        
    } catch (error) {
        console.error('Erro ao buscar pedidos:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao carregar pedidos',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});
\`\`\`

### 📂 Arquivos Afetados

**Prováveis arquivos afetados:**

- \`modules/Vendas/server.js\`
- \`modules/Vendas/routes/pedidos.js\`
- \`server.js\` (rotas principais)

**Para localizar o arquivo exato:**

\`\`\`bash
# Buscar por texto relacionado ao erro
grep -r "api/vendas/pedidos" modules/Vendas/

# Buscar por rotas
grep -r "app.get.*vendas" .

# Verificar logs
tail -f logs/error.log
\`\`\`

### 🧪 Como Testar

1. Implementar a correção no arquivo identificado
2. Reiniciar o servidor: \`npm restart\`
3. Acessar: \`http://localhost:3000/vendas\`
4. Abrir DevTools (F12) e verificar aba Network
5. Verificar se a requisição GET /api/vendas/pedidos retorna 200
6. Verificar se os pedidos são exibidos na tela

### 📸 Evidência

Screenshot: \`analysis-screenshots/vendas.png\`

---

## ERRO 2: Botão "Novo Pedido" não funciona

### 🔴 Severidade: HIGH

### 📝 Descrição do Erro

\`\`\`
Elemento não encontrado: button#novo-pedido
\`\`\`

### 🔍 Análise

**Causa Provável:** Elemento HTML não existe ou ID incorreto.

**Possíveis Causas:**
- Botão não foi renderizado
- ID do botão está diferente
- JavaScript não carregou
- Erro de sintaxe no HTML

### 🛠️ Solução Proposta

\`\`\`html
<!-- modules/Vendas/public/pages/vendas.html -->

<div class="page-header">
    <h1><i class="fas fa-shopping-cart"></i> Vendas</h1>
    <div class="page-actions">
        <button id="novo-pedido" class="btn btn-primary" onclick="abrirModalNovoPedido()">
            <i class="fas fa-plus"></i> Novo Pedido
        </button>
    </div>
</div>
\`\`\`

\`\`\`javascript
// modules/Vendas/public/js/vendas.js

function abrirModalNovoPedido() {
    // Limpar formulário
    document.getElementById('form-pedido').reset();
    
    // Abrir modal
    const modal = new bootstrap.Modal(document.getElementById('modalNovoPedido'));
    modal.show();
}

// Garantir que função está disponível globalmente
window.abrirModalNovoPedido = abrirModalNovoPedido;
\`\`\`

### 📂 Arquivos Afetados

- \`modules/Vendas/public/pages/vendas.html\`
- \`modules/Vendas/public/js/vendas.js\`

### 🧪 Como Testar

1. Implementar correções nos arquivos
2. Recarregar página (Ctrl+F5)
3. Verificar se botão "Novo Pedido" aparece
4. Clicar no botão
5. Verificar se modal abre
6. Verificar console do navegador (F12) para erros

---

## ✅ CHECKLIST DE VALIDAÇÃO

Após implementar as correções, validar:

- [ ] Módulo carrega sem erros
- [ ] Listagem de pedidos funciona
- [ ] Botão "Novo Pedido" funciona
- [ ] Modal de novo pedido abre
- [ ] Filtros funcionam corretamente
- [ ] Sem erros no console do navegador
- [ ] Sem erros no log do servidor
- [ ] Performance adequada (< 3s de carregamento)
- [ ] Testes automatizados passam
- [ ] Re-executar análise: \`node scripts/analyze-all-modules.js\`

---

**Arquivo gerado por:** analyze-all-modules.js
```

---

## 🚀 6. COMO EXECUTAR

### 6.1 INSTALAÇÃO DE DEPENDÊNCIAS

```bash
npm install puppeteer axios cheerio
```

### 6.2 CONFIGURAÇÃO

Criar arquivo `.env`:

```env
BASE_URL=http://localhost:3000
TEST_USER=admin@aluforce.com.br
TEST_PASSWORD=senha123
NODE_ENV=development
```

### 6.3 EXECUTAR ANÁLISE

```bash
# Análise completa de todos os módulos
node scripts/analyze-all-modules.js

# Análise de um módulo específico
node scripts/analyze-module.js --module=vendas

# Análise com relatório detalhado
node scripts/analyze-all-modules.js --verbose

# Análise e correção automática (quando possível)
node scripts/analyze-all-modules.js --auto-fix
```

### 6.4 RESULTADOS GERADOS

Após execução, os seguintes arquivos serão criados:

```
/
├── analysis-results.json           # Resultado completo em JSON
├── RELATORIO-ANALISE-MODULOS.md   # Relatório resumido
├── fixes/                          # Arquivos de correção
│   ├── FIX-DASHBOARD.md
│   ├── FIX-VENDAS.md
│   ├── FIX-FATURAMENTO.md
│   ├── FIX-FINANCEIRO.md
│   ├── FIX-PCP.md
│   ├── FIX-COMPRAS.md
│   ├── FIX-ESTOQUE.md
│   ├── FIX-RH.md
│   ├── FIX-ADMIN.md
│   └── FIX-RELATORIOS.md
└── analysis-screenshots/           # Screenshots de cada módulo
    ├── dashboard.png
    ├── vendas.png
    ├── faturamento.png
    └── ...
```

---

## 📊 7. INTERPRETAÇÃO DOS RESULTADOS

### 7.1 NÍVEIS DE SEVERIDADE

| Severidade | Descrição | Ação Requerida |
|-----------|-----------|----------------|
| 🔴 **CRITICAL** | Sistema não funciona, dados em risco | Corrigir IMEDIATAMENTE (0-4h) |
| 🟠 **HIGH** | Funcionalidade principal quebrada | Corrigir em 24h |
| 🟡 **MEDIUM** | Funcionalidade secundária com problemas | Corrigir em 1 semana |
| 🔵 **LOW** | Problema estético ou melhoria | Corrigir em 1 mês |

### 7.2 PRIORIZAÇÃO DE CORREÇÕES

1. **Primeiro:** Todos os erros CRITICAL
2. **Segundo:** Erros HIGH em módulos críticos (Vendas, Financeiro, Faturamento)
3. **Terceiro:** Erros HIGH em outros módulos
4. **Quarto:** Erros MEDIUM
5. **Quinto:** Erros LOW

### 7.3 MÉTRICAS DE QUALIDADE

**Score de Qualidade do Módulo:**

```
Score = (Testes Passados / Total de Testes) × 100
```

- **Excelente:** ≥ 95%
- **Bom:** 85% - 94%
- **Aceitável:** 70% - 84%
- **Insuficiente:** < 70%

---

## ✅ CONCLUSÃO

Este prompt fornece:

1. ✅ **Análise automatizada** de todos os módulos
2. ✅ **Detecção de erros** funcionais, de API, de performance
3. ✅ **Geração automática** de arquivos Markdown de correção
4. ✅ **Instruções detalhadas** para cada erro encontrado
5. ✅ **Código de exemplo** para implementar correções
6. ✅ **Checklist de validação** para cada correção
7. ✅ **Screenshots** para evidência visual
8. ✅ **Relatório executivo** com métricas

### Próximos Passos

1. **Executar análise:**
   ```bash
   node scripts/analyze-all-modules.js
   ```

2. **Revisar relatório:**
   - Abrir `RELATORIO-ANALISE-MODULOS.md`
   - Identificar módulos com problemas

3. **Implementar correções:**
   - Abrir arquivos em `fixes/FIX-*.md`
   - Seguir instruções passo a passo
   - Implementar código proposto

4. **Validar correções:**
   - Executar checklist de cada arquivo
   - Re-executar análise
   - Verificar se erros foram corrigidos

5. **Documentar:**
   - Atualizar CHANGELOG
   - Commitar correções
   - Criar PR para revisão

---

**Autor:** Senior Software Engineer  
**Data:** Maio 2026  
**Versão:** 1.0  
**Status:** Pronto para Execução 🚀
