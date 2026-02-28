#!/bin/bash
# Install rate-limit-redis directly into node_modules without touching package.json
cd /var/www/aluforce

# Install via npm with --no-save to skip package.json
npm install rate-limit-redis --no-save --force 2>&1 | tail -5
echo "---NPM-STATUS: $?---"

# Verify
if [ -f node_modules/rate-limit-redis/package.json ]; then
    echo "rate-limit-redis INSTALLED OK"
    cat node_modules/rate-limit-redis/package.json | grep version | head -1
else
    echo "rate-limit-redis NOT FOUND - trying manual install..."
    # Alternative: use npm pack + extract
    cd /tmp
    npm pack rate-limit-redis 2>&1 | tail -3
    if ls rate-limit-redis-*.tgz 1>/dev/null 2>&1; then
        mkdir -p /var/www/aluforce/node_modules/rate-limit-redis
        tar -xzf rate-limit-redis-*.tgz -C /var/www/aluforce/node_modules/rate-limit-redis --strip-components=1
        rm -f rate-limit-redis-*.tgz
        echo "rate-limit-redis manually extracted"
    fi
fi

echo "---INSTALL-COMPLETE---"
