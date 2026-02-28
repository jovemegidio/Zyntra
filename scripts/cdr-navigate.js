/**
 * CDR Scraper - Navega até Relatórios > Ligações Efetuadas e captura dados
 */
const puppeteer = require('puppeteer-core');

const CONFIG = {
    url: 'https://sip10.tsinfo.net.br',
    username: 'Labor@',
    password: 'F.0582#9d5c?',
    chromiumPath: '/snap/bin/chromium'
};

async function scrapeCDR() {
    const browser = await puppeteer.launch({
        executablePath: CONFIG.chromiumPath,
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--ignore-certificate-errors']
    });
    
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });
        
        // Track ALL AJAX requests
        const ajaxRequests = [];
        page.on('request', (request) => {
            if (request.resourceType() === 'xhr' || request.resourceType() === 'fetch') {
                ajaxRequests.push({
                    url: request.url(),
                    method: request.method(),
                    postData: request.postData(),
                    headers: request.headers()
                });
            }
        });
        
        const ajaxResponses = [];
        page.on('response', async (response) => {
            const url = response.url();
            const contentType = response.headers()['content-type'] || '';
            if ((response.request().resourceType() === 'xhr' || response.request().resourceType() === 'fetch') && contentType.includes('json')) {
                try {
                    const data = await response.text();
                    ajaxResponses.push({ url, data: data.substring(0, 3000) });
                } catch (e) {}
            }
        });
        
        // Login
        console.log('[CDR] Logging in...');
        await page.goto(CONFIG.url, { waitUntil: 'networkidle2', timeout: 30000 });
        await page.type('#username', CONFIG.username, { delay: 30 });
        await page.type('#password', CONFIG.password, { delay: 30 });
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
            page.click('button[type="submit"]')
        ]);
        await new Promise(r => setTimeout(r, 3000));
        console.log('[CDR] Logged in! URL:', page.url());
        
        // Clear tracked requests
        ajaxRequests.length = 0;
        ajaxResponses.length = 0;
        
        // Find and click "Relatórios" menu
        console.log('[CDR] Looking for Relatórios menu...');
        
        const menuClicked = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a'));
            for (const link of links) {
                const text = link.innerText.trim();
                if (text === 'Relatórios') {
                    link.click();
                    return true;
                }
            }
            return false;
        });
        
        console.log('[CDR] Relatórios menu clicked:', menuClicked);
        await new Promise(r => setTimeout(r, 1000));
        
        // Take screenshot after clicking Relatórios
        await page.screenshot({ path: '/tmp/cdr-menu-open.png' });
        
        // Find and click "Ligações Efetuadas"
        console.log('[CDR] Looking for Ligações Efetuadas...');
        
        const subMenuClicked = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a'));
            for (const link of links) {
                const text = link.innerText.trim();
                if (text.includes('Liga') && text.includes('Efetuadas')) {
                    link.click();
                    return text;
                }
            }
            return null;
        });
        
        console.log('[CDR] Ligações Efetuadas clicked:', subMenuClicked);
        
        // Wait for data to load
        await new Promise(r => setTimeout(r, 5000));
        await page.screenshot({ path: '/tmp/cdr-ligacoes.png' });
        
        // Print AJAX requests
        console.log('\n[CDR] AJAX Requests made:');
        ajaxRequests.forEach(r => {
            console.log(`  ${r.method} ${r.url}`);
            if (r.postData) console.log(`    POST Data: ${r.postData}`);
        });
        
        console.log('\n[CDR] AJAX JSON Responses:');
        ajaxResponses.forEach(r => {
            console.log(`  URL: ${r.url}`);
            console.log(`  Data: ${r.data}`);
        });
        
        // Check current URL
        console.log('\n[CDR] Current URL:', page.url());
        
        // Check if there's a new iframe
        const iframes = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('iframe')).map(f => ({
                src: f.src,
                id: f.id,
                name: f.name
            }));
        });
        console.log('[CDR] Iframes after navigation:', JSON.stringify(iframes));
        
        // Check page content for table data
        const tableData = await page.evaluate(() => {
            // Look for any data table
            const tables = document.querySelectorAll('table');
            const result = [];
            tables.forEach((table, idx) => {
                const rows = table.querySelectorAll('tr');
                if (rows.length > 0) {
                    const headers = Array.from(rows[0].querySelectorAll('th, td')).map(cell => cell.innerText.trim());
                    const data = [];
                    for (let i = 1; i < Math.min(rows.length, 5); i++) {
                        const cells = Array.from(rows[i].querySelectorAll('td')).map(cell => cell.innerText.trim());
                        data.push(cells);
                    }
                    result.push({ tableIndex: idx, rowCount: rows.length, headers, sampleData: data });
                }
            });
            return result;
        });
        
        console.log('\n[CDR] Tables found:', tableData.length);
        tableData.forEach(t => {
            console.log(`  Table ${t.tableIndex}: ${t.rowCount} rows`);
            console.log(`  Headers: ${JSON.stringify(t.headers)}`);
            console.log(`  Sample: ${JSON.stringify(t.sampleData)}`);
        });
        
        // Check for ExtJS grids
        const extGridData = await page.evaluate(() => {
            // ExtJS stores its data in Ext.ComponentManager
            if (typeof Ext !== 'undefined') {
                const stores = [];
                Ext.StoreManager.each(function(store) {
                    stores.push({
                        storeId: store.storeId,
                        count: store.getCount(),
                        fields: store.model ? store.model.getFields().map(f => f.name) : []
                    });
                });
                return { hasExt: true, stores };
            }
            return { hasExt: false };
        });
        
        console.log('\n[CDR] ExtJS:', JSON.stringify(extGridData));
        
        // If we see the page content changed, check what's visible
        const visibleContent = await page.evaluate(() => {
            const mainContent = document.querySelector('.main-content, #content, .content, .panel-body, .container-fluid');
            if (mainContent) {
                return mainContent.innerText.substring(0, 2000);
            }
            return document.body.innerText.substring(0, 2000);
        });
        
        console.log('\n[CDR] Visible content:');
        console.log(visibleContent.substring(0, 1500));
        
    } catch (error) {
        console.error('[CDR] Error:', error.message);
    } finally {
        await browser.close();
    }
}

scrapeCDR();
