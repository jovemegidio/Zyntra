import sys
with open('/var/www/aluforce/_shared/user-profile-loader.js', 'r', encoding='utf-8-sig') as f:
    content = f.read()
old = "const token = sessionStorage.getItem('authToken');"
new = "const token = sessionStorage.getItem('tabAuthToken') || sessionStorage.getItem('authToken') || localStorage.getItem('authToken');"
if old in content:
    content = content.replace(old, new, 1)
    with open('/var/www/aluforce/_shared/user-profile-loader.js', 'w', encoding='utf-8') as f:
        f.write(content)
    print('FIX3_OK')
else:
    print('ERROR: Pattern not found')
