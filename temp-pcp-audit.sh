#!/bin/bash
echo '=========================================='
echo '=== CMD 3: API calls in index.html ==='
echo '=========================================='
grep -oE '/api/pcp/[a-zA-Z0-9/_:?&=-]+' /var/www/aluforce/modules/PCP/index.html 2>/dev/null | sort -u
echo ''

echo '=========================================='
echo '=== CMD 3b: fetch URLs in index.html ==='
echo '=========================================='
grep -oE "fetch\(['\"\`][^'\"\`]+" /var/www/aluforce/modules/PCP/index.html 2>/dev/null | sort -u | head -80
echo ''

echo '=========================================='
echo '=== CMD 4: API calls ordens-producao.html ==='
echo '=========================================='
grep -oE '/api/pcp/[a-zA-Z0-9/_:?&=-]+' /var/www/aluforce/modules/PCP/ordens-producao.html 2>/dev/null | sort -u
echo ''

echo '=========================================='
echo '=== CMD 4b: fetch URLs ordens-producao.html ==='
echo '=========================================='
grep -oE "fetch\(['\"\`][^'\"\`]+" /var/www/aluforce/modules/PCP/ordens-producao.html 2>/dev/null | sort -u | head -80
echo ''

echo '=========================================='
echo '=== CMD 5: API calls apontamentos.html ==='
echo '=========================================='
grep -oE '/api/pcp/[a-zA-Z0-9/_:?&=-]+' /var/www/aluforce/modules/PCP/apontamentos.html 2>/dev/null | sort -u
echo ''

echo '=========================================='
echo '=== CMD 5b: fetch URLs apontamentos.html ==='
echo '=========================================='
grep -oE "fetch\(['\"\`][^'\"\`]+" /var/www/aluforce/modules/PCP/apontamentos.html 2>/dev/null | sort -u | head -80
echo ''

echo '=========================================='
echo '=== CMD 6: API calls relatorios.html ==='
echo '=========================================='
grep -oE '/api/pcp/[a-zA-Z0-9/_:?&=-]+' /var/www/aluforce/modules/PCP/pages/relatorios.html 2>/dev/null | sort -u
echo ''

echo '=========================================='
echo '=== CMD 6b: fetch URLs relatorios.html ==='
echo '=========================================='
grep -oE "fetch\(['\"\`][^'\"\`]+" /var/www/aluforce/modules/PCP/pages/relatorios.html 2>/dev/null | sort -u | head -80
echo ''

echo '=========================================='
echo '=== CMD 7: API calls estoque.html ==='
echo '=========================================='
grep -oE '/api/pcp/[a-zA-Z0-9/_:?&=-]+' /var/www/aluforce/modules/PCP/pages/estoque.html 2>/dev/null | sort -u
echo ''

echo '=========================================='
echo '=== CMD 7b: fetch URLs estoque.html ==='
echo '=========================================='
grep -oE "fetch\(['\"\`][^'\"\`]+" /var/www/aluforce/modules/PCP/pages/estoque.html 2>/dev/null | sort -u | head -80
echo ''

echo '=========================================='
echo '=== CMD 8: API calls materiais.html ==='
echo '=========================================='
grep -oE '/api/pcp/[a-zA-Z0-9/_:?&=-]+' /var/www/aluforce/modules/PCP/pages/materiais.html 2>/dev/null | sort -u
echo ''

echo '=========================================='
echo '=== CMD 8b: fetch URLs materiais.html ==='
echo '=========================================='
grep -oE "fetch\(['\"\`][^'\"\`]+" /var/www/aluforce/modules/PCP/pages/materiais.html 2>/dev/null | sort -u | head -80
echo ''

echo '=========================================='
echo '=== CMD 9: API calls gestao-producao.html ==='
echo '=========================================='
grep -oE '/api/pcp/[a-zA-Z0-9/_:?&=-]+' /var/www/aluforce/modules/PCP/pages/gestao-producao.html 2>/dev/null | sort -u
echo ''

echo '=========================================='
echo '=== CMD 9b: fetch URLs gestao-producao.html ==='
echo '=========================================='
grep -oE "fetch\(['\"\`][^'\"\`]+" /var/www/aluforce/modules/PCP/pages/gestao-producao.html 2>/dev/null | sort -u | head -80
echo ''

echo '=========================================='
echo '=== CMD 10: API calls faturamento.html ==='
echo '=========================================='
grep -oE '/api/pcp/[a-zA-Z0-9/_:?&=-]+' /var/www/aluforce/modules/PCP/pages/faturamento.html 2>/dev/null | sort -u
echo ''

echo '=========================================='
echo '=== CMD 10b: fetch URLs faturamento.html ==='
echo '=========================================='
grep -oE "fetch\(['\"\`][^'\"\`]+" /var/www/aluforce/modules/PCP/pages/faturamento.html 2>/dev/null | sort -u | head -80
echo ''

echo '=========================================='
echo '=== CMD 11: API calls ordem-compra.html ==='
echo '=========================================='
grep -oE '/api/pcp/[a-zA-Z0-9/_:?&=-]+' /var/www/aluforce/modules/PCP/pages/ordem-compra.html 2>/dev/null | sort -u
echo ''

echo '=========================================='
echo '=== CMD 11b: fetch URLs ordem-compra.html ==='
echo '=========================================='
grep -oE "fetch\(['\"\`][^'\"\`]+" /var/www/aluforce/modules/PCP/pages/ordem-compra.html 2>/dev/null | sort -u | head -80
echo ''

echo '=========================================='
echo '=== CMD 12: PCP routes mount in index.js ==='
echo '=========================================='
grep -n -i 'pcp' /var/www/aluforce/routes/index.js 2>/dev/null
echo ''

echo '=========================================='
echo '=== CMD 13: DB tables used by PCP ==='
echo '=========================================='
grep -oiE 'FROM [a-z_]+|INTO [a-z_]+|UPDATE [a-z_]+|JOIN [a-z_]+' /var/www/aluforce/routes/pcp-routes.js | sort -u
echo ''

echo '=== AUDIT COMPLETE ==='
