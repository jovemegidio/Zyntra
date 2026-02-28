/**
 * CDR Scraper para MagnusBilling/NextBilling
 * Usa Puppeteer para fazer login e extrair dados de CDR
 */
const puppeteer = require('puppeteer-core');

const CONFIG = {
    url: 'https://sip10.tsinfo.net.br',
    username: 'Labor@',
    password: 'F.0582#9d5c?',
    chromiumPath: '/snap/bin/chromium'
};

async function scrapeTest() {
    console.log('[CDR Scraper] Starting test...');
    
    const browser = await puppeteer.launch({
        executablePath: CONFIG.chromiumPath,
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-web-security',
            '--ignore-certificate-errors'
        ]
    });
    
    try {
        const page = await browser.newPage();
        
        // Set viewport
        await page.setViewport({ width: 1920, height: 1080 });
        
        // Navigate to login page
        console.log('[CDR Scraper] Navigating to login page...');
        await page.goto(CONFIG.url, { waitUntil: 'networkidle2', timeout: 30000 });
        
        // Wait for page to load
        await new Promise(r => setTimeout(r, 3000));
        
        // Take screenshot before login
        await page.screenshot({ path: '/tmp/cdr-before-login.png' });
        console.log('[CDR Scraper] Screenshot saved: /tmp/cdr-before-login.png');
        
        // Get page title
        const title = await page.title();
        console.log('[CDR Scraper] Page title:', title);
        
        // Get page URL
        console.log('[CDR Scraper] Current URL:', page.url());
        
        // Look for login form elements
        const pageContent = await page.content();
        
        // Check for ExtJS login fields
        const hasLoginForm = pageContent.includes('username') || pageContent.includes('LoginForm');
        console.log('[CDR Scraper] Has login form:', hasLoginForm);
        
        // Try to find and fill login form
        // MagnusBilling uses ExtJS, so inputs might be rendered differently
        console.log('[CDR Scraper] Looking for input fields...');
        
        const inputs = await page.$$('input');
        console.log('[CDR Scraper] Found', inputs.length, 'input fields');
        
        for (const input of inputs) {
            const type = await input.evaluate(el => el.type);
            const name = await input.evaluate(el => el.name);
            const id = await input.evaluate(el => el.id);
            const placeholder = await input.evaluate(el => el.placeholder);
            console.log(`  Input: type=${type}, name=${name}, id=${id}, placeholder=${placeholder}`);
        }
        
        // Try filling username field
        const usernameSelectors = [
            'input[name="LoginForm[username]"]',
            'input[name="username"]',
            'input[type="text"]',
            '#username',
            'input[placeholder*="usu"]',
            'input[placeholder*="user"]'
        ];
        
        let usernameField = null;
        for (const sel of usernameSelectors) {
            usernameField = await page.$(sel);
            if (usernameField) {
                console.log('[CDR Scraper] Found username field with selector:', sel);
                break;
            }
        }
        
        const passwordSelectors = [
            'input[name="LoginForm[password]"]',
            'input[name="password"]',
            'input[type="password"]',
            '#password'
        ];
        
        let passwordField = null;
        for (const sel of passwordSelectors) {
            passwordField = await page.$(sel);
            if (passwordField) {
                console.log('[CDR Scraper] Found password field with selector:', sel);
                break;
            }
        }
        
        if (usernameField && passwordField) {
            console.log('[CDR Scraper] Filling login form...');
            await usernameField.click({ clickCount: 3 });
            await usernameField.type(CONFIG.username, { delay: 50 });
            
            await passwordField.click({ clickCount: 3 });
            await passwordField.type(CONFIG.password, { delay: 50 });
            
            await page.screenshot({ path: '/tmp/cdr-filled-login.png' });
            
            // Look for submit button
            const submitSelectors = [
                'button[type="submit"]',
                'input[type="submit"]',
                'button.btn',
                '.login-btn',
                '#loginButton',
                'a.login'
            ];
            
            let submitBtn = null;
            for (const sel of submitSelectors) {
                submitBtn = await page.$(sel);
                if (submitBtn) {
                    console.log('[CDR Scraper] Found submit button:', sel);
                    break;
                }
            }
            
            if (submitBtn) {
                console.log('[CDR Scraper] Clicking submit...');
                await Promise.all([
                    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
                    submitBtn.click()
                ]);
            } else {
                // Try pressing Enter
                console.log('[CDR Scraper] No submit button found, pressing Enter...');
                await page.keyboard.press('Enter');
                await new Promise(r => setTimeout(r, 5000));
            }
            
            // Wait for page to load after login
            await new Promise(r => setTimeout(r, 5000));
            
            console.log('[CDR Scraper] After login URL:', page.url());
            await page.screenshot({ path: '/tmp/cdr-after-login.png' });
            console.log('[CDR Scraper] Screenshot saved: /tmp/cdr-after-login.png');
            
            // Check if we're on dashboard
            const afterContent = await page.content();
            const isDashboard = afterContent.includes('dashboard') || afterContent.includes('Dashboard') || afterContent.includes('Ext.') || page.url().includes('dashboard');
            console.log('[CDR Scraper] Is dashboard:', isDashboard);
            
            // If logged in, try to intercept AJAX calls
            if (isDashboard || page.url().includes('dashboard')) {
                console.log('[CDR Scraper] Successfully logged in! Looking for CDR data...');
                
                // Intercept network requests to find API patterns
                const requests = [];
                page.on('response', async (response) => {
                    const url = response.url();
                    if (url.includes('cdr') || url.includes('call') || url.includes('report') || url.includes('read')) {
                        const contentType = response.headers()['content-type'] || '';
                        console.log(`[CDR Scraper] Intercepted: ${url} (${contentType})`);
                        if (contentType.includes('json')) {
                            try {
                                const data = await response.json();
                                console.log('[CDR Scraper] JSON data:', JSON.stringify(data).substring(0, 500));
                            } catch (e) {}
                        }
                    }
                });
                
                // Try navigating to CDR page via ExtJS menu or direct URL
                console.log('[CDR Scraper] Trying to navigate to CDR...');
                
                // Try direct URL navigation to CDR
                await page.goto(CONFIG.url + '/index.php/cdr/read', { waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
                console.log('[CDR Scraper] CDR page URL:', page.url());
                
                const cdrContent = await page.content();
                // Check for JSON response
                if (cdrContent.includes('"rows"') || cdrContent.includes('"totalCount"')) {
                    console.log('[CDR Scraper] Got CDR JSON data!');
                    const bodyText = await page.evaluate(() => document.body.innerText);
                    console.log('[CDR Scraper] Data:', bodyText.substring(0, 1000));
                } else {
                    console.log('[CDR Scraper] CDR page content (first 300 chars):', cdrContent.substring(0, 300));
                    
                    // Try using page.evaluate to make AJAX call within the page context
                    console.log('[CDR Scraper] Trying AJAX call within page context...');
                    try {
                        const ajaxResult = await page.evaluate(async () => {
                            const response = await fetch('/index.php/cdr/read', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/x-www-form-urlencoded',
                                    'X-Requested-With': 'XMLHttpRequest'
                                },
                                body: 'page=1&start=0&limit=25'
                            });
                            const text = await response.text();
                            return text.substring(0, 2000);
                        });
                        console.log('[CDR Scraper] AJAX result:', ajaxResult);
                    } catch (e) {
                        console.log('[CDR Scraper] AJAX failed:', e.message);
                    }
                }
            }
        } else {
            console.log('[CDR Scraper] Could not find login form fields!');
            // Dump all elements for debugging
            const bodyText = await page.evaluate(() => document.body.innerText);
            console.log('[CDR Scraper] Page text:', bodyText.substring(0, 500));
        }
        
    } catch (error) {
        console.error('[CDR Scraper] Error:', error.message);
    } finally {
        await browser.close();
        console.log('[CDR Scraper] Done.');
    }
}

scrapeTest();
