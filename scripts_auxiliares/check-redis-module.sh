#!/bin/bash
echo "=== Check redis module ==="
cd /var/www/aluforce
ls -la node_modules/redis/package.json 2>&1
ls -la node_modules/redis/dist/index.js 2>&1

echo "=== Test require('redis') ==="
node -e "try { const r = require('redis'); console.log('REDIS MODULE OK - version:', r.createClient ? 'v4+' : 'v3-'); } catch(e) { console.log('REDIS ERROR:', e.message); }" 2>&1

echo "=== Check @redis scope ==="
ls -la node_modules/@redis/ 2>&1 | head -10

echo "=== Check REDIS_URL env ==="
pm2 env 0 2>&1 | grep -i redis

echo "=== PM2 logs - redis related ==="
pm2 logs --nostream --lines 30 2>&1 | grep -iE "redis|cache|rate.limit" | tail -15

echo "=== DONE ==="
