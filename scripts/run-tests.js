/**
 * ALUFORCE ERP - Test Runner
 * Automated test execution with comprehensive reporting
 * 
 * Usage:
 *   npm run test:all          - Run all tests
 *   npm run test:unit         - Run unit tests only
 *   npm run test:integration  - Run integration tests only
 *   npm run test:e2e          - Run E2E tests only
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

const log = {
  info: (msg) => console.log(`${COLORS.blue}[INFO]${COLORS.reset} ${msg}`),
  success: (msg) => console.log(`${COLORS.green}[PASS]${COLORS.reset} ${msg}`),
  error: (msg) => console.log(`${COLORS.red}[FAIL]${COLORS.reset} ${msg}`),
  warn: (msg) => console.log(`${COLORS.yellow}[WARN]${COLORS.reset} ${msg}`),
  header: (msg) => console.log(`\n${COLORS.cyan}${'='.repeat(60)}${COLORS.reset}\n${COLORS.cyan}${msg}${COLORS.reset}\n${COLORS.cyan}${'='.repeat(60)}${COLORS.reset}\n`)
};

const results = {
  unit: { passed: 0, failed: 0, skipped: 0, duration: 0 },
  integration: { passed: 0, failed: 0, skipped: 0, duration: 0 },
  e2e: { passed: 0, failed: 0, skipped: 0, duration: 0 }
};

function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const start = Date.now();
    const proc = spawn(command, args, {
      shell: true,
      cwd: process.cwd(),
      stdio: 'pipe',
      ...options
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
      process.stdout.write(data);
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
      process.stderr.write(data);
    });

    proc.on('close', (code) => {
      resolve({
        code,
        stdout,
        stderr,
        duration: Date.now() - start
      });
    });

    proc.on('error', (error) => {
      resolve({
        code: 1,
        stdout,
        stderr: error.message,
        duration: Date.now() - start
      });
    });
  });
}

async function runUnitTests() {
  log.header('UNIT TESTS');
  
  const result = await runCommand('npx', [
    'mocha',
    'tests/unit/**/*.test.js',
    '--timeout', '10000',
    '--reporter', 'spec'
  ]);

  results.unit.duration = result.duration;
  
  if (result.code === 0) {
    results.unit.passed = 1;
    log.success('Unit tests passed');
  } else {
    results.unit.failed = 1;
    log.error('Unit tests failed');
  }

  return result.code === 0;
}

async function runIntegrationTests() {
  log.header('INTEGRATION TESTS');
  
  const result = await runCommand('npx', [
    'mocha',
    'tests/integration/**/*.test.js',
    '--timeout', '30000',
    '--reporter', 'spec'
  ]);

  results.integration.duration = result.duration;
  
  if (result.code === 0) {
    results.integration.passed = 1;
    log.success('Integration tests passed');
  } else {
    results.integration.failed = 1;
    log.error('Integration tests failed');
  }

  return result.code === 0;
}

async function runE2ETests() {
  log.header('E2E TESTS');
  
  const result = await runCommand('npx', [
    'playwright', 'test',
    '--reporter=list'
  ]);

  results.e2e.duration = result.duration;
  
  if (result.code === 0) {
    results.e2e.passed = 1;
    log.success('E2E tests passed');
  } else {
    results.e2e.failed = 1;
    log.error('E2E tests failed');
  }

  return result.code === 0;
}

async function runCoverage() {
  log.header('COVERAGE ANALYSIS');
  
  const result = await runCommand('npx', [
    'nyc',
    '--reporter=text',
    '--reporter=html',
    '--reporter=json',
    'mocha',
    'tests/unit/**/*.test.js',
    'tests/integration/**/*.test.js',
    '--timeout', '30000'
  ]);

  return result.code === 0;
}

function generateReport() {
  log.header('TEST RESULTS SUMMARY');

  const report = {
    timestamp: new Date().toISOString(),
    version: require('./package.json').version,
    results: {
      unit: results.unit,
      integration: results.integration,
      e2e: results.e2e
    },
    summary: {
      totalPassed: results.unit.passed + results.integration.passed + results.e2e.passed,
      totalFailed: results.unit.failed + results.integration.failed + results.e2e.failed,
      totalDuration: results.unit.duration + results.integration.duration + results.e2e.duration
    },
    passRate: 0,
    status: 'UNKNOWN'
  };

  const total = report.summary.totalPassed + report.summary.totalFailed;
  report.passRate = total > 0 ? (report.summary.totalPassed / total * 100).toFixed(2) : 0;
  report.status = report.summary.totalFailed === 0 ? 'PASSED' : 'FAILED';

  console.log(`
┌─────────────────────────────────────────────────────────┐
│                    TEST RESULTS                         │
├─────────────────────────────────────────────────────────┤
│ Unit Tests:        ${results.unit.failed === 0 ? '✅ PASSED' : '❌ FAILED'}                            │
│ Integration Tests: ${results.integration.failed === 0 ? '✅ PASSED' : '❌ FAILED'}                            │
│ E2E Tests:         ${results.e2e.failed === 0 ? '✅ PASSED' : '❌ FAILED'}                            │
├─────────────────────────────────────────────────────────┤
│ Pass Rate:         ${report.passRate}%                                  │
│ Total Duration:    ${(report.summary.totalDuration / 1000).toFixed(2)}s                              │
│ Overall Status:    ${report.status === 'PASSED' ? '✅ PASSED' : '❌ FAILED'}                            │
└─────────────────────────────────────────────────────────┘
`);

  // Save report to file
  const reportPath = path.join(__dirname, 'coverage', 'test-report.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  log.info(`Report saved to ${reportPath}`);

  return report;
}

async function main() {
  const args = process.argv.slice(2);
  const testType = args[0] || 'all';

  log.header('ALUFORCE ERP - Automated Test Suite');
  log.info(`Running: ${testType} tests`);
  log.info(`Date: ${new Date().toLocaleString()}`);

  let success = true;

  try {
    switch (testType) {
      case 'unit':
        success = await runUnitTests();
        break;
      case 'integration':
        success = await runIntegrationTests();
        break;
      case 'e2e':
        success = await runE2ETests();
        break;
      case 'coverage':
        success = await runCoverage();
        break;
      case 'all':
      default:
        const unitOk = await runUnitTests();
        const intOk = await runIntegrationTests();
        const e2eOk = await runE2ETests();
        success = unitOk && intOk && e2eOk;
        break;
    }

    const report = generateReport();
    
    if (report.status === 'FAILED') {
      log.error('Some tests failed. Check the report for details.');
      process.exit(1);
    } else {
      log.success('All tests passed successfully!');
      process.exit(0);
    }
  } catch (error) {
    log.error(`Test execution error: ${error.message}`);
    process.exit(1);
  }
}

main();
