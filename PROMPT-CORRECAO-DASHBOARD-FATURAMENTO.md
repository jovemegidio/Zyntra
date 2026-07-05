# 🎯 PROMPT DE CORREÇÃO: DASHBOARD E MÓDULO FATURAMENTO

## OBJETIVO PRINCIPAL

Corrigir e otimizar o Dashboard principal e o módulo de Faturamento do sistema Zyntra ERP, garantindo que todos os componentes funcionem com dados reais e que o modal de configurações do sistema esteja 100% funcional.

---

## 📊 PARTE 1: CORREÇÃO DO DASHBOARD

### 1.1 REMOVER: Metas do Mês

**Tarefa:** Remover completamente o widget "Metas do Mês" do dashboard principal.

**Arquivos a Verificar:**
- `public/dashboard.html` ou `modules/Admin/public/pages/dashboard.html`
- `public/js/dashboard.js` ou similar
- `routes/dashboard.js` ou `server.js` (rotas de dashboard)
- Qualquer CSS relacionado a metas

**Ações Específicas:**

1. **Localizar e remover HTML:**
```html
<!-- REMOVER ESTE BLOCO COMPLETO -->
<div class="card" id="metas-mes">
    <div class="card-header">
        <h3>Metas do Mês</h3>
    </div>
    <div class="card-body">
        <!-- Conteúdo de metas -->
    </div>
</div>
```

2. **Remover JavaScript relacionado:**
```javascript
// REMOVER funções como:
function carregarMetasMes() { ... }
function atualizarProgressoMetas() { ... }
// E suas chamadas
```

3. **Remover rotas de API:**
```javascript
// REMOVER endpoints como:
app.get('/api/dashboard/metas', ...)
app.post('/api/dashboard/metas', ...)
```

4. **Limpar CSS:**
```css
/* REMOVER estilos como: */
.metas-mes { ... }
.progresso-meta { ... }
```

**Validação:**
- [ ] Widget não aparece mais no dashboard
- [ ] Nenhum erro no console do navegador
- [ ] Nenhuma chamada de API para /api/dashboard/metas
- [ ] Layout do dashboard permanece organizado



---

### 1.2 CORRIGIR: Pedidos Recentes (Dados Reais)

**Tarefa:** Garantir que o widget "Pedidos Recentes" exiba dados reais do banco de dados.

**Arquivos a Analisar:**
- `server.js` ou `routes/dashboard.js` (endpoint de pedidos)
- `public/js/dashboard.js` (renderização frontend)
- Banco de dados: tabela `pedidos` ou `vendas`

**Problemas Comuns a Corrigir:**

1. **Dados mockados/hardcoded:**
```javascript
// ❌ ERRADO - Dados falsos
const pedidos = [
    { id: 1, cliente: 'Cliente Teste', valor: 1000 },
    { id: 2, cliente: 'Outro Teste', valor: 2000 }
];

// ✅ CORRETO - Dados reais do banco
const [pedidos] = await pool.query(`
    SELECT 
        p.id,
        p.numero_pedido,
        c.nome as cliente_nome,
        p.valor_total,
        p.status,
        p.data_pedido,
        u.nome as vendedor_nome
    FROM pedidos p
    LEFT JOIN clientes c ON p.cliente_id = c.id
    LEFT JOIN usuarios u ON p.vendedor_id = u.id
    WHERE p.data_pedido >= DATE_SUB(NOW(), INTERVAL 7 DAY)
    ORDER BY p.data_pedido DESC
    LIMIT 10
`);
```

2. **Endpoint de API:**
```javascript
// Criar ou corrigir endpoint
app.get('/api/dashboard/pedidos-recentes', authenticateToken, async (req, res) => {
    try {
        const [pedidos] = await pool.query(`
            SELECT 
                p.id,
                p.numero_pedido,
                c.nome as cliente_nome,
                c.cnpj as cliente_cnpj,
                p.valor_total,
                p.status,
                DATE_FORMAT(p.data_pedido, '%d/%m/%Y %H:%i') as data_pedido_formatada,
                u.nome as vendedor_nome,
                (SELECT COUNT(*) FROM pedido_itens WHERE pedido_id = p.id) as total_itens
            FROM pedidos p
            LEFT JOIN clientes c ON p.cliente_id = c.id
            LEFT JOIN usuarios u ON p.vendedor_id = u.id
            WHERE p.deleted_at IS NULL
            ORDER BY p.data_pedido DESC
            LIMIT 10
        `);
        
        res.json({
            success: true,
            pedidos: pedidos,
            total: pedidos.length
        });
    } catch (error) {
        console.error('Erro ao buscar pedidos recentes:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao carregar pedidos recentes'
        });
    }
});
```

3. **Frontend - Renderização:**
```javascript
// public/js/dashboard.js
async function carregarPedidosRecentes() {
    try {
        const response = await fetch('/api/dashboard/pedidos-recentes', {
            headers: {
                'Authorization': `Bearer ${getToken()}`
            }
        });
        
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.message);
        }
        
        const container = document.getElementById('pedidos-recentes-lista');
        
        if (data.pedidos.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-inbox"></i>
                    <p>Nenhum pedido recente encontrado</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = data.pedidos.map(pedido => `
            <div class="pedido-item" data-id="${pedido.id}">
                <div class="pedido-info">
                    <strong>#${pedido.numero_pedido}</strong>
                    <span class="cliente">${pedido.cliente_nome}</span>
                </div>
                <div class="pedido-detalhes">
                    <span class="valor">R$ ${formatarMoeda(pedido.valor_total)}</span>
                    <span class="status status-${pedido.status}">${formatarStatus(pedido.status)}</span>
                    <span class="data">${pedido.data_pedido_formatada}</span>
                </div>
                <button class="btn-ver-detalhes" onclick="verDetalhesPedido(${pedido.id})">
                    <i class="fas fa-eye"></i>
                </button>
            </div>
        `).join('');
        
    } catch (error) {
        console.error('Erro ao carregar pedidos:', error);
        mostrarNotificacao('Erro ao carregar pedidos recentes', 'error');
    }
}

// Funções auxiliares
function formatarMoeda(valor) {
    return parseFloat(valor).toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function formatarStatus(status) {
    const statusMap = {
        'pendente': 'Pendente',
        'aprovado': 'Aprovado',
        'em_producao': 'Em Produção',
        'faturado': 'Faturado',
        'cancelado': 'Cancelado'
    };
    return statusMap[status] || status;
}
```

**Validação:**
- [ ] Pedidos exibidos são do banco de dados real
- [ ] Dados atualizados ao recarregar página
- [ ] Formatação de valores monetários correta (R$ 1.234,56)
- [ ] Status dos pedidos exibidos corretamente
- [ ] Link para ver detalhes funciona
- [ ] Mensagem apropriada quando não há pedidos



---

### 1.3 CORRIGIR: Fluxo Financeiro (Dados Reais)

**Tarefa:** Garantir que o widget "Fluxo Financeiro" exiba dados reais de contas a pagar e receber.

**Arquivos a Analisar:**
- `modules/Financeiro/` (módulo financeiro)
- `server.js` ou `routes/financeiro.js`
- Tabelas: `contas_pagar`, `contas_receber`, `fluxo_caixa`

**Implementação Completa:**

