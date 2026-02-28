#!/bin/bash
cd /var/www/aluforce
npm install rate-limit-redis --save --force 2>&1 | tail -10
echo "---INSTALL_STATUS---"
ls -la node_modules/rate-limit-redis/package.json 2>&1
echo "---DONE---"
