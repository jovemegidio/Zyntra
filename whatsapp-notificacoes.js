// ============================================
// ALUFORCE - Sistema de Notificações WhatsApp
// Módulo de envio em massa com templates e fila
// ============================================

const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// ============================================
// CONFIGURAÇÃO DO BANCO DE DADOS
// ============================================
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'aluforce',
    password: process.env.DB_PASSWORD || 'Aluforce2026VpsDB',
    database: process.env.DB_NAME || 'aluforce_vendas',
    waitForConnections: true,
    connectionLimit: 5
};

let pool = null;

async function getPool() {
    if (!pool) {
        pool = mysql.createPool(dbConfig);
    }
    return pool;
}

// ============================================
// TEMPLATES DE MENSAGENS
// ============================================
const TEMPLATES = {
    // === RH ===
    ANIVERSARIO: (nome) => `🎂 *Feliz Aniversário, ${nome}!*

A família *ALUFORCE* deseja a você um dia incrível, repleto de alegria e realizações!

🎉🎈🎁 Que este novo ano de vida seja cheio de conquistas!

_Mensagem automática - ALUFORCE ERP_`,

    BOAS_VINDAS: (nome, cargo) => `👋 *Bem-vindo(a) à ALUFORCE, ${nome}!*

Estamos muito felizes em ter você em nossa equipe${cargo ? ` como *${cargo}*` : ''}.

Qualquer dúvida, conte conosco!

_Equipe ALUFORCE_`,

    FERIAS_INICIO: (nome, dataRetorno) => `🏖️ *Boas Férias, ${nome}!*

Suas férias começam hoje. Aproveite esse momento de descanso!

📅 Retorno previsto: *${dataRetorno}*

_Equipe RH - ALUFORCE_`,

    FERIAS_RETORNO: (nome) => `👋 *Bem-vindo(a) de volta, ${nome}!*

Esperamos que tenha descansado bem!
Estamos felizes com seu retorno.

_Equipe RH - ALUFORCE_`,

    // === PCP ===
    NOVA_ORDEM: (codigo, produto, quantidade) => `🏭 *Nova Ordem de Produção*

📋 Ordem: *${codigo}*
📦 Produto: ${produto}
📊 Quantidade: ${quantidade}

_PCP - ALUFORCE_`,

    ORDEM_URGENTE: (codigo, produto, prazo) => `🚨 *ORDEM URGENTE*

📋 Ordem: *${codigo}*
📦 Produto: ${produto}
⏰ Prazo: *${prazo}*

Atenção especial necessária!

_PCP - ALUFORCE_`,

    ORDEM_CONCLUIDA: (codigo, produto) => `✅ *Ordem Concluída*

📋 Ordem: *${codigo}*
📦 Produto: ${produto}

Produção finalizada com sucesso!

_PCP - ALUFORCE_`,

    ESTOQUE_BAIXO: (material, quantidade, minimo) => `⚠️ *ALERTA: Estoque Baixo*

📦 Material: *${material}*
📊 Estoque atual: *${quantidade}*
📉 Mínimo: ${minimo}

Verificar necessidade de compra!

_PCP - ALUFORCE_`,

    ENTRADA_MATERIAL: (material, quantidade, estoque) => `📥 *Entrada de Material*

📦 Material: *${material}*
➕ Quantidade: +${quantidade}
📊 Estoque atual: ${estoque}

_PCP - ALUFORCE_`,

    SAIDA_MATERIAL: (material, quantidade, estoque) => `📤 *Saída de Material*

📦 Material: *${material}*
➖ Quantidade: -${quantidade}
📊 Estoque atual: ${estoque}

_PCP - ALUFORCE_`,

    // === VENDAS ===
    NOVO_ORCAMENTO: (numero, cliente, valor) => `📝 *Novo Orçamento*

📋 Nº: *${numero}*
👤 Cliente: ${cliente}
💰 Valor: R$ ${valor}

_Vendas - ALUFORCE_`,

    ORCAMENTO_APROVADO: (numero, cliente) => `✅ *Orçamento Aprovado*

📋 Nº: *${numero}*
👤 Cliente: ${cliente}

Iniciar processo de produção!

_Vendas - ALUFORCE_`,

    PEDIDO_FATURADO: (numero, cliente) => `💰 *Pedido Faturado*

📋 Pedido: *${numero}*
👤 Cliente: ${cliente}

NF emitida com sucesso!

_Vendas - ALUFORCE_`,

    // === COMPRAS ===
    NOVO_PEDIDO_COMPRA: (numero, fornecedor, valor) => `🛒 *Novo Pedido de Compra*

📋 Nº: *${numero}*
🏢 Fornecedor: ${fornecedor}
💰 Valor: R$ ${valor}

_Compras - ALUFORCE_`,

    PEDIDO_ENTREGUE: (numero, fornecedor) => `📦 *Pedido Entregue*

📋 Nº: *${numero}*
🏢 Fornecedor: ${fornecedor}

Material recebido!

_Compras - ALUFORCE_`,

    PEDIDO_ATRASADO: (numero, fornecedor, dias) => `🚨 *PEDIDO ATRASADO*

📋 Nº: *${numero}*
🏢 Fornecedor: ${fornecedor}
⏰ Dias de atraso: *${dias}*

Entrar em contato com fornecedor!

_Compras - ALUFORCE_`,

    // === FINANCEIRO ===
    CONTA_VENCER: (descricao, valor, vencimento) => `💳 *Conta a Vencer*

📋 ${descricao}
💰 Valor: R$ ${valor}
📅 Vencimento: *${vencimento}*

_Financeiro - ALUFORCE_`,

    CONTA_VENCIDA: (descricao, valor, diasAtraso) => `🚨 *CONTA VENCIDA*

📋 ${descricao}
💰 Valor: R$ ${valor}
⏰ Dias em atraso: *${diasAtraso}*

_Financeiro - ALUFORCE_`,

    PAGAMENTO_RECEBIDO: (cliente, valor) => `💰 *Pagamento Recebido*

👤 Cliente: ${cliente}
💵 Valor: R$ ${valor}

_Financeiro - ALUFORCE_`,

    // === GERAL ===
    AVISO_GERAL: (titulo, mensagem) => `📢 *${titulo}*

${mensagem}

_ALUFORCE ERP_`,

    MANUTENCAO_SISTEMA: (data, horario, duracao) => `🔧 *Manutenção Programada*

📅 Data: ${data}
⏰ Horário: ${horario}
⏱️ Duração estimada: ${duracao}

O sistema pode ficar indisponível durante este período.

_TI - ALUFORCE_`
};

