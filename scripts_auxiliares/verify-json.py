import json, os

path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'api', 'arvore-produto-data.json')
d = json.load(open(path, 'r', encoding='utf-8'))

pr = d['parametros']['precos_kg']
desp = d['parametros']['despesas']
markup = d['parametros']['markup_pct']
tot_desp_pct = sum(desp.values())

print(f"Total products: {len(d['products'])}")
print(f"Markup: {markup}%")
print(f"Total despesas: {tot_desp_pct}%")
print()

# Verify first product
p = d['products'][0]
cmp = sum(p['kg_m'].get(k, 0) * v for k, v in pr.items())
preco = cmp * (1 + markup / 100)
mb = preco - cmp
mb_pct = (mb / preco) * 100
desp_total = preco * tot_desp_pct / 100
ml = preco - cmp - desp_total
ml_pct = (ml / preco) * 100

print(f"{p['codigo']}: CMP={cmp:.4f}, Preco={preco:.4f}, MB%={mb_pct:.2f}%, ML={ml:.4f}, ML%={ml_pct:.2f}%")

# Count categories
cats = {}
for p in d['products']:
    cats[p['categoria']] = cats.get(p['categoria'], 0) + 1
print()
for cat, count in sorted(cats.items()):
    print(f"  {cat}: {count}")
