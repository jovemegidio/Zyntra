#!/usr/bin/env python3
"""
Generate SQL to completely rebuild bobinas_estoque from Excel data.
Adds tipo column (bobina/rolo), deletes all existing rows, inserts 126 from Excel.
"""

# Product code -> produto_id mapping (from DB query)
PRODUCT_IDS = {
    'CET2.15': 786, 'CET2.25': 787, 'CET2.40': 788, 'CET3.25': 791,
    'CET4.15': 795, 'CET8.15': 805,
    'DUI10': 672, 'DUI16': 673, 'DUI25': 674, 'DUI35': 675,
    'DUN10': 667, 'DUN16': 668, 'DUN25': 669, 'DUN35': 670,
    'PRO150': 812, 'PRO185': 813, 'PRO50': 808,
    'QDN10': 713, 'QDN16': 714, 'QDN35': 716,
    'TRI25': 697, 'TRN10': 677, 'TRN16': 678, 'TRN35': 680,
    'UN10': 764, 'UN120': 771, 'UN16': 765, 'UN185': 773,
    'UN240': 774, 'UN25': 766, 'UN35': 767, 'UN50': 768,
    'UN70': 769, 'UN95': 770
}

# All 126 rows from Excel (parsed via read_excel_estoque.py)
# Updated 2026-02-24: 'BOBINA' used for bobinas without dimension info
EXCEL_DATA = [
    # (cod, qtde, dimensao, cor, local, obs)
    ('CET2.15', 940, '0,65X0,45', 'CINZA', 'CHÃO DE FABRICA', ''),
    ('CET2.15', 700, '0,65x0,45', 'CINZA', 'CHÃO DE FABRICA', ''),
    ('CET2.15', 200, '0,65x0,25', 'CINZA', 'CHÃO DE FABRICA', ''),
    ('CET2.15', 300, '0,65x0,25', 'CINZA', 'CHÃO DE FABRICA', ''),
    ('CET2.15', 420, '0,65x0,25', 'CINZA', 'CHÃO DE FABRICA', ''),
    ('CET2.15', 500, '0,65x0,25', 'CINZA', 'CHÃO DE FABRICA', ''),
    ('PRO185', 130, 'BOBINA', 'CINZA', 'CHÃO DE FABRICA', 'ESTA NA BOBINA DE FERRO VERDE'),
    ('UN70', 60, 'BOBINA', 'VERMELHA', 'CHÃO DE FABRICA', ''),
    ('UN70', 60, 'BOBINA', 'CINZA', 'CHÃO DE FABRICA', ''),
    ('CET2.40', 170, '0,65x0,25', 'CINZA', 'CHÃO DE FABRICA', ''),
    ('CET2.40', 220, '0,65x0,25', 'CINZA', 'CHÃO DE FABRICA', ''),
    ('UN120', 90, 'BOBINA', 'PRETO', 'CHÃO DE FABRICA', ''),
    ('UN185', 150, 'BOBINA', 'PRETO', 'CHÃO DE FABRICA', ''),
    ('CET4.15', 230, 'BOBINA', 'CINZA', 'CHÃO DE FABRICA', ''),
    ('UN35', 180, 'BOBINA', 'CINZA', 'CHÃO DE FABRICA', ''),
    ('UN95', 96, 'BOBINA', 'CINZA', 'CHÃO DE FABRICA', ''),
    ('UN35', 190, 'BOBINA', 'PRETO', 'CHÃO DE FABRICA', ''),
    ('UN35', 175, 'BOBINA', 'CINZA', 'CHÃO DE FABRICA', ''),
    ('UN10', 270, 'BOBINA', 'PRETO', 'CHÃO DE FABRICA', ''),
    ('UN10', 180, 'BOBINA', 'PRETO', 'CHÃO DE FABRICA', ''),
    ('UN10', 200, 'BOBINA', 'PRETO', 'CHÃO DE FABRICA', ''),
    ('UN50', 197, 'BOBINA', 'CINZA', 'CHÃO DE FABRICA', ''),
    ('UN50', 120, 'BOBINA', 'CINZA', 'CHÃO DE FABRICA', ''),
    ('UN50', 57, 'BOBINA', 'CINZA', 'CHÃO DE FABRICA', ''),
    ('UN50', 140, 'BOBINA', 'AZUL', 'CHÃO DE FABRICA', ''),
    ('UN185', 75, 'BOBINA', 'AZUL', 'CHÃO DE FABRICA', ''),
    ('UN16', 360, 'BOBINA', 'PRETO', 'CHÃO DE FABRICA', ''),
    ('UN50', 180, 'BOBINA', 'VERMELHA', 'CHÃO DE FABRICA', ''),
    ('UN10', 400, 'BOBINA', 'CINZA', 'CHÃO DE FABRICA', ''),
    ('UN10', 769, 'BOBINA', 'CINZA', 'CHÃO DE FABRICA', ''),
    ('UN35', 240, 'BOBINA', 'VERMELHA', 'CHÃO DE FABRICA', ''),
    ('UN16', 280, 'BOBINA', 'PRETO', 'CHÃO DE FABRICA', ''),
    ('UN16', 105, 'BOBINA', 'PRETO', 'CHÃO DE FABRICA', ''),
    ('UN16', 120, 'BOBINA', 'PRETO', 'CHÃO DE FABRICA', ''),
    ('UN16', 120, 'BOBINA', 'PRETO', 'CHÃO DE FABRICA', ''),
    ('UN16', 90, 'BOBINA', 'PRETO', 'CHÃO DE FABRICA', ''),
    ('UN16', 70, 'BOBINA', 'PRETO', 'CHÃO DE FABRICA', ''),
    ('UN35', 350, 'BOBINA', 'VERMELHA', 'CHÃO DE FABRICA', ''),
    ('UN25', 175, 'BOBINA', 'AZUL', 'CHÃO DE FABRICA', ''),
    ('UN16', 250, 'BOBINA', 'AZUL', 'CHÃO DE FABRICA', ''),
    ('UN35', 500, 'BOBINA', 'AZUL', 'CHÃO DE FABRICA', ''),
    ('CET2.15', 30, 'BOBINA', 'CINZA', 'CHÃO DE FABRICA', ''),
    ('UN10', 340, 'BOBINA', 'VERMELHA', 'CHÃO DE FABRICA', ''),
    ('UN35', 275, 'BOBINA', 'PRETO', 'CHÃO DE FABRICA', ''),
    ('UN10', 350, 'BOBINA', 'CINZA', 'CHÃO DE FABRICA', ''),
    ('UN10', 800, 'BOBINA', 'AZUL', 'CHÃO DE FABRICA', ''),
    ('UN16', 150, 'BOBINA', 'CINZA', 'CHÃO DE FABRICA', ''),
    ('UN10', 200, 'BOBINA', 'PRETO', 'CHÃO DE FABRICA', ''),
    ('UN120', 120, 'BOBINA', 'CINZA', 'CHÃO DE FABRICA', ''),
    ('UN10', 155, 'BOBINA', 'AZUL', 'CHÃO DE FABRICA', ''),
    ('UN240', 68, 'BOBINA', 'CINZA', 'CHÃO DE FABRICA', ''),
    ('UN240', 60, 'BOBINA', 'VERMELHA', 'CHÃO DE FABRICA', ''),
    ('UN25', 582, 'BOBINA', 'CINZA', 'CHÃO DE FABRICA', ''),
    ('UN16', 935, 'BOBINA', 'PRETO', 'CHÃO DE FABRICA', 'DUPLA CAMADA'),
    ('PRO150', 300, 'BOBINA', 'CINZA', 'CHÃO DE FABRICA', ''),
    ('UN10', 400, 'BOBINA', 'PRETO', 'CHÃO DE FABRICA', 'DUPLA CAMADA'),
    ('UN185', 150, 'BOBINA', 'PRETO', 'CHÃO DE FABRICA', ''),
    ('UN35', 155, 'BOBINA', 'PRETO', 'CHÃO DE FABRICA', ''),
    ('UN10', 530, 'BOBINA', 'PRETO', 'CHÃO DE FABRICA', ''),
    ('UN35', 300, 'BOBINA', 'PRETO', 'CHÃO DE FABRICA', ''),
    ('UN35', 155, 'BOBINA', 'VERMELHA', 'CHÃO DE FABRICA', ''),
    ('UN25', 295, 'BOBINA', 'VERMELHA', 'CHÃO DE FABRICA', ''),
    ('UN10', 330, 'BOBINA', 'PRETO', 'CHÃO DE FABRICA', ''),
    ('UN50', 150, 'BOBINA', 'PRETO', 'CHÃO DE FABRICA', ''),
    ('UN10', 300, 'BOBINA', 'AZUL', 'CHÃO DE FABRICA', ''),
    ('CET3.25', 800, 'BOBINA', 'CINZA', 'CHÃO DE FABRICA', ''),
    ('CET3.25', 185, 'BOBINA', 'CINZA', 'CHÃO DE FABRICA', ''),
    ('CET4.15', 3600, 'BOBINA', 'CINZA', 'CHÃO DE FABRICA', 'BOBINA LA NOS FUNDOS (FORA)'),
    ('UN10', 320, 'BOBINA', 'CINZA', 'CHÃO DE FABRICA', ''),
    ('UN16', 360, 'BOBINA', 'PRETO', 'CHÃO DE FABRICA', ''),
    ('UN10', 400, 'BOBINA', 'CINZA', 'CHÃO DE FABRICA', ''),
    ('UN16', 475, 'BOBINA', 'AZUL', 'CHÃO DE FABRICA', ''),
    ('UN10', 440, 'BOBINA', 'VERMELHA', 'CHÃO DE FABRICA', ''),
    ('CET8.15', 130, 'BOBINA', 'CINZA', 'CHÃO DE FABRICA', ''),
    ('UN35', 282, 'BOBINA', 'PRETO', 'CHÃO DE FABRICA', ''),
    ('CET4.15', 600, 'BOBINA', 'CINZA', 'CHÃO DE FABRICA', ''),
    ('CET2.25', 70, 'BOBINA', 'CINZA', 'CHÃO DE FABRICA', ''),
    ('CET3.25', 105, 'BOBINA', 'CINZA', 'CHÃO DE FABRICA', ''),
    ('CET4.15', 180, 'BOBINA', 'CINZA', 'CHÃO DE FABRICA', ''),
    ('CET4.15', 170, 'BOBINA', 'CINZA', 'CHÃO DE FABRICA', ''),
    ('CET2.15', 190, 'BOBINA', 'CINZA', 'CHÃO DE FABRICA', ''),
    ('CET2.15', 140, 'BOBINA', 'CINZA', 'CHÃO DE FABRICA', ''),
    ('UN16', 1615, 'BOBINA', 'AZUL', 'CHÃO DE FABRICA', ''),
    ('PRO50', 270, 'BOBINA', 'CINZA', 'CHÃO DE FABRICA', ''),
    ('CET4.15', 470, 'BOBINA', 'CINZA', 'CHÃO DE FABRICA', ''),
    ('CET4.15', 560, 'BOBINA', 'CINZA', 'CHÃO DE FABRICA', ''),
    ('UN16', 24, 'BOBINA', 'CINZA', 'CHÃO DE FABRICA', ''),
    # --- Multiplex cables (ESTOQUE section) ---
    ('QDN16', 100, '0,65X0,45', 'PT/CZ/VM/NU', 'ESTOQUE', ''),
    ('DUN16', 80, '0,65X0,45', 'PT/NU', 'ESTOQUE', ''),
    ('TRN16', 130, '0,65X0,45', 'PT/CZ/NU', 'ESTOQUE', ''),
    ('TRN16', 60, '0,65X0,45', 'PT/CZ/NU', 'ESTOQUE', ''),
    ('QDN10', 120, '0,65X0,45', 'PT/CZ/VM/NU', 'ESTOQUE', ''),
    ('TRN10', 100, '0,65X0,45', 'PT/CZ/NU', 'ESTOQUE', ''),
    ('TRN10', 150, '0,65X0,45', 'PT/CZ/NU', 'ESTOQUE', ''),
    ('DUI16', 160, '0,80X0,45', 'PT/AZ', 'ESTOQUE', ''),
    ('DUI16', 160, '0,80X0,45', 'PT/AZ', 'ESTOQUE', ''),
    ('DUI16', 80, '0,80X0,45', 'PT/AZ', 'ESTOQUE', ''),
    ('DUI16', 190, '0,80X0,45', 'PT/AZ', 'ESTOQUE', ''),
    ('DUI25', 100, '0,65X0,45', 'PT/AZ', 'ESTOQUE', ''),
    ('DUI25', 130, '0,65X0,45', 'PT/AZ', 'ESTOQUE', ''),
    ('TRI25', 130, '0,65X0,45', 'PT/CZ/AZ', 'ESTOQUE', ''),
    ('DUI10', 500, '0,65X0,25', 'PT/AZ', 'ESTOQUE', ''),
    ('DUN10', 100, 'ROLO', 'PT/NU', 'ESTOQUE', ''),
    ('TRN10', 50, 'ROLO', 'PT/CZ/NU', 'ESTOQUE', ''),
    ('QDN10', 50, 'ROLO', 'PT/CZ/VM/NU', 'ESTOQUE', ''),
    ('DUN16', 100, 'ROLO', 'PT/NU', 'ESTOQUE', ''),
    ('DUN35', 100, 'ROLO', 'PT/NU', 'ESTOQUE', ''),
    ('DUN35', 100, 'ROLO', 'PT/NU', 'ESTOQUE', ''),
    ('DUN35', 100, 'ROLO', 'PT/NU', 'ESTOQUE', ''),
    ('DUN16', 87, 'ROLO', 'PT/NU', 'ESTOQUE', ''),
    ('DUN10', 100, 'ROLO', 'PT/NU', 'ESTOQUE', ''),
    ('DUN10', 40, 'ROLO', 'PT/NU', 'ESTOQUE', ''),
    ('TRN35', 20, 'ROLO', 'PT/CZ/NU', 'ESTOQUE', ''),
    ('DUN25', 100, 'ROLO', 'PT/NU', 'ESTOQUE', ''),
    ('TRN16', 20, 'ROLO', 'PT/CZ/NU', 'ESTOQUE', ''),
    ('TRN35', 70, 'ROLO', 'PT/CZ/NU', 'ESTOQUE', ''),
    ('DUN25', 120, 'ROLO', 'PT/NU', 'ESTOQUE', ''),
    ('QDN16', 70, 'ROLO', 'PT/CZ/VM/NU', 'ESTOQUE', ''),
    ('QDN16', 60, 'ROLO', 'PT/CZ/VM/NU', 'ESTOQUE', ''),
    ('DUN10', 300, 'ROLO', 'PT/NU', 'ESTOQUE', ''),
    ('QDN35', 50, 'ROLO', 'PT/CZ/VM/NU', 'ESTOQUE', ''),
    ('DUN10', 100, 'ROLO', 'PT/NU', 'ESTOQUE', ''),
    ('DUN10', 150, 'ROLO', 'PT/NU', 'ESTOQUE', ''),
    ('QDN10', 60, 'ROLO', 'PT/CZ/VM/NU', 'ESTOQUE', ''),
    ('DUI35', 70, 'ROLO', 'PT/AZ', 'ESTOQUE', ''),
    ('DUN16', 150, 'ROLO', 'PT/NU', 'ESTOQUE', ''),
]