// ============================================
// GRUPOS DE DESTINATÁRIOS
// ============================================
const GRUPOS = {
    TI: ['ti@aluforce.ind.br'],
    RH: ['rh@aluforce.ind.br'],
    PCP: ['pcp@aluforce.ind.br', 'clemerson.silva@aluforce.ind.br'],
    COMPRAS: ['compras@aluforce.ind.br'],
    FINANCEIRO: ['financeiro@aluforce.ind.br'],
    COMERCIAL: ['comercial@aluforce.ind.br', 'fernando.kofugi@aluforce.ind.br'],
    DIRETORIA: ['diretoria@aluforce.ind.br'],
    PRODUCAO: [] // Será preenchido dinamicamente
};

// ============================================
// FILA DE MENSAGENS
// ============================================
const filaEnvio = [];
let processandoFila = false;

async function adicionarNaFila(telefone, mensagem, prioridade = 'normal') {
    filaEnvio.push({
        telefone,
        mensagem,
        prioridade,
        tentativas: 0,
        criadoEm: new Date()
    });
    
    // Ordenar por prioridade (alta primeiro)
    filaEnvio.sort((a, b) => {
        const prioridadeOrdem = { alta: 0, normal: 1, baixa: 2 };
        return prioridadeOrdem[a.prioridade] - prioridadeOrdem[b.prioridade];
    });
    
    // Iniciar processamento se não estiver rodando
    if (!processandoFila) {
        processarFila();
    }
}

async function processarFila() {
    if (filaEnvio.length === 0) {
        processandoFila = false;
        return;
    }
    
    processandoFila = true;
    const item = filaEnvio.shift();
    
    try {
        // Chamar API de envio do WhatsApp
        const response = await fetch('http://localhost:3002/api/whatsapp/enviar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                telefone: item.telefone,
                mensagem: item.mensagem
            })
        });
        
        const resultado = await response.json();
        
        if (resultado.success) {
            console.log(`✅ [FILA] Mensagem enviada para ${item.telefone}`);
            await registrarEnvio(item.telefone, item.mensagem, 'sucesso');
        } else {
            throw new Error(resultado.error);
        }
    } catch (error) {
        console.error(`❌ [FILA] Erro ao enviar para ${item.telefone}:`, error.message);
        
        // Tentar novamente até 3 vezes
        if (item.tentativas < 3) {
            item.tentativas++;
            filaEnvio.push(item);
        } else {
            await registrarEnvio(item.telefone, item.mensagem, 'falha', error.message);
        }
    }
    
    // Aguardar 2 segundos entre mensagens (evitar bloqueio)
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Continuar processando
    processarFila();
}