1. **Endpoint de API:**
```javascript
// routes/dashboard.js ou server.js
app.get('/api/dashboard/fluxo-financeiro', authenticateToken, async (req, res) => {
    try {
        // Período: últimos 30 dias e próximos 30 dias
        const dataInicio = new Date();
        dataInicio.setDate(dataInicio.getDate() - 30);
        const dataFim = new Date();
        dataFim.setDate(dataFim.getDate() + 30);
        
        // Contas a Receber
        const [contasReceber] = await pool.query(`
            SELECT 
                SUM(CASE WHEN status = 'pago' THEN valor_pago ELSE 0 END) as recebido,
                SUM(CASE WHEN status = 'pendente' AND data_vencimento <= CURDATE() THEN valor_total ELSE 0 END) as vencido,
                SUM(CASE WHEN status = 'pendente' AND data_vencimento > CURDATE() THEN valor_total ELSE 0 END) as a_receber,
                COUNT(*) as total_titulos
            FROM contas_receber
            WHERE data_vencimento BETWEEN ? AND ?
            AND deleted_at IS NULL
        `, [dataInicio, dataFim]);
        
        // Contas a Pagar
        const [contasPagar] = await pool.query(`
            SELECT 
                SUM(CASE WHEN status = 'pago' THEN valor_pago ELSE 0 END) as pago,
                SUM(CASE WHEN status = 'pendente' AND data_vencimento <= CURDATE() THEN valor_total ELSE 0 END) as vencido,
                SUM(CASE WHEN status = 'pendente' AND data_vencimento > CURDATE() THEN valor_total ELSE 0 END) as a_pagar,
                COUNT(*) as total_titulos
            FROM contas_pagar
            WHERE data_vencimento BETWEEN ? AND ?
            AND deleted_at IS NULL
        `, [dataInicio, dataFim]);
        
        // Saldo atual
        const [saldoAtual] = await pool.query(`
            SELECT 
                COALESCE(SUM(CASE WHEN tipo = 'entrada' THEN valor ELSE -valor END), 0) as saldo
            FROM fluxo_caixa
            WHERE data_movimento <= CURDATE()
            AND deleted_at IS NULL
        `);
        
        // Projeção próximos 7 dias
        const [projecao7dias] = await pool.query(`
            SELECT 
                COALESCE(SUM(valor_total), 0) as total_receber
            FROM contas_receber
            WHERE status = 'pendente'
            AND data_vencimento BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)
            AND deleted_at IS NULL
        `);
        
        const [projecaoPagar7dias] = await pool.query(`
            SELECT 
                COALESCE(SUM(valor_total), 0) as total_pagar
            FROM contas_pagar
            WHERE status = 'pendente'
            AND data_vencimento BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)
            AND deleted_at IS NULL
        `);
        
        res.json({
            success: true,
            fluxo: {
                receber: {
                    recebido: parseFloat(contasReceber[0].recebido || 0),
                    vencido: parseFloat(contasReceber[0].vencido || 0),
                    a_receber: parseFloat(contasReceber[0].a_receber || 0),
                    total_titulos: parseInt(contasReceber[0].total_titulos || 0)
                },
                pagar: {
                    pago: parseFloat(contasPagar[0].pago || 0),
                    vencido: parseFloat(contasPagar[0].vencido || 0),
                    a_pagar: parseFloat(contasPagar[0].a_pagar || 0),
                    total_titulos: parseInt(contasPagar[0].total_titulos || 0)
                },
                saldo_atual: parseFloat(saldoAtual[0].saldo || 0),
                projecao_7dias: {
                    receber: parseFloat(projecao7dias[0].total_receber || 0),
                    pagar: parseFloat(projecaoPagar7dias[0].total_pagar || 0),
                    saldo_projetado: parseFloat(saldoAtual[0].saldo || 0) + 
                                    parseFloat(projecao7dias[0].total_receber || 0) - 
                                    parseFloat(projecaoPagar7dias[0].total_pagar || 0)
                }
            }
        });
        
    } catch (error) {
        console.error('Erro ao buscar fluxo financeiro:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao carregar fluxo financeiro'
        });
    }
});
```

2. **Frontend - Renderização:**
```javascript
// public/js/dashboard.js
async function carregarFluxoFinanceiro() {
    try {
        const response = await fetch('/api/dashboard/fluxo-financeiro', {
            headers: {
                'Authorization': `Bearer ${getToken()}`
            }
        });
        
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.message);
        }
        
        const fluxo = data.fluxo;
        
        // Atualizar cards de resumo
        document.getElementById('saldo-atual').textContent = formatarMoedaComSinal(fluxo.saldo_atual);
        document.getElementById('saldo-atual').className = fluxo.saldo_atual >= 0 ? 'positivo' : 'negativo';
        
        // Contas a Receber
        document.getElementById('total-recebido').textContent = formatarMoeda(fluxo.receber.recebido);
        document.getElementById('total-a-receber').textContent = formatarMoeda(fluxo.receber.a_receber);
        document.getElementById('total-vencido-receber').textContent = formatarMoeda(fluxo.receber.vencido);
        
        // Contas a Pagar
        document.getElementById('total-pago').textContent = formatarMoeda(fluxo.pagar.pago);
        document.getElementById('total-a-pagar').textContent = formatarMoeda(fluxo.pagar.a_pagar);
        document.getElementById('total-vencido-pagar').textContent = formatarMoeda(fluxo.pagar.vencido);
        
        // Projeção 7 dias
        document.getElementById('projecao-receber-7d').textContent = formatarMoeda(fluxo.projecao_7dias.receber);
        document.getElementById('projecao-pagar-7d').textContent = formatarMoeda(fluxo.projecao_7dias.pagar);
        document.getElementById('saldo-projetado-7d').textContent = formatarMoedaComSinal(fluxo.projecao_7dias.saldo_projetado);
        document.getElementById('saldo-projetado-7d').className = fluxo.projecao_7dias.saldo_projetado >= 0 ? 'positivo' : 'negativo';
        
        // Alertas de vencidos
        if (fluxo.receber.vencido > 0) {
            mostrarAlerta('warning', `Você tem R$ ${formatarMoeda(fluxo.receber.vencido)} em contas a receber vencidas`);
        }
        
        if (fluxo.pagar.vencido > 0) {
            mostrarAlerta('danger', `Você tem R$ ${formatarMoeda(fluxo.pagar.vencido)} em contas a pagar vencidas`);
        }
        
    } catch (error) {
        console.error('Erro ao carregar fluxo financeiro:', error);
        mostrarNotificacao('Erro ao carregar fluxo financeiro', 'error');
    }
}

function formatarMoedaComSinal(valor) {
    const sinal = valor >= 0 ? '+' : '';
    return sinal + ' R$ ' + formatarMoeda(Math.abs(valor));
}
```

**Validação:**
- [ ] Saldo atual exibido corretamente
- [ ] Contas a receber somadas corretamente
- [ ] Contas a pagar somadas corretamente
- [ ] Títulos vencidos destacados
- [ ] Projeção de 7 dias calculada
- [ ] Cores indicam positivo (verde) e negativo (vermelho)
- [ ] Alertas aparecem para contas vencidas



---

## ⚙️ PARTE 2: MODAL DE CONFIGURAÇÕES DO SISTEMA

### 2.1 GARANTIR FUNCIONAMENTO COMPLETO

**Tarefa:** Verificar e corrigir o modal de configurações do sistema para que todas as opções funcionem perfeitamente.

**Arquivos a Analisar:**
- `public/pages/configuracoes.html` ou modal inline no dashboard
- `public/js/configuracoes.js`
- `routes/configuracoes.js` ou `server.js`
- Tabela: `configuracoes_sistema` ou `system_settings`

**Configurações Essenciais a Implementar:**

1. **Estrutura do Banco de Dados:**
```sql
CREATE TABLE IF NOT EXISTS configuracoes_sistema (
    id INT AUTO_INCREMENT PRIMARY KEY,
    chave VARCHAR(100) UNIQUE NOT NULL,
    valor TEXT,
    tipo ENUM('string', 'number', 'boolean', 'json') DEFAULT 'string',
    categoria VARCHAR(50),
    descricao TEXT,
    editavel BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_chave (chave),
    INDEX idx_categoria (categoria)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Inserir configurações padrão
INSERT INTO configuracoes_sistema (chave, valor, tipo, categoria, descricao) VALUES
-- Empresa
('empresa_nome', 'ALUFORCE INDÚSTRIA E COMÉRCIO LTDA', 'string', 'empresa', 'Nome da empresa'),
('empresa_cnpj', '00.000.000/0000-00', 'string', 'empresa', 'CNPJ da empresa'),
('empresa_ie', '', 'string', 'empresa', 'Inscrição Estadual'),
('empresa_telefone', '', 'string', 'empresa', 'Telefone principal'),
('empresa_email', '', 'string', 'empresa', 'E-mail principal'),
('empresa_endereco', '', 'string', 'empresa', 'Endereço completo'),
('empresa_logo_url', '/assets/logo.png', 'string', 'empresa', 'URL do logo'),

-- Sistema
('sistema_nome', 'Zyntra ERP', 'string', 'sistema', 'Nome do sistema'),
('sistema_versao', '2.4.0', 'string', 'sistema', 'Versão do sistema'),
('sistema_manutencao', 'false', 'boolean', 'sistema', 'Modo manutenção'),
('sistema_permitir_cadastro', 'false', 'boolean', 'sistema', 'Permitir auto-cadastro'),

-- E-mail
('email_smtp_host', '', 'string', 'email', 'Servidor SMTP'),
('email_smtp_port', '587', 'number', 'email', 'Porta SMTP'),
('email_smtp_user', '', 'string', 'email', 'Usuário SMTP'),
('email_smtp_password', '', 'string', 'email', 'Senha SMTP (criptografada)'),
('email_from_name', 'Sistema ERP', 'string', 'email', 'Nome do remetente'),
('email_from_address', '', 'string', 'email', 'E-mail remetente'),

-- Fiscal
('nfe_ambiente', 'homologacao', 'string', 'fiscal', 'Ambiente NFe (producao/homologacao)'),
('nfe_serie', '1', 'number', 'fiscal', 'Série da NFe'),
('nfe_numero_atual', '1', 'number', 'fiscal', 'Próximo número de NFe'),
('nfe_certificado_path', '', 'string', 'fiscal', 'Caminho do certificado digital'),

-- Financeiro
('financeiro_dias_vencimento_padrao', '30', 'number', 'financeiro', 'Dias para vencimento padrão'),
('financeiro_juros_mora', '2', 'number', 'financeiro', 'Juros de mora (% ao mês)'),
('financeiro_multa_atraso', '2', 'number', 'financeiro', 'Multa por atraso (%)'),

-- Vendas
('vendas_desconto_maximo', '10', 'number', 'vendas', 'Desconto máximo permitido (%)'),
('vendas_aprovar_automatico', 'false', 'boolean', 'vendas', 'Aprovar pedidos automaticamente'),
('vendas_estoque_negativo', 'false', 'boolean', 'vendas', 'Permitir estoque negativo'),

-- Notificações
('notificacoes_email_ativo', 'true', 'boolean', 'notificacoes', 'Enviar notificações por e-mail'),
('notificacoes_discord_webhook', '', 'string', 'notificacoes', 'Webhook Discord'),
('notificacoes_whatsapp_ativo', 'false', 'boolean', 'notificacoes', 'Notificações WhatsApp')

ON DUPLICATE KEY UPDATE valor=valor;
```

