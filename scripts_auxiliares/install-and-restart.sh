#!/bin/bash
# Install rate-limit-redis via temp directory (avoids broken package.json)
set -e

echo "=== Creating temp install dir ==="
rm -rf /tmp/rl-install
mkdir -p /tmp/rl-install
cd /tmp/rl-install
echo '{"name":"temp","version":"1.0.0"}' > package.json

echo "=== Installing rate-limit-redis ==="
npm install rate-limit-redis 2>&1 | tail -5

echo "=== Copying to aluforce node_modules ==="
cp -r /tmp/rl-install/node_modules/rate-limit-redis /var/www/aluforce/node_modules/

echo "=== Verifying ==="
ls -la /var/www/aluforce/node_modules/rate-limit-redis/package.json
grep '"version"' /var/www/aluforce/node_modules/rate-limit-redis/package.json

echo "=== Restarting PM2 ==="
cd /var/www/aluforce
pm2 delete all 2>/dev/null || true
export REDIS_URL=redis://localhost:6379
pm2 start ecosystem.config.js --env production 2>&1

echo "=== Waiting for startup ==="
sleep 6

echo "=== PM2 Status ==="
pm2 list

echo "=== PM2 Logs (last 30) ==="
pm2 logs --nostream --lines 30 2>&1

echo "=== Health Check ==="
curl -s http://localhost:3000/api/health 2>&1 | head -25

echo "=== File Check ==="
ls -la /var/www/aluforce/services/rate-limiter-redis.js 2>&1
ls -la /var/www/aluforce/_shared/fetch-utils.js 2>&1
ls -la /var/www/aluforce/_shared/chunk-loader.js 2>&1

echo "=== ALL DONE ==="
