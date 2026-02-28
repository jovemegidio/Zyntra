#!/bin/bash
# Test NextBilling/MagnusBilling CDR API

COOKIE_JAR="/tmp/nb_session.txt"
BASE="https://sip10.tsinfo.net.br"

# Step 1: Login
echo "=== Step 1: Login ==="
rm -f "$COOKIE_JAR"
LOGIN_RESP=$(curl -sk -c "$COOKIE_JAR" \
  --data-urlencode 'username=Labor@' \
  --data-urlencode 'password=F.0582#9d5c?' \
  --data-urlencode 'remind=1' \
  "$BASE/security/redirect" \
  -D- -o /dev/null 2>/dev/null)

echo "$LOGIN_RESP" | grep -i 'location\|set-cookie'
echo "Cookie jar:"
cat "$COOKIE_JAR"
echo ""

# Step 2: Try accessing main page with AJAX header  
echo "=== Step 2: Main page ==="
curl -sk -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
  "$BASE/" \
  -D- -o /dev/null 2>/dev/null | grep -i 'location\|set-cookie' | head -5

echo ""

# Step 3: Try CDR endpoint as AJAX
echo "=== Step 3: CDR Read ==="
CDR_RESP=$(curl -sk -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
  -H 'X-Requested-With: XMLHttpRequest' \
  -H 'Accept: application/json' \
  "$BASE/index.php/cdr/read?page=1&start=0&limit=5" \
  2>/dev/null)
echo "$CDR_RESP" | head -c 1000
echo ""

# Step 4: Try report/callSummary endpoint
echo "=== Step 4: Report Read ==="
RPT_RESP=$(curl -sk -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
  -H 'X-Requested-With: XMLHttpRequest' \
  -H 'Accept: application/json' \
  "$BASE/index.php/callSummary/read?page=1&start=0&limit=5" \
  2>/dev/null)
echo "$RPT_RESP" | head -c 1000
echo ""

# Step 5: Try with POST
echo "=== Step 5: CDR Read POST ==="
CDR_POST=$(curl -sk -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
  -X POST \
  -H 'X-Requested-With: XMLHttpRequest' \
  -H 'Accept: application/json' \
  -d 'page=1&start=0&limit=5' \
  "$BASE/index.php/cdr/read" \
  2>/dev/null)
echo "$CDR_POST" | head -c 1000
echo ""

# Step 6: Try /module/callSummaryByDay
echo "=== Step 6: callSummaryByDay ==="
DAILY=$(curl -sk -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
  -H 'X-Requested-With: XMLHttpRequest' \
  -H 'Accept: application/json' \
  "$BASE/index.php/callSummaryByDay/read?page=1&start=0&limit=5" \
  2>/dev/null)
echo "$DAILY" | head -c 1000
echo ""

echo "=== DONE ==="