2. **Backend - Endpoints de API:**
```javascript
// routes/configuracoes.js ou server.js

// Listar todas as configurações (agrupadas por categoria)
app.get('/api/configuracoes', authenticateToken, authorizeAdmin, async (req, res) => {
    try {
        const [configs] = await pool.query(`
            SELECT 
                id,
                chave,
                valor,
                tipo,
                categoria,
                descricao,
                editavel
            FROM configuracoes_sistema
            WHERE editavel = TRUE
            ORDER BY categoria, chave
        `);
        
        // Agrupar por categoria
        const configsPorCategoria = configs.reduce((acc, config) => {
            if (!acc[config.categoria]) {
                acc[config.categoria] = [];
            }
            
            // Converter valor baseado no tipo
            let valorConvertido = config.valor;
            if (config.tipo === 'boolean') {
                valorConvertido = config.valor === 'true' || config.valor === '1';
            } else if (config.tipo === 'number') {
                valorConvertido = parseFloat(config.valor);
            } else if (config.tipo === 'json') {
                try {
                    valorConvertido = JSON.parse(config.valor);
                } catch (e) {
                    valorConvertido = config.valor;
                }
            }
            
            acc[config.categoria].push({
                ...config,
                valor: valorConvertido
            });
            
            return acc;
        }, {});
        
        res.json({
            success: true,
            configuracoes: configsPorCategoria
        });
        
    } catch (error) {
        console.error('Erro ao buscar configurações:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao carregar configurações'
        });
    }
});

// Atualizar uma configuração
app.put('/api/configuracoes/:chave', authenticateToken, authorizeAdmin, async (req, res) => {
    try {
        const { chave } = req.params;
        const { valor } = req.body;
        
        // Verificar se a configuração existe e é editável
        const [config] = await pool.query(
            'SELECT * FROM configuracoes_sistema WHERE chave = ? AND editavel = TRUE',
            [chave]
        );
        
        if (config.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Configuração não encontrada ou não editável'
            });
        }
        
        // Validar valor baseado no tipo
        let valorFinal = valor;
        if (config[0].tipo === 'boolean') {
            valorFinal = valor ? 'true' : 'false';
        } else if (config[0].tipo === 'number') {
            if (isNaN(valor)) {
                return res.status(400).json({
                    success: false,
                    message: 'Valor deve ser numérico'
                });
            }
            valorFinal = String(valor);
        } else if (config[0].tipo === 'json') {
            try {
                JSON.parse(valor);
                valorFinal = valor;
            } catch (e) {
                return res.status(400).json({
                    success: false,
                    message: 'Valor JSON inválido'
                });
            }
        }
        
        // Atualizar configuração
        await pool.query(
            'UPDATE configuracoes_sistema SET valor = ?, updated_at = NOW() WHERE chave = ?',
            [valorFinal, chave]
        );
        
        // Log de auditoria
        await writeAuditLog({
            userId: req.user.id,
            action: 'UPDATE_CONFIG',
            module: 'configuracoes',
            description: `Configuração ${chave} atualizada`,
            previousData: { valor: config[0].valor },
            newData: { valor: valorFinal },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });
        
        res.json({
            success: true,
            message: 'Configuração atualizada com sucesso'
        });
        
    } catch (error) {
        console.error('Erro ao atualizar configuração:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao atualizar configuração'
        });
    }
});

// Atualizar múltiplas configurações de uma vez
app.post('/api/configuracoes/bulk-update', authenticateToken, authorizeAdmin, async (req, res) => {
    try {
        const { configuracoes } = req.body; // Array de { chave, valor }
        
        if (!Array.isArray(configuracoes)) {
            return res.status(400).json({
                success: false,
                message: 'Formato inválido'
            });
        }
        
        const connection = await pool.getConnection();
        await connection.beginTransaction();
        
        try {
            for (const config of configuracoes) {
                await connection.query(
                    'UPDATE configuracoes_sistema SET valor = ?, updated_at = NOW() WHERE chave = ? AND editavel = TRUE',
                    [config.valor, config.chave]
                );
            }
            
            await connection.commit();
            
            res.json({
                success: true,
                message: `${configuracoes.length} configurações atualizadas com sucesso`
            });
            
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
        
    } catch (error) {
        console.error('Erro ao atualizar configurações em lote:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao atualizar configurações'
        });
    }
});

// Testar conexão SMTP
app.post('/api/configuracoes/testar-email', authenticateToken, authorizeAdmin, async (req, res) => {
    try {
        const { email_destino } = req.body;
        
        if (!email_destino) {
            return res.status(400).json({
                success: false,
                message: 'E-mail de destino é obrigatório'
            });
        }
        
        // Buscar configurações de e-mail
        const [configs] = await pool.query(`
            SELECT chave, valor 
            FROM configuracoes_sistema 
            WHERE chave LIKE 'email_%'
        `);
        
        const emailConfig = {};
        configs.forEach(c => {
            emailConfig[c.chave] = c.valor;
        });
        
        // Tentar enviar e-mail de teste
        const resultado = await sendEmail(
            email_destino,
            'Teste de Configuração SMTP',
            '<h1>Teste de E-mail</h1><p>Se você recebeu este e-mail, as configurações SMTP estão corretas!</p>',
            'Teste de E-mail - Se você recebeu este e-mail, as configurações SMTP estão corretas!'
        );
        
        if (resultado.success) {
            res.json({
                success: true,
                message: 'E-mail de teste enviado com sucesso!'
            });
        } else {
            res.status(500).json({
                success: false,
                message: `Erro ao enviar e-mail: ${resultado.error}`
            });
        }
        
    } catch (error) {
        console.error('Erro ao testar e-mail:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao testar configurações de e-mail'
        });
    }
});
```



3. **Frontend - Modal de Configurações:**
```html
<!-- Modal de Configurações do Sistema -->
<div class="modal fade" id="modalConfiguracoes" tabindex="-1">
    <div class="modal-dialog modal-xl">
        <div class="modal-content">
            <div class="modal-header">
                <h5 class="modal-title">
                    <i class="fas fa-cog"></i> Configurações do Sistema
                </h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body">
                <!-- Tabs de Categorias -->
                <ul class="nav nav-tabs" id="configTabs" role="tablist">
                    <li class="nav-item">
                        <button class="nav-link active" data-bs-toggle="tab" data-bs-target="#tab-empresa">
                            <i class="fas fa-building"></i> Empresa
                        </button>
                    </li>
                    <li class="nav-item">
                        <button class="nav-link" data-bs-toggle="tab" data-bs-target="#tab-sistema">
                            <i class="fas fa-desktop"></i> Sistema
                        </button>
                    </li>
                    <li class="nav-item">
                        <button class="nav-link" data-bs-toggle="tab" data-bs-target="#tab-email">
                            <i class="fas fa-envelope"></i> E-mail
                        </button>
                    </li>
                    <li class="nav-item">
                        <button class="nav-link" data-bs-toggle="tab" data-bs-target="#tab-fiscal">
                            <i class="fas fa-file-invoice"></i> Fiscal
                        </button>
                    </li>
                    <li class="nav-item">
                        <button class="nav-link" data-bs-toggle="tab" data-bs-target="#tab-financeiro">
                            <i class="fas fa-dollar-sign"></i> Financeiro
                        </button>
                    </li>
                    <li class="nav-item">
                        <button class="nav-link" data-bs-toggle="tab" data-bs-target="#tab-vendas">
                            <i class="fas fa-shopping-cart"></i> Vendas
                        </button>
                    </li>
                    <li class="nav-item">
                        <button class="nav-link" data-bs-toggle="tab" data-bs-target="#tab-notificacoes">
                            <i class="fas fa-bell"></i> Notificações
                        </button>
                    </li>
                </ul>
                
                <!-- Conteúdo das Tabs -->
                <div class="tab-content mt-3" id="configTabsContent">
                    <!-- Conteúdo será preenchido dinamicamente -->
                </div>
            </div>
            <div class="modal-footer">
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">
                    <i class="fas fa-times"></i> Cancelar
                </button>
                <button type="button" class="btn btn-primary" onclick="salvarConfiguracoes()">
                    <i class="fas fa-save"></i> Salvar Alterações
                </button>
            </div>
        </div>
    </div>
</div>
```

