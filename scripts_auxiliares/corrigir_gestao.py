# -*- coding: utf-8 -*-
import re

file_path = r"c:\Users\egidio\Music\Sistema - ALUFORCE - V.2\modules\PCP\index.html"

# Ler arquivo
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Dicionário de substituições de encoding corrompido
replacements = {
    'GestÃ£o de ProduÃ§Ã£o': 'Gestão de Produção',
    'Tempo Total de ProduÃ§Ã£o': 'Tempo Total de Produção',
    'Este mÃªs': 'Este mês',
    'MÃ¡quinas Ativas': 'Máquinas Ativas',
    'EficiÃªncia MÃ©dia': 'Eficiência Média',
    'NÃºmero do pedido': 'Número do pedido',
    'PerÃ­odo': 'Período',
    'Este MÃªs': 'Este Mês',
    'Todas as MÃ¡quinas': 'Todas as Máquinas',
    'Registros de ProduÃ§Ã£o': 'Registros de Produção',
    'NÂº Pedido': 'Nº Pedido',
    'Tempo de ProduÃ§Ã£o': 'Tempo de Produção',
    'MÃ¡quinas Utilizadas': 'Máquinas Utilizadas',
    'AÃ§Ãµes': 'Ações',
    'produÃ§Ã£o': 'produção',
    'SeÃ§Ã£o de MÃ¡quinas': 'Seção de Máquinas',
    'CÃ³digo': 'Código',
    'Nome da MÃ¡quina': 'Nome da Máquina',
    'Ãšltima ManutenÃ§Ã£o': 'Última Manutenção',
    'mÃ¡quinas': 'máquinas',
    'MÃ¡quina': 'Máquina',
    'MÃ¡quinas Cadastradas': 'Máquinas Cadastradas',
    'Carregando mÃ¡quinas': 'Carregando máquinas',
    'Carregando dados de produÃ§Ã£o': 'Carregando dados de produção',
}

# Aplicar substituições
for old, new in replacements.items():
    content = content.replace(old, new)

# Remover o título e manter só os botões
old_header = '''                <div class="page-header">
                    <div class="page-header-top" style="justify-content: space-between;">
                        <h2 class="page-title" style="display: flex; align-items: center; gap: 12px; margin: 0; font-size: 20px; font-weight: 700; color: var(--gray-800);">
                            <i class="fas fa-industry" style="color: var(--primary-500);"></i> Gestão de Produção
                        </h2>
                        <div class="page-actions">
                            <button class="btn btn-secondary" onclick="atualizarDadosGestao()">
                                <i class="fas fa-sync-alt"></i> Atualizar
                            </button>
                            <button class="btn btn-primary" onclick="exportarGestaoProducao()">
                                <i class="fas fa-file-excel"></i> Exportar
                            </button>
                        </div>
                    </div>
                </div>'''

new_header = '''                <div class="page-header">
                    <div class="page-header-top" style="justify-content: flex-end;">
                        <div class="page-actions">
                            <button class="btn btn-secondary" onclick="atualizarDadosGestao()">
                                <i class="fas fa-sync-alt"></i> Atualizar
                            </button>
                            <button class="btn btn-primary" onclick="exportarGestaoProducao()">
                                <i class="fas fa-file-excel"></i> Exportar
                            </button>
                        </div>
                    </div>
                </div>'''

content = content.replace(old_header, new_header)

# Salvar arquivo
with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Arquivo corrigido com sucesso!")
