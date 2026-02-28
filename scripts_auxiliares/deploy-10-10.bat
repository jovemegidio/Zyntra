@echo off
REM === Deploy Enterprise Performance Files to VPS ===
set VPS=31.97.64.102
set USER=root
set PASS=Aluforce@2026#Vps
set REMOTE=/var/www/aluforce
set LOCAL="g:\Outros computadores\Meu laptop (2)\Sistema - ALUFORCE - V.2"

echo [1/8] Uploading rate-limiter-redis.js...
pscp -pw "%PASS%" %LOCAL%\services\rate-limiter-redis.js %USER%@%VPS%:%REMOTE%/services/rate-limiter-redis.js

echo [2/8] Uploading security-middleware.js...
pscp -pw "%PASS%" %LOCAL%\security-middleware.js %USER%@%VPS%:%REMOTE%/security-middleware.js

echo [3/8] Uploading ecosystem.config.js...
pscp -pw "%PASS%" %LOCAL%\ecosystem.config.js %USER%@%VPS%:%REMOTE%/ecosystem.config.js

echo [4/8] Uploading server.js...
pscp -pw "%PASS%" %LOCAL%\server.js %USER%@%VPS%:%REMOTE%/server.js

echo [5/8] Uploading fetch-utils.js...
pscp -pw "%PASS%" %LOCAL%\_shared\fetch-utils.js %USER%@%VPS%:%REMOTE%/_shared/fetch-utils.js

echo [6/8] Uploading chunk-loader.js...
pscp -pw "%PASS%" %LOCAL%\_shared\chunk-loader.js %USER%@%VPS%:%REMOTE%/_shared/chunk-loader.js

echo [7/8] Installing rate-limit-redis + Restarting PM2...
plink -ssh %USER%@%VPS% -pw "%PASS%" -batch "mkdir -p %REMOTE%/_shared && mkdir -p %REMOTE%/services && cd %REMOTE% && npm install rate-limit-redis --save --force 2>&1 | tail -3 && echo '---NPM-DONE---' && pm2 delete all 2>/dev/null; REDIS_URL=redis://localhost:6379 pm2 start ecosystem.config.js --env production && sleep 3 && pm2 list && echo '---PM2-DONE---'"

echo [8/8] Verifying deployment...
plink -ssh %USER%@%VPS% -pw "%PASS%" -batch "curl -s http://localhost:3000/api/health 2>&1 | python3 -m json.tool 2>/dev/null | head -20 && echo '---HEALTH-DONE---' && ls -la %REMOTE%/services/rate-limiter-redis.js %REMOTE%/_shared/fetch-utils.js %REMOTE%/_shared/chunk-loader.js && echo '---ALL-DONE---'"

echo ========================================
echo Deploy completed! Check output above.
echo ========================================
pause
