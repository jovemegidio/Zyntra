#!/bin/bash
cd /var/www/aluforce
# Check if redis is already in node_modules
if [ -d "node_modules/redis" ]; then
    echo "Redis already installed"
    node -e "console.log('redis version:', require('redis/package.json').version)"
else
    npm install redis --force 2>&1
fi

# Verify
node -e "const r = require('redis'); console.log('Redis client OK:', typeof r.createClient)"