4. **JavaScript - Lógica do Modal:**
```javascript
// public/js/configuracoes.js

let configuracoesOriginais = {};
let configuracoesAtuais = {};

// Abrir modal e carregar configurações
async function abrirModalConfiguracoes() {
    try {
        const response = await fetch('/api/configuracoes', {
            headers: {
                'Authorization': `Bearer ${getToken()}`
            }
        });
        
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.message);
        }
        
        configuracoesOriginais = JSON.parse(JSON.stringify(data.configuracoes));
        configuracoesAtuais = data.configuracoes;
        
        renderizarConfiguracoes(data.configuracoes);
        
        const modal = new bootstrap.Modal(document.getElementById('modalConfiguracoes'));
        modal.show();
        
    } catch (error) {
        console.error('Erro ao carregar configurações:', error);
        mostrarNotificacao('Erro ao carregar configurações', 'error');
    }
}

// Renderizar configurações nas tabs
function renderizarConfiguracoes(configs) {
    const tabContent = document.getElementById('configTabsContent');
    
    const categorias = {
        'empresa': 'Empresa',
        'sistema': 'Sistema',
        'email': 'E-mail',
        'fiscal': 'Fiscal',
        'financeiro': 'Financeiro',
        'vendas': 'Vendas',
        'notificacoes': 'Notificações'
    };
    
    let html = '';
    
    Object.entries(categorias).forEach(([categoria, titulo], index) => {
        const configsCategoria = configs[categoria] || [];
        
        html += `
            <div class="tab-pane fade ${index === 0 ? 'show active' : ''}" 
                 id="tab-${categoria}" 
                 role="tabpanel">
                <div class="config-section">
                    <h6 class="mb-3">${titulo}</h6>
                    ${renderizarCamposCategoria(configsCategoria, categoria)}
                </div>
            </div>
        `;
    });
    
    tabContent.innerHTML = html;
}

// Renderizar campos de uma categoria
function renderizarCamposCategoria(configs, categoria) {
    if (configs.length === 0) {
        return '<p class="text-muted">Nenhuma configuração disponível nesta categoria.</p>';
    }
    
    return configs.map(config => {
        const inputId = `config-${config.chave}`;
        let inputHtml = '';
        
        switch (config.tipo) {
            case 'boolean':
                inputHtml = `
                    <div class="form-check form-switch">
                        <input class="form-check-input" 
                               type="checkbox" 
                               id="${inputId}"
                               data-chave="${config.chave}"
                               ${config.valor ? 'checked' : ''}
                               onchange="atualizarConfiguracao('${config.chave}', this.checked)">
                        <label class="form-check-label" for="${inputId}">
                            ${config.descricao}
                        </label>
                    </div>
                `;
                break;
                
            case 'number':
                inputHtml = `
                    <label for="${inputId}" class="form-label">${config.descricao}</label>
                    <input type="number" 
                           class="form-control" 
                           id="${inputId}"
                           data-chave="${config.chave}"
                           value="${config.valor}"
                           onchange="atualizarConfiguracao('${config.chave}', this.value)">
                `;
                break;
                
            default: // string
                const isPassword = config.chave.includes('password') || config.chave.includes('senha');
                inputHtml = `
                    <label for="${inputId}" class="form-label">${config.descricao}</label>
                    <input type="${isPassword ? 'password' : 'text'}" 
                           class="form-control" 
                           id="${inputId}"
                           data-chave="${config.chave}"
                           value="${config.valor || ''}"
                           onchange="atualizarConfiguracao('${config.chave}', this.value)">
                `;
        }
        
        return `
            <div class="mb-3">
                ${inputHtml}
                ${config.chave === 'email_smtp_host' ? `
                    <button class="btn btn-sm btn-outline-primary mt-2" onclick="testarEmail()">
                        <i class="fas fa-paper-plane"></i> Testar Envio
                    </button>
                ` : ''}
            </div>
        `;
    }).join('');
}

// Atualizar configuração no objeto local
function atualizarConfiguracao(chave, valor) {
    const categoria = chave.split('_')[0];
    
    if (configuracoesAtuais[categoria]) {
        const config = configuracoesAtuais[categoria].find(c => c.chave === chave);
        if (config) {
            config.valor = valor;
        }
    }
}

// Salvar todas as configurações
async function salvarConfiguracoes() {
    try {
        // Coletar todas as configurações alteradas
        const configsParaAtualizar = [];
        
        Object.values(configuracoesAtuais).forEach(categoria => {
            categoria.forEach(config => {
                configsParaAtualizar.push({
                    chave: config.chave,
                    valor: String(config.valor)
                });
            });
        });
        
        const response = await fetch('/api/configuracoes/bulk-update', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getToken()}`
            },
            body: JSON.stringify({
                configuracoes: configsParaAtualizar
            })
        });
        
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.message);
        }
        
        mostrarNotificacao('Configurações salvas com sucesso!', 'success');
        
        // Fechar modal
        const modal = bootstrap.Modal.getInstance(document.getElementById('modalConfiguracoes'));
        modal.hide();
        
        // Recarregar página para aplicar mudanças
        setTimeout(() => {
            location.reload();
        }, 1000);
        
    } catch (error) {
        console.error('Erro ao salvar configurações:', error);
        mostrarNotificacao('Erro ao salvar configurações', 'error');
    }
}

