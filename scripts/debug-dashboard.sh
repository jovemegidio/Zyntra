#!/bin/bash
TOKEN=$(python3 -c "import json; print(json.load(open('/tmp/login_resp.json'))['token'])" 2>/dev/null)
echo "Token: ${TOKEN:0:30}..."

# Fetch index.html with auth token
BODY=$(curl -s http://localhost:3000/index.html -b "authToken=$TOKEN")
LINES=$(echo "$BODY" | wc -l)
echo "Response lines: $LINES"

# Check for our changes
echo "Has hellen email: $(echo "$BODY" | grep -c 'hellen.nascimento')"
echo "Has emailPermissions: $(echo "$BODY" | grep -c 'emailPermissions')"
echo "Has applyModulePermissions: $(echo "$BODY" | grep -c 'applyModulePermissions')"
echo "Has Buscar dados: $(echo "$BODY" | grep -c 'Buscar dados atualizados')"
echo "Has module-card: $(echo "$BODY" | grep -c 'module-card')"

# Also check what URL dashboard redirects to
echo ""
echo "--- Dashboard redirect ---"
curl -sI http://localhost:3000/dashboard -b "authToken=$TOKEN" | grep -i 'location\|HTTP'

# Check if there's a /dashboard route
echo ""
echo "--- /dashboard body check ---"
DASH=$(curl -s http://localhost:3000/dashboard -b "authToken=$TOKEN" -L)
DASH_LINES=$(echo "$DASH" | wc -l)
echo "Dashboard body lines: $DASH_LINES"
echo "Has module-card: $(echo "$DASH" | grep -c 'module-card')"
echo "Has hellen email: $(echo "$DASH" | grep -c 'hellen.nascimento')"
echo "Has applyModulePermissions: $(echo "$DASH" | grep -c 'applyModulePermissions')"
