/**
 * CDR Scraper - Testar formatos de resposta e sessão HTTP direta
 */
const puppeteer = require('puppeteer-core');
const https = require('https');

const CONFIG = {
    url: 'https://sip10.tsinfo.net.br',
    username: 'Labor@',
    password: 'F.0582#9d5c?',
    chromiumPath: '/snap/bin/chromium'
};

async function testDataFormats() {
    const browser = await puppeteer.launch({
        executablePath: CONFIG.chromiumPath,
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--ignore-certificate-errors']
    });
    
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });
        
        // Login
        console.log('[Test] Logging in...');
        await page.goto(CONFIG.url, { waitUntil: 'networkidle2', timeout: 30000 });
        await page.type('#username', CONFIG.username, { delay: 30 });
        await page.type('#password', CONFIG.password, { delay: 30 });
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
            page.click('button[type="submit"]')
        ]);
        await new Promise(r => setTimeout(r, 3000));
        console.log('[Test] Logged in!');
        
        // Get cookies
        const cookies = await page.cookies();
        console.log('[Test] Cookies:', cookies.map(c => `${c.name}=${c.value}`).join('; '));
        
        // Test 1: Fetch data endpoint directly from page context (with session)
        console.log('\n[Test] === Test 1: Fetch /relatorioLigacoes/data from page context ===');
        const dataResult = await page.evaluate(async () => {
            const today = new Date();
            const dd = String(today.getDate()).padStart(2, '0');
            const mm = String(today.getMonth() + 1).padStart(2, '0');
            const yyyy = today.getFullYear();
            const dateStr = `${dd}/${mm}/${yyyy}`;
            
            const params = new URLSearchParams({
                DATAI_TMP: dateStr,
                DATAF_TMP: dateStr,
                SORT_DIRECTION: 'DESC',
                SORT_CHANGE: '',
                SORT_TAG: 'data_index',
                PAGE: '1',
                txtDataI: dateStr,
                txtDataF: dateStr,
                txtTipo: '0',
                txtFiltro: ''
            });
            
            const response = await fetch(`/relatorioLigacoes/data?${Math.random()}&${params.toString()}`, {
                headers: {
                    'X-Requested-With': 'XMLHttpRequest'
                }
            });
            
            const contentType = response.headers.get('content-type');
            const text = await response.text();
            
            return {
                status: response.status,
                contentType,
                length: text.length,
                first2000: text.substring(0, 2000)
            };
        });
        
        console.log('[Test] Status:', dataResult.status);
        console.log('[Test] Content-Type:', dataResult.contentType);
        console.log('[Test] Length:', dataResult.length);
        console.log('[Test] Response:', dataResult.first2000);
        
        // Test 2: Navigate to the page and extract data from DOM
        console.log('\n[Test] === Test 2: Navigate to page and extract DOM data ===');
        
        // Click Relatórios menu
        await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a'));
            for (const link of links) {
                if (link.innerText.trim() === 'Relatórios') {
                    link.click();
                    break;
                }
            }
        });
        await new Promise(r => setTimeout(r, 1000));
        
        // Click Ligações Efetuadas
        await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a'));
            for (const link of links) {
                const text = link.innerText.trim();
                if (text.includes('Liga') && text.includes('Efetuadas')) {
                    link.click();
                    break;
                }
            }
        });
        await new Promise(r => setTimeout(r, 5000));
        
        // Extract ALL table data
        const allTableData = await page.evaluate(() => {
            const rows = document.querySelectorAll('table tr');
            const data = [];
            rows.forEach((row, idx) => {
                if (idx === 0) return; // Skip header
                const cells = Array.from(row.querySelectorAll('td'));
                if (cells.length >= 6) {
                    data.push({
                        data: cells[0].innerText.trim(),
                        origem: cells[1].innerText.trim(),
                        destino: cells[2].innerText.trim(),
                        cidade: cells[3].innerText.trim(),
                        tempo: cells[4].innerText.trim(),
                        valor: cells[5].innerText.trim()
                    });
                }
            });
            return data;
        });
        
        console.log('[Test] Total records extracted:', allTableData.length);
        console.log('[Test] First 5 records:', JSON.stringify(allTableData.slice(0, 5), null, 2));
        console.log('[Test] Last record:', JSON.stringify(allTableData[allTableData.length - 1]));
        
        // Test 3: Check if there's pagination info
        const paginationInfo = await page.evaluate(() => {
            const body = document.body.innerText;
            const match = body.match(/Exibindo de (\d+) .* (\d+) de (\d+)/);
            if (match) {
                return { from: match[1], to: match[2], total: match[3] };
            }
            return null;
        });
        console.log('\n[Test] Pagination:', JSON.stringify(paginationInfo));
        
        // Test 4: Try to get data for a different date range
        console.log('\n[Test] === Test 3: Fetch data for yesterday ===');
        const yesterdayResult = await page.evaluate(async () => {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const dd = String(yesterday.getDate()).padStart(2, '0');
            const mm = String(yesterday.getMonth() + 1).padStart(2, '0');
            const yyyy = yesterday.getFullYear();
            const dateStr = `${dd}/${mm}/${yyyy}`;
            
            const params = new URLSearchParams({
                DATAI_TMP: dateStr,
                DATAF_TMP: dateStr,
                SORT_DIRECTION: 'DESC',
                SORT_CHANGE: '',
                SORT_TAG: 'data_index',
                PAGE: '1',
                txtDataI: dateStr,
                txtDataF: dateStr,
                txtTipo: '0',
                txtFiltro: ''
            });
            
            const response = await fetch(`/relatorioLigacoes/data?${Math.random()}&${params.toString()}`, {
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            });
            const text = await response.text();
            return { length: text.length, first1000: text.substring(0, 1000) };
        });
        console.log('[Test] Yesterday response length:', yesterdayResult.length);
        console.log('[Test] Yesterday data:', yesterdayResult.first1000);
        
        // Test 5: Get all unique origins (ramais)
        console.log('\n[Test] === Test 4: Unique origins (ramais) ===');
        const uniqueOrigens = [...new Set(allTableData.map(r => r.origem))];
        console.log('[Test] Unique origens:', uniqueOrigens);
        
    } catch (error) {
        console.error('[Test] Error:', error.message);
    } finally {
        await browser.close();
    }
}

testDataFormats();