// Testar envio de e-mail
async function testarEmail() {
    const email = prompt('Digite o e-mail de destino para teste:');
    
    if (!email) return;
    
    try {
        const response = await fetch('/api/configuracoes/testar-email', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getToken()}`
            },
            body: JSON.stringify({
                email_destino: email
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            mostrarNotificacao('E-mail de teste enviado! Verifique a caixa de entrada.', 'success');
        } else {
            mostrarNotificacao(`Erro: ${data.message}`, 'error');
        }
        
    } catch (error) {
        console.error('Erro ao testar e-mail:', error);
        mostrarNotificacao('Erro ao enviar e-mail de teste', 'error');
    }
}
```

**Validação do Modal:**
- [ ] Modal abre sem erros
- [ ] Todas as tabs carregam corretamente
- [ ] Campos são preenchidos com valores do banco
- [ ] Alterações são salvas corretamente
- [ ] Validação de tipos (number, boolean, string)
- [ ] Teste de e-mail funciona
- [ ] Auditoria registra alterações
- [ ] Página recarrega após salvar
- [ ] Mensagens de erro/sucesso aparecem



---

## 📦 PARTE 3: ANÁLISE E CORREÇÃO DO MÓDULO FATURAMENTO

### 3.1 VERIFICAÇÃO COMPLETA DO MÓDULO

**Tarefa:** Analisar e corrigir todos os componentes do módulo de faturamento.

**Arquivos a Analisar:**
- `modules/Faturamento/` (estrutura completa)
- `modules/Faturamento/public/pages/faturamento.html`
- `modules/Faturamento/public/js/faturamento.js`
- `modules/Faturamento/api/` ou rotas em `server.js`
- Tabelas: `faturamento`, `notas_fiscais`, `pedidos`

### 3.2 CHECKLIST DE FUNCIONALIDADES

#### ✅ 1. Listagem de Pedidos Pendentes de Faturamento

**Verificar:**
```javascript
// Endpoint deve retornar pedidos aprovados mas não faturados
app.get('/api/faturamento/pedidos-pendentes', authenticateToken, async (req, res) => {
    try {
        const [pedidos] = await pool.query(`
            SELECT 
                p.id,
                p.numero_pedido,
                p.data_pedido,
                c.nome as cliente_nome,
                c.cnpj as cliente_cnpj,
                c.endereco as cliente_endereco,
                c.cidade as cliente_cidade,
                c.uf as cliente_uf,
                p.valor_total,
                p.valor_produtos,
                p.valor_frete,
                p.valor_desconto,
                p.observacoes,
                u.nome as vendedor_nome,
                (SELECT COUNT(*) FROM pedido_itens WHERE pedido_id = p.id) as total_itens,
                DATEDIFF(CURDATE(), p.data_pedido) as dias_pendente
            FROM pedidos p
            INNER JOIN clientes c ON p.cliente_id = c.id
            LEFT JOIN usuarios u ON p.vendedor_id = u.id
            WHERE p.status = 'aprovado'
            AND p.faturado = FALSE
            AND p.deleted_at IS NULL
            ORDER BY p.data_pedido ASC
        `);
        
        res.json({
            success: true,
            pedidos: pedidos,
            total: pedidos.length
        });
        
    } catch (error) {
        console.error('Erro ao buscar pedidos pendentes:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao carregar pedidos pendentes'
        });
    }
});
```

**Validar:**
- [ ] Apenas pedidos aprovados aparecem
- [ ] Pedidos já faturados não aparecem
- [ ] Dados do cliente completos
- [ ] Valor total calculado corretamente
- [ ] Ordenação por data (mais antigos primeiro)

#### ✅ 2. Visualizar Detalhes do Pedido

**Verificar:**
```javascript
app.get('/api/faturamento/pedido/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        
        // Dados do pedido
        const [pedido] = await pool.query(`
            SELECT 
                p.*,
                c.nome as cliente_nome,
                c.cnpj as cliente_cnpj,
                c.ie as cliente_ie,
                c.endereco as cliente_endereco,
                c.numero as cliente_numero,
                c.complemento as cliente_complemento,
                c.bairro as cliente_bairro,
                c.cidade as cliente_cidade,
                c.uf as cliente_uf,
                c.cep as cliente_cep,
                c.telefone as cliente_telefone,
                c.email as cliente_email,
                u.nome as vendedor_nome
            FROM pedidos p
            INNER JOIN clientes c ON p.cliente_id = c.id
            LEFT JOIN usuarios u ON p.vendedor_id = u.id
            WHERE p.id = ?
            AND p.deleted_at IS NULL
        `, [id]);
        
        if (pedido.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Pedido não encontrado'
            });
        }
        
        // Itens do pedido
        const [itens] = await pool.query(`
            SELECT 
                pi.*,
                pr.codigo as produto_codigo,
                pr.descricao as produto_descricao,
                pr.unidade as produto_unidade,
                pr.ncm as produto_ncm,
                pr.cfop as produto_cfop,
                pr.cst_icms as produto_cst_icms,
                pr.aliquota_icms as produto_aliquota_icms
            FROM pedido_itens pi
            INNER JOIN produtos pr ON pi.produto_id = pr.id
            WHERE pi.pedido_id = ?
            ORDER BY pi.item_numero
        `, [id]);
        
        res.json({
            success: true,
            pedido: pedido[0],
            itens: itens
        });
        
    } catch (error) {
        console.error('Erro ao buscar detalhes do pedido:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao carregar detalhes do pedido'
        });
    }
});
```

**Validar:**
- [ ] Todos os dados do cliente carregam
- [ ] Itens do pedido aparecem completos
- [ ] Informações fiscais dos produtos presentes
- [ ] Cálculos de impostos corretos

#### ✅ 3. Gerar Nota Fiscal

**Verificar:**
```javascript
app.post('/api/faturamento/gerar-nfe', authenticateToken, authorizeAction('faturamento', 'emitir'), async (req, res) => {
    try {
        const { pedido_id, natureza_operacao, tipo_frete, transportadora_id } = req.body;
        
        // Validações
        if (!pedido_id) {
            return res.status(400).json({
                success: false,
                message: 'ID do pedido é obrigatório'
            });
        }
        
        // Buscar pedido
        const [pedido] = await pool.query(
            'SELECT * FROM pedidos WHERE id = ? AND status = ? AND faturado = FALSE',
            [pedido_id, 'aprovado']
        );
        
        if (pedido.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Pedido não encontrado ou já faturado'
            });
        }
        
        // Buscar configurações NFe
        const [configs] = await pool.query(`
            SELECT chave, valor 
            FROM configuracoes_sistema 
            WHERE chave LIKE 'nfe_%' OR chave LIKE 'empresa_%'
        `);
        
        const nfeConfig = {};
        configs.forEach(c => {
            nfeConfig[c.chave] = c.valor;
        });
        
        // Buscar próximo número de NFe
        const numeroNFe = parseInt(nfeConfig.nfe_numero_atual || 1);
        const serieNFe = parseInt(nfeConfig.nfe_serie || 1);
        
        const connection = await pool.getConnection();
        await connection.beginTransaction();
        
        try {
            // Criar registro de nota fiscal
            const [resultNFe] = await connection.query(`
                INSERT INTO notas_fiscais (
                    pedido_id,
                    numero,
                    serie,
                    modelo,
                    natureza_operacao,
                    tipo_frete,
                    transportadora_id,
                    valor_total,
                    valor_produtos,
                    valor_frete,
                    valor_desconto,
                    base_calculo_icms,
                    valor_icms,
                    base_calculo_st,
                    valor_st,
                    valor_ipi,
                    valor_pis,
                    valor_cofins,
                    status,
                    ambiente,
                    usuario_emissao_id,
                    data_emissao,
                    created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
            `, [
                pedido_id,
                numeroNFe,
                serieNFe,
                '55', // NFe
                natureza_operacao || 'Venda de Mercadoria',
                tipo_frete || 'CIF',
                transportadora_id || null,
                pedido[0].valor_total,
                pedido[0].valor_produtos,
                pedido[0].valor_frete || 0,
                pedido[0].valor_desconto || 0,
                0, // Calcular impostos
                0,
                0,
                0,
                0,
                0,
                0,
                'pendente',
                nfeConfig.nfe_ambiente || 'homologacao',
                req.user.id
            ]);
            
            const nfeId = resultNFe.insertId;
            
            // Copiar itens do pedido para a NFe
            await connection.query(`
                INSERT INTO nota_fiscal_itens (
                    nota_fiscal_id,
                    produto_id,
                    item_numero,
                    codigo_produto,
                    descricao,
                    ncm,
                    cfop,
                    unidade,
                    quantidade,
                    valor_unitario,
                    valor_total,
                    valor_desconto,
                    cst_icms,
                    aliquota_icms,
                    base_calculo_icms,
                    valor_icms
                )
                SELECT 
                    ? as nota_fiscal_id,
                    pi.produto_id,
                    pi.item_numero,
                    pr.codigo,
                    pr.descricao,
                    pr.ncm,
                    pr.cfop,
                    pr.unidade,
                    pi.quantidade,
                    pi.preco_unitario,
                    pi.valor_total,
                    pi.valor_desconto,
                    pr.cst_icms,
                    pr.aliquota_icms,
                    (pi.valor_total * pr.aliquota_icms / 100) as base_calculo_icms,
                    (pi.valor_total * pr.aliquota_icms / 100) as valor_icms
                FROM pedido_itens pi
                INNER JOIN produtos pr ON pi.produto_id = pr.id
                WHERE pi.pedido_id = ?
            `, [nfeId, pedido_id]);
            
            // Atualizar número da NFe nas configurações
            await connection.query(
                'UPDATE configuracoes_sistema SET valor = ? WHERE chave = ?',
                [String(numeroNFe + 1), 'nfe_numero_atual']
            );
            
            // Marcar pedido como faturado
            await connection.query(
                'UPDATE pedidos SET faturado = TRUE, status = ?, data_faturamento = NOW() WHERE id = ?',
                ['faturado', pedido_id]
            );
            
            await connection.commit();
            
            // Log de auditoria
            await writeAuditLog({
                userId: req.user.id,
                action: 'GERAR_NFE',
                module: 'faturamento',
                description: `NFe ${numeroNFe}/${serieNFe} gerada para pedido ${pedido[0].numero_pedido}`,
                newData: { nfe_id: nfeId, numero: numeroNFe, serie: serieNFe },
                ip: req.ip,
                userAgent: req.headers['user-agent']
            });
            
            res.json({
                success: true,
                message: 'Nota fiscal gerada com sucesso!',
                nfe: {
                    id: nfeId,
                    numero: numeroNFe,
                    serie: serieNFe,
                    status: 'pendente'
                }
            });
            
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
        
    } catch (error) {
        console.error('Erro ao gerar NFe:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao gerar nota fiscal'
        });
    }
});
```

**Validar:**
- [ ] NFe criada com número sequencial
- [ ] Itens copiados corretamente
- [ ] Impostos calculados
- [ ] Pedido marcado como faturado
- [ ] Auditoria registrada
- [ ] Transação atômica (rollback em erro)



#### ✅ 4. Transmitir NFe para SEFAZ

**Verificar:**
```javascript
app.post('/api/faturamento/transmitir-nfe/:id', authenticateToken, authorizeAction('faturamento', 'transmitir'), async (req, res) => {
    try {
        const { id } = req.params;
        
        // Buscar NFe
        const [nfe] = await pool.query(`
            SELECT nf.*, p.*, c.*
            FROM notas_fiscais nf
            INNER JOIN pedidos p ON nf.pedido_id = p.id
            INNER JOIN clientes c ON p.cliente_id = c.id
            WHERE nf.id = ?
            AND nf.status = 'pendente'
        `, [id]);
        
        if (nfe.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'NFe não encontrada ou já transmitida'
            });
        }
        
        // Buscar itens da NFe
        const [itens] = await pool.query(`
            SELECT * FROM nota_fiscal_itens WHERE nota_fiscal_id = ?
        `, [id]);
        
        // Buscar configurações
        const [configs] = await pool.query(`
            SELECT chave, valor FROM configuracoes_sistema 
            WHERE chave LIKE 'nfe_%' OR chave LIKE 'empresa_%'
        `);
        
        const config = {};
        configs.forEach(c => config[c.chave] = c.valor);
        
        // Montar XML da NFe
        const xmlNFe = await gerarXMLNFe(nfe[0], itens, config);
        
        // Assinar XML com certificado digital
        const xmlAssinado = await assinarXML(xmlNFe, config.nfe_certificado_path, config.nfe_certificado_senha);
        
        // Transmitir para SEFAZ
        const resultado = await transmitirParaSEFAZ(xmlAssinado, config.nfe_ambiente);
        
        if (resultado.sucesso) {
            // Atualizar NFe com dados da autorização
            await pool.query(`
                UPDATE notas_fiscais SET
                    status = 'autorizada',
                    chave_acesso = ?,
                    protocolo = ?,
                    data_autorizacao = NOW(),
                    xml_enviado = ?,
                    xml_retorno = ?
                WHERE id = ?
            `, [
                resultado.chave_acesso,
                resultado.protocolo,
                xmlAssinado,
                resultado.xml_retorno,
                id
            ]);
            
            // Log de auditoria
            await writeAuditLog({
                userId: req.user.id,
                action: 'TRANSMITIR_NFE',
                module: 'faturamento',
                description: `NFe ${nfe[0].numero}/${nfe[0].serie} transmitida com sucesso`,
                newData: { 
                    chave_acesso: resultado.chave_acesso,
                    protocolo: resultado.protocolo
                },
                ip: req.ip,
                userAgent: req.headers['user-agent']
            });
            
            res.json({
                success: true,
                message: 'NFe transmitida e autorizada com sucesso!',
                chave_acesso: resultado.chave_acesso,
                protocolo: resultado.protocolo
            });
            
        } else {
            // Atualizar NFe com erro
            await pool.query(`
                UPDATE notas_fiscais SET
                    status = 'rejeitada',
                    mensagem_erro = ?,
                    xml_enviado = ?,
                    xml_retorno = ?
                WHERE id = ?
            `, [
                resultado.mensagem_erro,
                xmlAssinado,
                resultado.xml_retorno,
                id
            ]);
            
            res.status(400).json({
                success: false,
                message: `NFe rejeitada: ${resultado.mensagem_erro}`
            });
        }
        
    } catch (error) {
        console.error('Erro ao transmitir NFe:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao transmitir nota fiscal'
        });
    }
});

// Funções auxiliares (implementar conforme biblioteca NFe)
async function gerarXMLNFe(nfe, itens, config) {
    // Usar biblioteca como node-nfe ou similar
    // Retornar XML da NFe
}

async function assinarXML(xml, certPath, certPassword) {
    // Assinar XML com certificado digital
    // Usar biblioteca como node-forge
}

async function transmitirParaSEFAZ(xml, ambiente) {
    // Transmitir para webservice da SEFAZ
    // Retornar resultado da transmissão
}
```

**Validar:**
- [ ] XML gerado corretamente
- [ ] Assinatura digital funciona
- [ ] Transmissão para SEFAZ
- [ ] Tratamento de erros da SEFAZ
- [ ] Chave de acesso salva
- [ ] Status atualizado corretamente

#### ✅ 5. Cancelar NFe

**Verificar:**
```javascript
app.post('/api/faturamento/cancelar-nfe/:id', authenticateToken, authorizeAction('faturamento', 'cancelar'), async (req, res) => {
    try {
        const { id } = req.params;
        const { justificativa } = req.body;
        
        if (!justificativa || justificativa.length < 15) {
            return res.status(400).json({
                success: false,
                message: 'Justificativa deve ter no mínimo 15 caracteres'
            });
        }
        
        // Buscar NFe
        const [nfe] = await pool.query(`
            SELECT * FROM notas_fiscais 
            WHERE id = ? AND status = 'autorizada'
        `, [id]);
        
        if (nfe.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'NFe não encontrada ou não pode ser cancelada'
            });
        }
        
        // Verificar prazo de cancelamento (24h)
        const horasDesdeEmissao = (Date.now() - new Date(nfe[0].data_autorizacao).getTime()) / (1000 * 60 * 60);
        
        if (horasDesdeEmissao > 24) {
            return res.status(400).json({
                success: false,
                message: 'NFe não pode ser cancelada após 24 horas da autorização'
            });
        }
        
        // Enviar cancelamento para SEFAZ
        const resultado = await cancelarNFeSEFAZ(nfe[0].chave_acesso, justificativa);
        
        if (resultado.sucesso) {
            await pool.query(`
                UPDATE notas_fiscais SET
                    status = 'cancelada',
                    data_cancelamento = NOW(),
                    justificativa_cancelamento = ?,
                    protocolo_cancelamento = ?
                WHERE id = ?
            `, [justificativa, resultado.protocolo, id]);
            
            // Desmarcar pedido como faturado
            await pool.query(
                'UPDATE pedidos SET faturado = FALSE, status = ? WHERE id = ?',
                ['aprovado', nfe[0].pedido_id]
            );
            
            // Log de auditoria
            await writeAuditLog({
                userId: req.user.id,
                action: 'CANCELAR_NFE',
                module: 'faturamento',
                description: `NFe ${nfe[0].numero}/${nfe[0].serie} cancelada`,
                previousData: { status: 'autorizada' },
                newData: { status: 'cancelada', justificativa },
                ip: req.ip,
                userAgent: req.headers['user-agent']
            });
            
            res.json({
                success: true,
                message: 'NFe cancelada com sucesso!'
            });
            
        } else {
            res.status(400).json({
                success: false,
                message: `Erro ao cancelar NFe: ${resultado.mensagem_erro}`
            });
        }
        
    } catch (error) {
        console.error('Erro ao cancelar NFe:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao cancelar nota fiscal'
        });
    }
});
```

**Validar:**
- [ ] Justificativa obrigatória (mín 15 caracteres)
- [ ] Prazo de 24h respeitado
- [ ] Cancelamento enviado para SEFAZ
- [ ] Pedido volta para status aprovado
- [ ] Auditoria registrada

#### ✅ 6. Imprimir DANFE

**Verificar:**
```javascript
app.get('/api/faturamento/danfe/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        
        // Buscar NFe completa
        const [nfe] = await pool.query(`
            SELECT nf.*, p.*, c.*, e.* as empresa
            FROM notas_fiscais nf
            INNER JOIN pedidos p ON nf.pedido_id = p.id
            INNER JOIN clientes c ON p.cliente_id = c.id
            CROSS JOIN (
                SELECT 
                    MAX(CASE WHEN chave = 'empresa_nome' THEN valor END) as nome,
                    MAX(CASE WHEN chave = 'empresa_cnpj' THEN valor END) as cnpj,
                    MAX(CASE WHEN chave = 'empresa_ie' THEN valor END) as ie,
                    MAX(CASE WHEN chave = 'empresa_endereco' THEN valor END) as endereco
                FROM configuracoes_sistema
                WHERE chave LIKE 'empresa_%'
            ) e
            WHERE nf.id = ?
        `, [id]);
        
        if (nfe.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'NFe não encontrada'
            });
        }
        
        // Buscar itens
        const [itens] = await pool.query(`
            SELECT * FROM nota_fiscal_itens WHERE nota_fiscal_id = ?
        `, [id]);
        
        // Gerar PDF do DANFE
        const pdfBuffer = await gerarDANFE(nfe[0], itens);
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="DANFE-${nfe[0].numero}.pdf"`);
        res.send(pdfBuffer);
        
    } catch (error) {
        console.error('Erro ao gerar DANFE:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao gerar DANFE'
        });
    }
});

