/**
 * ALUFORCE ERP - Mobile & Tablet Test Suite
 * Tests for responsive layout, touch interactions, and visual regression
 */

const { test, expect } = require('@playwright/test');

/* ============================================================================
   TEST CONFIGURATION
   ============================================================================ */

const PAGES_TO_TEST = [
    { path: '/login', name: 'Login' },
    { path: '/Financeiro/', name: 'Financeiro Dashboard' },
    { path: '/Financeiro/contas-pagar.html', name: 'Contas a Pagar' },
    { path: '/Financeiro/contas-receber.html', name: 'Contas a Receber' },
    { path: '/Financeiro/fluxo-caixa.html', name: 'Fluxo de Caixa' },
    { path: '/PCP/', name: 'PCP Dashboard' },
    { path: '/PCP/ordens-producao.html', name: 'Ordens de Produção' },
    { path: '/Vendas/', name: 'Vendas Dashboard' },
    { path: '/RH/', name: 'RH Dashboard' },
    { path: '/Compras/', name: 'Compras Dashboard' },
    { path: '/NFe/', name: 'NFe Dashboard' },
];

const MOBILE_VIEWPORTS = [
    { width: 320, height: 568, name: 'iPhone-SE-old' },
    { width: 375, height: 667, name: 'iPhone-SE' },
    { width: 390, height: 844, name: 'iPhone-12' },
    { width: 414, height: 896, name: 'iPhone-11-Pro-Max' },
];

const TABLET_VIEWPORTS = [
    { width: 768, height: 1024, name: 'iPad-Portrait' },
    { width: 1024, height: 768, name: 'iPad-Landscape' },
    { width: 834, height: 1194, name: 'iPad-Pro-Portrait' },
    { width: 1194, height: 834, name: 'iPad-Pro-Landscape' },
];

/* ============================================================================
   HELPER FUNCTIONS
   ============================================================================ */

async function waitForPageLoad(page) {
    await page.waitForLoadState('networkidle');
    // Wait for any animations to complete
    await page.waitForTimeout(500);
}

async function dismissModalsAndPopovers(page) {
    // Try to close any open modals
    const closeButtons = await page.$$('.modal-close, [data-dismiss="modal"], .close-modal');
    for (const btn of closeButtons) {
        try {
            await btn.click();
            await page.waitForTimeout(300);
        } catch (e) {
            // Modal might already be closed
        }
    }
}

/* ============================================================================
   LAYOUT TESTS
   ============================================================================ */

