import sys
with open('/var/www/aluforce/modules/Vendas/public/prospeccao.html', 'r', encoding='utf-8-sig') as f:
    content = f.read()

old = """        getAuthHeaders() {
            const token = localStorage.getItem('token');
            return { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' };
        },"""

new = """        getAuthHeaders() {
            // v7.3 FIX: Priorizar sessionStorage.tabAuthToken (isolado por aba)
            const token = sessionStorage.getItem('tabAuthToken') || localStorage.getItem('token');
            return { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' };
        },"""

if old in content:
    content = content.replace(old, new, 1)
    with open('/var/www/aluforce/modules/Vendas/public/prospeccao.html', 'w', encoding='utf-8') as f:
        f.write(content)
    print('FIX5_OK')
else:
    print('ERROR: Pattern not found')
    idx = content.find('getAuthHeaders()')
    if idx >= 0:
        print(f'Found at pos {idx}: {repr(content[idx:idx+200])}')
