# 🎨 PROMPT DE AUDITORIA: TEMPLATES, BRANDING E CHAT SYSTEM
## ANÁLISE COMPLETA DE PADRONIZAÇÃO E CONSISTÊNCIA VISUAL

---

**Objetivo:** Realizar auditoria completa de todos os templates (Orçamentos, PDFs, Relatórios), verificar consistência de branding (logos, cores, identidade visual) em sidebars e cabeçalhos, e validar funcionamento do sistema de chat em todas as páginas e módulos sem exceção.

**Auditor:** Senior Prompt Engineer | UX/UI Specialist | QA Engineer  
**Data:** Maio 2026  
**Sistema:** Zyntra ERP Multi-Company (Aluforce, Labor Energy, Labor Eletric)  
**Escopo:** 100% dos módulos, páginas e templates

---

## 📋 ÍNDICE

1. [Auditoria de Templates](#1-auditoria-de-templates)
2. [Auditoria de Branding](#2-auditoria-de-branding)
3. [Auditoria do Sistema de Chat](#3-auditoria-do-sistema-de-chat)
4. [Matriz de Validação](#4-matriz-de-validação)
5. [Relatório de Não Conformidades](#5-relatório-de-não-conformidades)
6. [Plano de Correção](#6-plano-de-correção)

---

## 🎯 1. AUDITORIA DE TEMPLATES

### 1.1 OBJETIVO

Verificar se todos os templates de documentos (Orçamentos, PDFs, Relatórios) seguem o mesmo padrão visual, estrutura e identidade da empresa.

### 1.2 TEMPLATES A AUDITAR

#### 📄 Categoria: ORÇAMENTOS

**Localização esperada:**
- `modules/Vendas/templates/orcamento.html`
- `modules/Vendas/templates/orcamento-pdf.html`
- `templates/orcamento/`

**Checklist de Verificação:**

```markdown
## ORÇAMENTO - TEMPLATE PADRÃO

### Estrutura Visual
- [ ] Logo da empresa no cabeçalho (canto superior esquerdo)
- [ ] Nome da empresa abaixo do logo
- [ ] Título "ORÇAMENTO" centralizado e destacado
- [ ] Número do orçamento visível (formato: ORC-YYYY-NNNN)
- [ ] Data de emissão
- [ ] Validade do orçamento

### Dados da Empresa (Cabeçalho)
- [ ] Razão Social completa
- [ ] CNPJ formatado (XX.XXX.XXX/XXXX-XX)
- [ ] Inscrição Estadual
- [ ] Endereço completo
- [ ] Telefone e e-mail
- [ ] Website (se aplicável)

### Dados do Cliente
- [ ] Nome/Razão Social do cliente
- [ ] CNPJ/CPF do cliente
- [ ] Endereço completo
- [ ] Contato (telefone/e-mail)
- [ ] Seção claramente delimitada

### Tabela de Itens
- [ ] Cabeçalho da tabela com colunas:
  - [ ] Item/Código
  - [ ] Descrição
  - [ ] Quantidade
  - [ ] Unidade
  - [ ] Valor Unitário
  - [ ] Valor Total
- [ ] Linhas zebradas (alternância de cores)
- [ ] Alinhamento correto (números à direita, texto à esquerda)
- [ ] Formatação monetária (R$ 1.234,56)

### Totalizadores
- [ ] Subtotal
- [ ] Desconto (se aplicável)
- [ ] Frete (se aplicável)
- [ ] Valor Total destacado (fonte maior, negrito)

### Rodapé
- [ ] Condições de pagamento
- [ ] Prazo de entrega
- [ ] Observações/Notas
- [ ] Assinatura do vendedor
- [ ] Dados bancários (se aplicável)
- [ ] Texto legal (se aplicável)

### Identidade Visual
- [ ] Cores da empresa aplicadas
- [ ] Fonte padrão consistente
- [ ] Espaçamento adequado
- [ ] Margens corretas
- [ ] Logo em alta resolução (não pixelizada)

### Responsividade (se HTML)
- [ ] Visualização correta em tela
- [ ] Impressão formatada (CSS @media print)
- [ ] Quebra de página adequada
```



#### 📄 Categoria: PEDIDOS DE VENDA

**Localização esperada:**
- `modules/Vendas/templates/pedido.html`
- `modules/Vendas/templates/pedido-pdf.html`

**Checklist de Verificação:**

```markdown
## PEDIDO DE VENDA - TEMPLATE PADRÃO

### Estrutura Visual
- [ ] Logo da empresa no cabeçalho
- [ ] Título "PEDIDO DE VENDA" destacado
- [ ] Número do pedido (formato: PED-YYYY-NNNN)
- [ ] Data do pedido
- [ ] Status do pedido (badge colorido)

### Informações do Pedido
- [ ] Vendedor responsável
- [ ] Forma de pagamento
- [ ] Condições de pagamento
- [ ] Prazo de entrega
- [ ] Tipo de frete

### Dados do Cliente
- [ ] Mesmo padrão do orçamento
- [ ] Endereço de entrega (se diferente)
- [ ] Endereço de cobrança (se diferente)

### Tabela de Produtos
- [ ] Mesmo padrão do orçamento
- [ ] Coluna adicional: Estoque disponível
- [ ] Destaque para produtos em falta

### Totalizadores
- [ ] Subtotal de produtos
- [ ] Desconto aplicado (% e valor)
- [ ] Valor do frete
- [ ] Impostos (se aplicável)
- [ ] Valor Total em destaque

### Observações
- [ ] Observações internas (não visíveis ao cliente)
- [ ] Observações para o cliente
- [ ] Instruções de entrega

### Rodapé
- [ ] Assinaturas (vendedor e cliente)
- [ ] Data de aprovação
- [ ] Termos e condições
```

#### 📄 Categoria: NOTAS FISCAIS (DANFE)

**Localização esperada:**
- `modules/Faturamento/templates/danfe.html`
- `modules/NFe/templates/danfe.html`

**Checklist de Verificação:**

```markdown
## DANFE - DOCUMENTO AUXILIAR DA NOTA FISCAL ELETRÔNICA

### Layout Padrão SEFAZ
- [ ] Segue layout oficial da SEFAZ
- [ ] Recibo do destinatário no topo
- [ ] Identificação do emitente
- [ ] DANFE em destaque

### Código de Barras
- [ ] Chave de acesso em código de barras
- [ ] Chave de acesso em texto (44 dígitos)
- [ ] Código de barras legível e escaneável

### QR Code (para NFCe)
- [ ] QR Code presente
- [ ] QR Code funcional (teste de leitura)
- [ ] Link para consulta da nota

### Dados do Emitente
- [ ] Logo da empresa (opcional, mas recomendado)
- [ ] Razão Social
- [ ] Nome Fantasia
- [ ] CNPJ e IE
- [ ] Endereço completo

### Dados do Destinatário
- [ ] Nome/Razão Social
- [ ] CNPJ/CPF
- [ ] Endereço completo
- [ ] Município e UF

### Dados da Nota
- [ ] Número da nota
- [ ] Série
- [ ] Data de emissão
- [ ] Data de saída/entrada
- [ ] Natureza da operação

### Produtos/Serviços
- [ ] Tabela com todos os itens
- [ ] Código do produto
- [ ] Descrição
- [ ] NCM
- [ ] CFOP
- [ ] Quantidade
- [ ] Unidade
- [ ] Valor unitário
- [ ] Valor total

### Cálculo de Impostos
- [ ] Base de cálculo ICMS
- [ ] Valor ICMS
- [ ] Base de cálculo ICMS ST
- [ ] Valor ICMS ST
- [ ] Valor total dos produtos
- [ ] Valor do frete
- [ ] Valor do seguro
- [ ] Outras despesas
- [ ] Valor total da nota

### Transportador
- [ ] Razão Social
- [ ] CNPJ
- [ ] Endereço
- [ ] Placa do veículo
- [ ] UF do veículo

### Dados Adicionais
- [ ] Informações complementares
- [ ] Reservado ao fisco

### Impressão
- [ ] Margens corretas (A4)
- [ ] Quebra de página adequada
- [ ] Fonte legível (mínimo 8pt)
```



#### 📄 Categoria: RELATÓRIOS

**Localização esperada:**
- `modules/*/templates/relatorios/`
- `templates/relatorios/`

**Tipos de Relatórios a Auditar:**

1. **Relatório de Vendas**
2. **Relatório Financeiro**
3. **Relatório de Estoque**
4. **Relatório de Produção (PCP)**
5. **Relatório de Compras**
6. **Relatório de RH**
7. **Relatório Gerencial**

**Checklist Universal para Relatórios:**

```markdown
## RELATÓRIOS - PADRÃO UNIVERSAL

### Cabeçalho do Relatório
- [ ] Logo da empresa (canto superior esquerdo)
- [ ] Nome da empresa
- [ ] Título do relatório (centralizado, fonte grande)
- [ ] Subtítulo/Descrição do relatório
- [ ] Período do relatório (data inicial - data final)
- [ ] Data de geração
- [ ] Usuário que gerou
- [ ] Página X de Y (rodapé)

### Filtros Aplicados
- [ ] Seção "Filtros Aplicados" visível
- [ ] Lista todos os filtros usados
- [ ] Valores dos filtros claramente exibidos
- [ ] Exemplo: "Período: 01/01/2026 a 31/01/2026"
- [ ] Exemplo: "Vendedor: João Silva"

### Corpo do Relatório
- [ ] Tabelas com cabeçalhos claros
- [ ] Linhas zebradas para legibilidade
- [ ] Alinhamento correto (números à direita)
- [ ] Formatação de valores monetários
- [ ] Formatação de datas (dd/mm/yyyy)
- [ ] Formatação de percentuais (XX,XX%)

### Totalizadores e Resumos
- [ ] Subtotais por seção
- [ ] Total geral destacado
- [ ] Médias (se aplicável)
- [ ] Percentuais (se aplicável)
- [ ] Gráficos (se aplicável)

### Gráficos (se aplicável)
- [ ] Título do gráfico
- [ ] Legenda clara
- [ ] Cores consistentes com identidade visual
- [ ] Eixos rotulados
- [ ] Valores exibidos (se necessário)

### Rodapé
- [ ] Número da página
- [ ] Data e hora de geração
- [ ] Nome do sistema (Zyntra ERP)
- [ ] Versão do sistema (opcional)
- [ ] Texto: "Relatório gerado automaticamente"

### Exportação
- [ ] PDF: Formatação preservada
- [ ] Excel: Dados estruturados em colunas
- [ ] CSV: Separadores corretos
- [ ] Impressão: Margens e quebras adequadas

### Identidade Visual
- [ ] Cores da empresa no cabeçalho
- [ ] Fonte padrão (Arial, Helvetica, ou similar)
- [ ] Logo em alta resolução
- [ ] Espaçamento consistente
```

#### 📄 Categoria: ORDEM DE PRODUÇÃO

**Localização esperada:**
- `modules/PCP/templates/ordem-producao.html`

**Checklist de Verificação:**

```markdown
## ORDEM DE PRODUÇÃO - TEMPLATE

### Cabeçalho
- [ ] Logo da empresa
- [ ] Título "ORDEM DE PRODUÇÃO"
- [ ] Número da OP (formato: OP-YYYY-NNNN)
- [ ] Data de emissão
- [ ] Prioridade (badge colorido)
- [ ] Status (badge colorido)

### Dados do Produto
- [ ] Código do produto
- [ ] Descrição completa
- [ ] Quantidade a produzir
- [ ] Unidade de medida
- [ ] Data prevista de conclusão
- [ ] Lote (se aplicável)

### Estrutura do Produto (BOM)
- [ ] Tabela de matérias-primas
- [ ] Código do componente
- [ ] Descrição
- [ ] Quantidade necessária
- [ ] Unidade
- [ ] Estoque disponível
- [ ] Quantidade a requisitar

### Roteiro de Produção
- [ ] Sequência de operações
- [ ] Descrição da operação
- [ ] Centro de trabalho
- [ ] Tempo estimado
- [ ] Responsável

### Observações
- [ ] Instruções especiais
- [ ] Observações técnicas
- [ ] Controle de qualidade

### Apontamentos (se impresso após produção)
- [ ] Espaço para data/hora início
- [ ] Espaço para data/hora fim
- [ ] Espaço para quantidade produzida
- [ ] Espaço para refugo/perda
- [ ] Assinatura do operador
```



### 1.3 SCRIPT DE AUDITORIA AUTOMATIZADA

**Criar script para verificar todos os templates:**

```javascript
// scripts/audit-templates.js

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const TEMPLATE_DIRS = [
    'modules/Vendas/templates',
    'modules/Faturamento/templates',
    'modules/PCP/templates',
    'modules/Financeiro/templates',
    'modules/Compras/templates',
    'modules/RH/templates',
    'templates'
];

const REQUIRED_ELEMENTS = {
    logo: ['img[src*="logo"]', '.logo', '#logo'],
    empresa_nome: ['.empresa-nome', '.razao-social', '#empresa-nome'],
    titulo: ['h1', '.titulo-documento', '.document-title'],
    data: ['.data-emissao', '.data-documento', '[data-field="data"]'],
    rodape: ['footer', '.rodape', '.document-footer']
};

async function auditarTemplates() {
    const relatorio = {
        total_templates: 0,
        templates_conformes: 0,
        templates_nao_conformes: 0,
        problemas: []
    };
    
    for (const dir of TEMPLATE_DIRS) {
        if (!fs.existsSync(dir)) {
            console.log(`⚠️  Diretório não encontrado: ${dir}`);
            continue;
        }
        
        const arquivos = fs.readdirSync(dir)
            .filter(f => f.endsWith('.html') || f.endsWith('.ejs') || f.endsWith('.hbs'));
        
        for (const arquivo of arquivos) {
            relatorio.total_templates++;
            const caminhoCompleto = path.join(dir, arquivo);
            const conteudo = fs.readFileSync(caminhoCompleto, 'utf-8');
            const $ = cheerio.load(conteudo);
            
            const problemas = [];
            
            // Verificar logo
            const temLogo = REQUIRED_ELEMENTS.logo.some(selector => $(selector).length > 0);
            if (!temLogo) {
                problemas.push('Logo da empresa não encontrada');
            }
            
            // Verificar nome da empresa
            const temNomeEmpresa = REQUIRED_ELEMENTS.empresa_nome.some(selector => $(selector).length > 0);
            if (!temNomeEmpresa) {
                problemas.push('Nome da empresa não encontrado');
            }
            
            // Verificar título
            const temTitulo = REQUIRED_ELEMENTS.titulo.some(selector => $(selector).length > 0);
            if (!temTitulo) {
                problemas.push('Título do documento não encontrado');
            }
            
            // Verificar data
            const temData = REQUIRED_ELEMENTS.data.some(selector => $(selector).length > 0);
            if (!temData) {
                problemas.push('Data de emissão não encontrada');
            }
            
            // Verificar rodapé
            const temRodape = REQUIRED_ELEMENTS.rodape.some(selector => $(selector).length > 0);
            if (!temRodape) {
                problemas.push('Rodapé não encontrado');
            }
            
            // Verificar CSS inline ou link
            const temCSS = $('style').length > 0 || $('link[rel="stylesheet"]').length > 0;
            if (!temCSS) {
                problemas.push('Nenhum CSS encontrado (inline ou externo)');
            }
            
            if (problemas.length === 0) {
                relatorio.templates_conformes++;
                console.log(`✅ ${caminhoCompleto}`);
            } else {
                relatorio.templates_nao_conformes++;
                console.log(`❌ ${caminhoCompleto}`);
                relatorio.problemas.push({
                    arquivo: caminhoCompleto,
                    problemas: problemas
                });
            }
        }
    }
    
    // Gerar relatório
    console.log('\n📊 RELATÓRIO DE AUDITORIA DE TEMPLATES\n');
    console.log(`Total de templates: ${relatorio.total_templates}`);
    console.log(`✅ Conformes: ${relatorio.templates_conformes}`);
    console.log(`❌ Não conformes: ${relatorio.templates_nao_conformes}`);
    console.log(`📈 Taxa de conformidade: ${((relatorio.templates_conformes / relatorio.total_templates) * 100).toFixed(2)}%`);
    
    if (relatorio.problemas.length > 0) {
        console.log('\n🔍 PROBLEMAS ENCONTRADOS:\n');
        relatorio.problemas.forEach(p => {
            console.log(`\n📄 ${p.arquivo}`);
            p.problemas.forEach(prob => console.log(`   - ${prob}`));
        });
    }
    
    // Salvar relatório em JSON
    fs.writeFileSync(
        'audit-templates-report.json',
        JSON.stringify(relatorio, null, 2)
    );
    
    console.log('\n💾 Relatório salvo em: audit-templates-report.json');
}

auditarTemplates().catch(console.error);
```

**Executar:**
```bash
node scripts/audit-templates.js
```

---

## 🎨 2. AUDITORIA DE BRANDING

### 2.1 OBJETIVO

Verificar se todas as páginas do sistema exibem corretamente:
- Logo da empresa (Zyntra ou empresa específica)
- Nome da empresa
- Cores da identidade visual
- Consistência de branding em sidebars e cabeçalhos

### 2.2 ELEMENTOS DE BRANDING A VERIFICAR

#### 🏢 Multi-Company Branding

**Empresas no Sistema:**
1. **Aluforce** (Indústria)
2. **Labor Energy** (Comércio)
3. **Labor Eletric** (Indústria)

**Cada empresa deve ter:**
- Logo próprio
- Cores próprias
- Nome/Razão Social próprio
- CNPJ próprio



### 2.3 CHECKLIST DE BRANDING POR COMPONENTE

#### 📱 SIDEBAR (Menu Lateral)

**Localização esperada:**
- `public/components/sidebar.html`
- `templates/partials/sidebar.ejs`
- Inline em `public/pages/*.html`

**Checklist:**

```markdown
## SIDEBAR - AUDITORIA DE BRANDING

### Logo
- [ ] Logo da empresa exibido no topo da sidebar
- [ ] Logo clicável (redireciona para dashboard)
- [ ] Logo em alta resolução (não pixelizado)
- [ ] Logo responsivo (reduz em telas pequenas)
- [ ] Logo correto para cada empresa:
  - [ ] Aluforce: Logo Aluforce
  - [ ] Labor Energy: Logo Labor Energy
  - [ ] Labor Eletric: Logo Labor Eletric

### Nome da Empresa
- [ ] Nome/Razão Social abaixo do logo
- [ ] Fonte legível
- [ ] Cor consistente com identidade visual
- [ ] Nome correto para cada empresa

### Cores da Sidebar
- [ ] Cor de fundo consistente
- [ ] Cor dos itens de menu
- [ ] Cor do item ativo/selecionado
- [ ] Cor do hover (ao passar o mouse)
- [ ] Cores seguem paleta da empresa

### Estrutura
- [ ] Itens de menu organizados por módulos
- [ ] Ícones consistentes (Font Awesome ou similar)
- [ ] Hierarquia visual clara
- [ ] Submenus funcionam corretamente

### Responsividade
- [ ] Sidebar colapsa em mobile
- [ ] Botão de toggle funciona
- [ ] Logo permanece visível quando colapsada
- [ ] Menu hamburguer funcional
```

#### 🎯 HEADER (Cabeçalho)

**Localização esperada:**
- `public/components/header.html`
- `templates/partials/header.ejs`

**Checklist:**

```markdown
## HEADER - AUDITORIA DE BRANDING

### Logo (se presente no header)
- [ ] Logo da empresa exibido
- [ ] Logo clicável
- [ ] Logo em alta resolução
- [ ] Logo correto para cada empresa

### Nome da Empresa/Sistema
- [ ] Nome do sistema (Zyntra ERP) ou empresa
- [ ] Posicionamento consistente
- [ ] Fonte e cor adequadas

### Breadcrumb (Navegação)
- [ ] Breadcrumb presente
- [ ] Mostra caminho atual (Home > Módulo > Página)
- [ ] Links funcionais
- [ ] Estilo consistente

### Ações do Usuário
- [ ] Nome do usuário logado
- [ ] Avatar/foto do usuário
- [ ] Menu dropdown funcional
- [ ] Opções: Perfil, Configurações, Sair

### Notificações
- [ ] Ícone de notificações
- [ ] Badge com contador
- [ ] Dropdown de notificações funcional
- [ ] Estilo consistente

### Cores
- [ ] Cor de fundo do header
- [ ] Cor do texto
- [ ] Cor dos ícones
- [ ] Cores seguem identidade visual
```

#### 📄 PÁGINAS INTERNAS

**Checklist para TODAS as páginas:**

```markdown
## PÁGINAS - AUDITORIA DE BRANDING

### Título da Página
- [ ] Título claro e descritivo
- [ ] Ícone representativo
- [ ] Fonte e tamanho consistentes
- [ ] Cor consistente

### Botões
- [ ] Botões primários: Cor da empresa
- [ ] Botões secundários: Cor neutra
- [ ] Botões de ação: Verde (sucesso)
- [ ] Botões de cancelar: Vermelho (perigo)
- [ ] Hover states funcionam
- [ ] Ícones nos botões (quando apropriado)

### Cards/Painéis
- [ ] Bordas consistentes
- [ ] Sombras consistentes
- [ ] Espaçamento interno consistente
- [ ] Cabeçalhos de cards padronizados

### Tabelas
- [ ] Cabeçalho com cor de fundo
- [ ] Linhas zebradas
- [ ] Hover nas linhas
- [ ] Ações (editar, excluir) consistentes
- [ ] Paginação padronizada

### Formulários
- [ ] Labels consistentes
- [ ] Inputs com borda e padding adequados
- [ ] Validação visual (vermelho para erro, verde para sucesso)
- [ ] Mensagens de erro claras
- [ ] Botões de submit padronizados

### Modais
- [ ] Cabeçalho com título e botão fechar
- [ ] Corpo com padding adequado
- [ ] Rodapé com botões alinhados à direita
- [ ] Overlay escuro (backdrop)
- [ ] Animação de abertura/fechamento

### Cores Gerais
- [ ] Paleta de cores consistente em toda a aplicação
- [ ] Cores primárias da empresa aplicadas
- [ ] Cores de status padronizadas:
  - [ ] Sucesso: Verde (#28a745)
  - [ ] Aviso: Amarelo (#ffc107)
  - [ ] Erro: Vermelho (#dc3545)
  - [ ] Info: Azul (#17a2b8)
```

### 2.4 SCRIPT DE AUDITORIA DE BRANDING

```javascript
// scripts/audit-branding.js

const puppeteer = require('puppeteer');
const fs = require('fs');

const PAGES_TO_AUDIT = [
    { url: '/dashboard', name: 'Dashboard' },
    { url: '/vendas', name: 'Vendas' },
    { url: '/vendas/pedidos', name: 'Pedidos' },
    { url: '/faturamento', name: 'Faturamento' },
    { url: '/financeiro', name: 'Financeiro' },
    { url: '/financeiro/contas-receber', name: 'Contas a Receber' },
    { url: '/financeiro/contas-pagar', name: 'Contas a Pagar' },
    { url: '/pcp', name: 'PCP' },
    { url: '/pcp/ordens-producao', name: 'Ordens de Produção' },
    { url: '/compras', name: 'Compras' },
    { url: '/compras/pedidos', name: 'Pedidos de Compra' },
    { url: '/estoque', name: 'Estoque' },
    { url: '/estoque/produtos', name: 'Produtos' },
    { url: '/rh', name: 'RH' },
    { url: '/rh/funcionarios', name: 'Funcionários' },
    { url: '/admin', name: 'Admin' },
    { url: '/admin/usuarios', name: 'Usuários' },
    { url: '/relatorios', name: 'Relatórios' }
];

async function auditarBranding() {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    
    // Login (ajustar conforme necessário)
    await page.goto('http://localhost:3000/login');
    await page.type('#email', 'admin@aluforce.com.br');
    await page.type('#password', 'senha123');
    await page.click('button[type="submit"]');
    await page.waitForNavigation();
    
    const relatorio = {
        data_auditoria: new Date().toISOString(),
        total_paginas: PAGES_TO_AUDIT.length,
        paginas_conformes: 0,
        paginas_nao_conformes: 0,
        problemas: []
    };
    
    for (const pagina of PAGES_TO_AUDIT) {
        console.log(`\n🔍 Auditando: ${pagina.name} (${pagina.url})`);
        
        try {
            await page.goto(`http://localhost:3000${pagina.url}`, {
                waitUntil: 'networkidle2',
                timeout: 10000
            });
            
            const problemas = [];
            
            // Verificar logo na sidebar
            const logoSidebar = await page.$('.sidebar img[src*="logo"], .sidebar .logo img');
            if (!logoSidebar) {
                problemas.push('Logo não encontrado na sidebar');
            } else {
                // Verificar se logo está visível
                const logoVisivel = await page.evaluate(el => {
                    const rect = el.getBoundingClientRect();
                    return rect.width > 0 && rect.height > 0;
                }, logoSidebar);
                
                if (!logoVisivel) {
                    problemas.push('Logo na sidebar não está visível');
                }
            }
            
            // Verificar nome da empresa
            const nomeEmpresa = await page.$('.sidebar .empresa-nome, .sidebar .company-name');
            if (!nomeEmpresa) {
                problemas.push('Nome da empresa não encontrado na sidebar');
            }
            
            // Verificar header
            const header = await page.$('header, .header, .page-header');
            if (!header) {
                problemas.push('Header não encontrado');
            }
            
            // Verificar título da página
            const titulo = await page.$('h1, .page-title');
            if (!titulo) {
                problemas.push('Título da página não encontrado');
            }
            
            // Tirar screenshot
            await page.screenshot({
                path: `audit-screenshots/${pagina.name.replace(/\s+/g, '-').toLowerCase()}.png`,
                fullPage: true
            });
            
            if (problemas.length === 0) {
                relatorio.paginas_conformes++;
                console.log(`✅ ${pagina.name} - Conforme`);
            } else {
                relatorio.paginas_nao_conformes++;
                console.log(`❌ ${pagina.name} - Não conforme`);
                relatorio.problemas.push({
                    pagina: pagina.name,
                    url: pagina.url,
                    problemas: problemas
                });
            }
            
        } catch (error) {
            console.log(`⚠️  Erro ao auditar ${pagina.name}: ${error.message}`);
            relatorio.problemas.push({
                pagina: pagina.name,
                url: pagina.url,
                problemas: [`Erro ao carregar página: ${error.message}`]
            });
        }
    }
    
    await browser.close();
    
    // Gerar relatório
    console.log('\n📊 RELATÓRIO DE AUDITORIA DE BRANDING\n');
    console.log(`Total de páginas: ${relatorio.total_paginas}`);
    console.log(`✅ Conformes: ${relatorio.paginas_conformes}`);
    console.log(`❌ Não conformes: ${relatorio.paginas_nao_conformes}`);
    console.log(`📈 Taxa de conformidade: ${((relatorio.paginas_conformes / relatorio.total_paginas) * 100).toFixed(2)}%`);
    
    if (relatorio.problemas.length > 0) {
        console.log('\n🔍 PROBLEMAS ENCONTRADOS:\n');
        relatorio.problemas.forEach(p => {
            console.log(`\n📄 ${p.pagina} (${p.url})`);
            p.problemas.forEach(prob => console.log(`   - ${prob}`));
        });
    }
    
    // Salvar relatório
    fs.writeFileSync(
        'audit-branding-report.json',
        JSON.stringify(relatorio, null, 2)
    );
    
    console.log('\n💾 Relatório salvo em: audit-branding-report.json');
    console.log('📸 Screenshots salvos em: audit-screenshots/');
}

// Criar diretório de screenshots
if (!fs.existsSync('audit-screenshots')) {
    fs.mkdirSync('audit-screenshots');
}

auditarBranding().catch(console.error);
```

**Executar:**
```bash
npm install puppeteer
node scripts/audit-branding.js
```



---

## 💬 3. AUDITORIA DO SISTEMA DE CHAT

### 3.1 OBJETIVO

Verificar se o sistema de chat está presente e funcional em **TODAS** as páginas e módulos do sistema, sem exceção.

### 3.2 REQUISITOS DO CHAT

**O chat deve:**
1. Estar presente em 100% das páginas
2. Ser acessível via botão flutuante (canto inferior direito)
3. Abrir/fechar suavemente (animação)
4. Manter histórico de conversas
5. Funcionar em tempo real (WebSocket/Socket.io)
6. Exibir notificações de novas mensagens
7. Ser responsivo (funcionar em mobile)

### 3.3 CHECKLIST DE AUDITORIA DO CHAT

```markdown
## SISTEMA DE CHAT - AUDITORIA COMPLETA

### Presença do Chat

#### Módulo: DASHBOARD
- [ ] Página: /dashboard
- [ ] Botão de chat visível
- [ ] Chat abre ao clicar
- [ ] Chat funcional

#### Módulo: VENDAS
- [ ] Página: /vendas
- [ ] Página: /vendas/pedidos
- [ ] Página: /vendas/orcamentos
- [ ] Página: /vendas/clientes
- [ ] Página: /vendas/novo-pedido
- [ ] Página: /vendas/editar-pedido/:id
- [ ] Todas as páginas com chat funcional

#### Módulo: FATURAMENTO
- [ ] Página: /faturamento
- [ ] Página: /faturamento/notas-fiscais
- [ ] Página: /faturamento/gerar-nfe
- [ ] Todas as páginas com chat funcional

#### Módulo: FINANCEIRO
- [ ] Página: /financeiro
- [ ] Página: /financeiro/contas-receber
- [ ] Página: /financeiro/contas-pagar
- [ ] Página: /financeiro/fluxo-caixa
- [ ] Página: /financeiro/bancos
- [ ] Página: /financeiro/conciliacao
- [ ] Todas as páginas com chat funcional

#### Módulo: PCP (Produção)
- [ ] Página: /pcp
- [ ] Página: /pcp/ordens-producao
- [ ] Página: /pcp/apontamentos
- [ ] Página: /pcp/estrutura-produtos
- [ ] Página: /pcp/roteiros
- [ ] Todas as páginas com chat funcional

#### Módulo: COMPRAS
- [ ] Página: /compras
- [ ] Página: /compras/pedidos
- [ ] Página: /compras/fornecedores
- [ ] Página: /compras/cotacoes
- [ ] Página: /compras/recebimento
- [ ] Todas as páginas com chat funcional

#### Módulo: ESTOQUE
- [ ] Página: /estoque
- [ ] Página: /estoque/produtos
- [ ] Página: /estoque/movimentacoes
- [ ] Página: /estoque/inventario
- [ ] Página: /estoque/transferencias
- [ ] Todas as páginas com chat funcional

#### Módulo: RH
- [ ] Página: /rh
- [ ] Página: /rh/funcionarios
- [ ] Página: /rh/folha-pagamento
- [ ] Página: /rh/ponto
- [ ] Página: /rh/ferias
- [ ] Página: /rh/beneficios
- [ ] Todas as páginas com chat funcional

#### Módulo: ADMIN
- [ ] Página: /admin
- [ ] Página: /admin/usuarios
- [ ] Página: /admin/permissoes
- [ ] Página: /admin/configuracoes
- [ ] Página: /admin/logs
- [ ] Todas as páginas com chat funcional

#### Módulo: RELATÓRIOS
- [ ] Página: /relatorios
- [ ] Página: /relatorios/vendas
- [ ] Página: /relatorios/financeiro
- [ ] Página: /relatorios/estoque
- [ ] Página: /relatorios/producao
- [ ] Todas as páginas com chat funcional

### Funcionalidades do Chat

#### Botão Flutuante
- [ ] Posicionado no canto inferior direito
- [ ] Ícone de chat/mensagem visível
- [ ] Badge com contador de mensagens não lidas
- [ ] Cor consistente com identidade visual
- [ ] Animação de pulse (opcional)
- [ ] Z-index adequado (sempre visível)

#### Janela do Chat
- [ ] Abre ao clicar no botão
- [ ] Animação suave de abertura
- [ ] Tamanho adequado (não muito grande/pequeno)
- [ ] Posicionada corretamente
- [ ] Não sobrepõe elementos importantes
- [ ] Botão de fechar funcional
- [ ] Botão de minimizar funcional

#### Cabeçalho do Chat
- [ ] Título "Chat de Suporte" ou similar
- [ ] Status online/offline
- [ ] Avatar do atendente (se aplicável)
- [ ] Botões de ação (fechar, minimizar)

#### Área de Mensagens
- [ ] Histórico de mensagens visível
- [ ] Scroll automático para última mensagem
- [ ] Mensagens do usuário alinhadas à direita
- [ ] Mensagens do atendente alinhadas à esquerda
- [ ] Timestamp em cada mensagem
- [ ] Avatar do remetente
- [ ] Diferenciação visual (cores, bordas)

#### Campo de Entrada
- [ ] Input de texto funcional
- [ ] Placeholder adequado
- [ ] Botão de enviar
- [ ] Envio com Enter
- [ ] Envio com Shift+Enter (nova linha)
- [ ] Botão de anexar arquivo (opcional)
- [ ] Botão de emoji (opcional)

#### Notificações
- [ ] Som ao receber mensagem (opcional)
- [ ] Notificação desktop (se permitido)
- [ ] Badge atualiza em tempo real
- [ ] Título da página pisca (opcional)

#### Tempo Real
- [ ] Mensagens aparecem instantaneamente
- [ ] Indicador "digitando..." funcional
- [ ] Reconexão automática se desconectar
- [ ] Mensagens persistem após recarregar página

#### Responsividade
- [ ] Funciona em desktop (>1024px)
- [ ] Funciona em tablet (768px - 1024px)
- [ ] Funciona em mobile (<768px)
- [ ] Botão flutuante visível em mobile
- [ ] Chat ocupa tela inteira em mobile (opcional)

### Integração

#### Backend
- [ ] Endpoint WebSocket/Socket.io configurado
- [ ] Autenticação de usuário no chat
- [ ] Histórico de mensagens salvo no banco
- [ ] API para buscar mensagens antigas
- [ ] API para marcar mensagens como lidas

#### Banco de Dados
- [ ] Tabela `chat_messages` existe
- [ ] Tabela `chat_conversations` existe
- [ ] Relacionamento com usuários
- [ ] Índices adequados para performance
```

### 3.4 SCRIPT DE AUDITORIA DO CHAT

```javascript
// scripts/audit-chat.js

const puppeteer = require('puppeteer');
const fs = require('fs');

const ALL_PAGES = [
    // Dashboard
    '/dashboard',
    
    // Vendas
    '/vendas',
    '/vendas/pedidos',
    '/vendas/orcamentos',
    '/vendas/clientes',
    
    // Faturamento
    '/faturamento',
    '/faturamento/notas-fiscais',
    
    // Financeiro
    '/financeiro',
    '/financeiro/contas-receber',
    '/financeiro/contas-pagar',
    '/financeiro/fluxo-caixa',
    
    // PCP
    '/pcp',
    '/pcp/ordens-producao',
    '/pcp/apontamentos',
    
    // Compras
    '/compras',
    '/compras/pedidos',
    '/compras/fornecedores',
    
    // Estoque
    '/estoque',
    '/estoque/produtos',
    '/estoque/movimentacoes',
    
    // RH
    '/rh',
    '/rh/funcionarios',
    '/rh/folha-pagamento',
    
    // Admin
    '/admin',
    '/admin/usuarios',
    '/admin/permissoes',
    
    // Relatórios
    '/relatorios',
    '/relatorios/vendas',
    '/relatorios/financeiro'
];

async function auditarChat() {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    
    // Login
    await page.goto('http://localhost:3000/login');
    await page.type('#email', 'admin@aluforce.com.br');
    await page.type('#password', 'senha123');
    await page.click('button[type="submit"]');
    await page.waitForNavigation();
    
    const relatorio = {
        data_auditoria: new Date().toISOString(),
        total_paginas: ALL_PAGES.length,
        paginas_com_chat: 0,
        paginas_sem_chat: 0,
        chat_funcional: 0,
        chat_nao_funcional: 0,
        detalhes: []
    };
    
    for (const url of ALL_PAGES) {
        console.log(`\n🔍 Verificando chat em: ${url}`);
        
        try {
            await page.goto(`http://localhost:3000${url}`, {
                waitUntil: 'networkidle2',
                timeout: 10000
            });
            
            // Aguardar um pouco para garantir que o chat carregou
            await page.waitForTimeout(1000);
            
            const resultado = {
                url: url,
                chat_presente: false,
                chat_funcional: false,
                problemas: []
            };
            
            // Verificar se botão do chat existe
            const botaoChat = await page.$(
                '#chat-button, .chat-button, .chat-widget-button, [data-chat-button]'
            );
            
            if (!botaoChat) {
                resultado.problemas.push('Botão do chat não encontrado');
                relatorio.paginas_sem_chat++;
            } else {
                resultado.chat_presente = true;
                relatorio.paginas_com_chat++;
                
                // Verificar se botão está visível
                const botaoVisivel = await page.evaluate(el => {
                    const rect = el.getBoundingClientRect();
                    const style = window.getComputedStyle(el);
                    return rect.width > 0 && 
                           rect.height > 0 && 
                           style.display !== 'none' && 
                           style.visibility !== 'hidden';
                }, botaoChat);
                
                if (!botaoVisivel) {
                    resultado.problemas.push('Botão do chat não está visível');
                } else {
                    // Tentar clicar no botão
                    try {
                        await botaoChat.click();
                        await page.waitForTimeout(500);
                        
                        // Verificar se janela do chat abriu
                        const janelaChat = await page.$(
                            '#chat-window, .chat-window, .chat-widget, [data-chat-window]'
                        );
                        
                        if (!janelaChat) {
                            resultado.problemas.push('Janela do chat não abriu');
                        } else {
                            const janelaVisivel = await page.evaluate(el => {
                                const rect = el.getBoundingClientRect();
                                const style = window.getComputedStyle(el);
                                return rect.width > 0 && 
                                       rect.height > 0 && 
                                       style.display !== 'none';
                            }, janelaChat);
                            
                            if (!janelaVisivel) {
                                resultado.problemas.push('Janela do chat não está visível');
                            } else {
                                resultado.chat_funcional = true;
                                relatorio.chat_funcional++;
                                
                                // Verificar elementos da janela do chat
                                const temInput = await page.$('#chat-input, .chat-input, [data-chat-input]');
                                if (!temInput) {
                                    resultado.problemas.push('Campo de entrada não encontrado');
                                }
                                
                                const temBotaoEnviar = await page.$('#chat-send, .chat-send, [data-chat-send]');
                                if (!temBotaoEnviar) {
                                    resultado.problemas.push('Botão de enviar não encontrado');
                                }
                                
                                const temAreaMensagens = await page.$('#chat-messages, .chat-messages, [data-chat-messages]');
                                if (!temAreaMensagens) {
                                    resultado.problemas.push('Área de mensagens não encontrada');
                                }
                            }
                        }
                    } catch (error) {
                        resultado.problemas.push(`Erro ao clicar no botão: ${error.message}`);
                    }
                }
            }
            
            if (!resultado.chat_funcional && resultado.chat_presente) {
                relatorio.chat_nao_funcional++;
            }
            
            relatorio.detalhes.push(resultado);
            
            // Status
            if (resultado.chat_funcional) {
                console.log(`✅ Chat funcional`);
            } else if (resultado.chat_presente) {
                console.log(`⚠️  Chat presente mas não funcional`);
            } else {
                console.log(`❌ Chat não encontrado`);
            }
            
        } catch (error) {
            console.log(`⚠️  Erro: ${error.message}`);
            relatorio.detalhes.push({
                url: url,
                chat_presente: false,
                chat_funcional: false,
                problemas: [`Erro ao carregar página: ${error.message}`]
            });
        }
    }
    
    await browser.close();
    
    // Gerar relatório
    console.log('\n📊 RELATÓRIO DE AUDITORIA DO CHAT\n');
    console.log(`Total de páginas auditadas: ${relatorio.total_paginas}`);
    console.log(`✅ Páginas com chat: ${relatorio.paginas_com_chat}`);
    console.log(`❌ Páginas sem chat: ${relatorio.paginas_sem_chat}`);
    console.log(`🟢 Chat funcional: ${relatorio.chat_funcional}`);
    console.log(`🔴 Chat não funcional: ${relatorio.chat_nao_funcional}`);
    console.log(`📈 Taxa de cobertura: ${((relatorio.paginas_com_chat / relatorio.total_paginas) * 100).toFixed(2)}%`);
    console.log(`📈 Taxa de funcionalidade: ${((relatorio.chat_funcional / relatorio.paginas_com_chat) * 100).toFixed(2)}%`);
    
    // Listar páginas com problemas
    const paginasComProblemas = relatorio.detalhes.filter(d => d.problemas.length > 0);
    if (paginasComProblemas.length > 0) {
        console.log('\n🔍 PÁGINAS COM PROBLEMAS:\n');
        paginasComProblemas.forEach(p => {
            console.log(`\n📄 ${p.url}`);
            p.problemas.forEach(prob => console.log(`   - ${prob}`));
        });
    }
    
    // Salvar relatório
    fs.writeFileSync(
        'audit-chat-report.json',
        JSON.stringify(relatorio, null, 2)
    );
    
    console.log('\n💾 Relatório salvo em: audit-chat-report.json');
}

auditarChat().catch(console.error);
```

**Executar:**
```bash
node scripts/audit-chat.js
```



---

## 📊 4. MATRIZ DE VALIDAÇÃO

### 4.1 MATRIZ COMPLETA DE AUDITORIA

**Criar planilha Excel ou Google Sheets com as seguintes colunas:**

| Módulo | Página | URL | Template OK | Logo OK | Branding OK | Chat OK | Status | Observações |
|--------|--------|-----|-------------|---------|-------------|---------|--------|-------------|
| Dashboard | Principal | /dashboard | ✅ | ✅ | ✅ | ✅ | OK | - |
| Vendas | Lista | /vendas | ✅ | ✅ | ✅ | ❌ | FALHA | Chat não abre |
| Vendas | Pedidos | /vendas/pedidos | ✅ | ❌ | ✅ | ✅ | FALHA | Logo não aparece |
| ... | ... | ... | ... | ... | ... | ... | ... | ... |

### 4.2 CRITÉRIOS DE APROVAÇÃO

**Para cada item:**

- ✅ **OK**: Funciona perfeitamente, sem problemas
- ⚠️ **ATENÇÃO**: Funciona mas com pequenos problemas estéticos
- ❌ **FALHA**: Não funciona ou não está presente
- 🔄 **PARCIAL**: Funciona parcialmente

**Status Geral da Página:**

- **OK**: Todos os itens ✅
- **ATENÇÃO**: Pelo menos um item ⚠️, nenhum ❌
- **FALHA**: Pelo menos um item ❌
- **CRÍTICO**: Múltiplos itens ❌

### 4.3 MÉTRICAS DE QUALIDADE

**Calcular:**

1. **Taxa de Conformidade de Templates:**
   ```
   (Templates OK / Total de Templates) × 100
   ```

2. **Taxa de Conformidade de Branding:**
   ```
   (Páginas com Branding OK / Total de Páginas) × 100
   ```

3. **Taxa de Cobertura do Chat:**
   ```
   (Páginas com Chat / Total de Páginas) × 100
   ```

4. **Taxa de Funcionalidade do Chat:**
   ```
   (Chat Funcional / Páginas com Chat) × 100
   ```

5. **Score Geral de Qualidade:**
   ```
   (Conformidade Templates + Conformidade Branding + Cobertura Chat + Funcionalidade Chat) / 4
   ```

**Metas:**
- 🎯 **Excelente**: Score ≥ 95%
- 🟢 **Bom**: Score ≥ 85%
- 🟡 **Aceitável**: Score ≥ 70%
- 🔴 **Insuficiente**: Score < 70%

---

## 🚨 5. RELATÓRIO DE NÃO CONFORMIDADES

### 5.1 TEMPLATE DE RELATÓRIO

```markdown
# RELATÓRIO DE NÃO CONFORMIDADES
## Auditoria de Templates, Branding e Chat

**Data:** [DATA]  
**Auditor:** [NOME]  
**Sistema:** Zyntra ERP v2.4.0

---

### RESUMO EXECUTIVO

- **Total de Itens Auditados:** XXX
- **Conformes:** XXX (XX%)
- **Não Conformes:** XXX (XX%)
- **Críticos:** XXX

---

### NÃO CONFORMIDADES CRÍTICAS

#### NC-001: Chat Ausente em Módulo Financeiro

**Severidade:** 🔴 CRÍTICA  
**Módulo:** Financeiro  
**Páginas Afetadas:**
- /financeiro/contas-receber
- /financeiro/contas-pagar
- /financeiro/fluxo-caixa

**Descrição:**
O sistema de chat não está presente nas páginas do módulo financeiro, impedindo que usuários solicitem suporte durante operações financeiras críticas.

**Impacto:**
- Usuários não conseguem tirar dúvidas em tempo real
- Aumento de erros operacionais
- Redução da satisfação do usuário

**Evidência:**
- Screenshot: `audit-screenshots/financeiro-contas-receber.png`
- Log: Elemento `#chat-button` não encontrado

**Ação Corretiva:**
1. Adicionar widget de chat em todas as páginas do módulo
2. Testar funcionalidade em cada página
3. Validar integração com backend

**Responsável:** [NOME]  
**Prazo:** [DATA]

---

#### NC-002: Logo Incorreto em Templates de Relatório

**Severidade:** 🟠 ALTA  
**Módulo:** Relatórios  
**Templates Afetados:**
- `templates/relatorios/vendas.html`
- `templates/relatorios/financeiro.html`

**Descrição:**
Templates de relatório estão exibindo logo genérico do Zyntra ao invés do logo específico da empresa (Aluforce, Labor Energy, Labor Eletric).

**Impacto:**
- Inconsistência de branding
- Confusão para clientes multi-empresa
- Aparência não profissional

**Evidência:**
- Template: `templates/relatorios/vendas.html` linha 15
- Logo atual: `/assets/zyntra-logo.png`
- Logo esperado: `/assets/{{empresa}}-logo.png`

**Ação Corretiva:**
1. Implementar lógica de logo dinâmico baseado em empresa
2. Atualizar todos os templates de relatório
3. Testar com cada empresa

**Responsável:** [NOME]  
**Prazo:** [DATA]

---

### NÃO CONFORMIDADES MÉDIAS

[Listar todas as não conformidades médias...]

---

### NÃO CONFORMIDADES BAIXAS

[Listar todas as não conformidades baixas...]

---

### RECOMENDAÇÕES

1. **Padronização de Templates**
   - Criar template base para todos os documentos
   - Implementar sistema de herança de templates
   - Documentar padrões visuais

2. **Branding Dinâmico**
   - Implementar middleware de branding
   - Carregar logo e cores baseado em empresa
   - Criar guia de identidade visual

3. **Chat Universal**
   - Adicionar chat em layout base
   - Garantir carregamento em todas as páginas
   - Implementar testes automatizados

4. **Monitoramento Contínuo**
   - Executar scripts de auditoria semanalmente
   - Criar dashboard de conformidade
   - Alertar sobre regressões

---

### ANEXOS

- Relatório JSON completo: `audit-full-report.json`
- Screenshots: `audit-screenshots/`
- Logs de execução: `audit-logs/`
```

---

## 🔧 6. PLANO DE CORREÇÃO

### 6.1 PRIORIZAÇÃO

**Ordem de correção:**

1. 🔴 **CRÍTICO** - Corrigir imediatamente (0-24h)
   - Chat ausente em páginas principais
   - Logo incorreto em documentos oficiais
   - Branding inconsistente em módulos críticos

2. 🟠 **ALTO** - Corrigir em até 1 semana
   - Templates sem padronização
   - Elementos de branding faltantes
   - Chat não funcional

3. 🟡 **MÉDIO** - Corrigir em até 2 semanas
   - Pequenas inconsistências visuais
   - Melhorias de UX
   - Otimizações de performance

4. 🔵 **BAIXO** - Corrigir em até 1 mês
   - Ajustes estéticos menores
   - Documentação
   - Melhorias incrementais

### 6.2 TEMPLATE DE CORREÇÃO

**Para cada não conformidade:**

```markdown
## CORREÇÃO: [ID da NC]

### Análise
- **Causa Raiz:** [Descrição]
- **Arquivos Afetados:** [Lista]
- **Dependências:** [Lista]

### Solução Proposta
[Descrição detalhada da solução]

### Implementação

#### Passo 1: [Título]
```bash
# Comandos ou código
```

#### Passo 2: [Título]
```javascript
// Código de exemplo
```

### Testes
- [ ] Teste unitário
- [ ] Teste de integração
- [ ] Teste manual
- [ ] Teste em produção

### Validação
- [ ] Auditoria passou
- [ ] Screenshots atualizados
- [ ] Documentação atualizada
- [ ] Aprovação do time

### Rollback (se necessário)
[Instruções para reverter a mudança]
```

### 6.3 SCRIPT DE CORREÇÃO AUTOMATIZADA

```bash
#!/bin/bash
# scripts/fix-all-issues.sh

echo "🔧 Iniciando correções automatizadas..."

# 1. Adicionar chat em todas as páginas
echo "📝 Adicionando chat universal..."
node scripts/add-chat-to-all-pages.js

# 2. Corrigir logos
echo "🎨 Corrigindo logos..."
node scripts/fix-logos.js

# 3. Padronizar templates
echo "📄 Padronizando templates..."
node scripts/standardize-templates.js

# 4. Validar correções
echo "✅ Validando correções..."
node scripts/audit-templates.js
node scripts/audit-branding.js
node scripts/audit-chat.js

echo "✨ Correções concluídas!"
```

---

## ✅ CONCLUSÃO

Este prompt fornece um framework completo para:

1. ✅ **Auditar todos os templates** (Orçamentos, PDFs, Relatórios)
2. ✅ **Verificar branding** (Logos, cores, identidade visual)
3. ✅ **Validar sistema de chat** (Presença e funcionalidade em 100% das páginas)
4. ✅ **Gerar relatórios detalhados** (JSON, screenshots, métricas)
5. ✅ **Criar plano de correção** (Priorizado e acionável)

### Próximos Passos

1. **Executar scripts de auditoria**
   ```bash
   npm install puppeteer cheerio
   node scripts/audit-templates.js
   node scripts/audit-branding.js
   node scripts/audit-chat.js
   ```

2. **Analisar relatórios gerados**
   - `audit-templates-report.json`
   - `audit-branding-report.json`
   - `audit-chat-report.json`

3. **Priorizar correções** baseado em severidade

4. **Implementar correções** seguindo o plano

5. **Re-auditar** para validar correções

6. **Documentar** padrões para evitar regressões

---

**Autor:** Senior Prompt Engineer  
**Data:** Maio 2026  
**Versão:** 1.0  
**Status:** Pronto para Execução
