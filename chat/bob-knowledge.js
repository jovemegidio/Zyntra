/**
 * BOB - Base de Conhecimento COMPLETA Aluforce
 * Alimentado com TODO o conteúdo real da Central de Ajuda: https://zyntraerp.com.br/Ajuda/index.html
 * Cada entrada corresponde a um artigo real, com passo a passo extraído diretamente do site
 */

// ==================== MAPA DA CENTRAL DE AJUDA ====================
const HELP_LINKS = {
  home: 'https://zyntraerp.com.br/Ajuda/index.html',
  guiaInicial: 'https://zyntraerp.com.br/Ajuda/colecoes/guia-inicial.html',
  tutoriais: 'https://zyntraerp.com.br/Ajuda/colecoes/tutoriais.html',
  vendas: 'https://zyntraerp.com.br/Ajuda/colecoes/vendas.html',
  compras: 'https://zyntraerp.com.br/Ajuda/colecoes/compras.html',
  financas: 'https://zyntraerp.com.br/Ajuda/colecoes/financas.html',
  estoque: 'https://zyntraerp.com.br/Ajuda/colecoes/estoque.html',
  notasFiscais: 'https://zyntraerp.com.br/Ajuda/colecoes/notas-fiscais.html',
  cadastros: 'https://zyntraerp.com.br/Ajuda/colecoes/cadastros.html',
  whatsapp: 'https://zyntraerp.com.br/Ajuda/colecoes/whatsapp.html',
  app: 'https://zyntraerp.com.br/Ajuda/colecoes/app.html',
  seguranca: 'https://zyntraerp.com.br/Ajuda/colecoes/seguranca.html',
  portal: 'https://zyntraerp.com.br/Ajuda/colecoes/portal.html',
  relatorios: 'https://zyntraerp.com.br/Ajuda/colecoes/relatorios.html',
  novidades: 'https://zyntraerp.com.br/Ajuda/colecoes/novidades.html',
  cenarios: 'https://zyntraerp.com.br/Ajuda/colecoes/cenarios.html',
  contabilidade: 'https://zyntraerp.com.br/Ajuda/colecoes/contabilidade.html',
  pcp: 'https://zyntraerp.com.br/Ajuda/colecoes/pcp.html',
  rh: 'https://zyntraerp.com.br/Ajuda/colecoes/rh.html',
  faturamento: 'https://zyntraerp.com.br/Ajuda/colecoes/faturamento.html',
  logistica: 'https://zyntraerp.com.br/Ajuda/colecoes/logistica.html',
};

