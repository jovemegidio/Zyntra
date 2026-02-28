#!/bin/bash
# Test MagnusBilling API - Various Authentication Methods
BASE="https://sip10.tsinfo.net.br"
USER="Labor@"
PASS='F.0582#9d5c?'

echo "=============================================="
echo "TEST 1: MagnusBilling API format with user/pass in URL"
echo "=============================================="
curl -sk "${BASE}/index.php/cdr/read/username/${USER}/password/${PASS}" -o /tmp/mb_test1.txt 2>/dev/null
head -c 500 /tmp/mb_test1.txt
echo ""

echo ""
echo "=============================================="
echo "TEST 2: MagnusBilling POST login + session"
echo "=============================================="
curl -sk -c /tmp/mb_cookies.txt -D /tmp/mb_headers.txt \
  -X POST "${BASE}/index.php/authentication/login" \
  -d "username=${USER}&password=${PASS}" \
  -o /tmp/mb_test2.txt 2>/dev/null
echo "Headers:"
cat /tmp/mb_headers.txt
echo "Response:"
head -c 500 /tmp/mb_test2.txt
echo ""

echo ""
echo "=============================================="
echo "TEST 3: Login via security/login endpoint"
echo "=============================================="
curl -sk -c /tmp/mb_cookies3.txt -D /tmp/mb_headers3.txt \
  -X POST "${BASE}/security/login" \
  -d "LoginForm[username]=${USER}&LoginForm[password]=${PASS}&LoginForm[rememberMe]=1" \
  -o /tmp/mb_test3.txt 2>/dev/null
echo "Headers:"
cat /tmp/mb_headers3.txt
echo "Response:"
head -c 500 /tmp/mb_test3.txt
echo ""

echo ""
echo "=============================================="
echo "TEST 4: Login then CDR read with cookies from Test 3"
echo "=============================================="
curl -sk -b /tmp/mb_cookies3.txt \
  -X POST "${BASE}/index.php/cdr/read" \
  -d "page=1&start=0&limit=25" \
  -H "X-Requested-With: XMLHttpRequest" \
  -o /tmp/mb_test4.txt 2>/dev/null
head -c 500 /tmp/mb_test4.txt
echo ""

echo ""
echo "=============================================="
echo "TEST 5: JSON login attempt"
echo "=============================================="
curl -sk -c /tmp/mb_cookies5.txt \
  -X POST "${BASE}/index.php/authentication/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"${USER}\",\"password\":\"${PASS}\"}" \
  -o /tmp/mb_test5.txt 2>/dev/null
head -c 500 /tmp/mb_test5.txt
echo ""

echo ""
echo "=============================================="
echo "TEST 6: Login via /mbilling/index.php"
echo "=============================================="
curl -sk -c /tmp/mb_cookies6.txt \
  -X POST "${BASE}/mbilling/index.php/authentication/login" \
  -d "username=${USER}&password=${PASS}" \
  -o /tmp/mb_test6.txt 2>/dev/null
head -c 200 /tmp/mb_test6.txt
echo ""

echo ""
echo "=============================================="
echo "TEST 7: Direct CDR with creds in POST body"
echo "=============================================="
curl -sk -X POST "${BASE}/index.php/cdr/read" \
  -d "username=${USER}&password=${PASS}&page=1&start=0&limit=25" \
  -H "X-Requested-With: XMLHttpRequest" \
  -o /tmp/mb_test7.txt 2>/dev/null
head -c 500 /tmp/mb_test7.txt
echo ""

echo ""
echo "=============================================="
echo "TEST 8: Check /index.php main page structure"
echo "=============================================="
curl -sk "${BASE}/index.php" -o /tmp/mb_test8.txt 2>/dev/null
grep -i "login\|csrf\|token\|form\|action\|session" /tmp/mb_test8.txt | head -20
echo ""

echo ""
echo "=============================================="
echo "TEST 9: Login via Yii standard CSRF flow"
echo "=============================================="
# Step 1: Get the login page and extract CSRF token
CSRF=$(curl -sk -c /tmp/mb_cookies9.txt "${BASE}/index.php" | grep -oP 'csrf[_-]token["\s]*content="[^"]*"' | grep -oP 'content="[^"]*"' | grep -oP '"[^"]*"' | tr -d '"')
echo "CSRF Token: ${CSRF}"

# Step 2: Login with CSRF
curl -sk -b /tmp/mb_cookies9.txt -c /tmp/mb_cookies9.txt \
  -X POST "${BASE}/security/redirect" \
  -d "LoginForm[username]=${USER}&LoginForm[password]=${PASS}&LoginForm[rememberMe]=1&_csrf=${CSRF}" \
  -D /tmp/mb_headers9.txt \
  -o /tmp/mb_test9.txt 2>/dev/null
echo "Login headers:"
cat /tmp/mb_headers9.txt
echo ""

# Step 3: Try CDR with the session
curl -sk -b /tmp/mb_cookies9.txt \
  -X POST "${BASE}/index.php/cdr/read" \
  -d "page=1&start=0&limit=25" \
  -H "X-Requested-With: XMLHttpRequest" \
  -o /tmp/mb_test9b.txt 2>/dev/null
echo "CDR Response:"
head -c 500 /tmp/mb_test9b.txt
echo ""

echo ""
echo "=============================================="
echo "TEST 10: Check what the login redirect gives us"
echo "=============================================="
curl -sk -b /tmp/mb_cookies9.txt -L "${BASE}/dashboard" \
  -o /tmp/mb_test10.txt 2>/dev/null
grep -oP 'api_key["\s:=]*["\x27][^"\x27]*["\x27]' /tmp/mb_test10.txt | head -5
grep -oP 'api_secret["\s:=]*["\x27][^"\x27]*["\x27]' /tmp/mb_test10.txt | head -5
grep -oP 'token["\s:=]*["\x27][^"\x27]*["\x27]' /tmp/mb_test10.txt | head -5
echo "Page size: $(wc -c < /tmp/mb_test10.txt) bytes"
echo ""

echo "DONE"
