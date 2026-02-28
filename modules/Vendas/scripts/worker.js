#!/usr/bin/env node
// Worker que processa jobs de agregação usando BullMQ
const { Worker, Queue } = require('bullmq');
const IORedis = (() => { try { return require('ioredis'); } catch (e) { return null; }})();
const mysql = require('mysql2/promise');

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const queueName = 'aggregates';

async function computeAndPersist() {
  const DB_CONFIG = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'vendas_db',
  };
  let pool = null;
  try {
    pool = mysql.createPool(DB_CONFIG);
    const now = new Date();
    const months = 12;
    const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
    const startStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-01`;

    const [rows] = await pool.query(
      `SELECT DATE_FORMAT(created_at, '%Y-%m') AS ym, COALESCE(SUM(CASE WHEN status = 'faturado' THEN valor ELSE 0 END), 0) AS total
       FROM pedidos
       WHERE created_at >= ?
       GROUP BY ym
       ORDER BY ym ASC`,
      [startStr]
    );

    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS dashboard_aggregates (
          ym VARCHAR(7) NOT NULL PRIMARY KEY,
          total DECIMAL(18,2) NOT NULL DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);
    } catch (e) {}

    const map = new Map();
    for (const r of rows) map.set(r.ym, Number(r.total || 0));
    const labels = [];
    const values = [];
    for (let i = 0; i < months; i++) {
      const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      labels.push(d.toLocaleString('pt-BR', { month: 'short', year: 'numeric' }));
      const v = map.has(ym) ? map.get(ym) : 0;
      values.push(v);
      try { await pool.query('INSERT INTO dashboard_aggregates (ym, total) VALUES (?, ?) ON DUPLICATE KEY UPDATE total = VALUES(total), created_at = CURRENT_TIMESTAMP', [ym, v]); } catch (e) { }
    }

    // top vendedores last 30 days
    const periodDays = 30;
    const startTop = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (periodDays - 1));
    const startTopStr = `${startTop.getFullYear()}-${String(startTop.getMonth() + 1).padStart(2, '0')}-${String(startTop.getDate()).padStart(2, '0')}`;
    const [topRows] = await pool.query(
      `SELECT u.id, u.nome, COALESCE(SUM(CASE WHEN p.status = 'faturado' THEN p.valor ELSE 0 END), 0) AS valor
       FROM pedidos p
       JOIN usuarios u ON p.vendedor_id = u.id
       WHERE p.created_at >= ?
       GROUP BY u.id, u.nome
       ORDER BY valor DESC
       LIMIT 10`,
      [startTopStr]
    );

    // write cache to Redis if available
    if (IORedis) {
      try {
        const r = new IORedis(REDIS_URL);
        await r.set('dashboard:monthly', JSON.stringify({ labels, values }), 'EX', 3600);
        await r.set('dashboard:top_vendedores', JSON.stringify(topRows.map(r => ({ id: r.id, nome: r.nome, valor: Number(r.valor || 0) }))), 'EX', 3600);
        r.disconnect();
      } catch (e) { /* ignore */ }
    }

    console.log('Aggregates computed and cached');
  } catch (e) {
    console.error('Worker compute error', e && e.message ? e.message : e);
    throw e;
  } finally {
    try { if (pool) await pool.end(); } catch (e) {}
  }
}

if (require.main === module) {
  // If started as script without queue, run single compute
  if (process.argv.includes('--once')) {
    computeAndPersist().then(() => process.exit(0)).catch(() => process.exit(1));
  } else {
    // start a BullMQ worker that will process jobs named 'compute'
    const connection = { connectionString: REDIS_URL };
    const worker = new Worker(queueName, async job => {
      console.log('Processing job', job.id, job.name);
      await computeAndPersist();
    }, { connection });

    worker.on('completed', job => console.log('Job completed', job.id));
    worker.on('failed', (job, err) => console.error('Job failed', job && job.id, err && err.message ? err.message : err));

    console.log('Worker started, listening for jobs on queue', queueName);
  }
}