// ============================================
// REGISTRO DE ENVIOS NO BANCO
// ============================================
async function registrarEnvio(telefone, mensagem, status, erro = null) {
    try {
        const db = await getPool();
        await db.query(`
            INSERT INTO whatsapp_logs (telefone, mensagem, status, erro, created_at)
            VALUES (?, ?, ?, ?, NOW())
        `, [telefone, mensagem.substring(0, 500), status, erro]);
    } catch (err) {
        console.error('Erro ao registrar envio:', err.message);
    }
}

// ============================================
// FUNÇÕES DE ENVIO POR MÓDULO
// ============================================

// Buscar telefone por email
async function buscarTelefonePorEmail(email) {
    try {
        const db = await getPool();
        const [rows] = await db.query(`
            SELECT telefone, celular, telefone_pessoal
            FROM funcionarios 
            WHERE email = ? AND (status = 'Ativo' OR ativo = 1)
        `, [email]);
        
        if (rows.length > 0) {
            return rows[0].celular || rows[0].telefone_pessoal || rows[0].telefone;
        }
        return null;
    } catch (err) {
        console.error('Erro ao buscar telefone:', err.message);
        return null;
    }
}

// Buscar telefones de um grupo
async function buscarTelefonesGrupo(grupo) {
    const emails = GRUPOS[grupo] || [];
    const telefones = [];
    
    for (const email of emails) {
        const tel = await buscarTelefonePorEmail(email);
        if (tel) telefones.push(tel);
    }
    
    return telefones;
}

// === NOTIFICAÇÕES RH ===
async function notificarAniversariante(nome, telefone) {
    const mensagem = TEMPLATES.ANIVERSARIO(nome);
    await adicionarNaFila(telefone, mensagem, 'normal');
}

async function notificarBoasVindas(nome, cargo, telefone) {
    const mensagem = TEMPLATES.BOAS_VINDAS(nome, cargo);
    await adicionarNaFila(telefone, mensagem, 'normal');
}

// === NOTIFICAÇÕES PCP ===
async function notificarNovaOrdem(codigo, produto, quantidade) {
    const mensagem = TEMPLATES.NOVA_ORDEM(codigo, produto, quantidade);
    const telefones = await buscarTelefonesGrupo('PCP');
    for (const tel of telefones) {
        await adicionarNaFila(tel, mensagem, 'normal');
    }
}

async function notificarOrdemUrgente(codigo, produto, prazo) {
    const mensagem = TEMPLATES.ORDEM_URGENTE(codigo, produto, prazo);
    const telefones = await buscarTelefonesGrupo('PCP');
    for (const tel of telefones) {
        await adicionarNaFila(tel, mensagem, 'alta');
    }
}

async function notificarEstoqueBaixo(material, quantidade, minimo) {
    const mensagem = TEMPLATES.ESTOQUE_BAIXO(material, quantidade, minimo);
    const telefonesPCP = await buscarTelefonesGrupo('PCP');
    const telefonesCompras = await buscarTelefonesGrupo('COMPRAS');
    const telefones = [...new Set([...telefonesPCP, ...telefonesCompras])];
    
    for (const tel of telefones) {
        await adicionarNaFila(tel, mensagem, 'alta');
    }
}

async function notificarEntradaMaterial(material, quantidade, estoqueAtual) {
    const mensagem = TEMPLATES.ENTRADA_MATERIAL(material, quantidade, estoqueAtual);
    const telefones = await buscarTelefonesGrupo('PCP');
    for (const tel of telefones) {
        await adicionarNaFila(tel, mensagem, 'baixa');
    }
}

async function notificarSaidaMaterial(material, quantidade, estoqueAtual) {
    const mensagem = TEMPLATES.SAIDA_MATERIAL(material, quantidade, estoqueAtual);
    const telefones = await buscarTelefonesGrupo('PCP');
    for (const tel of telefones) {
        await adicionarNaFila(tel, mensagem, 'baixa');
    }
}