async function gerarDANFE(nfe, itens) {
    // Usar biblioteca como pdfkit ou danfe
    // Retornar buffer do PDF
}
```

**Validar:**
- [ ] PDF gerado corretamente
- [ ] Layout DANFE padrão
- [ ] Código de barras da chave de acesso
- [ ] QR Code (para NFCe)
- [ ] Todas as informações presentes



### 3.3 ESTRUTURA DO BANCO DE DADOS - FATURAMENTO

**Verificar se as tabelas existem e estão corretas:**

```sql
-- Tabela de Notas Fiscais
CREATE TABLE IF NOT EXISTS notas_fiscais (
    id INT AUTO_INCREMENT PRIMARY KEY,
    pedido_id INT NOT NULL,
    numero INT NOT NULL,
    serie INT NOT NULL DEFAULT 1,
    modelo VARCHAR(2) DEFAULT '55',
    chave_acesso VARCHAR(44),
    protocolo VARCHAR(20),
    natureza_operacao VARCHAR(100),
    tipo_frete ENUM('CIF', 'FOB', 'SEM_FRETE') DEFAULT 'CIF',
    transportadora_id INT,
    
    -- Valores
    valor_total DECIMAL(15,2) NOT NULL,
    valor_produtos DECIMAL(15,2) NOT NULL,
    valor_frete DECIMAL(15,2) DEFAULT 0,
    valor_desconto DECIMAL(15,2) DEFAULT 0,
    valor_outras_despesas DECIMAL(15,2) DEFAULT 0,
    
    -- Impostos
    base_calculo_icms DECIMAL(15,2) DEFAULT 0,
    valor_icms DECIMAL(15,2) DEFAULT 0,
    base_calculo_st DECIMAL(15,2) DEFAULT 0,
    valor_st DECIMAL(15,2) DEFAULT 0,
    valor_ipi DECIMAL(15,2) DEFAULT 0,
    valor_pis DECIMAL(15,2) DEFAULT 0,
    valor_cofins DECIMAL(15,2) DEFAULT 0,
    
    -- Status e controle
    status ENUM('pendente', 'autorizada', 'rejeitada', 'cancelada', 'denegada') DEFAULT 'pendente',
    ambiente ENUM('producao', 'homologacao') DEFAULT 'homologacao',
    mensagem_erro TEXT,
    
    -- XMLs
    xml_enviado LONGTEXT,
    xml_retorno LONGTEXT,
    
    -- Cancelamento
    data_cancelamento DATETIME,
    justificativa_cancelamento TEXT,
    protocolo_cancelamento VARCHAR(20),
    
    -- Auditoria
    usuario_emissao_id INT,
    data_emissao DATETIME,
    data_autorizacao DATETIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL,
    
    FOREIGN KEY (pedido_id) REFERENCES pedidos(id),
    FOREIGN KEY (transportadora_id) REFERENCES transportadoras(id),
    FOREIGN KEY (usuario_emissao_id) REFERENCES usuarios(id),
    
    UNIQUE KEY uk_numero_serie (numero, serie, deleted_at),
    INDEX idx_chave_acesso (chave_acesso),
    INDEX idx_status (status),
    INDEX idx_data_emissao (data_emissao)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabela de Itens da Nota Fiscal
CREATE TABLE IF NOT EXISTS nota_fiscal_itens (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nota_fiscal_id INT NOT NULL,
    produto_id INT NOT NULL,
    item_numero INT NOT NULL,
    
    -- Produto
    codigo_produto VARCHAR(50),
    descricao VARCHAR(255) NOT NULL,
    ncm VARCHAR(8),
    cfop VARCHAR(4),
    unidade VARCHAR(6),
    
    -- Quantidades e valores
    quantidade DECIMAL(15,4) NOT NULL,
    valor_unitario DECIMAL(15,4) NOT NULL,
    valor_total DECIMAL(15,2) NOT NULL,
    valor_desconto DECIMAL(15,2) DEFAULT 0,
    valor_frete DECIMAL(15,2) DEFAULT 0,
    valor_outras_despesas DECIMAL(15,2) DEFAULT 0,
    
    -- ICMS
    cst_icms VARCHAR(3),
    aliquota_icms DECIMAL(5,2) DEFAULT 0,
    base_calculo_icms DECIMAL(15,2) DEFAULT 0,
    valor_icms DECIMAL(15,2) DEFAULT 0,
    
    -- ICMS ST
    aliquota_st DECIMAL(5,2) DEFAULT 0,
    base_calculo_st DECIMAL(15,2) DEFAULT 0,
    valor_st DECIMAL(15,2) DEFAULT 0,
    
    -- IPI
    cst_ipi VARCHAR(2),
    aliquota_ipi DECIMAL(5,2) DEFAULT 0,
    valor_ipi DECIMAL(15,2) DEFAULT 0,
    
    -- PIS
    cst_pis VARCHAR(2),
    aliquota_pis DECIMAL(5,2) DEFAULT 0,
    valor_pis DECIMAL(15,2) DEFAULT 0,
    
    -- COFINS
    cst_cofins VARCHAR(2),
    aliquota_cofins DECIMAL(5,2) DEFAULT 0,
    valor_cofins DECIMAL(15,2) DEFAULT 0,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (nota_fiscal_id) REFERENCES notas_fiscais(id) ON DELETE CASCADE,
    FOREIGN KEY (produto_id) REFERENCES produtos(id),
    
    INDEX idx_nota_fiscal (nota_fiscal_id),
    INDEX idx_produto (produto_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabela de Transportadoras
CREATE TABLE IF NOT EXISTS transportadoras (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(255) NOT NULL,
    razao_social VARCHAR(255),
    cnpj VARCHAR(18),
    ie VARCHAR(20),
    endereco VARCHAR(255),
    numero VARCHAR(20),
    complemento VARCHAR(100),
    bairro VARCHAR(100),
    cidade VARCHAR(100),
    uf VARCHAR(2),
    cep VARCHAR(10),
    telefone VARCHAR(20),
    email VARCHAR(255),
    ativo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL,
    
    INDEX idx_cnpj (cnpj),
    INDEX idx_ativo (ativo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 3.4 FRONTEND - INTERFACE DE FATURAMENTO

**Verificar arquivo:** `modules/Faturamento/public/pages/faturamento.html`

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Faturamento - Zyntra ERP</title>
    <link rel="stylesheet" href="/css/style.css">
    <link rel="stylesheet" href="/modules/Faturamento/public/css/faturamento.css">
</head>
<body>
    <div class="container-fluid">
        <div class="page-header">
            <h1><i class="fas fa-file-invoice"></i> Faturamento</h1>
            <div class="page-actions">
                <button class="btn btn-primary" onclick="atualizarLista()">
                    <i class="fas fa-sync"></i> Atualizar
                </button>
            </div>
        </div>
        
        <!-- Filtros -->
        <div class="card mb-3">
            <div class="card-body">
                <div class="row">
                    <div class="col-md-3">
                        <label>Período</label>
                        <select class="form-control" id="filtro-periodo" onchange="aplicarFiltros()">
                            <option value="7">Últimos 7 dias</option>
                            <option value="15">Últimos 15 dias</option>
                            <option value="30" selected>Últimos 30 dias</option>
                            <option value="60">Últimos 60 dias</option>
                            <option value="90">Últimos 90 dias</option>
                        </select>
                    </div>
                    <div class="col-md-3">
                        <label>Status</label>
                        <select class="form-control" id="filtro-status" onchange="aplicarFiltros()">
                            <option value="">Todos</option>
                            <option value="pendente" selected>Pendentes</option>
                            <option value="autorizada">Autorizadas</option>
                            <option value="cancelada">Canceladas</option>
                        </select>
                    </div>
                    <div class="col-md-6">
                        <label>Buscar</label>
                        <input type="text" class="form-control" id="filtro-busca" 
                               placeholder="Número do pedido, cliente, CNPJ..."
                               onkeyup="aplicarFiltros()">
                    </div>
                </div>
            </div>
        </div>
        
        <!-- Resumo -->
        <div class="row mb-3">
            <div class="col-md-3">
                <div class="card card-stat">
                    <div class="card-body">
                        <div class="stat-icon bg-warning">
                            <i class="fas fa-clock"></i>
                        </div>
                        <div class="stat-content">
                            <div class="stat-label">Pendentes</div>
                            <div class="stat-value" id="total-pendentes">0</div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="col-md-3">
                <div class="card card-stat">
                    <div class="card-body">
                        <div class="stat-icon bg-success">
                            <i class="fas fa-check"></i>
                        </div>
                        <div class="stat-content">
                            <div class="stat-label">Autorizadas Hoje</div>
                            <div class="stat-value" id="total-autorizadas-hoje">0</div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="col-md-3">
                <div class="card card-stat">
                    <div class="card-body">
                        <div class="stat-icon bg-info">
                            <i class="fas fa-dollar-sign"></i>
                        </div>
                        <div class="stat-content">
                            <div class="stat-label">Valor Faturado Hoje</div>
                            <div class="stat-value" id="valor-faturado-hoje">R$ 0,00</div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="col-md-3">
                <div class="card card-stat">
                    <div class="card-body">
                        <div class="stat-icon bg-primary">
                            <i class="fas fa-file-invoice"></i>
                        </div>
                        <div class="stat-content">
                            <div class="stat-label">Total Mês</div>
                            <div class="stat-value" id="total-mes">0</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- Lista de Pedidos Pendentes -->
        <div class="card">
            <div class="card-header">
                <h5>Pedidos Pendentes de Faturamento</h5>
            </div>
            <div class="card-body">
                <div class="table-responsive">
                    <table class="table table-hover" id="tabela-pedidos">
                        <thead>
                            <tr>
                                <th>Pedido</th>
                                <th>Data</th>
                                <th>Cliente</th>
                                <th>CNPJ</th>
                                <th>Valor Total</th>
                                <th>Itens</th>
                                <th>Dias Pendente</th>
                                <th>Ações</th>
                            </tr>
                        </thead>
                        <tbody id="lista-pedidos">
                            <tr>
                                <td colspan="8" class="text-center">
                                    <div class="spinner-border" role="status">
                                        <span class="visually-hidden">Carregando...</span>
                                    </div>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    </div>
    
    <!-- Modal de Detalhes do Pedido -->
    <div class="modal fade" id="modalDetalhesPedido" tabindex="-1">
        <!-- Conteúdo do modal -->
    </div>
    
    <!-- Modal de Gerar NFe -->
    <div class="modal fade" id="modalGerarNFe" tabindex="-1">
        <!-- Formulário de geração de NFe -->
    </div>
    
    <script src="/js/utils.js"></script>
    <script src="/modules/Faturamento/public/js/faturamento.js"></script>
</body>
</html>
```

**Validar:**
- [ ] Layout responsivo
- [ ] Filtros funcionam
- [ ] Tabela carrega dados
- [ ] Ações (ver, faturar) funcionam
- [ ] Modais abrem corretamente
- [ ] Estatísticas atualizadas



---

## 🧪 PARTE 4: TESTES E VALIDAÇÃO

### 4.1 CHECKLIST DE TESTES - DASHBOARD

**Testar manualmente:**

- [ ] **Remover Metas do Mês**
  - [ ] Widget não aparece mais
  - [ ] Sem erros no console
  - [ ] Layout permanece organizado

- [ ] **Pedidos Recentes**
  - [ ] Exibe pedidos reais do banco
  - [ ] Formatação de valores correta
  - [ ] Status exibidos corretamente
  - [ ] Link para detalhes funciona
  - [ ] Atualiza ao recarregar

- [ ] **Fluxo Financeiro**
  - [ ] Saldo atual correto
  - [ ] Contas a receber somadas
  - [ ] Contas a pagar somadas
  - [ ] Títulos vencidos destacados
  - [ ] Projeção 7 dias calculada
  - [ ] Cores indicam positivo/negativo

### 4.2 CHECKLIST DE TESTES - MODAL CONFIGURAÇÕES

- [ ] **Abertura do Modal**
  - [ ] Modal abre sem erros
  - [ ] Todas as tabs carregam
  - [ ] Campos preenchidos com valores do banco

- [ ] **Edição de Configurações**
  - [ ] Campos de texto editáveis
  - [ ] Campos numéricos validados
  - [ ] Switches funcionam
  - [ ] Senhas ocultas

- [ ] **Salvamento**
  - [ ] Salvar atualiza banco de dados
  - [ ] Mensagem de sucesso aparece
  - [ ] Página recarrega após salvar
  - [ ] Auditoria registrada

- [ ] **Teste de E-mail**
  - [ ] Botão "Testar Envio" funciona
  - [ ] E-mail é enviado
  - [ ] Mensagem de sucesso/erro apropriada

### 4.3 CHECKLIST DE TESTES - FATURAMENTO

- [ ] **Listagem de Pedidos**
  - [ ] Apenas pedidos aprovados aparecem
  - [ ] Pedidos já faturados não aparecem
  - [ ] Filtros funcionam
  - [ ] Busca funciona
  - [ ] Ordenação correta

- [ ] **Visualizar Detalhes**
  - [ ] Modal abre com dados completos
  - [ ] Itens do pedido aparecem
  - [ ] Valores calculados corretamente

- [ ] **Gerar NFe**
  - [ ] Formulário de geração abre
  - [ ] Campos obrigatórios validados
  - [ ] NFe criada no banco
  - [ ] Número sequencial correto
  - [ ] Pedido marcado como faturado

- [ ] **Transmitir NFe**
  - [ ] XML gerado corretamente
  - [ ] Assinatura digital funciona
  - [ ] Transmissão para SEFAZ
  - [ ] Chave de acesso salva
  - [ ] Status atualizado

- [ ] **Cancelar NFe**
  - [ ] Justificativa obrigatória
  - [ ] Prazo de 24h respeitado
  - [ ] Cancelamento enviado
  - [ ] Pedido volta para aprovado

- [ ] **Imprimir DANFE**
  - [ ] PDF gerado
  - [ ] Layout correto
  - [ ] Todas as informações presentes

---

## 📝 PARTE 5: DOCUMENTAÇÃO DAS CORREÇÕES

### 5.1 CRIAR ARQUIVO DE CHANGELOG

Após realizar as correções, documentar em:

```markdown
# CHANGELOG - Correções Dashboard e Faturamento

## Data: [DATA]

### Dashboard

#### Removido
- Widget "Metas do Mês" removido completamente
  - Arquivos alterados: dashboard.html, dashboard.js
  - Rotas removidas: /api/dashboard/metas

#### Corrigido
- **Pedidos Recentes**: Agora exibe dados reais do banco de dados
  - Endpoint: GET /api/dashboard/pedidos-recentes
  - Formatação de valores monetários corrigida
  - Status dos pedidos exibidos corretamente

- **Fluxo Financeiro**: Dados reais de contas a pagar e receber
  - Endpoint: GET /api/dashboard/fluxo-financeiro
  - Cálculo de projeção 7 dias implementado
  - Alertas para contas vencidas

### Modal de Configurações

#### Implementado
- Sistema completo de configurações
  - Tabela: configuracoes_sistema
  - Endpoints: GET /api/configuracoes, PUT /api/configuracoes/:chave
  - Categorias: Empresa, Sistema, E-mail, Fiscal, Financeiro, Vendas, Notificações
  - Teste de envio de e-mail SMTP

### Módulo Faturamento

#### Corrigido
- Listagem de pedidos pendentes
- Visualização de detalhes do pedido
- Geração de NFe com número sequencial
- Transmissão para SEFAZ
- Cancelamento de NFe
- Impressão de DANFE

#### Tabelas Criadas
- notas_fiscais
- nota_fiscal_itens
- transportadoras

### Testes Realizados
- [x] Dashboard carrega sem erros
- [x] Pedidos recentes exibem dados reais
- [x] Fluxo financeiro calculado corretamente
- [x] Modal de configurações funciona
- [x] Faturamento lista pedidos pendentes
- [x] NFe gerada com sucesso
- [x] DANFE impresso corretamente
```

### 5.2 CRIAR GUIA DE USO

```markdown
# Guia de Uso - Dashboard e Faturamento

## Dashboard

### Pedidos Recentes
- Exibe os 10 pedidos mais recentes
- Clique em "Ver Detalhes" para abrir o pedido completo
- Atualiza automaticamente a cada 5 minutos

### Fluxo Financeiro
- **Saldo Atual**: Saldo em caixa no momento
- **A Receber**: Títulos pendentes não vencidos
- **Vencidos**: Títulos em atraso (vermelho)
- **Projeção 7 dias**: Previsão de saldo para próxima semana

## Configurações do Sistema

### Como Acessar
1. Clique no ícone de engrenagem no menu superior
2. Ou acesse: Menu > Configurações > Sistema

### Categorias Disponíveis
- **Empresa**: Dados cadastrais da empresa
- **Sistema**: Configurações gerais
- **E-mail**: Servidor SMTP para envio de e-mails
- **Fiscal**: Configurações de NFe
- **Financeiro**: Parâmetros financeiros
- **Vendas**: Regras de vendas
- **Notificações**: Canais de notificação

### Testar E-mail
1. Configure o servidor SMTP
2. Clique em "Testar Envio"
3. Digite um e-mail de destino
4. Verifique a caixa de entrada

## Faturamento

### Faturar um Pedido
1. Acesse: Menu > Faturamento
2. Localize o pedido na lista de pendentes
3. Clique em "Faturar"
4. Preencha os dados da NFe:
   - Natureza da operação
   - Tipo de frete
   - Transportadora (opcional)
5. Clique em "Gerar NFe"
6. Aguarde a geração
7. Clique em "Transmitir" para enviar à SEFAZ

### Cancelar NFe
1. Localize a NFe autorizada
2. Clique em "Cancelar"
3. Digite a justificativa (mín. 15 caracteres)
4. Confirme o cancelamento
5. **Atenção**: Só pode cancelar em até 24h da emissão

### Imprimir DANFE
1. Localize a NFe autorizada
2. Clique em "Imprimir DANFE"
3. O PDF será aberto em nova aba
```

---

## ✅ CONCLUSÃO

Este prompt fornece um guia completo para:

1. ✅ **Remover** o widget "Metas do Mês" do dashboard
2. ✅ **Corrigir** "Pedidos Recentes" para usar dados reais
3. ✅ **Corrigir** "Fluxo Financeiro" para usar dados reais
4. ✅ **Implementar** modal de configurações 100% funcional
5. ✅ **Analisar e corrigir** módulo de Faturamento completo

### Próximos Passos

1. Executar as correções seguindo este guia
2. Testar cada funcionalidade conforme checklists
3. Documentar as alterações no CHANGELOG
4. Criar guia de uso para usuários finais
5. Fazer backup do banco antes de aplicar migrações
6. Testar em ambiente de homologação primeiro

### Suporte

Se encontrar problemas durante a implementação:
- Verifique os logs do servidor
- Confirme que as tabelas do banco existem
- Valide as permissões de usuário
- Teste os endpoints via Postman/Insomnia

---

**Autor:** Senior Software Engineer  
**Data:** Maio 2026  
**Versão:** 1.0
