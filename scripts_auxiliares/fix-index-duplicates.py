#!/usr/bin/env python3
"""
Script para remover código JavaScript duplicado do index.html
"""

# Ler o arquivo
with open('public/index.html', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Encontrar e remover o bloco duplicado (linhas 799-1563)
# Manter apenas as linhas até 798 e depois pular para 1564
output_lines = []
skip = False

for i, line in enumerate(lines, 1):
    # Linha 799: início do bloco duplicado
    if i == 799 and '// Autenticação e funcionalidades' in line:
        skip = True
        print(f"Começando a pular código duplicado na linha {i}")
        continue
    
    # Linha 1564: após o bloco duplicado
    if i >= 1564:
        skip = False
    
    if not skip:
        output_lines.append(line)

# Salvar o arquivo corrigido
with open('public/index.html', 'w', encoding='utf-8') as f:
    f.writelines(output_lines)

print(f"✅ Arquivo corrigido! Removidas {len(lines) - len(output_lines)} linhas duplicadas")
print(f"   Original: {len(lines)} linhas")
print(f"   Corrigido: {len(output_lines)} linhas")
