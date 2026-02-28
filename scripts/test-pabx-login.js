// Quick test of CDR PABX login
const puppeteer = require('puppeteer-core');

async function testLogin() {
    console.log('Starting Chromium...');
    const browser = await puppeteer.launch({
        executablePath: '/snap/bin/chromium',
        headless: 'new',
        protocolTimeout: 120000,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--ignore-certificate-errors', '--single-process', '--no-zygote']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    console.log('Navigating to sip10.tsinfo.net.br...');
    await page.goto('https://sip10.tsinfo.net.br', { waitUntil: 'networkidle2', timeout: 30000 });
    
    const url1 = page.url();
    console.log('Initial URL:', url1);
    console.log('Title:', await page.title());

    // Check if form fields exist
    const hasUsername = await page.$('#username');
    const hasPassword = await page.$('#password');
    const hasSubmit = await page.$('button[type="submit"]');
    console.log('Has #username:', !!hasUsername);
    console.log('Has #password:', !!hasPassword);
    console.log('Has submit button:', !!hasSubmit);

    // Type credentials
    console.log('Typing credentials: Labor@ / F.0582#9d5c?');
    await page.type('#username', 'Labor@', { delay: 50 });
    await page.type('#password', 'F.0582#9d5c?', { delay: 50 });

    // Submit
    console.log('Clicking submit...');
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(e => console.log('Nav timeout:', e.message)),
        page.click('button[type="submit"]')
    ]);

    await new Promise(r => setTimeout(r, 3000));

    const url2 = page.url();
    console.log('After login URL:', url2);
    console.log('After login title:', await page.title());

    // Check for error messages on the page
    const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500));
    console.log('Page text (first 500):', bodyText);

    // Screenshot for debugging
    await page.screenshot({ path: '/tmp/cdr-login-test.png' });
    console.log('Screenshot saved to /tmp/cdr-login-test.png');

    await browser.close();
    console.log('Done');
}

testLogin().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
