/**
 * CDR Scraper - Explore Dashboard para encontrar URLs de relatórios
 */
const puppeteer = require('puppeteer-core');

const CONFIG = {
    url: 'https://sip10.tsinfo.net.br',
    username: 'Labor@',
    password: 'F.0582#9d5c?',
    chromiumPath: '/snap/bin/chromium'
};

async function exploreAfterLogin() {
    const browser = await puppeteer.launch({
        executablePath: CONFIG.chromiumPath,
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--ignore-certificate-errors']
    });
    
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });
        
        // Track ALL network requests
        const apiCalls = [];
        page.on('response', async (response) => {
            const url = response.url();
            if (!url.includes('.css') && !url.includes('.png') && !url.includes('.jpg') && !url.includes('.gif') && !url.includes('.ico') && !url.includes('.woff') && !url.includes('.ttf')) {
                apiCalls.push(url);
            }
        });
        
        // Login
        console.log('[Explorer] Logging in...');
        await page.goto(CONFIG.url, { waitUntil: 'networkidle2', timeout: 30000 });
        
        await page.type('#username', CONFIG.username, { delay: 30 });
        await page.type('#password', CONFIG.password, { delay: 30 });
        
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
            page.click('button[type="submit"]')
        ]);
        
        await new Promise(r => setTimeout(r, 3000));
        console.log('[Explorer] Logged in! URL:', page.url());
        
        // Get all links and menu items
        const links = await page.evaluate(() => {
            const allLinks = [];
            document.querySelectorAll('a').forEach(a => {
                allLinks.push({
                    text: a.innerText.trim(),
                    href: a.href,
                    class: a.className
                });
            });
            return allLinks.filter(l => l.text && l.text.length > 0);
        });
        
        console.log('\n[Explorer] Found', links.length, 'links:');
        links.forEach(l => {
            console.log(`  "${l.text}" -> ${l.href}`);
        });
        
        // Get menu structure (nav items, sidebar, etc.)
        const menuItems = await page.evaluate(() => {
            const items = [];
            // Look for nav, sidebar, menu elements
            const selectors = ['nav a', '.sidebar a', '.menu a', '.nav a', 'li a', '.dropdown a', '.nav-item a'];
            selectors.forEach(sel => {
                document.querySelectorAll(sel).forEach(el => {
                    const text = el.innerText.trim();
                    if (text && !items.some(i => i.text === text)) {
                        items.push({
                            text: text,
                            href: el.href,
                            parent: el.parentElement ? el.parentElement.className : ''
                        });
                    }
                });
            });
            return items;
        });
        
        console.log('\n[Explorer] Menu items:');
        menuItems.forEach(m => {
            console.log(`  "${m.text}" -> ${m.href} (parent: ${m.parent})`);
        });
        
        // Look for anything related to CDR, reports, calls, ligacoes
        const cdrLinks = links.filter(l => {
            const t = (l.text + ' ' + l.href).toLowerCase();
            return t.includes('cdr') || t.includes('report') || t.includes('relat') || t.includes('ligac') || t.includes('call') || t.includes('chamad') || t.includes('hist');
        });
        
        console.log('\n[Explorer] CDR/Report related links:');
        cdrLinks.forEach(l => {
            console.log(`  "${l.text}" -> ${l.href}`);
        });
        
        // Get the full page HTML structure (main content area)
        const htmlStructure = await page.evaluate(() => {
            // Get all elements with onclick or data attributes
            const elements = [];
            document.querySelectorAll('[onclick], [data-url], [data-href], [data-target]').forEach(el => {
                elements.push({
                    tag: el.tagName,
                    text: el.innerText.trim().substring(0, 100),
                    onclick: el.getAttribute('onclick'),
                    dataUrl: el.getAttribute('data-url'),
                    dataHref: el.getAttribute('data-href'),
                    dataTarget: el.getAttribute('data-target')
                });
            });
            return elements;
        });
        
        console.log('\n[Explorer] Interactive elements:');
        htmlStructure.forEach(el => {
            console.log(`  <${el.tag}> "${el.text}" onclick=${el.onclick} data-url=${el.dataUrl}`);
        });
        
        // Get all iframes
        const iframes = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('iframe')).map(f => ({
                src: f.src,
                id: f.id,
                name: f.name
            }));
        });
        console.log('\n[Explorer] Iframes:', JSON.stringify(iframes));
        
        // Print all API calls made during page load
        console.log('\n[Explorer] Network requests:');
        apiCalls.forEach(url => {
            if (url.includes('index.php') || url.includes('/api/') || url.includes('/dashboard/')) {
                console.log(`  ${url}`);
            }
        });
        
        await page.screenshot({ path: '/tmp/cdr-dashboard.png', fullPage: true });
        console.log('\n[Explorer] Dashboard screenshot saved: /tmp/cdr-dashboard.png');
        
    } catch (error) {
        console.error('[Explorer] Error:', error.message);
    } finally {
        await browser.close();
    }
}

exploreAfterLogin();
