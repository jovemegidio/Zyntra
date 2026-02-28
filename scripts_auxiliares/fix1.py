import sys
with open('/var/www/aluforce/public/js/auth-unified.js', 'r', encoding='utf-8-sig') as f:
    lines = f.readlines()
new_lines = []
for i, line in enumerate(lines):
    new_lines.append(line)
    if 'setTabUserData(userData);' in line and i > 200:
        new_lines.append('\n')
        new_lines.append('                // v7.3 FIX: Salvar TOKEN no sessionStorage desta aba\n')
        new_lines.append('                // Novas abas nao tem tabAuthToken, cai no localStorage errado\n')
        new_lines.append('                if (!getTabToken()) {\n')
        new_lines.append("                    var cookieToken = getCookie('authToken');\n")
        new_lines.append('                    if (cookieToken) {\n')
        new_lines.append('                        setTabToken(cookieToken);\n')
        new_lines.append("                        debugLog('Token do cookie salvo nesta aba');\n")
        new_lines.append('                    }\n')
        new_lines.append('                }\n')
with open('/var/www/aluforce/public/js/auth-unified.js', 'w', encoding='utf-8') as f:
    f.writelines(new_lines)
print('FIX1_OK')
