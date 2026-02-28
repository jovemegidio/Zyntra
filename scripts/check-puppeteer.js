try {
    require('puppeteer-core');
    console.log('OK');
} catch(e) {
    console.log('FAIL:', e.message);
}