// === NOTIFICAÇÕES VENDAS ===
async function notificarNovoOrcamento(numero, cliente, valor) {
    const mensagem = TEMPLATES.NOVO_ORCAMENTO(numero, cliente, valor);
    const telefones = await buscarTelefonesGrupo('COMERCIAL');
    for (const tel of telefones) {
        await adicionarNaFila(tel, mensagem, 'normal');
    }
}

async function notificarOrcamentoAprovado(numero, cliente) {
    const mensagem = TEMPLATES.ORCAMENTO_APROVADO(numero, cliente);
    const telefonesPCP = await buscarTelefonesGrupo('PCP');
    const telefonesComercial = await buscarTelefonesGrupo('COMERCIAL');
    const telefones = [...new Set([...telefonesPCP, ...telefonesComercial])];
    
    for (const tel of telefones) {
        await adicionarNaFila(tel, mensagem, 'alta');
    }
}

// === NOTIFICAÇÕES COMPRAS ===
async function notificarPedidoAtrasado(numero, fornecedor, dias) {
    const mensagem = TEMPLATES.PEDIDO_ATRASADO(numero, fornecedor, dias);
    const telefones = await buscarTelefonesGrupo('COMPRAS');
    for (const tel of telefones) {
        await adicionarNaFila(tel, mensagem, 'alta');
    }
}

// === NOTIFICAÇÕES FINANCEIRO ===
async function notificarContaVencer(descricao, valor, vencimento) {
    const mensagem = TEMPLATES.CONTA_VENCER(descricao, valor, vencimento);
    const telefones = await buscarTelefonesGrupo('FINANCEIRO');
    for (const tel of telefones) {
        await adicionarNaFila(tel, mensagem, 'normal');
    }
}

async function notificarContaVencida(descricao, valor, diasAtraso) {
    const mensagem = TEMPLATES.CONTA_VENCIDA(descricao, valor, diasAtraso);
    const telefones = await buscarTelefonesGrupo('FINANCEIRO');
    for (const tel of telefones) {
        await adicionarNaFila(tel, mensagem, 'alta');
    }
}

// === NOTIFICAÇÃO GERAL ===
async function notificarTodos(titulo, mensagem) {
    const msg = TEMPLATES.AVISO_GERAL(titulo, mensagem);
    
    try {
        const db = await getPool();
        const [funcionarios] = await db.query(`
            SELECT celular, telefone_pessoal, telefone
            FROM funcionarios 
            WHERE (status = 'Ativo' OR ativo = 1)
            AND (celular IS NOT NULL OR telefone_pessoal IS NOT NULL OR telefone IS NOT NULL)
        `);
        
        for (const func of funcionarios) {
            const tel = func.celular || func.telefone_pessoal || func.telefone;
            if (tel) {
                await adicionarNaFila(tel, msg, 'normal');
            }
        }
        
        console.log(`📢 [MASSA] ${funcionarios.length} mensagens adicionadas à fila`);
    } catch (err) {
        console.error('Erro ao notificar todos:', err.message);
    }
}

async function notificarManutencao(data, horario, duracao) {
    const mensagem = TEMPLATES.MANUTENCAO_SISTEMA(data, horario, duracao);
    await notificarTodos('Manutenção do Sistema', mensagem);
}

// ============================================
// EXPORTAR MÓDULO
// ============================================
module.exports = {
    // Templates
    TEMPLATES,
    GRUPOS,
    
    // Funções de fila
    adicionarNaFila,
    
    // RH
    notificarAniversariante,
    notificarBoasVindas,
    
    // PCP
    notificarNovaOrdem,
    notificarOrdemUrgente,
    notificarEstoqueBaixo,
    notificarEntradaMaterial,
    notificarSaidaMaterial,
    
    // Vendas
    notificarNovoOrcamento,
    notificarOrcamentoAprovado,
    
    // Compras
    notificarPedidoAtrasado,
    
    // Financeiro
    notificarContaVencer,
    notificarContaVencida,
    
    // Geral
    notificarTodos,
    notificarManutencao,
    
    // Utilitários
    buscarTelefonePorEmail,
    buscarTelefonesGrupo
};

console.log('📱 Módulo de Notificações WhatsApp carregado!');
