#!/usr/bin/env python3
"""Fix auth-unified.js - Save token to sessionStorage on cookie validation"""

with open('/var/www/aluforce/public/js/auth-unified.js', 'r', encoding='utf-8-sig') as f:
    content = f.read()

old = '                setTabUserData(userData);\n\n                // Disparar evento de sucesso'
new_text = '                setTabUserData(userData);\n\n                // v7.3 FIX: Salvar o TOKEN no sessionStorage desta aba\n                // Sem isso, novas abas nao tem tabAuthToken e getAuthHeaders() cai no localStorage\n                // que pode ter o token de outro usuario (ultimo login)\n                if (!getTabToken()) {\n                    const cookieToken = getCookie(\'authToken\');\n                    if (cookieToken) {\n                        setTabToken(cookieToken);\n                        debugLog(\'Token do cookie salvo nesta aba via setTabToken\');\n                    }\n                }\n\n                // Disparar evento de sucesso'

if old in content:
    content = content.replace(old, new_text, 1)
    with open('/var/www/aluforce/public/js/auth-unified.js', 'w', encoding='utf-8') as f:
        f.write(content)
    print('FIX 1 applied successfully to auth-unified.js')
else:
    print('ERROR: Pattern not found in auth-unified.js')
    lines = content.split('\n')
    for i in range(290, 300):
        if i < len(lines):
            print(f'Line {i+1}: {repr(lines[i])}')