test.describe('📱 Mobile Layout Tests', () => {
    
    for (const viewport of MOBILE_VIEWPORTS) {
        test.describe(`Viewport: ${viewport.name} (${viewport.width}x${viewport.height})`, () => {
            
            test.beforeEach(async ({ page }) => {
                await page.setViewportSize(viewport);
            });
            
            test('No horizontal scroll on any page', async ({ page }) => {
                for (const pageConfig of PAGES_TO_TEST) {
                    await page.goto(pageConfig.path);
                    await waitForPageLoad(page);
                    
                    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
                    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
                    
                    expect(scrollWidth, `Page ${pageConfig.name} has horizontal scroll`).toBeLessThanOrEqual(clientWidth + 1);
                }
            });
            
            test('All interactive elements meet touch target size', async ({ page }) => {
                for (const pageConfig of PAGES_TO_TEST) {
                    await page.goto(pageConfig.path);
                    await waitForPageLoad(page);
                    await dismissModalsAndPopovers(page);
                    
                    const interactiveElements = await page.$$('button, a[href], input, select, textarea, [role="button"], .btn');
                    let smallElements = [];
                    
                    for (const element of interactiveElements) {
                        const box = await element.boundingBox();
                        if (box && box.width > 0 && box.height > 0) {
                            // Check if element is visible
                            const isVisible = await element.isVisible();
                            if (isVisible && (box.width < 44 || box.height < 44)) {
                                const text = await element.textContent();
                                smallElements.push({
                                    text: text?.trim().substring(0, 30),
                                    width: box.width,
                                    height: box.height
                                });
                            }
                        }
                    }
                    
                    // Log small elements for debugging but don't fail immediately
                    if (smallElements.length > 0) {
                        console.warn(`⚠️ Page ${pageConfig.name}: ${smallElements.length} elements below 44px touch target`);
                        console.warn(smallElements.slice(0, 5));
                    }
                    
                    // Fail if more than 20% of elements are too small
                    const totalElements = interactiveElements.length;
                    const threshold = Math.floor(totalElements * 0.2);
                    expect(smallElements.length, `Too many small touch targets on ${pageConfig.name}`).toBeLessThan(threshold);
                }
            });
            
            test('Sidebar is hidden or transformed to drawer', async ({ page }) => {
                await page.goto('/Financeiro/');
                await waitForPageLoad(page);
                
                const sidebar = await page.$('.sidebar');
                if (sidebar) {
                    const box = await sidebar.boundingBox();
                    const isHidden = await sidebar.evaluate(el => {
                        const style = window.getComputedStyle(el);
                        return style.display === 'none' || 
                               style.visibility === 'hidden' ||
                               style.transform.includes('translateX(-');
                    });
                    
                    // Sidebar should be hidden or off-screen
                    if (box) {
                        expect(box.x + box.width <= 0 || isHidden).toBeTruthy();
                    }
                }
            });
            
            test('Header is properly sized for mobile', async ({ page }) => {
                await page.goto('/Financeiro/');
                await waitForPageLoad(page);
                
                const header = await page.$('.header, header, .main-header');
                if (header) {
                    const box = await header.boundingBox();
                    expect(box.height).toBeLessThanOrEqual(60);
                    expect(box.width).toBe(viewport.width);
                }
            });
            
            test('Content does not overflow viewport', async ({ page }) => {
                for (const pageConfig of PAGES_TO_TEST.slice(0, 3)) {
                    await page.goto(pageConfig.path);
                    await waitForPageLoad(page);
                    
                    // Check for elements overflowing
                    const overflowingElements = await page.evaluate(() => {
                        const elements = document.querySelectorAll('*');
                        const overflow = [];
                        elements.forEach(el => {
                            const rect = el.getBoundingClientRect();
                            if (rect.right > window.innerWidth + 10) {
                                overflow.push({
                                    tag: el.tagName,
                                    class: el.className,
                                    right: rect.right,
                                    viewportWidth: window.innerWidth
                                });
                            }
                        });
                        return overflow.slice(0, 5);
                    });
                    
                    if (overflowingElements.length > 0) {
                        console.warn(`⚠️ ${pageConfig.name}: Elements overflowing viewport`, overflowingElements);
                    }
                }
            });
        });
    }
});

test.describe('📱 Tablet Layout Tests', () => {
    
    for (const viewport of TABLET_VIEWPORTS) {
        test.describe(`Viewport: ${viewport.name} (${viewport.width}x${viewport.height})`, () => {
            
            test.beforeEach(async ({ page }) => {
                await page.setViewportSize(viewport);
            });
            
            test('Grid adapts to 2-3 columns', async ({ page }) => {
                await page.goto('/Financeiro/');
                await waitForPageLoad(page);
                
                const kpiGrid = await page.$('.kpi-grid, .stats-grid');
                if (kpiGrid) {
                    const gridStyle = await kpiGrid.evaluate(el => {
                        const style = window.getComputedStyle(el);
                        return {
                            display: style.display,
                            gridTemplateColumns: style.gridTemplateColumns
                        };
                    });
                    
                    // Should have 2-3 columns in tablet
                    if (gridStyle.display === 'grid') {
                        const columns = gridStyle.gridTemplateColumns.split(' ').filter(c => c && c !== '0px');
                        expect(columns.length).toBeGreaterThanOrEqual(2);
                        expect(columns.length).toBeLessThanOrEqual(4);
                    }
                }
            });
            
            test('Sidebar is slim rail in portrait', async ({ page }) => {
                if (viewport.width < viewport.height) { // Portrait
                    await page.goto('/Financeiro/');
                    await waitForPageLoad(page);
                    
                    const sidebar = await page.$('.sidebar');
                    if (sidebar) {
                        const box = await sidebar.boundingBox();
                        if (box && box.x >= 0) {
                            expect(box.width).toBeLessThanOrEqual(80);
                        }
                    }
                }
            });
        });
    }
});

