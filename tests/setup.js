/**
 * Test Environment Setup
 * 
 * Provides test database isolation and shared helpers.
 * Usage:
 *   TEST_DB_NAME=aluforce_test npx jest tests/integration/ --runInBand
 * 
 * If TEST_DB_NAME is set, tests use a separate DB (safe for mutations).
 * If not set, tests run read-only against the main DB.
 */

const TEST_CONFIG = {
    // Override via environment variables for CI/CD
    baseUrl: process.env.TEST_URL || 'http://localhost:3000',
    dbName: process.env.TEST_DB_NAME || null, // null = use main DB (read-only tests)
    adminEmail: process.env.TEST_ADMIN_EMAIL || 'admin@aluforce.com',
    adminPassword: process.env.TEST_ADMIN_PASSWORD || 'Admin@2026#Secure',
    timeout: parseInt(process.env.TEST_TIMEOUT) || 10000,
};

// Warn if running mutation tests against production DB
if (!TEST_CONFIG.dbName && process.env.NODE_ENV === 'production') {
    console.error('⛔ FATAL: Cannot run tests against production without TEST_DB_NAME set');
    process.exit(1);
}

if (!TEST_CONFIG.dbName) {
    console.warn('⚠️  TEST_DB_NAME not set — running in read-only mode against main DB');
}

module.exports = { TEST_CONFIG };