// ==================== BASE DE CONHECIMENTO COMPLETA ====================
const knowledgeBase = [

  // ============================================================
  // GUIA INICIAL
  // ============================================================
  {
    keywords: ['primeiro acesso', 'login', 'entrar', 'acessar', 'primeiro login', 'começar', 'iniciar', 'nova conta', 'credenciais', 'senha temporária', 'boas-vindas', 'como acessar', 'acessar sistema'],
    category: 'Guia Inicial',
    question: 'Como fazer o primeiro acesso ao Aluforce?',
    answer: `Vou te guiar no **primeiro acesso** ao Aluforce! 🚀

Após a contratação, você receberá um **e-mail de boas-vindas** com as instruções. Siga os passos:

1️⃣ Acesse o portal do Aluforce pelo **link enviado por e-mail**
2️⃣ Utilize as **credenciais temporárias** fornecidas (usuário e senha)
3️⃣ No primeiro login, será solicitado que crie uma **nova senha**
4️⃣ Complete seu cadastro com informações pessoais

**Requisitos do sistema:**
• Navegador: Chrome, Firefox, Edge ou Safari (versões atualizadas)
• Conexão: Internet banda larga estável
• Resolução: Mínimo 1024x768 pixels

**Ao acessar, você encontrará:**
• 📋 **Menu lateral** — Acesso rápido a todos os módulos
• 📊 **Dashboard** — Visão geral dos indicadores do negócio
• 🔍 **Barra de pesquisa** — Busca rápida de funcionalidades
• 🔔 **Notificações** — Atualizações importantes

📖 Artigo completo: https://zyntraerp.com.br/Ajuda/artigos/primeiro-acesso.html`
  },
  {
    keywords: ['configuração inicial', 'configurar empresa', 'dados empresa', 'configurações iniciais', 'setup', 'cnpj', 'razão social', 'certificado digital', 'regime tributário', 'configurar'],
    category: 'Guia Inicial',
    question: 'Como fazer as configurações iniciais?',
    answer: `As **configurações iniciais** do Aluforce passo a passo: ⚙️

**1. Dados da Empresa:**
• Acesse **Configurações > Empresa**
• Preencha: CNPJ, Razão Social, Nome Fantasia
• Adicione endereço completo e dados de contato
• Faça upload do logotipo da empresa

**2. Configurações Fiscais:**
• **Regime Tributário**: Simples Nacional, Lucro Presumido ou Lucro Real
• **Inscrição Estadual**: Obrigatória para comércio de produtos
• **Inscrição Municipal**: Para prestadores de serviço
• **Certificado Digital**: A1 ou A3 para assinatura de documentos fiscais

**3. Configurando Usuários:**
• Acesse **Configurações > Usuários > Novo Usuário**
• Defina nome, e-mail e senha temporária
• Perfis disponíveis: 👑 Administrador | 💰 Financeiro | 📦 Vendedor | 📦 Estoquista | 👁️ Visualizador

**4. Notificações:**
• Configure alertas por e-mail, no sistema e push (app mobile)

📖 Artigo completo: https://zyntraerp.com.br/Ajuda/artigos/configuracoes-iniciais.html`
  },
  {
    keywords: ['segmento', 'tipo empresa', 'ramo', 'comércio', 'serviços', 'indústria', 'locação', 'tipo negócio', 'configuração segmento'],
    category: 'Guia Inicial',
    question: 'Como configurar o Aluforce para meu segmento?',
    answer: `O Aluforce tem **configurações otimizadas** para cada tipo de negócio! 🏢

🛒 **Comércio** (lojas, distribuidoras, e-commerce):
• Ative controle de estoque por produto
• Configure locais de estoque (loja, depósito, CD)
• Configure formas de pagamento (dinheiro, cartão, boleto, PIX)
• Ative o PDV se tiver loja física
• Configure NF-e e NFC-e

🔧 **Serviços** (consultorias, agências):
• Cadastre serviços com códigos LC 116
• Configure alíquotas de ISS por município
• Configure emissão de NFS-e
• Ative cobrança automática por boleto ou PIX

🏭 **Indústria** (manufatura, produção):
• Configure estruturas de produto (BOM)
• Defina processos de fabricação
• Configure ordens de produção
• Configure estoque de matérias-primas e produtos acabados

🏗️ **Locação** (equipamentos, veículos, imóveis):
• Configure itens e tabelas de preços por período
• Ative controle de disponibilidade e manutenções
• Configure faturamento por período e renovação automática

📖 Artigo completo: https://zyntraerp.com.br/Ajuda/artigos/configuracoes-segmento.html`
  },

  // ============================================================
  // CADASTROS
  // ============================================================
  {
    keywords: ['cadastro cliente', 'cadastrar cliente', 'novo cliente', 'cliente', 'clientes', 'cpf', 'cnpj cliente', 'cadastro clientes'],
    category: 'Cadastros',
    question: 'Como cadastrar clientes?',
    answer: `Para **cadastrar clientes** no Aluforce: 👤

**Passo a passo:**
1️⃣ Acesse **Cadastros > Clientes** no menu lateral
2️⃣ Clique em **"Novo Cliente"**
3️⃣ Preencha os dados obrigatórios:
   • Razão Social / Nome
   • CPF ou CNPJ (ao digitar o CNPJ, o sistema busca automaticamente na Receita Federal!)
   • Inscrição Estadual (se houver)
   • Endereço completo e CEP

**Informações complementares:**
• Contatos (telefone, e-mail, site)
• Endereço de entrega (se diferente)
• Dados bancários
• Tags de categorização

**Configurações de vendas (aba "Vendas"):**
• Tabela de preços específica
• Condição de pagamento padrão
• Limite de crédito
• Vendedor responsável
• Desconto padrão

**Importação em lote:**
• Baixe o modelo Excel em Cadastros > Clientes > Importar
• Preencha e envie — o sistema não permite CPF/CNPJ duplicado

📖 Artigo completo: https://zyntraerp.com.br/Ajuda/artigos/cadastro-clientes.html`
  },
  {
    keywords: ['cadastro fornecedor', 'cadastrar fornecedor', 'novo fornecedor', 'fornecedor', 'fornecedores', 'cadastro fornecedores'],
    category: 'Cadastros',
    question: 'Como cadastrar fornecedores?',
    answer: `Para **cadastrar fornecedores** no Aluforce: 🏢

**Passo a passo:**
1️⃣ Acesse **Cadastros > Fornecedores** no menu lateral
2️⃣ Clique em **"Novo Fornecedor"**
3️⃣ Preencha os dados:
   • Razão Social e Nome Fantasia
   • CNPJ (obrigatório)
   • Inscrição Estadual (obrigatório para contribuintes ICMS)
   • Endereço completo e contato

**Configurações de compras:**
• Condição de pagamento acordada
• Forma de pagamento (boleto, transferência, PIX)
• Prazo médio de entrega
• Tipo de frete (CIF/FOB)
• Categoria do fornecedor

**Vincular produtos ao fornecedor:**
1. Acesse a aba **"Produtos"** no cadastro
2. Adicione os produtos que o fornecedor oferece
3. Informe o código do produto no fornecedor

💡 **Dica:** Mantenha dados bancários atualizados para agilizar pagamentos.

📖 Artigo completo: https://zyntraerp.com.br/Ajuda/artigos/cadastro-fornecedores.html`
  },
  {
    keywords: ['cadastro produto', 'cadastrar produto', 'novo produto', 'produto', 'produtos', 'ncm', 'código barras', 'serviço', 'cadastro produtos', 'item'],
    category: 'Cadastros',
    question: 'Como cadastrar produtos e serviços?',
    answer: `Para **cadastrar produtos** no Aluforce: 📦

**Tipos de cadastro:** Produtos (itens físicos) | Serviços | Kits/Combos

**Passo a passo:**
1️⃣ Acesse **Cadastros > Produtos**
2️⃣ Clique em **"Novo Produto"**
3️⃣ Preencha dados básicos:

| Campo | Exemplo |
|-------|---------|
| Código | CABO-001 |
| Descrição | Cabo de Alumínio 35mm² |
| Unidade | MT (metro), UN, KG |
| NCM | 7614.10.00 |
| Preço de Venda | R$ 15,90 |
| Preço de Custo | R$ 10,50 |

**Informações fiscais (consulte seu contador):**
• NCM, CEST, Origem, CFOP padrão
• ICMS por estado, PIS/COFINS, IPI

**Controle de estoque:**
• Ative "Controla estoque: Sim"
• Defina estoque mínimo, máximo e local

**Múltiplas unidades:** Ex: 1 Rolo = 100 Metros

**Importação em lote:** Baixe o template Excel em Produtos > Importar

📖 Artigo completo: https://zyntraerp.com.br/Ajuda/artigos/cadastro-produtos.html`
  },

  // ============================================================
  // VENDAS
  // ============================================================
  {
    keywords: ['pedido venda', 'criar pedido', 'novo pedido', 'venda', 'vendas', 'vender', 'pedido', 'orçamento', 'proposta', 'pedidos'],
    category: 'Vendas',
    question: 'Como criar um pedido de venda?',
    answer: `Para criar um **pedido de venda** no Aluforce: 🛒

**Passo a passo:**
1️⃣ Acesse **Vendas > Pedidos de Venda** no menu lateral
2️⃣ Clique em **"Novo Pedido"**

**3️⃣ Selecione o cliente:**
• Busque por nome, CNPJ ou código
• Se não existir, cadastre clicando em "Novo Cliente" sem sair da tela!

**4️⃣ Adicione produtos:**
• Busque por código, descrição ou código de barras
• Informe quantidade, preço é preenchido automaticamente pela tabela
• Aplique desconto (% ou valor) se necessário

**5️⃣ Configure frete:**
• Tipo: CIF (vendedor paga) ou FOB (comprador paga)
• Transportadora, valor e previsão de entrega

**6️⃣ Defina pagamento:**
• Condição (30/60/90 dias, etc.)
• Forma (boleto, cartão, PIX, transferência)

**Status do pedido:**
📝 Rascunho → ⏳ Aguardando Aprovação → ✅ Aprovado → 📄 Faturado

**Ações rápidas:** Duplicar | Enviar PDF por e-mail | Imprimir | Gerar orçamento

⚠️ Pedidos faturados não podem ser editados. Para alterações, cancele a NF-e primeiro.

📖 Artigo completo: https://zyntraerp.com.br/Ajuda/artigos/criar-pedido-venda.html`
  },
  {
    keywords: ['faturar', 'faturamento', 'faturar pedido', 'emitir nota venda', 'faturamento pedido', 'faturar venda'],
    category: 'Vendas',
    question: 'Como faturar um pedido de venda?',
    answer: `Para **faturar um pedido** de venda: 📄

**Pré-requisitos:**
• Pedido com status "Aprovado"
• Dados fiscais dos produtos completos
• Certificado digital válido
• Empresa autorizada a emitir NF-e

**Passo a passo:**
1️⃣ Acesse **Vendas > Pedidos**, localize e abra o pedido
2️⃣ Clique em **"Faturar"** (disponível para pedidos aprovados)
3️⃣ Revise informações (cliente, produtos, valores)
4️⃣ Configure a NF-e (série, natureza da operação)
5️⃣ Clique em **"Emitir NF-e"** para transmitir à SEFAZ

**Faturamento parcial:** Selecione "Faturamento Parcial" e informe as quantidades de cada item.

**Faturamento em lote:** Acesse Vendas > Faturamento em Lote, selecione os pedidos e clique em "Faturar Selecionados".

**O que acontece ao faturar:**
• 📄 NF-e gerada e transmitida à SEFAZ
• 💰 Contas a receber criadas automaticamente
• 📦 Baixa automática do estoque
• 💼 Comissão do vendedor calculada

⚠️ Se a NF-e for rejeitada, verifique: CNPJ/IE do cliente, NCM, CFOP e cálculo de impostos.

📖 Artigo completo: https://zyntraerp.com.br/Ajuda/artigos/faturar-pedido.html`
  },
  {
    keywords: ['tabela preço', 'tabela preços', 'preço', 'preços', 'markup', 'desconto', 'política preço', 'precificação'],
    category: 'Vendas',
    question: 'Como gerenciar tabelas de preços?',
    answer: `Para gerenciar **tabelas de preços** no Aluforce: 💲

**Tipos de tabelas:**
| Tipo | Uso |
|------|-----|
| Padrão | Venda ao consumidor final |
| Atacado | Grandes quantidades / Revendedores |
| Promocional | Campanhas e ofertas com período |
| Regional | Diferenciação por região/estado |

**Criando uma tabela:**
1️⃣ Acesse **Vendas > Tabelas de Preços**
2️⃣ Clique em **"Nova Tabela"**
3️⃣ Defina nome, descrição e parâmetros
4️⃣ Configure vigência e regras

**Formas de definir preços:**
• **Por produto individual** — preço específico para cada item
• **Por percentual** — acréscimo/desconto sobre preço base
• **Por markup** — margem sobre o custo (Ex: custo R$100 + markup 50% = R$150)

**Vincular tabela a clientes:**
1. Edite o cadastro do cliente → aba "Vendas"
2. Selecione a tabela no campo "Tabela de Preços"

**Prioridade (quando múltiplas se aplicam):**
1. Tabela do cliente → 2. Promocional → 3. Grupo → 4. Padrão

📖 Artigo completo: https://zyntraerp.com.br/Ajuda/artigos/tabela-precos.html`
  },
  {
    keywords: ['comissão', 'comissões', 'acompanhar comissões', 'vendedor comissão'],
    category: 'Vendas',
    question: 'Como acompanhar comissões?',
    answer: `Para **acompanhar comissões** de vendedores: 💼

As comissões são calculadas automaticamente ao faturar pedidos.

**Como consultar:**
1️⃣ Acesse **Vendas > Comissões** ou **Relatórios > Vendas**
2️⃣ Filtre por vendedor, período, cliente ou status
3️⃣ Veja totais de vendas, comissão e comparativos

📖 Tutorial completo: https://zyntraerp.com.br/Ajuda/artigos/tutorial-acompanhar-comissoes.html
📚 Módulo de Vendas: ${HELP_LINKS.vendas}`
  },

  // ============================================================
  // COMPRAS
  // ============================================================
  {
    keywords: ['pedido compra', 'compra', 'compras', 'comprar', 'pedido de compra', 'requisição compra', 'solicitar compra', 'criar pedido compra'],
    category: 'Compras',
    question: 'Como criar um pedido de compra?',
    answer: `Para criar um **pedido de compra** no Aluforce: 📋

**Passo a passo:**
1️⃣ Acesse **Compras > Pedidos de Compra** no menu lateral
2️⃣ Clique em **"Novo Pedido"**

**3️⃣ Selecione o fornecedor:**
• Busque por nome ou CNPJ
• Confirme endereço e condições cadastradas

**4️⃣ Adicione produtos:**
• Pesquise por código, descrição ou código do fornecedor
• Informe quantidade e negocie o preço
• 💡 Dica: Use a sugestão de compras baseada no estoque mínimo!

**5️⃣ Configure frete e entrega:**
• Tipo: CIF (fornecedor paga) ou FOB (você paga)
• Valor do frete e previsão de entrega

**6️⃣ Defina o pagamento:**
• Condição: À vista, 30, 30/60/90 dias
• Forma: Boleto, transferência, PIX

**Status do pedido:**
📝 Rascunho → 📤 Enviado → ✅ Confirmado → 📦 Recebido

**Recebimento da mercadoria:**
1. Localize o pedido → 2. Clique "Receber" → 3. Confira itens → 4. Vincule a NF-e de entrada

📖 Artigo completo: https://zyntraerp.com.br/Ajuda/artigos/criar-pedido-compra.html`
  },
  {
    keywords: ['cotação', 'cotação fornecedores', 'cotação compra', 'cotar'],
    category: 'Compras',
    question: 'Como fazer cotação com fornecedores?',
    answer: `Para **cotar com fornecedores** no Aluforce: 💰

1️⃣ Acesse **Compras > Cotações**
2️⃣ Crie uma nova cotação com os produtos desejados
3️⃣ Selecione os fornecedores para participar
4️⃣ Compare preços, prazos e condições
5️⃣ Aprove a melhor proposta e gere o pedido de compra

📖 Tutorial completo: https://zyntraerp.com.br/Ajuda/artigos/tutorial-cotacao-fornecedores.html
📚 Módulo de Compras: ${HELP_LINKS.compras}`
  },
  {
    keywords: ['entrada nota', 'entrada nfe', 'importar xml', 'xml fornecedor', 'nota fornecedor', 'entrada nf', 'nfe entrada', 'importar nota', 'receber nota'],
    category: 'Compras',
    question: 'Como dar entrada em NF-e de fornecedor?',
    answer: `Para dar **entrada em NF-e** de fornecedores: 📥

**Formas de entrada:**
| Método | Quando usar |
|--------|-------------|
| Importação XML | Quando tem o arquivo XML |
| Consulta SEFAZ | Busca automática de notas emitidas contra seu CNPJ |
| Digitação manual | Quando não tem XML disponível |
| Chave de acesso | Quando tem apenas a chave de 44 dígitos |

**Importação por XML:**
1️⃣ Acesse **Compras > Entrada de NF-e**
2️⃣ Clique em **"Importar XML"**
3️⃣ Selecione o arquivo ou arraste para a área indicada
4️⃣ Revise os dados exibidos
5️⃣ **Vincule os produtos** do fornecedor aos seus produtos

**Consulta na SEFAZ:**
1. Clique "Consulta SEFAZ" → 2. Informe o período → 3. Selecione as notas para importar

**O que acontece na entrada:**
• 📦 Entrada automática no estoque
• 💰 Criação de contas a pagar
• 📊 Registro para escrituração fiscal
• 💲 Atualização do custo dos produtos

⚠️ Confira sempre unidade de medida e quantidade antes de confirmar!

📖 Artigo completo: https://zyntraerp.com.br/Ajuda/artigos/entrada-nfe.html`
  },

  // ============================================================
  // NOTAS FISCAIS
  // ============================================================
  {
    keywords: ['nf', 'nfe', 'nf-e', 'nota fiscal', 'emitir nota', 'emitir nfe', 'nota fiscal eletrônica', 'emissão nota', 'emitir', 'nota', 'notas fiscais', 'danfe'],
    category: 'Notas Fiscais',
    question: 'Como emitir uma NF-e?',
    answer: `Para **emitir NF-e** (Nota Fiscal Eletrônica): 📄

**Pré-requisitos:**
• Certificado digital A1 ou A3 válido e configurado
• Empresa habilitada na SEFAZ
• Dados cadastrais corretos (CNPJ, IE, endereço)
• Produtos com NCM, CFOP e impostos definidos

**Formas de emitir:**
| Forma | Uso |
|-------|-----|
| Via pedido de venda | Faturando um pedido aprovado |
| NF-e avulsa | Vendas rápidas, remessas |
| Em lote | Grande volume de faturamento |

**Emitindo NF-e avulsa:**
1️⃣ Acesse **Notas Fiscais > Emitir NF-e**
2️⃣ Selecione o **cliente** (destinatário)
3️⃣ Defina a **natureza da operação** (Venda, Remessa, etc.)
4️⃣ Adicione os **produtos** com quantidades e valores
5️⃣ Configure **frete e pagamento**
6️⃣ Clique em **"Emitir"** para transmitir à SEFAZ

**Status:** AUTORIZADA ✅ | REJEITADA ❌ | EM PROCESSAMENTO ⏳ | DENEGADA 🚫

**Após autorização:** Imprima o DANFE | Guarde o XML (5 anos) | Envie ao cliente por e-mail

⚠️ NF-e rejeitada? Verifique CNPJ/IE, NCM, CFOP e cálculo de impostos.

📖 Artigo completo: https://zyntraerp.com.br/Ajuda/artigos/emitir-nfe.html`
  },
  {
    keywords: ['cancelar nota', 'cancelar nfe', 'cancelar nf-e', 'cancelamento nota', 'cancelamento nfe'],
    category: 'Notas Fiscais',
    question: 'Como cancelar uma NF-e?',
    answer: `Para **cancelar uma NF-e**: ❌

⚠️ **Prazo:** O cancelamento deve ser feito em até **24 horas** após a autorização!

**Requisitos:**
• Mercadoria NÃO pode ter circulado
• Dentro do prazo legal (24h)
• NF-e deve estar autorizada
• Sem eventos vinculados (CT-e)

**Passo a passo:**
1️⃣ Acesse **Notas Fiscais > Consulta**, busque a nota
2️⃣ Clique em **"Cancelar"** no menu de ações
3️⃣ Informe a **justificativa** (mínimo 15 caracteres)
4️⃣ Confirme — o evento será transmitido à SEFAZ

**O que acontece:**
• 📄 Evento de cancelamento registrado na SEFAZ
• 📦 Estoque é estornado
• 💰 Contas a receber canceladas
• 📝 Pedido volta para "Aprovado"

**Quando NÃO é possível cancelar:**
• Prazo de 24h ultrapassado → Consulte seu contador
• Mercadoria já em trânsito → Emita NF-e de devolução
• Erro em campo corrigível → Use Carta de Correção

📖 Artigo completo: https://zyntraerp.com.br/Ajuda/artigos/cancelar-nfe.html`
  },
  {
    keywords: ['carta correção', 'cc-e', 'corrigir nota', 'corrigir nfe', 'correção nota', 'carta de correção'],
    category: 'Notas Fiscais',
    question: 'Como emitir uma Carta de Correção (CC-e)?',
    answer: `Para emitir uma **Carta de Correção (CC-e)**: ✏️

**O que PODE ser corrigido:**
• Dados cadastrais do emitente ou destinatário
• Data de emissão ou saída (mantendo mês e ano)
• CFOP, transportadora
• Descrição complementar de mercadorias

**O que NÃO pode ser corrigido:**
❌ Valores (base de cálculo, impostos, total)
❌ Quantidade de produtos
❌ Dados que alterem o valor do imposto
❌ NCM do produto

**Passo a passo:**
1️⃣ Acesse **Notas Fiscais > Consulta**, busque a nota
2️⃣ Clique em **"Carta de Correção"**
3️⃣ Descreva claramente o erro e a correção (mínimo 15 caracteres)
4️⃣ Transmita à SEFAZ

**Regras:** Até 20 CC-e por NF-e | Prazo de 30 dias | Cada CC-e substitui as anteriores

📝 **Exemplo:** "Onde se lê: Rua das Flores, 123 — Leia-se: Rua das Flores, 1230. Correção do endereço do destinatário."

📖 Artigo completo: https://zyntraerp.com.br/Ajuda/artigos/carta-correcao.html`
  },
  {
    keywords: ['nfse', 'nfs-e', 'nota serviço', 'nota fiscal serviço', 'nfse nacional', 'nota serviço eletrônica', 'migração nfse'],
    category: 'Notas Fiscais',
    question: 'Como configurar a NFS-e Nacional?',
    answer: `Sobre a **NFS-e Nacional** (Nota Fiscal de Serviço): 📋

**O que é:**
Novo padrão do Governo Federal para padronizar a emissão de NFS-e em todo o Brasil. Vantagens: padrão único, simplificação, maior segurança.

**Verificar se seu município aderiu:**
1. Acesse o portal da NFS-e Nacional
2. Consulte a lista de municípios aderentes

**Como configurar no Aluforce:**
1️⃣ Certifique-se de que o **certificado digital** A1 ou A3 está válido
2️⃣ Acesse **Configurações > Notas Fiscais > NFS-e**
3️⃣ Selecione **"NFS-e Nacional"**
4️⃣ Configure o ambiente (Homologação para testes ou Produção)
5️⃣ Atualize seus serviços com códigos do **LC 116** e CNAE
6️⃣ **Teste em homologação** antes de emitir em produção

**FAQ:**
• Pode continuar no modelo antigo até o município migrar
• Notas antigas continuam válidas
• Não precisa de novo certificado digital

📖 Artigo completo: https://zyntraerp.com.br/Ajuda/artigos/nfs-e-nacional.html`
  },

  // ============================================================
  // FINANCEIRO
  // ============================================================
  {
    keywords: ['conta pagar', 'contas pagar', 'pagar', 'pagamento', 'despesa', 'despesas', 'contas a pagar', 'financeiro', 'lançar despesa', 'boleto pagar'],
    category: 'Financeiro',
    question: 'Como gerenciar contas a pagar?',
    answer: `Para gerenciar **contas a pagar** no Aluforce: 💸

**Acessando:** Menu Finanças > Contas a Pagar

**Tela exibe:** Filtros | Lista com vencimento/valor/status | Totalizadores (aberto, vencido, a vencer)

**Criando uma conta:**
1️⃣ Clique em **"Nova Conta"**
2️⃣ Selecione o **fornecedor/beneficiário**
3️⃣ Preencha: valor, vencimento, descrição, categoria
4️⃣ Configure recorrência (opcional, para despesas fixas)

**Campos:** Fornecedor | Valor | Vencimento | Categoria | Centro de Custo | Documento

**Baixando (pagamento):**
1️⃣ Localize a conta usando filtros
2️⃣ Clique em **"Baixar"**
3️⃣ Informe: data do pagamento, conta bancária, valor pago
4️⃣ Confirme — saldo bancário será atualizado

💡 É possível fazer **baixa parcial** e **baixa em lote** (múltiplas contas de uma vez)

**Status:** 🟡 Em Aberto | 🔴 Vencida | 🟢 Paga | 🟠 Parcial

📖 Artigo completo: https://zyntraerp.com.br/Ajuda/artigos/contas-pagar.html`
  },
  {
    keywords: ['conta receber', 'contas receber', 'receber', 'recebimento', 'receita', 'contas a receber', 'boleto', 'cobrar', 'cobrança', 'gerar boleto'],
    category: 'Financeiro',
    question: 'Como gerenciar contas a receber?',
    answer: `Para gerenciar **contas a receber** no Aluforce: 💰

**As contas podem ser geradas por:**
• Faturamento (automaticamente ao emitir NF-e)
• Cadastro manual
• Contratos de serviço
• Outras receitas

**Criando conta manual:**
1️⃣ Acesse **Finanças > Contas a Receber**
2️⃣ Clique em **"Nova Conta"**
3️⃣ Selecione o cliente
4️⃣ Preencha: valor, vencimento, descrição, categoria

**Baixando (recebimento):**
1️⃣ Localize a conta → 2️⃣ Clique "Baixar" → 3️⃣ Informe data, conta bancária, valor
4️⃣ Registre descontos ou juros se houver

💡 **Via boleto:** Com integração bancária, boletos pagos podem ser baixados automaticamente pelo arquivo de retorno!

**Renegociação:** Selecione o título → "Renegociar" → Defina novas condições (data, parcelas, juros/multa)

**Geração de boletos:**
• Acesse a conta → "Gerar Boleto" → Registrado no banco → Envie por e-mail

**Status:** 🟡 Em Aberto | 🔴 Vencida | 🟢 Recebida | 🟠 Parcial

📖 Artigo completo: https://zyntraerp.com.br/Ajuda/artigos/contas-receber.html`
  },
  {
    keywords: ['fluxo caixa', 'fluxo de caixa', 'caixa', 'projeção financeira', 'entradas saídas', 'saldo'],
    category: 'Financeiro',
    question: 'Como consultar o fluxo de caixa?',
    answer: `Para consultar o **fluxo de caixa**: 📊

**Acessando:**
1️⃣ Menu **Finanças > Fluxo de Caixa**
2️⃣ Selecione o período de análise

**O fluxo mostra:**
• 📈 Entradas — Valores a receber
• 📉 Saídas — Valores a pagar
• 💰 Saldo — Diferença entre entradas e saídas
• 📊 Saldo acumulado — Evolução ao longo do tempo

**Visualizações:**
| Tipo | Ideal para |
|------|-----------|
| Diário | Curto prazo (até 30 dias) |
| Semanal | Médio prazo (1-3 meses) |
| Mensal | Longo prazo (6-12 meses) |

**Filtros:** Conta bancária | Categoria | Centro de custo | Status (Realizado vs Previsto)

**Tipos de fluxo:**
• **Realizado** — Apenas movimentações já baixadas
• **Previsto** — Inclui títulos em aberto
• **Consolidado** — Realizado passado + previsão futura

**Exportar:** Excel para análises | PDF para apresentações

📖 Artigo completo: https://zyntraerp.com.br/Ajuda/artigos/fluxo-caixa.html`
  },
  {
    keywords: ['conciliação', 'conciliação bancária', 'extrato', 'ofx', 'banco', 'conta bancária', 'conciliar'],
    category: 'Financeiro',
    question: 'Como fazer conciliação bancária?',
    answer: `Para fazer **conciliação bancária**: 🏦

**Formas de conciliação:**
| Método | Descrição |
|--------|-----------|
| Importação OFX | Arquivo de extrato bancário padrão |
| Integração bancária | Conexão direta com o banco |
| Manual | Conferência item a item |

**Por arquivo OFX:**
1️⃣ Exporte o extrato do banco (internet banking) em formato OFX
2️⃣ Acesse **Finanças > Conciliação**
3️⃣ Selecione a conta bancária
4️⃣ Importe o arquivo OFX
5️⃣ Associe cada linha do extrato aos lançamentos do sistema

**Status:** ✅ Conciliado | ⏳ Pendente | ⚠️ Divergente | ❌ Não encontrado

**Tratando divergências:**
• Lançamento não encontrado? Crie diretamente pela conciliação
• Valores diferentes? Verifique juros, descontos ou lançamentos duplicados

💡 **Dica:** Configure regras automáticas para taxas bancárias e encargos recorrentes.

**Boas práticas:**
• Faça a conciliação diária ou semanalmente
• Não acumule lançamentos pendentes
• Mantenha contas bancárias atualizadas

📖 Artigo completo: https://zyntraerp.com.br/Ajuda/artigos/conciliacao-bancaria.html`
  },
  {
    keywords: ['desconto duplicata', 'duplicata', 'antecipação', 'antecipar recebível', 'antecipação recebíveis', 'desconto de duplicatas'],
    category: 'Financeiro',
    question: 'O que é desconto de duplicatas?',
    answer: `Sobre **desconto de duplicatas** (antecipação de recebíveis): 💵

**O que é:** Antecipe o recebimento de valores que seus clientes pagarão no futuro. Em vez de esperar o vencimento dos boletos, receba antecipadamente com desconto de uma taxa.

**Campanha especial: Taxa de 2,49% ao mês na primeira operação!**
• Sem limite de valor
• Aprovação rápida (até 24h)
• Dinheiro na conta em até 1 dia útil

**Como solicitar:**
1️⃣ Acesse **Finanças > Antecipação de Recebíveis**
2️⃣ Selecione as duplicatas que deseja antecipar
3️⃣ Confira a simulação com a taxa
4️⃣ Confirme a operação
5️⃣ Aguarde aprovação e receba na sua conta

**Regras:** Duplicatas com vencimento em até 90 dias | Valor mínimo R$ 500 | Sujeito a análise de crédito

📖 Artigo completo: https://zyntraerp.com.br/Ajuda/artigos/desconto-duplicatas.html`
  },

  // ============================================================
  // ESTOQUE
  // ============================================================
  {
    keywords: ['estoque', 'posição estoque', 'saldo estoque', 'consultar estoque', 'módulo estoque', 'estoque disponível', 'almoxarifado', 'depósito'],
    category: 'Estoque',
    question: 'Como funciona o módulo de estoque?',
    answer: `O **módulo de Estoque** do Aluforce: 📦

**Funcionalidades:**
• Posição de estoque (saldo atual)
• Histórico de movimentações (entradas/saídas)
• Inventário (contagem e ajustes)
• Múltiplos locais de estoque
• Alertas de estoque mínimo

**Tipos de movimentação:**
| Tipo | Origem |
|------|--------|
| Entrada por compra | Recebimento de fornecedor (NF-e) |
| Saída por venda | Faturamento de pedido |
| Transferência | Entre depósitos |
| Ajuste | Correção por inventário |
| Produção | Produtos fabricados (OP) |

**Consultar posição:**
1️⃣ Acesse **Estoque > Posição**
2️⃣ Aplique filtros (produto, local, categoria)
3️⃣ Veja: quantidade física, reservada, disponível, custo médio e valor total

**Múltiplos locais:** Cadastre cada depósito, defina o padrão, faça transferências entre locais.

**Configurações importantes:**
• Controle de estoque: Ative por produto
• Estoque mínimo/máximo
• Lote/Série para rastreabilidade

📖 Artigo completo: https://zyntraerp.com.br/Ajuda/artigos/visao-geral-estoque.html`
  },
  {
    keywords: ['inventário', 'inventario', 'contagem estoque', 'contagem', 'fazer inventário', 'conferir estoque'],
    category: 'Estoque',
    question: 'Como fazer inventário de estoque?',
    answer: `Para fazer **inventário de estoque**: 📋

**Quando fazer:**
• Periódico (mensal, trimestral, anual)
• Rotativo (grupos de produtos por vez)
• Eventual (após identificar problemas)
• Fiscal (para fechamento contábil)

**Passo a passo:**
1️⃣ Acesse **Estoque > Inventário**
2️⃣ Clique em **"Novo Inventário"**
3️⃣ Selecione os produtos (todos ou por categoria/local)
4️⃣ Gere a lista de contagem

**Métodos de contagem:**
• Lista impressa | Coletor de dados | App móvel | Digitação direta

**Lançando a contagem:**
1️⃣ Acesse o inventário aberto
2️⃣ Informe as quantidades contadas
3️⃣ Revise divergências (sistema destaca as diferenças)

**Divergências:**
• Físico > Sistema → Entrada não registrada
• Físico < Sistema → Saída não registrada, perda

**Finalizando:**
1. Revise divergências → 2. Aprove (usuário com permissão) → 3. Confirme ajustes (movimentações automáticas)

⚠️ Após finalizado, o inventário não pode ser alterado!

📖 Artigo completo: https://zyntraerp.com.br/Ajuda/artigos/inventario-estoque.html`
  },
  {
    keywords: ['ajuste estoque', 'ajustar estoque', 'correção estoque', 'baixa estoque', 'avaria', 'perda'],
    category: 'Estoque',
    question: 'Como fazer ajuste de estoque?',
    answer: `Para fazer **ajuste de estoque**: 🔧

**Quando fazer:**
• Após inventário com diferenças
• Quebra ou avaria de produtos
• Produtos vencidos
• Erro de entrada/saída
• Consumo interno

**Passo a passo:**
1️⃣ Acesse **Estoque > Ajuste**
2️⃣ Clique em **"Novo Ajuste"**
3️⃣ Selecione o tipo: Entrada (acréscimo) ou Saída (baixa)
4️⃣ Escolha o **motivo** (Inventário, Avaria, Vencimento, Consumo, Bonificação)
5️⃣ Adicione produtos e quantidades
6️⃣ Confirme — o estoque é atualizado imediatamente

**Histórico:** Todos os ajustes ficam registrados com data/hora, usuário, quantidade e motivo.

⚠️ Ajustes podem ter implicações fiscais — consulte seu contador sobre NFs de ajuste.

📖 Artigo completo: https://zyntraerp.com.br/Ajuda/artigos/ajuste-estoque.html`
  },

  // ============================================================
  // PCP / PRODUÇÃO
  // ============================================================
  {
    keywords: ['pcp', 'ordem produção', 'produção', 'criar ordem', 'op', 'ordem de produção', 'fabricar', 'planejamento produção', 'nova op', 'ordem producao'],
    category: 'PCP',
    question: 'Como criar uma ordem de produção?',
    answer: `Para criar uma **ordem de produção (OP)** no PCP: 🏭

**Pré-requisitos:**
• Acesso ao módulo PCP
• Produtos e materiais cadastrados
• Lista de materiais (BOM) configurada

**Passo a passo:**
1️⃣ No menu lateral, clique em **Ord. Produção**
2️⃣ Clique em **"+ Nova OP"**
3️⃣ Selecione o **produto** — o sistema carrega automaticamente a BOM e etapas
4️⃣ Informe **quantidade** e **prazo de entrega**
5️⃣ Vincule o pedido de venda (opcional)
6️⃣ Revise e clique em **"Aprovar OP"** para liberar

💡 Se algum material não tiver estoque suficiente, o sistema alerta com ícone amarelo na BOM. Crie uma ordem de compra antes de aprovar!

**Etapas de produção (exemplo cabos de alumínio):**
1. Trefilação (Trefiladora) → 2. Encordoamento (Encordoadora) → 3. Bobinamento (Bobinadeira) → 4. Inspeção (Laboratório) → 5. Expedição

📖 Tutorial completo: https://zyntraerp.com.br/Ajuda/artigos/tutorial-criar-ordem-producao.html`
  },
  {
    keywords: ['pcp', 'apontar produção', 'kanban', 'apontamento', 'produzir', 'apontamento produção', 'registrar produção', 'quadro kanban'],
    category: 'PCP',
    question: 'Como apontar produção (Kanban)?',
    answer: `Para **apontar produção** usando o quadro Kanban: 📊

**Passo a passo:**
1️⃣ No menu lateral, clique em **Apontamentos**
2️⃣ O **quadro Kanban** exibe OPs por status: Aguardando | Em Produção | Concluído
3️⃣ Clique no **card da OP** que deseja apontar
4️⃣ Preencha:
   • Etapa (Trefilação, Encordoamento, etc.)
   • Quantidade produzida (kg)
   • Tempo (horas)
   • Máquina utilizada
5️⃣ Clique em **"Salvar Apontamento"**
6️⃣ A OP se move automaticamente no Kanban

**Status do Kanban:**
🟡 Aguardando — OP aprovada, esperando início
🔵 Em Produção — Produção em andamento
🔴 Parada — Interrompida (manutenção, falta de material)
🟢 Concluída — Produção finalizada
🟣 Qualidade — Em inspeção

💡 Você pode arrastar os cards entre colunas ou clicar para abrir detalhes.

⚠️ Apontamentos só podem ser feitos em OPs com status "Aprovada" ou "Em Produção".

📖 Tutorial completo: https://zyntraerp.com.br/Ajuda/artigos/tutorial-apontar-producao.html`
  },
  {
    keywords: ['pcp', 'bom', 'estrutura materiais', 'lista materiais', 'composição produto', 'estrutura produto', 'bill of materials'],
    category: 'PCP',
    question: 'Como gerenciar a estrutura de materiais (BOM)?',
    answer: `Para gerenciar a **BOM (Bill of Materials)**: 📋

A BOM define todos os materiais e quantidades necessários para fabricar um produto.

**Passo a passo:**
1️⃣ Acesse **PCP > Estrutura de Materiais**
2️⃣ Selecione o produto acabado
3️⃣ Adicione os materiais componentes com quantidades
4️⃣ Defina as etapas de produção

**Ao criar uma OP, a BOM é carregada automaticamente!**

💡 Mantenha a BOM sempre atualizada para garantir cálculos corretos de custo e necessidade de materiais.

📖 Tutorial: https://zyntraerp.com.br/Ajuda/artigos/tutorial-consultar-estoque.html
📚 Módulo PCP: ${HELP_LINKS.tutoriais}`
  },

  // ============================================================
  // RH / RECURSOS HUMANOS
  // ============================================================
  {
    keywords: ['rh', 'holerite', 'contracheque', 'salário', 'folha pagamento', 'consultar holerite', 'recursos humanos', 'pagamento funcionário'],
    category: 'RH',
    question: 'Como consultar o holerite?',
    answer: `Para consultar seu **holerite** (contracheque): 💵

**Passo a passo:**
1️⃣ No menu lateral, clique em **Holerites**
2️⃣ Selecione o **mês e ano** de referência nas abas superiores
3️⃣ Clique sobre o holerite para ver os **detalhes**:

| Proventos | Descontos |
|-----------|-----------|
| Salário Base (220h) | INSS (7,5% a 14%) |
| Horas Extras 50%/100% | IRRF |
| Adicional Noturno (20%) | Vale Transporte (até 6%) |
| FGTS 8% (informativo) | Outros descontos |

4️⃣ Clique em **"Baixar PDF"** para download do contracheque

💡 Os holerites ficam disponíveis após o fechamento da folha, geralmente até o 5º dia útil do mês seguinte.

⚠️ Divergências? Entre em contato com o RH antes do fechamento do próximo período.

📖 Tutorial completo: https://zyntraerp.com.br/Ajuda/artigos/tutorial-consultar-holerite.html`
  },
  {
    keywords: ['rh', 'férias', 'solicitar férias', 'pedir férias', 'férias funcionário', 'período aquisitivo', 'abono pecuniário'],
    category: 'RH',
    question: 'Como solicitar férias?',
    answer: `Para **solicitar férias** pelo Aluforce: 🏖️

**Pré-requisitos:** Período aquisitivo completo (12 meses) | Solicitar com 30 dias de antecedência

**Passo a passo:**
1️⃣ No menu lateral, clique em **Férias**
2️⃣ Clique em **"+ Nova Solicitação"**
3️⃣ Selecione **data de início e término** (sistema calcula os dias automaticamente)
4️⃣ Indique se deseja **vender 1/3** (abono pecuniário)
5️⃣ Envie — a solicitação entra no fluxo: ✅ Enviada → ⏳ Gestor → 🔜 RH → ✅ Aprovada

**Regras CLT:**
| Regra | Detalhe |
|-------|---------|
| Período aquisitivo | 12 meses de trabalho |
| Fracionamento | Até 3 períodos (um ≥14 dias, demais ≥5 dias) |
| Abono pecuniário | Converter até 1/3 em dinheiro |
| Pagamento | Até 2 dias úteis antes do início |
| Início vedado | Não pode iniciar 2 dias antes de feriado/DSR |

💡 Converse com seu gestor antes de enviar e acompanhe o status em tempo real na tela de férias.

📖 Tutorial completo: https://zyntraerp.com.br/Ajuda/artigos/tutorial-solicitar-ferias.html`
  },
  {
    keywords: ['rh', 'ponto', 'ponto eletrônico', 'registrar ponto', 'bater ponto', 'entrada', 'saída', 'jornada', 'hora trabalhada', 'gestão ponto'],
    category: 'RH',
    question: 'Como registrar ponto eletrônico?',
    answer: `Para **registrar ponto eletrônico**: ⏰

**Passo a passo:**
1️⃣ No menu lateral, clique em **Gestão Ponto**
2️⃣ Clique em **"Registrar Entrada"** para iniciar sua jornada
3️⃣ O sistema identifica automaticamente o tipo: Entrada → Saída Intervalo → Retorno → Saída Final

**Marcações diárias obrigatórias:**
| Marcação | Horário típico |
|----------|---------------|
| ▶ Entrada | 07:00 - 08:00 |
| ⏸ Saída intervalo | 11:00 - 12:00 |
| ▶ Retorno intervalo | 12:00 - 13:00 |
| ⏹ Saída final | 17:00 - 18:00 |

**Visualizar registros:** Confira marcações do dia com horas trabalhadas calculadas automaticamente.

**Histórico semanal:** Veja resumo de horas e solicite correções se necessário.

💡 Registre o ponto assim que chegar e antes de sair para evitar divergências.
⚠️ Correções devem ser feitas no mesmo mês, antes do fechamento da folha.

📖 Tutorial completo: https://zyntraerp.com.br/Ajuda/artigos/tutorial-registrar-ponto.html`
  },
  {
    keywords: ['rh', 'funcionário', 'cadastrar funcionário', 'novo funcionário', 'admissão', 'colaborador', 'funcionários', 'empregado'],
    category: 'RH',
    question: 'Como cadastrar um funcionário?',
    answer: `Para **cadastrar um funcionário**: 👤

**Pré-requisitos:** Acesso ao módulo RH (perfil admin) | Documentação do colaborador em mãos

**Passo a passo:**
1️⃣ No menu lateral, clique em **Funcionários**
2️⃣ Clique em **"+ Novo Funcionário"**
3️⃣ Preencha as abas do formulário:
   • **Dados Pessoais** — Nome, CPF, RG, data de nascimento
   • **Contrato** — Cargo, departamento, salário, data de admissão
   • **Bancário** — Dados para pagamento
   • **Benefícios** — VT, VR, plano de saúde
   • **Acesso** — E-mail corporativo, perfil de acesso ao sistema
4️⃣ Clique em **"Salvar Cadastro"**

**Documentos necessários:**
CPF | RG | CTPS (física ou digital) | Título de Eleitor | Comprovante de endereço | Foto 3x4

💡 Documentos podem ser digitalizados e anexados ao cadastro.
⚠️ CPF e e-mail devem ser únicos — o sistema não permite duplicados.

📖 Tutorial completo: https://zyntraerp.com.br/Ajuda/artigos/tutorial-cadastrar-funcionario.html`
  },
  {
    keywords: ['rh', 'treinamento', 'treinamentos', 'capacitação', 'gerenciar treinamentos'],
    category: 'RH',
    question: 'Como gerenciar treinamentos?',
    answer: `Para **gerenciar treinamentos** de funcionários: 📚

1️⃣ Acesse o módulo **RH > Treinamentos**
2️⃣ Cadastre os treinamentos disponíveis
3️⃣ Vincule funcionários e defina datas
4️⃣ Acompanhe a conclusão e certificados

📖 Tutorial: https://zyntraerp.com.br/Ajuda/artigos/tutorial-gerenciar-treinamentos.html
📚 Tutoriais RH: ${HELP_LINKS.tutoriais}`
  },

  // ============================================================
  // RELATÓRIOS
  // ============================================================
  {
    keywords: ['relatório venda', 'relatórios vendas', 'relatório vendas', 'desempenho vendas', 'performance vendas', 'ranking vendedor'],
    category: 'Relatórios',
    question: 'Como gerar relatórios de vendas?',
    answer: `Para gerar **relatórios de vendas**: 📊

**Tipos disponíveis:**
1. **Por Período** — Todas as vendas em um período (filtros: data, vendedor, cliente, produto)
2. **Por Vendedor** — Desempenho individual, ticket médio, ranking
3. **Por Produto** — Mais vendidos, receita, margem, curva ABC
4. **Por Cliente** — Histórico, frequência, valor médio, clientes inativos

**Como gerar:**
1️⃣ Acesse **Relatórios > Vendas** no menu lateral
2️⃣ Selecione o tipo de relatório
3️⃣ Configure os filtros (período, vendedor, etc.)
4️⃣ Clique em **"Gerar Relatório"**

📤 Exporte para: Excel | PDF | CSV

💡 Agende envio automático por e-mail (diário, semanal ou mensal)
⚠️ Apenas vendas com status "Faturado" são incluídas nos totais.

📖 Artigo completo: https://zyntraerp.com.br/Ajuda/artigos/relatorios-vendas.html`
  },
  {
    keywords: ['relatório financeiro', 'relatórios financeiros', 'dre', 'demonstrativo resultado', 'indicadores financeiros', 'relatório contas'],
    category: 'Relatórios',
    question: 'Como gerar relatórios financeiros?',
    answer: `Para gerar **relatórios financeiros**: 💹

**Relatórios disponíveis:**
1. **Fluxo de Caixa** — Realizado, Previsto, Comparativo
2. **Contas a Receber** — Por vencimento, inadimplência, aging
3. **Contas a Pagar** — A vencer, vencidos, por fornecedor/categoria
4. **DRE** — Receita bruta/líquida, custos, lucro, análise vertical/horizontal
5. **Conciliação Bancária** — Conciliados, pendentes, diferenças

**Como gerar:**
1️⃣ Acesse **Relatórios > Financeiro**
2️⃣ Escolha o relatório desejado
3️⃣ Defina parâmetros (período, conta bancária, categoria)
4️⃣ Visualize na tela ou exporte (Excel/PDF)

**Indicadores automáticos:**
| Indicador | O que mostra |
|-----------|-------------|
| Liquidez Corrente | Capacidade de pagar obrigações |
| Margem de Lucro | % lucro sobre receita |
| Prazo Médio Recebimento | Tempo médio para receber |
| Prazo Médio Pagamento | Tempo médio para pagar |
| Índice Inadimplência | % títulos vencidos |

📖 Artigo completo: https://zyntraerp.com.br/Ajuda/artigos/relatorios-financeiros.html`
  },
  {
    keywords: ['relatório estoque', 'relatórios estoque', 'posição estoque', 'curva abc', 'giro estoque', 'valorização estoque'],
    category: 'Relatórios',
    question: 'Como gerar relatórios de estoque?',
    answer: `Para gerar **relatórios de estoque**: 📦

**Relatórios disponíveis:**
1. **Posição de Estoque** — Quantidade atual, mínimo, máximo, localização
2. **Movimentação** — Entradas, saídas, transferências por período
3. **Produtos Abaixo do Mínimo** — Itens que precisam reposição com sugestão de compra
4. **Valorização** — Valor total do estoque, custo médio, por categoria
5. **Curva ABC** — Classe A (20% = 80% valor) | B (30% = 15%) | C (50% = 5%)
6. **Giro de Estoque** — Alto/baixo giro, dias de cobertura, produtos obsoletos

**Como gerar:**
1️⃣ Acesse **Relatórios > Estoque**
2️⃣ Selecione o tipo de relatório
3️⃣ Configure filtros (período, produto, categoria, depósito)
4️⃣ Gere e analise ou exporte

💡 Configure alertas automáticos para estoque mínimo!
⚠️ A valorização usa o método de custo médio ponderado.

📖 Artigo completo: https://zyntraerp.com.br/Ajuda/artigos/relatorios-estoque.html`
  },
  {
    keywords: ['relatório', 'relatórios', 'dashboard', 'indicadores', 'exportar relatório', 'agendar relatório', 'excel', 'exportar excel'],
    category: 'Relatórios',
    question: 'Como funciona o módulo de relatórios?',
    answer: `O **módulo de Relatórios** do Aluforce: 📊

**Categorias disponíveis:**
• 📈 Relatórios de Vendas
• 💰 Relatórios Financeiros (DRE, fluxo de caixa)
• 📦 Relatórios de Estoque (posição, curva ABC, giro)
• 🏭 Relatórios de Produção (PCP)

**Dashboard de Indicadores:** Visão em tempo real dos principais KPIs da empresa.

**Exportação:** Excel | PDF | CSV para análises detalhadas

**Agendar envio automático:** Configure relatórios para serem enviados por e-mail em períodos definidos (diário, semanal, mensal).

📖 Visão geral: https://zyntraerp.com.br/Ajuda/artigos/visao-geral-relatorios.html
📖 Dashboard: https://zyntraerp.com.br/Ajuda/artigos/dashboard-indicadores.html
📖 Exportar: https://zyntraerp.com.br/Ajuda/artigos/exportar-relatorios.html
📚 Todos os relatórios: ${HELP_LINKS.relatorios}`
  },

  // ============================================================
  // CONTABILIDADE
  // ============================================================
  {
    keywords: ['contabilidade', 'plano contas', 'contador', 'contábil', 'plano de contas', 'faturamento', 'receita despesa'],
    category: 'Contabilidade',
    question: 'Como funciona a contabilidade no Aluforce?',
    answer: `O módulo de **Contabilidade** do Aluforce: 📒

**Funcionalidades:**
• **Plano de Contas** — Configure categorias de receitas e despesas
• **DRE e Relatórios Financeiros** — Demonstrativos de resultado

**Plano de Contas:**
Acesse **Configurações > Plano de Contas** para configurar as categorias contábeis.

**Integração:** Exporte dados para seu contador nos formatos padrão.

📖 Plano de Contas: https://zyntraerp.com.br/Ajuda/artigos/plano-contas.html
📖 DRE: https://zyntraerp.com.br/Ajuda/artigos/relatorios-financeiros.html
📚 Contabilidade: ${HELP_LINKS.contabilidade}`
  },

  // ============================================================
  // WHATSAPP
  // ============================================================
  {
    keywords: ['whatsapp', 'integração whatsapp', 'enviar whatsapp', 'whats', 'wpp', 'mensagem whatsapp', 'envio automático'],
    category: 'WhatsApp',
    question: 'Como funciona a integração com WhatsApp?',
    answer: `A **integração com WhatsApp** do Aluforce: 📱

**Funcionalidades:**
| Função | Descrição |
|--------|-----------|
| Envio de NF-e | PDF da nota fiscal automaticamente |
| Boletos | Compartilhe cobranças |
| Orçamentos | Envie propostas comerciais |
| Confirmação de pedido | Notifique sobre novos pedidos |
| Rastreamento | Informe código de rastreio |
| Lembretes | Alertas de vencimento |

**Configurando:**
1️⃣ Acesse **Configurações > WhatsApp**
2️⃣ Conecte escaneando o **QR Code** com WhatsApp Business
3️⃣ Configure os **templates** de mensagem
4️⃣ Defina os **gatilhos** automáticos

**Templates com variáveis dinâmicas:**
\`{nome_cliente}\` | \`{numero_pedido}\` | \`{valor_total}\` | \`{data_vencimento}\` | \`{link_boleto}\` | \`{codigo_rastreio}\`

**Gatilhos automáticos:**
• Pedido aprovado → Confirmação
• NF-e emitida → Envio do PDF
• Pedido enviado → Código rastreio
• 3 dias antes do vencimento → Lembrete
• Título vencido → Aviso de atraso

**Envio manual:** Abra qualquer registro → clique no ícone WhatsApp → confirme o envio.

📖 Artigo completo: https://zyntraerp.com.br/Ajuda/artigos/integracao-whatsapp.html`
  },

  // ============================================================
  // APP
  // ============================================================
  {
    keywords: ['app', 'aplicativo', 'celular', 'mobile', 'app aluforce', 'smartphone', 'android', 'ios', 'iphone'],
    category: 'App',
    question: 'Como usar o App Aluforce?',
    answer: `O **App Aluforce** para celular: 📱

**Download e instalação:**
1️⃣ Acesse Play Store (Android) ou App Store (iOS)
2️⃣ Busque por **"Aluforce"**
3️⃣ Instale o aplicativo
4️⃣ Faça login com as **mesmas credenciais** do sistema web

**Funcionalidades:**
• 📊 Dashboard de indicadores
• 🛒 Vendas (consulta e criação de pedidos)
• 👤 Clientes (cadastro e consulta)
• 💰 Financeiro (contas a pagar/receber, fluxo de caixa)
• 📦 Produtos (estoque e preços)
• 🔔 Notificações push

**Navegação:** Menu lateral (hambúrguer) | Barra de busca | Ícone sino (alertas)

**Configurações:**
• Notificações push personalizáveis
• Login por biometria (digital ou Face ID)
• Modo offline para algumas consultas

**Requisitos:** Android 8.0+ | iOS 13.0+ | 100 MB livres

📖 Artigo completo: https://zyntraerp.com.br/Ajuda/artigos/como-usar-app.html`
  },

  // ============================================================
  // SEGURANÇA
  // ============================================================
  {
    keywords: ['usuário', 'permissão', 'permissões', 'perfil acesso', 'segurança', 'senha', 'acesso', 'usuários', 'criar usuário', 'liberar acesso'],
    category: 'Segurança',
    question: 'Como gerenciar usuários e permissões?',
    answer: `Para gerenciar **usuários e permissões**: 🔒

**Cadastrando novo usuário:**
1️⃣ Acesse **Configurações > Usuários**
2️⃣ Clique em **"Novo Usuário"**
3️⃣ Preencha: nome, e-mail, telefone, departamento
4️⃣ Selecione o **perfil de acesso**
5️⃣ Envie o convite — o usuário receberá um e-mail para criar senha

**Perfis padrão:**
| Perfil | Acesso |
|--------|--------|
| Administrador | Acesso total |
| Financeiro | Contas, fluxo de caixa, relatórios |
| Vendedor | Pedidos, clientes, consultas |
| Estoquista | Produtos, movimentações, inventário |
| Comprador | Pedidos de compra, fornecedores |
| Visualização | Apenas consulta |

**Personalizando:** Crie perfis personalizados em Configurações > Perfis, marcando permissões individuais (Visualizar, Criar, Editar, Excluir, Aprovar).

**Gerenciamento:**
• **Desativar** (não excluir) para ex-colaboradores — mantém histórico
• **Resetar senha** — envie link de redefinição
• **Alterar perfil** — ao mudar de função

⚠️ Mantenha sempre pelo menos 1 administrador ativo!

📖 Artigo completo: https://zyntraerp.com.br/Ajuda/artigos/usuarios-permissoes.html`
  },

  // ============================================================
  // PORTAL / INTEGRAÇÕES / API
  // ============================================================
  {
    keywords: ['api', 'integração', 'integrações', 'webhook', 'token', 'rest', 'conectar sistema', 'endpoint', 'portal'],
    category: 'Portal e Integrações',
    question: 'Como usar as integrações e API?',
    answer: `As **integrações e API** do Aluforce: 🔌

**Integrações nativas:**
| Tipo | Descrição |
|------|-----------|
| Bancos | Cobrança e conciliação bancária |
| Contabilidade | Exportação para sistemas contábeis |
| E-commerce | Marketplaces e lojas virtuais |
| Transportadoras | Rastreamento e frete |
| Pagamentos | Gateways de pagamento |

**Configurando uma integração:**
1️⃣ Acesse **Configurações > Integrações**
2️⃣ Selecione a integração desejada
3️⃣ Configure as credenciais do parceiro
4️⃣ Teste a conexão
5️⃣ Ative para uso em produção

**API REST para integrações personalizadas:**
• Autenticação: \`Authorization: Bearer seu_token_aqui\`
• Endpoints: /api/v1/clientes | /api/v1/produtos | /api/v1/pedidos | /api/v1/nfe | /api/v1/financeiro
• Métodos: GET, POST, PUT, DELETE

**Gerando token:**
1. Acesse Configurações > API → 2. "Gerar Token" → 3. Copie (exibido apenas 1 vez!)

**Webhooks:** Receba notificações em tempo real (novo pedido, NF-e autorizada, pagamento recebido, etc.)

🔒 Nunca compartilhe seu token. Se suspeitar de vazamento, revogue e gere um novo.

📖 Artigo completo: https://zyntraerp.com.br/Ajuda/artigos/integracoes-api.html`
  },

  // ============================================================
  // NOVIDADES
  // ============================================================
  {
    keywords: ['novidades', 'atualizações', 'novo recurso', 'novidade', 'última versão', 'update', 'lançamento'],
    category: 'Novidades',
    question: 'Quais são as últimas novidades do Aluforce?',
    answer: `As **últimas novidades** do Aluforce: 🆕

**Destaques recentes:**
• 📄 **NFS-e Nacional** — Novo padrão de emissão de notas de serviço
• 💵 **Desconto de Duplicatas** — Antecipação de recebíveis com taxa de 2,49%
• 🔌 **Integrações e API** — Conecte com outros sistemas
• 📊 **Novos relatórios** — Indicadores aprimorados

📖 Novidades: https://zyntraerp.com.br/Ajuda/artigos/novidades-sistema.html
📚 Todas as novidades: ${HELP_LINKS.novidades}`
  },

  // ============================================================
  // CENÁRIOS DE NEGÓCIO
  // ============================================================
  {
    keywords: ['cenário', 'cenários', 'caso de uso', 'exemplo prático', 'fluxo trabalho', 'cenários de negócio', 'prática'],
    category: 'Cenários',
    question: 'Cenários de uso do Aluforce?',
    answer: `Os **cenários de negócio** do Aluforce mostram fluxos de trabalho completos na prática: 💼

Exemplos reais de como resolver situações do dia a dia:

• 🛒 **Cenários de Vendas** — Fluxo completo desde pedido até faturamento
• 📦 **Cenários de Compras** — Da cotação ao recebimento
• 💰 **Cenários Financeiros** — Gestão de caixa e cobrança
• 💵 **Desconto de Duplicatas** — Antecipação prática

📖 Cenários: https://zyntraerp.com.br/Ajuda/artigos/cenarios-uso.html
📚 Todos os cenários: ${HELP_LINKS.cenarios}`
  },

  // ============================================================
  // PIX E COBRANÇA
  // ============================================================
  {
    keywords: ['pix', 'cobrança pix', 'gerar pix', 'pix cobrança', 'qr code pix', 'régua cobrança', 'cobrança automática'],
    category: 'Faturamento',
    question: 'Como gerar cobrança PIX e configurar régua de cobrança?',
    answer: `Sobre **cobrança PIX** e **régua de cobrança**: 💳

**Cobrança PIX:**
Gere cobranças PIX direto pelo sistema para facilitar o recebimento dos seus clientes.

**Régua de Cobrança:**
Automatize a cobrança de títulos em atraso com uma sequência programada de ações.

📖 PIX: https://zyntraerp.com.br/Ajuda/artigos/tutorial-pix-cobranca.html
📖 Régua: https://zyntraerp.com.br/Ajuda/artigos/tutorial-regua-cobranca.html
📚 Tutoriais: ${HELP_LINKS.tutoriais}`
  },

  // ============================================================
  // BOLETOS BANCÁRIOS (NOVO)
  // ============================================================
  {
    keywords: ['boleto', 'boletos', 'boleto bancário', 'boletos bancários', 'emitir boleto', 'gerar boleto', 'boleto cobrança', 'nosso número', 'linha digitável', 'baixa boleto'],
    category: 'Financeiro',
    question: 'Como emitir e gerenciar boletos bancários?',
    answer: `Para **emitir e gerenciar boletos bancários** no Aluforce: 🏦

**Funcionalidades:**
• Emissão de boletos com dados do sacado
• Acompanhamento de status (emitido, pago, vencido, cancelado)
• KPIs automáticos: total emitidos, pagos, vencidos, valor em aberto
• Exportação da listagem em CSV
• Baixa manual de boletos

**Emitindo um boleto:**
1️⃣ Acesse **Financeiro > Boletos**
2️⃣ Clique em **"Emitir Boleto"**
3️⃣ Preencha os dados do sacado (Nome, CPF/CNPJ, endereço)
4️⃣ Configure: valor, data de vencimento, descrição e conta bancária de destino
5️⃣ Revise e clique em **"Emitir Boleto"** — o sistema gera automaticamente o nosso número e a linha digitável

**Status dos boletos:**
🟢 Pago — Compensado pelo banco
🟡 Emitido — Aguardando pagamento
🔴 Vencido — Prazo expirou
⚪ Cancelado — Cancelado manualmente

**Baixa manual:** Quando um boleto é pago por outro meio (PIX, transferência), clique no ícone de check na coluna de ações.

💡 **Dica:** Configure as contas bancárias no módulo Bancos antes de emitir boletos.

📖 Artigo completo: https://zyntraerp.com.br/Ajuda/artigos/boletos-bancarios.html
📖 Tutorial: https://zyntraerp.com.br/Ajuda/artigos/tutorial-boletos.html`
  },

  // ============================================================
  // RECORRÊNCIAS FINANCEIRAS (NOVO)
  // ============================================================
  {
    keywords: ['recorrência', 'recorrências', 'recorrente', 'transação recorrente', 'lançamento recorrente', 'despesa fixa', 'receita fixa', 'aluguel', 'assinatura', 'mensalidade', 'recorrências financeiras', 'processar pendentes'],
    category: 'Financeiro',
    question: 'Como configurar transações recorrentes?',
    answer: `Para configurar **transações recorrentes** no Aluforce: 🔄

As recorrências automatizam a criação de lançamentos que se repetem, como aluguéis, assinaturas, mensalidades e salários.

**Frequências disponíveis:**
| Frequência | Exemplo |
|-----------|---------|
| Semanal | Frete semanal |
| Quinzenal | Adiantamento salarial |
| Mensal | Aluguel, internet |
| Bimestral | Conta de água |
| Trimestral | Impostos trimestrais |
| Semestral | IPVA, seguros |
| Anual | Licenças, IPTU |

**Criando uma recorrência:**
1️⃣ Acesse **Financeiro > Recorrências**
2️⃣ Clique em **"Nova Recorrência"**
3️⃣ Preencha: descrição, tipo (pagar ou receber), valor, frequência e dia de vencimento
4️⃣ Configure data de início e término (opcional)
5️⃣ Salve — o sistema gera lançamentos automaticamente nos vencimentos

**Processar Pendentes:** Clique para gerar imediatamente lançamentos de recorrências cujo vencimento já passou.

**KPIs:**
• Total Ativas | A Pagar/Mês | A Receber/Mês | Próx. 7 Dias

⚠️ Alterar valor ou frequência afeta apenas lançamentos futuros.
💡 Recorrências sem data de término ficam ativas indefinidamente. Pause ou encerre a qualquer momento.

📖 Artigo completo: https://zyntraerp.com.br/Ajuda/artigos/recorrencias-financeiras.html
📖 Tutorial: https://zyntraerp.com.br/Ajuda/artigos/tutorial-recorrencias.html`
  },

  // ============================================================
  // IMPOSTOS / CONFIGURAÇÃO TRIBUTÁRIA (NOVO)
  // ============================================================
  {
    keywords: ['imposto', 'impostos', 'tributário', 'tributação', 'alíquota', 'icms', 'iss', 'pis', 'cofins', 'ipi', 'irpj', 'csll', 'simples nacional', 'lucro presumido', 'lucro real', 'regime tributário', 'configurar impostos', 'impostos configuração'],
    category: 'Financeiro',
    question: 'Como configurar impostos no sistema?',
    answer: `Para **configurar impostos** no Aluforce: 🧾

O módulo de Impostos centraliza todas as configurações tributárias da empresa.

**Categorias de impostos:**
| Categoria | Exemplos | Incidência |
|-----------|----------|------------|
| Federais | IRPJ, CSLL, PIS, COFINS, IPI | Faturamento / Lucro |
| Estaduais | ICMS, ICMS-ST | Circulação de mercadorias |
| Municipais | ISS, IPTU, Taxa de Licença | Serviços / Imóveis |

**Cadastrando um imposto:**
1️⃣ Acesse **Financeiro > Impostos**
2️⃣ Clique em **"Novo Imposto"**
3️⃣ Preencha: nome, sigla, alíquota (%), categoria, base de cálculo e observações
4️⃣ Defina a vigência (início e término)
5️⃣ Salve — o imposto fica disponível para NFS-e, boletos e relatórios

**Filtros:** Use as abas **Todos**, **Federais**, **Estaduais** e **Municipais**.

**Regimes tributários:**
• **Simples Nacional** — Alíquota unificada em DAS
• **Lucro Presumido** — Base presumida (IRPJ, CSLL, PIS, COFINS)
• **Lucro Real** — Base no lucro efetivo

💡 **Dica:** Consulte seu contador para as alíquotas corretas. Exportar em CSV para enviar ao escritório.

📖 Artigo completo: https://zyntraerp.com.br/Ajuda/artigos/impostos-configuracao.html
📖 Tutorial: https://zyntraerp.com.br/Ajuda/artigos/tutorial-impostos.html`
  },

  // ============================================================
  // CENTROS DE CUSTO (NOVO)
  // ============================================================
  {
    keywords: ['centro custo', 'centros custo', 'centro de custo', 'centros de custo', 'departamento', 'setor', 'rateio', 'classificar despesa', 'custo departamento'],
    category: 'Financeiro',
    question: 'Como usar centros de custo?',
    answer: `Para usar **centros de custo** no Aluforce: 🏢

Centros de custo classificam receitas e despesas por setor, projeto ou departamento.

**Para que servem:**
• Controlar gastos por departamento (Administrativo, Comercial, Produção)
• Analisar rentabilidade de projetos
• Comparar orçado vs. realizado por setor
• Gerar relatórios gerenciais segmentados
• Facilitar o rateio de custos compartilhados

**Estrutura hierárquica (até 3 níveis):**
| Nível | Exemplo |
|-------|---------|
| 1 — Grupo | Operacional |
| 2 — Centro | Produção |
| 3 — Subcentro | Linha de Montagem A |

**Criando um centro de custo:**
1️⃣ Acesse **Financeiro > Centros de Custo**
2️⃣ Clique em **"Novo Centro"**
3️⃣ Preencha: código, nome, centro pai (se subcentro), responsável e status
4️⃣ Defina o orçamento mensal (opcional)
5️⃣ Salve — disponível para uso em lançamentos financeiros

**Uso:** Ao criar contas a pagar/receber, selecione o centro de custo no campo correspondente.

**KPIs:** Total de Centros | Centros Ativos | Receita Total | Despesa Total

📖 Artigo completo: https://zyntraerp.com.br/Ajuda/artigos/centros-custo.html
📖 Tutorial: https://zyntraerp.com.br/Ajuda/artigos/tutorial-centros-custo.html`
  },

  // ============================================================
  // ORÇAMENTOS FINANCEIROS (NOVO)
  // ============================================================
  {
    keywords: ['orçamento financeiro', 'orçamentos financeiros', 'orçamento empresa', 'planejamento financeiro', 'orçado realizado', 'budget', 'meta financeira', 'desvio orçamentário'],
    category: 'Financeiro',
    question: 'Como criar orçamentos financeiros?',
    answer: `Para criar **orçamentos financeiros** no Aluforce: 📋

O módulo de Orçamentos permite planejar receitas e despesas por período, comparando previsto vs. realizado.

**Para que servem:**
• Planejar gastos e investimentos
• Definir metas de receita por departamento
• Comparar orçado vs. realizado em tempo real
• Identificar desvios orçamentários

**Criando um orçamento:**
1️⃣ Acesse **Financeiro > Orçamentos**
2️⃣ Clique em **"Novo Orçamento"**
3️⃣ Defina o período (mês, trimestre ou ano)
4️⃣ Preencha: categoria, descrição, valor previsto e centro de custo (opcional)
5️⃣ Salve — o sistema mostra automaticamente realizado vs. previsto

**Visualização:** Use os botões **Este Mês**, **Trimestre** e **Ano** para alternar períodos. Gráfico de barras com comparação visual.

**Indicadores:**
| Indicador | Descrição |
|-----------|-----------|
| % Executado | Quanto do orçamento já foi utilizado |
| Saldo Disponível | Valor restante |
| Desvio | Diferença entre realizado e orçado |

⚠️ Orçamentos aprovados não podem ser excluídos, apenas cancelados.

📖 Artigo completo: https://zyntraerp.com.br/Ajuda/artigos/orcamentos-financeiros.html
📖 Tutorial: https://zyntraerp.com.br/Ajuda/artigos/tutorial-orcamentos.html`
  },

  // ============================================================
  // DASHBOARD FINANCEIRO (NOVO)
  // ============================================================
  {
    keywords: ['dashboard financeiro', 'painel financeiro', 'visão financeira', 'indicadores financeiros', 'kpi financeiro', 'saldo total', 'resultado mês'],
    category: 'Financeiro',
    question: 'Como funciona o dashboard financeiro?',
    answer: `O **Dashboard Financeiro** do Aluforce: 📊

É a tela inicial do módulo, oferecendo visão consolidada da saúde financeira.

**KPIs exibidos:**
| Indicador | Descrição |
|-----------|-----------|
| Saldo Total | Soma dos saldos de todas as contas bancárias |
| Contas a Receber | Total de recebíveis em aberto |
| Contas a Pagar | Total de obrigações pendentes |
| Resultado do Mês | Receitas menos despesas no período |

**Gráficos disponíveis:**
• 📊 **Fluxo de Caixa** — Barras com entradas e saídas por período
• 📈 **Evolução do Saldo** — Linha mostrando a tendência
• 🥧 **Despesas por Categoria** — Pizza com distribuição de gastos

**Ações rápidas do dashboard:**
• Incluir novo cliente/fornecedor
• Criar nova conta a receber ou a pagar
• Acessar relatórios financeiros

**Filtros:** Mês atual | Trimestre | Semestre | Ano

💡 Acesse o dashboard diariamente para visão rápida. Dados atualizados em tempo real.

📖 Artigo completo: https://zyntraerp.com.br/Ajuda/artigos/dashboard-financeiro.html`
  },

  // ============================================================
  // NFS-E EMISSÃO (NOVO)
  // ============================================================
  {
    keywords: ['nfse emissão', 'emitir nfse', 'nota serviço emitir', 'nfs-e emitir', 'emissão nfse', 'nota fiscal serviço emitir', 'iss nfse', 'tomador serviço'],
    category: 'Financeiro',
    question: 'Como emitir NFS-e (Nota de Serviço)?',
    answer: `Para **emitir NFS-e** (Nota Fiscal de Serviço) no Aluforce: 📄

**Funcionalidades:**
• Emissão com dados do tomador
• Cálculo automático de ISS, PIS, COFINS, INSS, IR e CSLL
• Acompanhamento de status (emitida, cancelada, pendente)
• KPIs: total, emitidas, faturamento, ISS retido
• Exportação em CSV

**Emitindo uma NFS-e:**
1️⃣ Acesse **Financeiro > NFS-e**
2️⃣ Clique em **"Emitir NFS-e"**
3️⃣ Informe dados do tomador (razão social, CNPJ/CPF, e-mail)
4️⃣ Descreva o serviço, código de serviço municipal, valor e competência (mês/ano)
5️⃣ Informe a alíquota do ISS (demais impostos são calculados automaticamente)
6️⃣ Revise e clique em **"Emitir NFS-e"**

**Impostos calculados:**
| Imposto | Alíquota típica |
|---------|----------------|
| ISS | 2% a 5% (varia por município) |
| PIS | 0,65% a 1,65% |
| COFINS | 3% a 7,6% |
| INSS | 11% (quando aplicável) |
| IR | 1,5% (quando aplicável) |
| CSLL | 1% (quando aplicável) |

💡 A alíquota de ISS varia conforme o município. Consulte seu contador.

📖 Artigo completo: https://zyntraerp.com.br/Ajuda/artigos/nfse-emissao.html
📖 Migração NFS-e Nacional: https://zyntraerp.com.br/Ajuda/artigos/nfs-e-nacional.html`
  },

  // ============================================================
  // GESTÃO DE CONTAS BANCÁRIAS (NOVO)
  // ============================================================
  {
    keywords: ['conta bancária', 'contas bancárias', 'banco', 'bancos', 'cadastrar banco', 'saldo bancário', 'extrato', 'gestão bancária'],
    category: 'Financeiro',
    question: 'Como gerenciar contas bancárias?',
    answer: `Para **gerenciar contas bancárias** no Aluforce: 🏦

**Passo a passo:**
1️⃣ Acesse **Financeiro > Bancos** (ou Contas Bancárias)
2️⃣ Clique em **"Nova Conta"**
3️⃣ Preencha: banco, agência, conta, tipo (corrente/poupança), saldo inicial
4️⃣ Salve — a conta fica disponível para movimentações, boletos e conciliação

**Funcionalidades:**
• Cadastro de múltiplas contas bancárias
• Saldo atualizado em tempo real
• Histórico de movimentações
• Conciliação bancária por OFX
• Integração com boletos e pagamentos

💡 Mantenha os dados bancários atualizados para boletos e conciliação funcionarem corretamente.

📖 Tutorial: https://zyntraerp.com.br/Ajuda/artigos/tutorial-gestao-contas-bancarias.html
📚 Finanças: ${HELP_LINKS.financas}`
  },

  // ============================================================
  // LOGÍSTICA E TRANSPORTE (NOVO)
  // ============================================================
  {
    keywords: ['logística', 'logistica', 'transporte', 'expedição', 'frete', 'entrega', 'rastreio', 'ct-e', 'cte', 'transportadora', 'romaneio', 'embarque'],
    category: 'Logística',
    question: 'Como funciona o módulo de Logística?',
    answer: `O **módulo de Logística** do Aluforce: 🚚

Gerencia toda a cadeia de expedição e transporte — da separação do pedido até a entrega.

**Funcionalidades:**
• 📦 **Expedição** — Separação, conferência e liberação de pedidos
• 🚛 **Transporte** — Gestão de fretes e transportadoras
• 📄 **CT-e** — Emissão de Conhecimento de Transporte Eletrônico
• 📍 **Rastreio** — Acompanhamento de entregas em tempo real
• 📋 **Romaneio** — Lista de embarque com detalhes da carga
• 💰 **Tabela de Frete** — Cálculo automático por peso, distância ou valor

**Fluxo de expedição:**
📝 Pedido Aprovado → 📦 Separação → ✅ Conferência → 🚛 Embarque → 📍 Em Trânsito → ✅ Entregue

**CT-e (Conhecimento de Transporte):**
1️⃣ Acesse **Logística > CT-e**
2️⃣ Vincule a NF-e e transportadora
3️⃣ Configure rota, peso e valores
4️⃣ Emita — transmissão à SEFAZ

📖 Visão geral: https://zyntraerp.com.br/Ajuda/artigos/visao-geral-logistica.html
📖 Transporte: https://zyntraerp.com.br/Ajuda/artigos/tutorial-logistica-transporte.html
📖 CT-e: https://zyntraerp.com.br/Ajuda/artigos/tutorial-cte-transporte.html
📚 Logística: ${HELP_LINKS.logistica}`
  },

  // ============================================================
  // FATURAMENTO VISÃO GERAL (NOVO)
  // ============================================================
  {
    keywords: ['faturamento módulo', 'módulo faturamento', 'visão faturamento', 'fatura', 'faturas', 'faturar lote', 'faturamento integrado'],
    category: 'Faturamento',
    question: 'Como funciona o módulo de Faturamento?',
    answer: `O **módulo de Faturamento** do Aluforce: 💳

Integra vendas, notas fiscais e financeiro em um único fluxo.

**Funcionalidades:**
• Faturamento de pedidos aprovados em faturas
• Cobrança PIX com QR Code para pagamento instantâneo
• Régua de cobrança automática (e-mail e WhatsApp)
• Emissão de NF-e vinculada ao faturamento
• Dashboard consolidado de faturamento

**Fluxo:**
📝 Pedido Aprovado → 📄 Faturar → 🧾 NF-e Emitida → 💰 Cobrança Gerada → ✅ Recebido

📖 Visão geral: https://zyntraerp.com.br/Ajuda/artigos/visao-geral-faturamento.html
📖 PIX: https://zyntraerp.com.br/Ajuda/artigos/tutorial-pix-cobranca.html
📖 Régua: https://zyntraerp.com.br/Ajuda/artigos/tutorial-regua-cobranca.html
📚 Faturamento: ${HELP_LINKS.faturamento}`
  },

  // ============================================================
  // AÇÕES DE VENDAS — DUPLICAR, ORÇAMENTO, EXPORTAR PDF, PROSPECÇÃO (NOVO)
  // ============================================================
  {
    keywords: ['duplicar pedido', 'copiar pedido', 'clonar pedido', 'orçamento venda', 'gerar orçamento', 'proposta comercial', 'exportar pdf', 'pdf pedido', 'imprimir pedido'],
    category: 'Vendas',
    question: 'Como duplicar pedido, gerar orçamento ou exportar PDF?',
    answer: `Ações rápidas de **Vendas** no Aluforce: ⚡

**Duplicar Pedido:**
1️⃣ Acesse o pedido desejado → 2️⃣ Clique em **"Duplicar"** → 3️⃣ Um novo pedido é criado com os mesmos dados (cliente, produtos, condições). Ajuste o que precisar e salve.

**Gerar Orçamento:**
1️⃣ Crie um novo pedido normalmente → 2️⃣ Salve como **"Orçamento"** → 3️⃣ Envie o PDF ao cliente. Se aprovado, converta em pedido com um clique.

**Exportar Pedido em PDF:**
1️⃣ Abra o pedido → 2️⃣ Clique em **"Exportar PDF"** ou **"Imprimir"** → 3️⃣ Baixe ou envie por e-mail/WhatsApp.

📖 Duplicar: https://zyntraerp.com.br/Ajuda/artigos/tutorial-duplicar-pedido.html
📖 Orçamento: https://zyntraerp.com.br/Ajuda/artigos/tutorial-gerar-orcamento.html
📖 Exportar PDF: https://zyntraerp.com.br/Ajuda/artigos/tutorial-exportar-pedido-pdf.html`
  },
  {
    keywords: ['prospecção', 'prospecção b2b', 'lead', 'leads', 'prospect', 'captar cliente', 'funil vendas'],
    category: 'Vendas',
    question: 'Como usar a prospecção B2B?',
    answer: `Sobre **Prospecção B2B** no Aluforce: 🎯

Ferramenta para captar novos clientes e gerenciar o funil de vendas.

**Funcionalidades:**
• Cadastro de leads e prospects
• Funil de vendas visual
• Acompanhamento de atividades
• Conversão de lead em cliente

📖 Tutorial: https://zyntraerp.com.br/Ajuda/artigos/tutorial-prospeccao-b2b.html
📚 Vendas: ${HELP_LINKS.vendas}`
  },

  // ============================================================
  // NOTAS FISCAIS EXTRAS (NOVO)
  // ============================================================
  {
    keywords: ['inutilizar', 'inutilizar numeração', 'inutilizar nfe', 'faixa numeração', 'número nfe'],
    category: 'Notas Fiscais',
    question: 'Como inutilizar numeração de NF-e?',
    answer: `Para **inutilizar numeração** de NF-e: 🔢

**Quando usar:** Quebra na sequência numérica (ex: notas 100 a 105 foram puladas).

**Passo a passo:**
1️⃣ Acesse **Notas Fiscais > Inutilizar Numeração**
2️⃣ Informe a série, número inicial e número final
3️⃣ Informe a justificativa (mínimo 15 caracteres)
4️⃣ Transmita à SEFAZ

⚠️ A inutilização deve ser feita até o dia **5 do mês seguinte** à quebra de sequência.
⚠️ Números já utilizados em NF-e emitidas não podem ser inutilizados.

📖 Tutorial: https://zyntraerp.com.br/Ajuda/artigos/tutorial-inutilizar-numeracao.html
📚 Notas Fiscais: ${HELP_LINKS.notasFiscais}`
  },
  {
    keywords: ['consultar nfe', 'consultar nota', 'pesquisar nfe', 'buscar nota', 'status nfe', 'xml nfe', 'danfe consulta'],
    category: 'Notas Fiscais',
    question: 'Como consultar NF-e emitidas?',
    answer: `Para **consultar NF-e** emitidas: 🔍

1️⃣ Acesse **Notas Fiscais > Consulta**
2️⃣ Use os filtros: número, série, cliente, período, status
3️⃣ Clique na nota para ver detalhes, DANFE, XML e eventos

**Ações disponíveis:** Reimprimir DANFE | Baixar XML | Enviar por e-mail | Cancelar | Carta de Correção

📖 Tutorial: https://zyntraerp.com.br/Ajuda/artigos/tutorial-consultar-nfe.html
📚 Notas Fiscais: ${HELP_LINKS.notasFiscais}`
  },

  // ============================================================
  // COMPRAS EXTRAS (NOVO)
  // ============================================================
  {
    keywords: ['requisição compra', 'requisição', 'solicitar material', 'requisitar compra', 'pedido interno'],
    category: 'Compras',
    question: 'Como criar uma requisição de compra?',
    answer: `Para criar uma **requisição de compra**: 📝

Requisições são pedidos internos de materiais que precisam ser aprovados antes de virar pedido de compra.

1️⃣ Acesse **Compras > Requisições**
2️⃣ Clique em **"Nova Requisição"**
3️⃣ Adicione os materiais necessários com quantidade e justificativa
4️⃣ Envie para aprovação — o gestor aprova ou reprova
5️⃣ Após aprovada, converta em pedido de compra com um clique

📖 Tutorial: https://zyntraerp.com.br/Ajuda/artigos/tutorial-requisicao-compra.html
📚 Compras: ${HELP_LINKS.compras}`
  },
  {
    keywords: ['relatório compras', 'relatórios compras', 'relatório fornecedor', 'desempenho compras', 'análise compras'],
    category: 'Relatórios',
    question: 'Como gerar relatórios de compras?',
    answer: `Para gerar **relatórios de compras**: 📊

**Relatórios disponíveis:**
• Por Período — Todas as compras em um intervalo de datas
• Por Fornecedor — Volume, valores e desempenho
• Por Produto — Itens mais comprados, evolução de preço
• Cotações — Comparativo de propostas

1️⃣ Acesse **Relatórios > Compras**
2️⃣ Selecione o tipo e configure filtros
3️⃣ Gere e exporte (Excel/PDF)

📖 Tutorial: https://zyntraerp.com.br/Ajuda/artigos/tutorial-relatorios-compras.html
📚 Compras: ${HELP_LINKS.compras}`
  },

  // ============================================================
  // RELATÓRIOS PCP (NOVO)
  // ============================================================
  {
    keywords: ['relatório pcp', 'relatórios pcp', 'relatório produção', 'oee', 'eficiência produção', 'custo produção'],
    category: 'Relatórios',
    question: 'Como gerar relatórios de PCP/Produção?',
    answer: `Para gerar **relatórios de PCP/Produção**: 🏭

**Relatórios disponíveis:**
• **OEE** — Eficiência Global dos Equipamentos
• **Eficiência por etapa** — Produtividade de cada fase
• **Custo de produção** — Matéria-prima + mão de obra
• **Rastreabilidade** — Histórico completo de OPs
• **Análise de perdas** — Materiais desperdiçados

1️⃣ Acesse **Relatórios > Produção (PCP)**
2️⃣ Selecione o tipo de relatório
3️⃣ Configure filtros (período, produto, máquina)
4️⃣ Gere e exporte

📖 Tutorial: https://zyntraerp.com.br/Ajuda/artigos/tutorial-relatorios-pcp.html
📚 PCP: ${HELP_LINKS.pcp}`
  },

  // ============================================================
  // MOVIMENTAÇÃO DE ESTOQUE (NOVO)
  // ============================================================
  {
    keywords: ['movimentação estoque', 'transferência estoque', 'transferir estoque', 'mover estoque', 'entrada saída estoque', 'movimentar produto'],
    category: 'Estoque',
    question: 'Como fazer movimentação de estoque?',
    answer: `Para fazer **movimentação de estoque**: 📦

**Tipos de movimentação:**
| Tipo | Descrição |
|------|-----------|
| Entrada | Compras, devoluções, produção |
| Saída | Vendas, consumo, avarias |
| Transferência | Entre depósitos/locais |

**Passo a passo (transferência entre depósitos):**
1️⃣ Acesse **Estoque > Movimentações**
2️⃣ Clique em **"Nova Movimentação"**
3️⃣ Selecione: tipo (transferência), origem, destino
4️⃣ Adicione os produtos e quantidades
5️⃣ Confirme — saldos atualizados automaticamente

💡 Todas as movimentações ficam registradas no histórico do produto com data/hora e usuário.

📖 Tutorial: https://zyntraerp.com.br/Ajuda/artigos/tutorial-movimentacao-estoque.html
📚 Estoque: ${HELP_LINKS.estoque}`
  },

  // ============================================================
  // DASHBOARD DE VENDAS (NOVO)
  // ============================================================
  {
    keywords: ['dashboard vendas', 'painel vendas', 'indicadores vendas', 'kpi vendas', 'meta vendas', 'ranking vendedor'],
    category: 'Vendas',
    question: 'Como funciona o dashboard de vendas?',
    answer: `O **Dashboard de Vendas** do Aluforce: 📈

Visão consolidada do desempenho comercial.

**Indicadores exibidos:**
• 💰 Faturamento total do período
• 📊 Ticket médio por pedido
• 🏆 Ranking de vendedores
• 📦 Produtos mais vendidos
• 👥 Clientes com maior volume
• 📈 Evolução mensal de vendas

**Filtros:** Mês | Trimestre | Semestre | Ano | Vendedor | Região

📖 Tutorial: https://zyntraerp.com.br/Ajuda/artigos/tutorial-dashboard-vendas.html
📚 Vendas: ${HELP_LINKS.vendas}`
  },
];

