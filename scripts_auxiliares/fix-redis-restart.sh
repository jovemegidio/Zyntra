#!/bin/bash
# Fix redis npm client + restart PM2
cd /tmp/rl-install
npm install redis 2>&1 | tail -5

echo "=== Copying redis modules ==="
cp -r node_modules/redis /var/www/aluforce/node_modules/
cp -r node_modules/@redis /var/www/aluforce/node_modules/ 2>/dev/null || true

echo "=== Verify redis client ==="
ls -la /var/www/aluforce/node_modules/redis/package.json
grep version /var/www/aluforce/node_modules/redis/package.json | head -1

echo "=== Increase inotify watchers ==="
echo 524288 > /proc/sys/fs/inotify/max_user_watches
echo "fs.inotify.max_user_watches=524288" >> /etc/sysctl.conf 2>/dev/null
sysctl -p 2>/dev/null | grep inotify

echo "=== Restart PM2 ==="
cd /var/www/aluforce
pm2 delete all 2>/dev/null || true
export REDIS_URL=redis://localhost:6379
pm2 start ecosystem.config.js --env production --no-watch 2>&1 | tail -5
sleep 6
pm2 list

echo "=== Last 15 logs ==="
pm2 logs --nostream --lines 15 2>&1 | grep -E "CACHE|RATE|Redis|redis|REDIS|health|Error|error" | tail -20

echo "=== Health ==="
curl -s http://localhost:3000/api/health 2>&1 | head -30

echo "=== DONE ==="
