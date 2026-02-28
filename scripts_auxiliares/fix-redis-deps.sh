#!/bin/bash
# Install ALL redis dependencies properly
cd /tmp
rm -rf redis-full
mkdir redis-full
cd redis-full
echo '{"name":"temp","version":"1.0.0"}' > package.json

echo "=== Installing redis with all deps ==="
npm install redis 2>&1 | tail -5

echo "=== Listing installed packages ==="
ls node_modules/

echo "=== Copying ALL packages to aluforce ==="
for pkg in node_modules/*; do
    pkgname=$(basename "$pkg")
    if [ "$pkgname" != ".package-lock.json" ]; then
        rm -rf /var/www/aluforce/node_modules/$pkgname
        cp -r "$pkg" /var/www/aluforce/node_modules/$pkgname
    fi
done

# Also handle scoped packages
if [ -d "node_modules/@redis" ]; then
    mkdir -p /var/www/aluforce/node_modules/@redis
    for pkg in node_modules/@redis/*; do
        pkgname=$(basename "$pkg")
        rm -rf /var/www/aluforce/node_modules/@redis/$pkgname
        cp -r "$pkg" /var/www/aluforce/node_modules/@redis/$pkgname
    done
fi

echo "=== Verifying key modules ==="
ls /var/www/aluforce/node_modules/redis/package.json 2>&1
ls /var/www/aluforce/node_modules/cluster-key-slot/package.json 2>&1
ls /var/www/aluforce/node_modules/@redis/client/package.json 2>&1
ls /var/www/aluforce/node_modules/rate-limit-redis/package.json 2>&1

echo "=== Testing require('redis') ==="
cd /var/www/aluforce
node -e "try { const r = require('redis'); console.log('REDIS MODULE OK'); } catch(e) { console.log('ERROR:', e.message); }" 2>&1

echo "=== Restarting PM2 ==="
pm2 delete all 2>/dev/null || true
export REDIS_URL=redis://localhost:6379
pm2 start ecosystem.config.js --env production 2>&1 | tail -3
sleep 8
pm2 list

echo "=== Logs ==="
pm2 logs --nostream --lines 20 2>&1 | grep -iE "redis|cache|rate.limit|🚀|⚡|📦|error" | tail -20

echo "=== Health ==="
curl -s http://localhost:3000/api/health 2>&1 | head -30

echo "=== COMPLETE ==="
