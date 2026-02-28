import sys
with open('/var/www/aluforce/public/js/auth-unified.js', 'r', encoding='utf-8-sig') as f:
    content = f.read()

# Remove the old fix that uses getCookie (httpOnly cookie is not accessible from JS)
old_fix = """
                // v7.3 FIX: Salvar TOKEN no sessionStorage desta aba
                // Novas abas nao tem tabAuthToken, cai no localStorage errado
                if (!getTabToken()) {
                    var cookieToken = getCookie('authToken');
                    if (cookieToken) {
                        setTabToken(cookieToken);
                        debugLog('Token do cookie salvo nesta aba');
                    }
                }"""

if old_fix in content:
    content = content.replace(old_fix, '', 1)
    print('Removed old Fix 1 (getCookie approach)')
else:
    print('Old Fix 1 not found, continuing...')

# Now add the correct fix: in verifyAuth(), when server validates via cookie,
# copy localStorage token to sessionStorage AFTER server confirms the session.
# Find the "Sessao valida confirmada pelo servidor" block
old_block = """                debugLog('Sessao valida confirmada pelo servidor - salvando nesta aba');"""
if old_block not in content:
    # Try with accented characters
    old_block2 = "Sess"
    # Just search for the pattern around line 380-390 where server confirms session
    pass

# Better approach: find the second call to setTabUserData in verifyAuth
# The first one (line 293) is inside checkAuthentication
# The second one (around 385) is in verifyAuth when server-cookie validates
lines = content.split('\n')
insert_done = False
for i, line in enumerate(lines):
    if 'setTabUserData(serverUser);' in line and 'server-cookie' in '\n'.join(lines[max(0,i-5):i+10]):
        # This is the verifyAuth server-cookie block
        # Insert after this line: copy localStorage token to sessionStorage
        indent = '                '
        new_lines = [
            '',
            indent + '// v7.3 FIX: Copiar token do localStorage para sessionStorage desta aba',
            indent + '// O servidor confirmou a sessao via cookie, entao o localStorage tem token valido',
            indent + '// Precisamos salvar em sessionStorage para que getAuthHeaders() funcione isolado',
            indent + "if (!getTabToken()) {",
            indent + "    var lsToken = localStorage.getItem('authToken') || localStorage.getItem('token');",
            indent + "    if (lsToken && lsToken !== 'null') {",
            indent + "        setTabToken(lsToken);",
            indent + "        debugLog('Token copiado do localStorage para esta aba (server-cookie validou)');",
            indent + "    }",
            indent + "}",
        ]
        for j, new_line in enumerate(new_lines):
            lines.insert(i + 1 + j, new_line)
        insert_done = True
        print(f'Inserted fix after line {i+1} (server-cookie setTabUserData)')
        break

if not insert_done:
    # Fallback: find any setTabUserData(serverUser) that is NOT inside checkAuthentication
    for i, line in enumerate(lines):
        if 'setTabUserData(serverUser);' in line and i > 330:
            indent = '                '
            new_lines = [
                '',
                indent + '// v7.3 FIX: Copiar token do localStorage para sessionStorage desta aba',
                indent + "if (!getTabToken()) {",
                indent + "    var lsToken = localStorage.getItem('authToken') || localStorage.getItem('token');",
                indent + "    if (lsToken && lsToken !== 'null') {",
                indent + "        setTabToken(lsToken);",
                indent + "        debugLog('Token do localStorage copiado para sessionStorage');",
                indent + "    }",
                indent + "}",
            ]
            for j, new_line in enumerate(new_lines):
                lines.insert(i + 1 + j, new_line)
            insert_done = True
            print(f'Inserted fix (fallback) after line {i+1}')
            break

if not insert_done:
    print('ERROR: Could not find insertion point')
    for i, line in enumerate(lines):
        if 'setTabUserData' in line:
            print(f'  Found setTabUserData at line {i+1}: {line.strip()[:80]}')
else:
    content = '\n'.join(lines)
    with open('/var/www/aluforce/public/js/auth-unified.js', 'w', encoding='utf-8') as f:
        f.write(content)
    print('FIX1_v2 applied successfully')