// ==================== SINÔNIMOS E VARIAÇÕES ====================
const SYNONYMS = {
  'nf': 'nota fiscal nf-e emitir nota',
  'nfe': 'nf-e nota fiscal emitir',
  'nfse': 'nfs-e nota serviço',
  'nfce': 'nfc-e nota consumidor',
  'danfe': 'nf-e nota fiscal documento auxiliar',
  'xml': 'entrada nota importar nfe',
  'op': 'ordem produção pcp',
  'pcp': 'produção ordem produção fabricar kanban apontar',
  'rh': 'recursos humanos holerite férias ponto funcionário treinamento',
  'dre': 'relatório financeiro demonstrativo resultado',
  'boleto': 'cobrança pagamento conta receber',
  'nota': 'nota fiscal nf-e nfs-e emitir',
  'inadimplência': 'régua cobrança contas receber vencido',
  'devedor': 'contas receber inadimplência',
  'credor': 'conta pagar',
  'fornecimento': 'compras fornecedor',
  'fábrica': 'produção pcp',
  'manufatura': 'produção pcp',
  'financeiro': 'conta pagar receber fluxo caixa conciliação boleto recorrência imposto centro custo orçamento dashboard',
  'vendas': 'pedido venda faturar duplicar orçamento prospecção',
  'compras': 'pedido compra fornecedor requisição cotação',
  'estoque': 'inventário almoxarifado produto posição movimentação transferência',
  'contábil': 'contabilidade plano contas dre',
  'fiscal': 'nota fiscal nfe imposto icms',
  'imposto': 'fiscal icms pis cofins ipi iss alíquota tributário regime',
  'icms': 'imposto fiscal nota estadual',
  'cadastro': 'cadastrar cliente fornecedor produto',
  'preço': 'tabela preços markup desconto',
  'comissão': 'vendedor vendas desempenho',
  'caixa': 'fluxo caixa financeiro',
  'banco': 'conciliação bancária conta bancária ofx boleto',
  'dashboard': 'indicadores relatório painel kpi',
  'app': 'aplicativo celular mobile',
  'wpp': 'whatsapp integração envio',
  'whats': 'whatsapp integração envio',
  'login': 'primeiro acesso entrar acessar senha',
  'senha': 'acesso login segurança usuário',
  'erp': 'sistema aluforce módulos',
  'sefaz': 'nota fiscal nfe emitir transmitir',
  'certificado': 'certificado digital a1 a3 fiscal',
  'duplicata': 'desconto antecipação recebível',
  'pagamento': 'conta pagar financeiro boleto',
  'recebimento': 'conta receber financeiro boleto',
  'produto': 'cadastro produtos estoque ncm',
  'cliente': 'cadastro clientes vendas',
  'fornecedor': 'cadastro fornecedores compras',
  'orçamento': 'pedido venda proposta orçamento financeiro',
  'fatura': 'faturar pedido nfe módulo faturamento',
  'folha': 'folha pagamento holerite rh',
  'salário': 'holerite contracheque rh',
  'admissão': 'cadastrar funcionário rh',
  'logística': 'transporte expedição frete entrega rastreio ct-e',
  'frete': 'logística transporte expedição',
  'entrega': 'logística transporte rastreio expedição',
  'recorrência': 'recorrente lançamento automático mensal',
  'aluguel': 'recorrência despesa fixa mensal',
  'centro': 'centro custo departamento setor',
  'departamento': 'centro custo setor',
  'inutilizar': 'numeração nfe faixa',
};

