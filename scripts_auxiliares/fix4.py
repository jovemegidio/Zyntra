import sys
with open('/var/www/aluforce/modules/Vendas/public/pedidos.html', 'r', encoding='utf-8-sig') as f:
    content = f.read()

old = """        function getAuthHeaders() {
            const token = localStorage.getItem('authToken') || localStorage.getItem('token') || sessionStorage.getItem('token');
            return token ? { 'Authorization': `Bearer ${token}` } : {};
        }"""

new = """        function getAuthHeaders() {
            // v7.3 FIX: Priorizar sessionStorage.tabAuthToken (isolado por aba)
            // Antes usava localStorage que e compartilhado entre abas - causava troca de usuario
            const token = sessionStorage.getItem('tabAuthToken') || localStorage.getItem('authToken') || localStorage.getItem('token') || sessionStorage.getItem('token');
            return token ? { 'Authorization': `Bearer ${token}` } : {};
        }"""

if old in content:
    content = content.replace(old, new, 1)
    with open('/var/www/aluforce/modules/Vendas/public/pedidos.html', 'w', encoding='utf-8') as f:
        f.write(content)
    print('FIX4_OK')
else:
    print('ERROR: Pattern not found')
    # Try to find it with different whitespace
    idx = content.find('function getAuthHeaders()')
    if idx >= 0:
        snippet = content[idx:idx+300]
        print(f'Found at pos {idx}: {repr(snippet[:200])}')
