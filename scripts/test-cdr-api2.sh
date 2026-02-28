#!/bin/bash
# Test NextBilling API with different auth approaches

BASE="https://sip10.tsinfo.net.br"

# Approach 1: MagnusBilling API with api_key in URL
echo "=== Test 1: API key in URL ==="
curl -sk "$BASE/index.php/cdr/read/api_key/Labor%40/api_secret/F.0582%239d5c%3F?page=1&start=0&limit=5" 2>/dev/null | head -c 500
echo ""

# Approach 2: API with Basic Auth  
echo "=== Test 2: Basic Auth ==="
curl -sk -u 'Labor@:F.0582#9d5c?' "$BASE/index.php/cdr/read?page=1&start=0&limit=5" 2>/dev/null | head -c 500
echo ""

# Approach 3: API with Authorization Bearer
echo "=== Test 3: Bearer token ==="
curl -sk -H "Authorization: Basic $(echo -n 'Labor@:F.0582#9d5c?' | base64)" "$BASE/index.php/cdr/read?page=1&start=0&limit=5" 2>/dev/null | head -c 500
echo ""

# Approach 4: Same session - Login + CDR in ONE curl command (no -o /dev/null)
echo "=== Test 4: Single connection ==="
curl -sk -c /tmp/nb_single.txt -b /tmp/nb_single.txt \
  --data-urlencode 'username=Labor@' \
  --data-urlencode 'password=F.0582#9d5c?' \
  --data-urlencode 'remind=1' \
  "$BASE/security/redirect" \
  -o /dev/null 2>/dev/null

# Immediate follow-up with SAME cookie
curl -sk -b /tmp/nb_single.txt \
  -H 'Referer: https://sip10.tsinfo.net.br/dashboard' \
  -H 'X-Requested-With: XMLHttpRequest' \
  -H 'Accept: application/json, text/javascript, */*' \
  "$BASE/index.php/cdr/read?page=1&start=0&limit=5" \
  -w "\nHTTP_CODE: %{http_code}\n" \
  2>/dev/null | tail -c 500
echo ""

# Approach 5: POST to /security/redirect and follow to /dashboard without losing session
echo "=== Test 5: Login and access /dashboard ==="
curl -sk -c /tmp/nb_s5.txt -b /tmp/nb_s5.txt \
  --data-urlencode 'username=Labor@' \
  --data-urlencode 'password=F.0582#9d5c?' \
  --data-urlencode 'remind=1' \
  "$BASE/security/redirect" \
  -o /dev/null 2>/dev/null

# Access dashboard (SPA page)
DASH_CODE=$(curl -sk -b /tmp/nb_s5.txt -c /tmp/nb_s5.txt \
  -H 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' \
  "$BASE/dashboard" \
  -w "%{http_code}" -o /tmp/nb_dash.html 2>/dev/null)
echo "Dashboard HTTP code: $DASH_CODE"
if [ "$DASH_CODE" = "200" ]; then
  echo "Dashboard loaded! Extracting JS endpoints..."
  grep -oP 'controller[^"]*|/index\.php/[^"]*' /tmp/nb_dash.html | head -20
fi
echo ""

echo "=== DONE ==="