// ==================== FUNÇÕES DE BUSCA ====================

function normalize(str) {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .trim();
}

function expandWithSynonyms(msg) {
  let expanded = msg;
  for (const [syn, replacement] of Object.entries(SYNONYMS)) {
    if (normalize(msg).includes(normalize(syn))) {
      expanded += ' ' + replacement;
    }
  }
  return expanded;
}

function findAnswer(userMessage) {
  const rawMsg = normalize(userMessage);
  const expandedMsg = normalize(expandWithSynonyms(userMessage));
  const words = rawMsg.split(/\s+/).filter(w => w.length >= 2);

  let bestMatch = null;
  let bestScore = 0;

  for (const entry of knowledgeBase) {
    let score = 0;

    for (const keyword of entry.keywords) {
      const normalizedKw = normalize(keyword);
      const kwWords = normalizedKw.split(/\s+/);

      // Match exato da keyword completa na mensagem expandida
      if (expandedMsg.includes(normalizedKw)) {
        score += normalizedKw.length * 3;
      }

      // Match exato: mensagem inteira é igual a uma keyword
      if (rawMsg === normalizedKw) {
        score += 50;
      }

      // Match parcial de palavras da keyword
      for (const kwWord of kwWords) {
        if (kwWord.length < 2) continue;
        if (rawMsg.includes(kwWord)) {
          score += kwWord.length * 1.5;
        }
      }

      // Match de palavras do usuário contra keywords
      for (const word of words) {
        if (normalizedKw.includes(word) && word.length >= 2) {
          score += word.length;
        }
        if (normalizedKw === word) {
          score += 20;
        }
      }
    }

    // Bonus para match na pergunta
    const normalizedQuestion = normalize(entry.question);
    for (const word of words) {
      if (normalizedQuestion.includes(word) && word.length >= 3) {
        score += 2;
      }
    }

    // Bonus para match na categoria
    const normalizedCategory = normalize(entry.category);
    if (rawMsg.includes(normalizedCategory) || normalizedCategory.includes(rawMsg)) {
      score += 15;
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = entry;
    }
  }

  return bestScore >= 3 ? bestMatch : null;
}