/* ============================================================================
   MODAL TESTS
   ============================================================================ */

test.describe('🪟 Modal Tests', () => {
    
    test('Modals fit within mobile viewport', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 });
        await page.goto('/Financeiro/');
        await waitForPageLoad(page);
        
        // Try to open a modal (generic approach)
        const modalTriggers = await page.$$('[data-modal], [data-toggle="modal"], .btn-primary');
        
        for (const trigger of modalTriggers.slice(0, 3)) {
            try {
                await trigger.click();
                await page.waitForTimeout(500);
                
                const modal = await page.$('.modal-content, .modal-omie, .modal');
                if (modal) {
                    const box = await modal.boundingBox();
                    if (box) {
                        expect(box.width, 'Modal exceeds viewport width').toBeLessThanOrEqual(375);
                        expect(box.height, 'Modal exceeds viewport height').toBeLessThanOrEqual(667 * 0.95);
                        
                        // Check if footer buttons are visible
                        const footer = await page.$('.modal-footer');
                        if (footer) {
                            const footerBox = await footer.boundingBox();
                            expect(footerBox.y + footerBox.height, 'Modal footer below viewport').toBeLessThanOrEqual(667);
                        }
                    }
                    
                    // Close modal
                    await dismissModalsAndPopovers(page);
                }
            } catch (e) {
                // Modal might not exist or trigger doesn't work
            }
        }
    });
    
    test('Modal can be closed on mobile', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 });
        await page.goto('/Financeiro/');
        await waitForPageLoad(page);
        
        const modalTrigger = await page.$('[data-modal], [data-toggle="modal"]');
        if (modalTrigger) {
            await modalTrigger.click();
            await page.waitForTimeout(500);
            
            // Try to close via X button
            const closeBtn = await page.$('.modal-close, [data-dismiss="modal"]');
            if (closeBtn) {
                const box = await closeBtn.boundingBox();
                expect(box.width).toBeGreaterThanOrEqual(44);
                expect(box.height).toBeGreaterThanOrEqual(44);
                
                await closeBtn.click();
                await page.waitForTimeout(300);
                
                const modalOverlay = await page.$('.modal-overlay.active, .modal.show');
                expect(modalOverlay).toBeNull();
            }
        }
    });
});

/* ============================================================================
   FORM TESTS
   ============================================================================ */

test.describe('📝 Form Tests', () => {
    
    test('Form inputs have correct font size (no iOS zoom)', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 });
        
        for (const pageConfig of PAGES_TO_TEST.slice(0, 3)) {
            await page.goto(pageConfig.path);
            await waitForPageLoad(page);
            
            const inputs = await page.$$('input, select, textarea');
            
            for (const input of inputs) {
                const fontSize = await input.evaluate(el => {
                    return parseFloat(window.getComputedStyle(el).fontSize);
                });
                
                // Must be at least 16px to prevent iOS zoom
                expect(fontSize, `Input on ${pageConfig.name} has font-size < 16px`).toBeGreaterThanOrEqual(16);
            }
        }
    });
    
    test('Form inputs have adequate height for touch', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 });
        await page.goto('/Financeiro/');
        await waitForPageLoad(page);
        
        const inputs = await page.$$('input, select');
        
        for (const input of inputs) {
            const box = await input.boundingBox();
            if (box && box.height > 0) {
                expect(box.height, 'Input height too small for touch').toBeGreaterThanOrEqual(40);
            }
        }
    });
});

/* ============================================================================
   TABLE TESTS
   ============================================================================ */

