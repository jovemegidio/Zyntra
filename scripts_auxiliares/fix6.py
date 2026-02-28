import sys
with open('/var/www/aluforce/modules/Vendas/public/index.html', 'r', encoding='utf-8-sig') as f:
    content = f.read()

count = 0

# Fix 1: Line 9179 pattern
old1 = "const token = localStorage.getItem('authToken') || localStorage.getItem('token') || sessionStorage.getItem('authToken');"
new1 = "const token = sessionStorage.getItem('tabAuthToken') || localStorage.getItem('authToken') || localStorage.getItem('token') || sessionStorage.getItem('authToken');"
if old1 in content:
    content = content.replace(old1, new1)
    count += content.count(new1)
    print(f'Fix applied for pattern 1 ({count} occurrences)')

# Fix 2: Line 13996 multi-line pattern  
old2 = """let token = localStorage.getItem('authToken') ||
                            localStorage.getItem('token') ||
                            sessionStorage.getItem('authToken') ||
                            sessionStorage.getItem('token');"""
new2 = """let token = sessionStorage.getItem('tabAuthToken') ||
                            localStorage.getItem('authToken') ||
                            localStorage.getItem('token') ||
                            sessionStorage.getItem('authToken') ||
                            sessionStorage.getItem('token');"""
if old2 in content:
    content = content.replace(old2, new2)
    count += 1
    print('Fix applied for pattern 2')

if count > 0:
    with open('/var/www/aluforce/modules/Vendas/public/index.html', 'w', encoding='utf-8') as f:
        f.write(content)
    print(f'FIX6_OK ({count} fixes total)')
else:
    print('ERROR: No patterns found')
