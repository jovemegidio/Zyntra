import sys
with open('/var/www/aluforce/public/js/user-dropdown.js', 'r', encoding='utf-8-sig') as f:
    content = f.read()
old = "const response = await fetch('/api/me', { credentials: 'include' });"
new = """// v7.3 FIX: Usar token do sessionStorage (isolado por aba) em vez de apenas cookie
            var _headers = { 'Accept': 'application/json' };
            var _tabToken = sessionStorage.getItem('tabAuthToken') || localStorage.getItem('authToken');
            if (_tabToken) _headers['Authorization'] = 'Bearer ' + _tabToken;
            const response = await fetch('/api/me', { credentials: 'include', headers: _headers });"""
if old in content:
    content = content.replace(old, new, 1)
    with open('/var/www/aluforce/public/js/user-dropdown.js', 'w', encoding='utf-8') as f:
        f.write(content)
    print('FIX2_OK')
else:
    print('ERROR: Pattern not found')
    idx = content.find("fetch('/api/me'")
    if idx >= 0:
        print(f'Found at position {idx}: {repr(content[idx:idx+100])}')
