#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script Simplificado para Gerar SQL de Contas a Pagar
Sistema: ALUFORCE v2.0 - Módulo Financeiro
"""

import os
import re
from datetime import datetime

def generate_contas_pagar_sql():
    """
    Gera script SQL para tabela de contas a pagar
    baseado em estrutura padrão de sistemas financeiros
    """
    
    # Script SQL completo
    sql_script = f"""-- =====================================================
-- ALUFORCE v2.0 - Sistema Financeiro
-- Script de Criação: Contas a Pagar
-- Gerado em: {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}
-- =====================================================

-- Criar tabela de contas a pagar
CREATE TABLE IF NOT EXISTS contas_pagar (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo VARCHAR(20) UNIQUE,
    fornecedor_id INTEGER,
    fornecedor_nome VARCHAR(255) NOT NULL,
    fornecedor_cnpj VARCHAR(18),
    descricao TEXT NOT NULL,
    numero_documento VARCHAR(50),
    data_emissao DATE,
    data_vencimento DATE NOT NULL,
    data_pagamento DATE,
    valor_original DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    valor_pago DECIMAL(15,2) DEFAULT 0.00,
    valor_desconto DECIMAL(15,2) DEFAULT 0.00,
    valor_juros DECIMAL(15,2) DEFAULT 0.00,
    valor_multa DECIMAL(15,2) DEFAULT 0.00,
    valor_total DECIMAL(15,2) GENERATED ALWAYS AS (
        valor_original + valor_juros + valor_multa - valor_desconto
    ) STORED,
    categoria VARCHAR(100) DEFAULT 'Geral',
    centro_custo VARCHAR(100),
    forma_pagamento VARCHAR(50),
    conta_bancaria VARCHAR(100),
    status VARCHAR(20) DEFAULT 'PENDENTE' CHECK (
        status IN ('PENDENTE', 'VENCIDA', 'PAGA', 'CANCELADA', 'PARCIAL')
    ),
    observacoes TEXT,
    tags VARCHAR(500),
    usuario_criacao VARCHAR(100),
    usuario_pagamento VARCHAR(100),
    data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP,
    data_atualizacao DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    CONSTRAINT chk_valor_original CHECK (valor_original >= 0),
    CONSTRAINT chk_valor_pago CHECK (valor_pago >= 0),
    CONSTRAINT chk_datas CHECK (data_vencimento >= data_emissao OR data_emissao IS NULL)
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_contas_pagar_fornecedor ON contas_pagar(fornecedor_nome);
CREATE INDEX IF NOT EXISTS idx_contas_pagar_vencimento ON contas_pagar(data_vencimento);
CREATE INDEX IF NOT EXISTS idx_contas_pagar_status ON contas_pagar(status);
CREATE INDEX IF NOT EXISTS idx_contas_pagar_categoria ON contas_pagar(categoria);
CREATE INDEX IF NOT EXISTS idx_contas_pagar_documento ON contas_pagar(numero_documento);

-- Trigger para atualizar data_atualizacao
CREATE TRIGGER IF NOT EXISTS trg_contas_pagar_updated
    AFTER UPDATE ON contas_pagar
    FOR EACH ROW
BEGIN
    UPDATE contas_pagar 
    SET data_atualizacao = CURRENT_TIMESTAMP 
    WHERE id = NEW.id;
END;

-- Trigger para gerar código automático
CREATE TRIGGER IF NOT EXISTS trg_contas_pagar_codigo
    AFTER INSERT ON contas_pagar
    FOR EACH ROW
    WHEN NEW.codigo IS NULL
BEGIN
    UPDATE contas_pagar 
    SET codigo = printf('CP%06d', NEW.id)
    WHERE id = NEW.id;
END;

-- =====================================================
-- DADOS DE EXEMPLO (Remover em produção)
-- =====================================================

-- Fornecedores exemplo
INSERT OR IGNORE INTO contas_pagar (
    fornecedor_nome, fornecedor_cnpj, descricao, numero_documento,
    data_emissao, data_vencimento, valor_original, categoria,
    centro_custo, forma_pagamento, status, observacoes
) VALUES 
-- Exemplo 1: Conta de energia
(
    'ENERGISA MINAS GERAIS',
    '17.853.788/0001-95',
    'Conta de Energia Elétrica - Outubro/2025',
    'EE-2025-10-001',
    '2025-10-01',
    '2025-11-15',
    1850.75,
    'Utilidades',
    'Administração',
    'Débito Automático',
    'PENDENTE',
    'Consumo: 2.340 kWh - Unidade: Matriz'
),

-- Exemplo 2: Fornecedor de materiais
(
    'MATERIAIS INDUSTRIAIS LTDA',
    '12.345.678/0001-90',
    'Aquisição de Materiais de Produção',
    'NF-456789',
    '2025-10-15',
    '2025-11-30',
    5600.00,
    'Materiais',
    'Produção',
    'Boleto Bancário',
    'PENDENTE',
    'Pedido #PD-2025-189 - Materiais diversos'
),

-- Exemplo 3: Serviços de manutenção
(
    'MANUTENÇÃO E SERVIÇOS S/A',
    '98.765.432/0001-12',
    'Manutenção Preventiva Equipamentos',
    'OS-2025-234',
    '2025-10-10',
    '2025-11-10',
    2300.50,
    'Manutenção',
    'Produção',
    'Transferência',
    'PENDENTE',
    'Manutenção mensal conforme contrato'
),

-- Exemplo 4: Conta já paga
(
    'TELECOMUNICAÇÕES BRASIL S/A',
    '11.222.333/0001-44',
    'Internet e Telefonia Empresarial',
    'TEL-2025-09-001',
    '2025-09-01',
    '2025-10-05',
    890.00,
    'Telecomunicações',
    'Administração',
    'PIX',
    'PAGA',
    'Plano empresarial 500MB - Setembro/2025'
),

-- Exemplo 5: Conta vencida
(
    'ESCRITÓRIO CONTÁBIL ABC',
    '55.666.777/0001-88',
    'Honorários Contábeis - Setembro/2025',
    'HC-2025-09-001',
    '2025-09-15',
    '2025-10-15',
    1200.00,
    'Serviços Profissionais',
    'Administração',
    'Boleto Bancário',
    'VENCIDA',
    'Serviços contábeis mensais'
);

-- Atualizar dados de pagamento para contas pagas
UPDATE contas_pagar 
SET 
    data_pagamento = '2025-10-03',
    valor_pago = valor_original,
    usuario_pagamento = 'admin'
WHERE numero_documento = 'TEL-2025-09-001';

-- =====================================================
-- VIEWS ÚTEIS PARA RELATÓRIOS
-- =====================================================

-- View: Contas em aberto
CREATE VIEW IF NOT EXISTS v_contas_pagar_abertas AS
SELECT 
    c.*,
    CASE 
        WHEN c.data_vencimento < DATE('now') THEN 'VENCIDA'
        WHEN c.data_vencimento <= DATE('now', '+7 days') THEN 'VENCENDO'
        ELSE 'NO_PRAZO'
    END as situacao_vencimento,
    CAST(julianday('now') - julianday(c.data_vencimento) AS INTEGER) as dias_vencimento
FROM contas_pagar c
WHERE c.status IN ('PENDENTE', 'VENCIDA', 'PARCIAL');

-- View: Resumo por fornecedor
CREATE VIEW IF NOT EXISTS v_resumo_fornecedor AS
SELECT 
    fornecedor_nome,
    COUNT(*) as total_contas,
    SUM(CASE WHEN status = 'PENDENTE' THEN 1 ELSE 0 END) as contas_pendentes,
    SUM(CASE WHEN status = 'VENCIDA' THEN 1 ELSE 0 END) as contas_vencidas,
    SUM(CASE WHEN status = 'PAGA' THEN 1 ELSE 0 END) as contas_pagas,
    SUM(valor_total) as valor_total,
    SUM(CASE WHEN status IN ('PENDENTE', 'VENCIDA') THEN valor_total ELSE 0 END) as valor_aberto,
    SUM(valor_pago) as valor_pago
FROM contas_pagar
GROUP BY fornecedor_nome
ORDER BY valor_aberto DESC;

-- View: Fluxo de caixa
CREATE VIEW IF NOT EXISTS v_fluxo_caixa AS
SELECT 
    data_vencimento as data_referencia,
    SUM(valor_total) as valor_total,
    COUNT(*) as quantidade_contas,
    GROUP_CONCAT(fornecedor_nome, ', ') as fornecedores
FROM contas_pagar
WHERE status IN ('PENDENTE', 'VENCIDA')
GROUP BY data_vencimento
ORDER BY data_vencimento;

-- =====================================================
-- CONSULTAS ÚTEIS PARA GESTÃO
-- =====================================================

-- 1. Contas vencidas hoje
SELECT 
    'Contas Vencidas Hoje' as relatorio,
    COUNT(*) as quantidade,
    PRINTF('R$ %.2f', SUM(valor_total)) as valor_total
FROM contas_pagar
WHERE data_vencimento = DATE('now') 
  AND status IN ('PENDENTE', 'VENCIDA');

-- 2. Contas que vencem nos próximos 7 dias
SELECT 
    'Contas Vencendo (7 dias)' as relatorio,
    COUNT(*) as quantidade,
    PRINTF('R$ %.2f', SUM(valor_total)) as valor_total
FROM contas_pagar
WHERE data_vencimento BETWEEN DATE('now') AND DATE('now', '+7 days')
  AND status IN ('PENDENTE', 'VENCIDA');

-- 3. Total em aberto por categoria
SELECT 
    categoria,
    COUNT(*) as quantidade,
    PRINTF('R$ %.2f', SUM(valor_total)) as valor_total
FROM contas_pagar
WHERE status IN ('PENDENTE', 'VENCIDA')
GROUP BY categoria
ORDER BY SUM(valor_total) DESC;

-- 4. Maiores fornecedores em débito
SELECT 
    fornecedor_nome,
    COUNT(*) as contas_abertas,
    PRINTF('R$ %.2f', SUM(valor_total)) as valor_total
FROM contas_pagar
WHERE status IN ('PENDENTE', 'VENCIDA')
GROUP BY fornecedor_nome
ORDER BY SUM(valor_total) DESC
LIMIT 10;

-- =====================================================
-- ESTATÍSTICAS FINAIS
-- =====================================================

SELECT '=== ESTATÍSTICAS DO SISTEMA ===' as info;

SELECT 
    'Total de Contas' as metrica,
    COUNT(*) as valor
FROM contas_pagar
UNION ALL
SELECT 
    'Contas Pendentes',
    COUNT(*)
FROM contas_pagar
WHERE status = 'PENDENTE'
UNION ALL
SELECT 
    'Contas Vencidas',
    COUNT(*)
FROM contas_pagar
WHERE status = 'VENCIDA'
UNION ALL
SELECT 
    'Valor Total em Aberto',
    PRINTF('R$ %.2f', SUM(valor_total))
FROM contas_pagar
WHERE status IN ('PENDENTE', 'VENCIDA')
UNION ALL
SELECT 
    'Fornecedores Únicos',
    COUNT(DISTINCT fornecedor_nome)
FROM contas_pagar;

-- =====================================================
-- FIM DO SCRIPT
-- =====================================================
"""
    
    return sql_script

def create_import_template():
    """
    Cria template de importação para contas a pagar
    """
    
    template = """-- =====================================================
-- TEMPLATE DE IMPORTAÇÃO: CONTAS A PAGAR
-- =====================================================

-- Para importar suas contas a pagar, utilize o modelo abaixo:

INSERT INTO contas_pagar (
    fornecedor_nome,
    fornecedor_cnpj,
    descricao,
    numero_documento,
    data_emissao,
    data_vencimento,
    valor_original,
    categoria,
    centro_custo,
    forma_pagamento,
    status,
    observacoes
) VALUES 
-- Exemplo de importação:
(
    'NOME DO FORNECEDOR',
    'XX.XXX.XXX/XXXX-XX',
    'Descrição da conta',
    'Número do documento/NF',
    'YYYY-MM-DD',  -- Data de emissão
    'YYYY-MM-DD',  -- Data de vencimento
    0000.00,       -- Valor original
    'Categoria',   -- Ex: Utilidades, Materiais, Serviços
    'Centro de Custo',
    'Forma de Pagamento', -- Ex: Boleto, PIX, Débito
    'PENDENTE',    -- Status: PENDENTE, PAGA, VENCIDA
    'Observações adicionais'
);

-- =====================================================
-- IMPORTAÇÃO EM LOTE (Copie e modifique conforme necessário)
-- =====================================================

-- Exemplo de múltiplas inserções:
/*
INSERT INTO contas_pagar (fornecedor_nome, descricao, data_vencimento, valor_original, categoria, status) VALUES 
('Fornecedor A', 'Conta X', '2025-11-30', 1500.00, 'Materiais', 'PENDENTE'),
('Fornecedor B', 'Conta Y', '2025-12-15', 2300.50, 'Serviços', 'PENDENTE'),
('Fornecedor C', 'Conta Z', '2025-11-20', 890.75, 'Utilidades', 'PENDENTE');
*/

-- =====================================================
-- VERIFICAÇÃO APÓS IMPORTAÇÃO
-- =====================================================

-- Verificar contas importadas
SELECT COUNT(*) as total_contas, SUM(valor_original) as valor_total
FROM contas_pagar;

-- Listar últimas contas inseridas
SELECT * FROM contas_pagar 
ORDER BY data_criacao DESC 
LIMIT 10;
"""
    
    return template

def main():
    """Função principal"""
    print("🚀 ALUFORCE v2.0 - Gerador SQL: Contas a Pagar")
    print("=" * 50)
    
    try:
        # Definir caminhos
        base_path = r"C:\Users\Administrator\Documents\Sistema - Aluforce v.2 - BETA\modules\Financeiro"
        sql_file = os.path.join(base_path, "contas_pagar_complete.sql")
        template_file = os.path.join(base_path, "contas_pagar_import_template.sql")
        
        # Gerar script principal
        print("📝 Gerando script SQL completo...")
        sql_script = generate_contas_pagar_sql()
        
        with open(sql_file, 'w', encoding='utf-8') as f:
            f.write(sql_script)
        
        print(f"✅ Script principal salvo em: {sql_file}")
        
        # Gerar template de importação
        print("📝 Gerando template de importação...")
        template_script = create_import_template()
        
        with open(template_file, 'w', encoding='utf-8') as f:
            f.write(template_script)
        
        print(f"✅ Template salvo em: {template_file}")
        
        # Estatísticas
        print(f"\n📊 Estatísticas:")
        print(f"  • Linhas no script principal: {len(sql_script.splitlines())}")
        print(f"  • Tamanho do arquivo: {len(sql_script.encode('utf-8'))} bytes")
        print(f"  • Registros de exemplo: 5 contas")
        
        print(f"\n📋 Funcionalidades incluídas:")
        print(f"  ✅ Tabela completa com triggers")
        print(f"  ✅ Índices para performance")
        print(f"  ✅ Views para relatórios")
        print(f"  ✅ Dados de exemplo")
        print(f"  ✅ Template de importação")
        print(f"  ✅ Consultas úteis")
        
        print(f"\n💡 Como usar:")
        print(f"  1. Execute o script principal no seu banco SQLite")
        print(f"  2. Use o template para importar suas contas")
        print(f"  3. Ajuste os exemplos conforme necessário")
        
        print(f"\n🎯 Próximos passos:")
        print(f"  • Exporte seus dados do Excel para CSV")
        print(f"  • Adapte o template com seus dados reais")
        print(f"  • Execute no sistema ALUFORCE")
        
    except Exception as e:
        print(f"❌ Erro: {str(e)}")
        return False
    
    print(f"\n🏁 Script gerado com sucesso!")
    return True

if __name__ == "__main__":
    main()