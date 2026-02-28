try {
    const p = require('puppeteer-core');
    console.log('puppeteer-core: OK');
} catch(err) {
    console.log('puppeteer-core FAIL:', err.message);
}