// ==================== RESPOSTA DO BOB ====================

function getBobResponse(userMessage) {
  const greetings = ['oi', 'olá', 'ola', 'bom dia', 'boa tarde', 'boa noite', 'hey', 'hello', 'hi', 'eae', 'e aí', 'e ai', 'opa', 'fala', 'salve'];
  const thanks = ['obrigado', 'obrigada', 'valeu', 'vlw', 'muito obrigado', 'thanks', 'brigado', 'brigada'];
  const msgLower = userMessage.toLowerCase().trim();

  // Agradecimentos
  if (thanks.some(t => msgLower.includes(t))) {
    return {
      type: 'answer',
      answer: `Por nada! 😊 Fico feliz em ajudar!

Se precisar de mais alguma coisa, é só perguntar. Estou aqui para te ajudar com qualquer dúvida sobre o Aluforce! 💙`
    };
  }

  // Saudações
  if (greetings.some(g => msgLower === g || msgLower.startsWith(g + ' '))) {
    return {
      type: 'answer',
      answer: `Olá! 👋 Eu sou o **BOB**, assistente virtual do Aluforce!

Posso te ajudar com qualquer dúvida sobre o sistema. Aqui estão os módulos que domino:

📋 **Guia Inicial** — Primeiro acesso e configurações
🛒 **Vendas** — Pedidos, faturamento, tabelas de preços, prospecção B2B
📦 **Compras** — Pedidos de compra, cotações, requisições, entrada de NF-e
💰 **Financeiro** — Contas a pagar/receber, fluxo de caixa, conciliação, boletos, recorrências, impostos, centros de custo, orçamentos
📄 **Notas Fiscais** — Emitir, cancelar NF-e, NFS-e, carta de correção, inutilizar numeração
💳 **Faturamento** — Cobrança PIX, régua de cobrança, NFS-e
📦 **Estoque** — Posição, inventário, ajustes, movimentações
🏭 **PCP** — Ordens de produção, apontamento Kanban, BOM
🚚 **Logística** — Expedição, transporte, CT-e, rastreio
👤 **RH** — Holerite, férias, ponto, funcionários, treinamentos
📊 **Relatórios** — Vendas, financeiro, estoque, produção, compras, DRE
📱 **WhatsApp e App** — Integrações e app mobile
🔒 **Segurança** — Usuários e permissões
🔌 **Integrações** — API REST, webhooks

**O que você precisa?** 😊`
    };
  }

  // Busca na base de conhecimento
  const result = findAnswer(userMessage);
  if (result) {
    return {
      type: 'answer',
      answer: result.answer,
      category: result.category,
      question: result.question
    };
  }

  // Não encontrou resposta
  return {
    type: 'no_answer',
    answer: `Hmm, não encontrei uma resposta exata para essa pergunta. 🤔

Mas posso te ajudar com esses temas — tente digitar uma dessas palavras:

📋 **"primeiro acesso"** — Configurações iniciais
🛒 **"pedido venda"** — Criar pedido de venda
📦 **"compras"** — Pedido de compra
💰 **"contas pagar"** — Gestão financeira
📄 **"NF-e"** — Emitir nota fiscal
📦 **"estoque"** — Controle de estoque
🏭 **"PCP"** — Ordens de produção
👤 **"RH"** — Holerite, férias, ponto
📊 **"relatórios"** — Relatórios gerenciais
📱 **"WhatsApp"** — Integração
🔒 **"permissões"** — Usuários e acesso

Ou, se preferir, posso **transferir você para um atendente humano**! 💬

📚 Central de Ajuda completa: ${HELP_LINKS.home}`
  };
}

module.exports = { getBobResponse, findAnswer, knowledgeBase, HELP_LINKS };