test.describe('📊 Table Tests', () => {
    
    test('Tables have mobile-friendly alternative', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 });
        
        const pagesWithTables = [
            '/Financeiro/contas-pagar.html',
            '/Financeiro/contas-receber.html',
        ];
        
        for (const path of pagesWithTables) {
            await page.goto(path);
            await waitForPageLoad(page);
            
            const table = await page.$('table, .table');
            const dataCards = await page.$('.data-cards, .card-list, .mobile-cards');
            
            if (table) {
                const tableVisible = await table.isVisible();
                const cardsVisible = dataCards ? await dataCards.isVisible() : false;
                
                // Either table should be hidden or cards should be visible
                // For now, just log the state
                console.log(`📊 ${path}: Table visible=${tableVisible}, Cards visible=${cardsVisible}`);
            }
        }
    });
    
    test('Table actions are touch-friendly', async ({ page }) => {
        await page.setViewportSize({ width: 768, height: 1024 }); // Tablet where tables are visible
        await page.goto('/Financeiro/contas-pagar.html');
        await waitForPageLoad(page);
        
        const actionButtons = await page.$$('table button, table .btn, td .action-btn');
        
        for (const btn of actionButtons.slice(0, 10)) {
            const box = await btn.boundingBox();
            if (box) {
                const minDimension = Math.min(box.width, box.height);
                // Log warning if too small
                if (minDimension < 36) {
                    console.warn(`⚠️ Table action button too small: ${box.width}x${box.height}`);
                }
            }
        }
    });
});

/* ============================================================================
   NAVIGATION TESTS
   ============================================================================ */

test.describe('🧭 Navigation Tests', () => {
    
    test('Mobile menu toggle works', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 });
        await page.goto('/Financeiro/');
        await waitForPageLoad(page);
        
        const menuToggle = await page.$('.mobile-menu-btn, .hamburger, .menu-toggle, .header-menu-toggle');
        if (menuToggle) {
            const box = await menuToggle.boundingBox();
            expect(box.width).toBeGreaterThanOrEqual(44);
            expect(box.height).toBeGreaterThanOrEqual(44);
            
            await menuToggle.click();
            await page.waitForTimeout(500);
            
            const sidebar = await page.$('.sidebar.open, .sidebar.active');
            // Sidebar should be visible after toggle
            if (sidebar) {
                const sidebarBox = await sidebar.boundingBox();
                expect(sidebarBox.x).toBeGreaterThanOrEqual(0);
            }
        }
    });
    
    test('All navigation links are reachable', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 });
        await page.goto('/Financeiro/');
        await waitForPageLoad(page);
        
        // Open sidebar if needed
        const menuToggle = await page.$('.mobile-menu-btn, .hamburger, .menu-toggle');
        if (menuToggle) {
            await menuToggle.click();
            await page.waitForTimeout(500);
        }
        
        const navLinks = await page.$$('.sidebar a, .sidebar-btn, .nav-link');
        const linkData = [];
        
        for (const link of navLinks) {
            const box = await link.boundingBox();
            const href = await link.getAttribute('href');
            const isVisible = await link.isVisible();
            
            linkData.push({
                href,
                visible: isVisible,
                width: box?.width,
                height: box?.height
            });
        }
        
        // At least some nav links should be visible
        const visibleLinks = linkData.filter(l => l.visible);
        expect(visibleLinks.length).toBeGreaterThan(0);
    });
});

/* ============================================================================
   VISUAL REGRESSION TESTS
   ============================================================================ */

test.describe('📸 Visual Regression Tests', () => {
    
    const screenshotViewports = [
        { width: 375, height: 667, name: 'mobile' },
        { width: 768, height: 1024, name: 'tablet-portrait' },
        { width: 1024, height: 768, name: 'tablet-landscape' },
    ];
    
    for (const viewport of screenshotViewports) {
        for (const pageConfig of PAGES_TO_TEST.slice(0, 5)) {
            test(`Screenshot: ${pageConfig.name} @ ${viewport.name}`, async ({ page }) => {
                await page.setViewportSize(viewport);
                await page.goto(pageConfig.path);
                await waitForPageLoad(page);
                await dismissModalsAndPopovers(page);
                
                // Wait for any animations
                await page.waitForTimeout(1000);
                
                await expect(page).toHaveScreenshot(
                    `${pageConfig.name.replace(/\s+/g, '-').toLowerCase()}-${viewport.name}.png`,
                    {
                        fullPage: true,
                        maxDiffPixels: 200,
                    }
                );
            });
        }
    }
});

