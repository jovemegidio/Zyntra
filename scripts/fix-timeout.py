import re
import sys

filepath = '/var/www/aluforce/routes/vendas-extended.js'

with open(filepath, 'r') as f:
    content = f.read()

count = 0

# Fix /ligacoes/dispositivos
old = "    // GET /ligacoes/dispositivos\n    router.get('/ligacoes/dispositivos', authorizeArea('vendas'), async (req, res) => {\n        try {"
new = "    // GET /ligacoes/dispositivos\n    router.get('/ligacoes/dispositivos', authorizeArea('vendas'), async (req, res) => {\n        req.setTimeout(180000); res.setTimeout(180000); // CDR scraper needs more time\n        try {"
if old in content:
    content = content.replace(old, new)
    count += 1
    print('Fixed: /ligacoes/dispositivos')
else:
    print('WARN: /ligacoes/dispositivos pattern not found')

# Fix /ligacoes/cdr  
old = "    // GET /ligacoes/cdr\n    router.get('/ligacoes/cdr', authorizeArea('vendas'), async (req, res) => {\n        try {"
new = "    // GET /ligacoes/cdr\n    router.get('/ligacoes/cdr', authorizeArea('vendas'), async (req, res) => {\n        req.setTimeout(180000); res.setTimeout(180000); // CDR scraper needs more time\n        try {"
if old in content:
    content = content.replace(old, new)
    count += 1
    print('Fixed: /ligacoes/cdr')
else:
    print('WARN: /ligacoes/cdr pattern not found')

# Fix /ligacoes/resumo
old = "    // GET /ligacoes/resumo\n    router.get('/ligacoes/resumo', authorizeArea('vendas'), async (req, res) => {\n        try {"
new = "    // GET /ligacoes/resumo\n    router.get('/ligacoes/resumo', authorizeArea('vendas'), async (req, res) => {\n        req.setTimeout(180000); res.setTimeout(180000); // CDR scraper needs more time\n        try {"
if old in content:
    content = content.replace(old, new)
    count += 1
    print('Fixed: /ligacoes/resumo')
else:
    print('WARN: /ligacoes/resumo pattern not found')

with open(filepath, 'w') as f:
    f.write(content)

print(f'Done: {count}/3 routes patched')
