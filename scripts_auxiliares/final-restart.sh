#!/bin/bash
cd /var/www/aluforce
echo "=== Stopping PM2 ==="
pm2 delete all 2>/dev/null || true
sleep 2

echo "=== Starting PM2 (production) ==="
export NODE_ENV=production
export REDIS_URL=redis://localhost:6379
pm2 start ecosystem.config.js --env production 2>&1 | tail -5

echo "=== Waiting 8s for startup ==="
sleep 8

echo "=== PM2 List ==="
pm2 list

echo "=== Relevant Logs ==="
pm2 logs --nostream --lines 20 2>&1 | grep -iE "redis|cache|rate.limit|health|error|RATE|enterprise|online|starting|🚀|⚡|📦" | tail -25

echo "=== Health Endpoint ==="
curl -s http://localhost:3000/api/health 2>&1 | head -30

echo "=== FINAL STATUS ==="
echo "Redis server: $(redis-cli ping 2>&1)"
echo "rate-limit-redis: $(ls /var/www/aluforce/node_modules/rate-limit-redis/package.json 2>&1)"
echo "redis client: $(ls /var/www/aluforce/node_modules/redis/package.json 2>&1)"
echo "fetch-utils: $(ls /var/www/aluforce/_shared/fetch-utils.js 2>&1)"
echo "chunk-loader: $(ls /var/www/aluforce/_shared/chunk-loader.js 2>&1)"
echo "=== ALL DONE ==="