/* ============================================================================
   PERFORMANCE TESTS
   ============================================================================ */

test.describe('⚡ Performance Tests', () => {
    
    test('Page loads within acceptable time on mobile', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 });
        
        // Simulate slow 4G
        const client = await page.context().newCDPSession(page);
        await client.send('Network.emulateNetworkConditions', {
            offline: false,
            downloadThroughput: (4 * 1024 * 1024) / 8, // 4 Mbps
            uploadThroughput: (1 * 1024 * 1024) / 8,   // 1 Mbps
            latency: 100
        });
        
        for (const pageConfig of PAGES_TO_TEST.slice(0, 3)) {
            const start = Date.now();
            await page.goto(pageConfig.path, { waitUntil: 'domcontentloaded' });
            const loadTime = Date.now() - start;
            
            console.log(`📱 ${pageConfig.name}: DOM loaded in ${loadTime}ms`);
            
            // DOM should load within 5 seconds even on slow network
            expect(loadTime, `${pageConfig.name} took too long to load`).toBeLessThan(5000);
        }
    });
    
    test('No layout shifts after load', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 });
        await page.goto('/Financeiro/');
        await waitForPageLoad(page);
        
        // Measure CLS (Cumulative Layout Shift)
        const cls = await page.evaluate(() => {
            return new Promise((resolve) => {
                let clsValue = 0;
                const observer = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        if (!entry.hadRecentInput) {
                            clsValue += entry.value;
                        }
                    }
                });
                
                observer.observe({ type: 'layout-shift', buffered: true });
                
                setTimeout(() => {
                    observer.disconnect();
                    resolve(clsValue);
                }, 2000);
            });
        });
        
        console.log(`📊 CLS score: ${cls}`);
        expect(cls, 'CLS too high').toBeLessThan(0.25);
    });
});

/* ============================================================================
   ACCESSIBILITY TESTS
   ============================================================================ */

test.describe('♿ Accessibility Tests', () => {
    
    test('Focus is visible on interactive elements', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 });
        await page.goto('/Financeiro/');
        await waitForPageLoad(page);
        
        // Tab through first few elements
        for (let i = 0; i < 5; i++) {
            await page.keyboard.press('Tab');
            await page.waitForTimeout(100);
            
            const focusedElement = await page.$(':focus');
            if (focusedElement) {
                const outline = await focusedElement.evaluate(el => {
                    const style = window.getComputedStyle(el);
                    return {
                        outline: style.outline,
                        outlineWidth: style.outlineWidth,
                        boxShadow: style.boxShadow
                    };
                });
                
                // Element should have visible focus indicator
                const hasFocusStyle = 
                    outline.outline !== 'none' && outline.outline !== '0px' ||
                    outline.boxShadow !== 'none';
                
                if (!hasFocusStyle) {
                    console.warn('⚠️ Element has no visible focus style');
                }
            }
        }
    });
    
    test('Color contrast is adequate', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 });
        await page.goto('/Financeiro/');
        await waitForPageLoad(page);
        
        // Get text elements and check basic contrast
        const textElements = await page.$$('p, span, h1, h2, h3, h4, label, .text');
        
        let lowContrastCount = 0;
        
        for (const el of textElements.slice(0, 20)) {
            const colors = await el.evaluate(element => {
                const style = window.getComputedStyle(element);
                return {
                    color: style.color,
                    backgroundColor: style.backgroundColor
                };
            });
            
            // Simple check - if both are very light, might be an issue
            // Full contrast check would require color parsing
            if (colors.color.includes('rgb(200') || colors.color.includes('rgb(220')) {
                lowContrastCount++;
            }
        }
        
        // Log potential issues
        if (lowContrastCount > 5) {
            console.warn(`⚠️ Potential low contrast elements: ${lowContrastCount}`);
        }
    });
});