def escape_sql(val):
    """Escape single quotes for SQL"""
    if val is None:
        return ''
    return str(val).replace("'", "\\'")

def determine_tipo(dimensao):
    """Determine if it's bobina or rolo based on dimensao column"""
    if dimensao and dimensao.upper() == 'ROLO':
        return 'rolo'
    return 'bobina'

def main():
    lines = []
    lines.append("-- =========================================")
    lines.append("-- REBUILD bobinas_estoque FROM EXCEL DATA")
    lines.append("-- Generated automatically from Lista de Estoque - Aluforce Cabos.xlsx")
    lines.append("-- 126 rows, 34 product codes")
    lines.append("-- =========================================")
    lines.append("")
    
    # 1. Add tipo column if not exists
    lines.append("-- Step 1: Add tipo column (bobina/rolo)")
    lines.append("ALTER TABLE bobinas_estoque ADD COLUMN IF NOT EXISTS tipo ENUM('bobina','rolo') DEFAULT 'bobina' AFTER dimensao_bobina;")
    lines.append("")
    
    # 2. Delete all existing data
    lines.append("-- Step 2: Clear existing data")
    lines.append("DELETE FROM bobinas_estoque;")
    lines.append("ALTER TABLE bobinas_estoque AUTO_INCREMENT = 1;")
    lines.append("")
    
    # 3. Insert all rows
    lines.append("-- Step 3: Insert all 126 rows from Excel")
    lines.append("INSERT INTO bobinas_estoque (produto_id, codigo_produto, numero_bobina, quantidade, dimensao_bobina, tipo, veia_cor, local_armazenamento, observacao, status) VALUES")
    
    # Track numero_bobina per product code
    bobina_counter = {}
    
    values = []
    for cod, qtde, dim, cor, local, obs in EXCEL_DATA:
        pid = PRODUCT_IDS.get(cod)
        if pid is None:
            print(f"WARNING: No product ID for code {cod}")
            continue
        
        # Increment bobina number per product
        bobina_counter[cod] = bobina_counter.get(cod, 0) + 1
        num_bob = bobina_counter[cod]
        
        tipo = determine_tipo(dim)
        
        # For ROLO type, store 'ROLO' in dimensao_bobina; for bobina, store the dimension or 'BOBINA'
        if dim and dim.upper() == 'ROLO':
            dim_val = 'ROLO'
        elif dim and dim.upper() != 'BOBINA':
            dim_val = escape_sql(dim)  # specific dimension like '0,65X0,45'
        else:
            dim_val = 'BOBINA'  # generic bobina without specific dimension
        
        val = f"  ({pid}, '{escape_sql(cod)}', {num_bob}, {qtde:.2f}, '{dim_val}', '{tipo}', '{escape_sql(cor)}', '{escape_sql(local)}', '{escape_sql(obs)}', 'disponivel')"
        values.append(val)
    
    lines.append(',\n'.join(values) + ';')
    lines.append("")
    
    # 4. Verification queries
    lines.append("-- Step 4: Verification")
    lines.append("SELECT '=== TOTAL ROWS ===' as info;")
    lines.append("SELECT COUNT(*) as total_bobinas FROM bobinas_estoque;")
    lines.append("")
    lines.append("SELECT '=== BY PRODUCT ===' as info;")
    lines.append("SELECT codigo_produto, COUNT(*) as bobinas, SUM(quantidade) as total_metros, GROUP_CONCAT(DISTINCT tipo) as tipos FROM bobinas_estoque GROUP BY codigo_produto ORDER BY codigo_produto;")
    lines.append("")
    lines.append("SELECT '=== ROLOS vs BOBINAS ===' as info;")
    lines.append("SELECT tipo, COUNT(*) as qtd, SUM(quantidade) as total_metros FROM bobinas_estoque GROUP BY tipo;")
    
    sql_content = '\n'.join(lines)
    
    output_path = r"g:\Outros computadores\Meu laptop (2)\Sistema - ALUFORCE - V.2\scripts_auxiliares\rebuild_bobinas.sql"
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(sql_content)
    
    print(f"SQL generated: {output_path}")
    print(f"Total INSERT rows: {len(values)}")
    print(f"Product codes: {len(bobina_counter)}")
    
    # Summary
    print("\n=== SUMMARY ===")
    for cod in sorted(bobina_counter.keys()):
        count = bobina_counter[cod]
        total = sum(qtde for c, qtde, *_ in EXCEL_DATA if c == cod)
        rolos = sum(1 for c, _, dim, *_ in EXCEL_DATA if c == cod and dim.upper() == 'ROLO')
        bobs = count - rolos
        print(f"  {cod:12s} | {count:3d} items | {total:8.0f}m | {bobs} bobinas, {rolos} rolos")

if __name__ == '__main__':
    main()
