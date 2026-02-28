#!/bin/bash
cd /var/www/aluforce
echo "=== Installing rate-limit-redis ==="
npm install rate-limit-redis --save --force 2>&1 | tail -8
echo "=== Checking install ==="
ls -la node_modules/rate-limit-redis/package.json 2>&1
echo "=== Restarting PM2 ==="
pm2 delete all 2>/dev/null
export REDIS_URL=redis://localhost:6379
pm2 start ecosystem.config.js --env production 2>&1
sleep 5
echo "=== PM2 Status ==="
pm2 list
echo "=== PM2 Logs (last 20) ==="
pm2 logs --nostream --lines 20 2>&1
echo "=== Health Check ==="
curl -s http://localhost:3000/api/health 2>&1 | head -20
echo ""
echo "=== File Verification ==="
ls -la /var/www/aluforce/services/rate-limiter-redis.js
ls -la /var/www/aluforce/_shared/fetch-utils.js
ls -la /var/www/aluforce/_shared/chunk-loader.js
ls -la /var/www/aluforce/node_modules/rate-limit-redis/package.json 2>&1
echo "=== ALL DONE ==="
