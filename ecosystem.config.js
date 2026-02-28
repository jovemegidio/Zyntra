// ecosystem.config.js - Configuração PM2 para desenvolvimento e produção
const isProduction = process.env.NODE_ENV === 'production';

module.exports = {
  apps: [{
    name: 'aluforce-dashboard',
    script: 'server.js',
    instances: isProduction ? 'max' : 1,
    exec_mode: isProduction ? 'cluster' : 'fork',
    env: {
      NODE_ENV: 'development',
      PORT: 3000
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000,
      SKIP_MIGRATIONS: '1',
      DB_CONN_LIMIT: '200',
      DB_QUERY_TIMEOUT: '15000',
      REQUEST_TIMEOUT: '30000',
      REDIS_URL: 'redis://localhost:6379'
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true,
    watch: !isProduction,  // Watch apenas em dev, desabilitado em produção
    watch_delay: 1000,
    max_memory_restart: '1G',
    node_args: '--max-old-space-size=4096',
    kill_timeout: 5000,
    wait_ready: true,
    listen_timeout: 10000,
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s',
    ignore_watch: [
      'node_modules',
      'logs',
      'uploads',
      'dist',
      'backups',
      '*.log',
      '*.sql',
      '*.md',
      '*.txt',
      '.git',
      '.vscode',
      'tests'
    ],
    watch_options: {
      followSymlinks: false,
      usePolling: false
    }
  }]
};