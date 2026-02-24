
const { chromium } = require('playwright');
const path = require('path');

(async () => {
    const PROFILE_DIR = path.join(__dirname, 'backend', '.maersk-profile');
    const context = await chromium.launchPersistentContext(PROFILE_DIR, {
        headless: true,
        channel: 'msedge',
        viewport: { width: 1920, height: 1080 },
        args: ['--disable-blink-features=AutomationControlled']
    });
    const page = context.pages()[0] || await context.newPage();
    try {
        console.log('Navigating and waiting...');
        await page.goto('https://www.maersk.com/book/', { waitUntil: 'load', timeout: 90000 });
        await page.waitForTimeout(15000); // Wait for potential OIDC redirects

        console.log('Final URL:', page.url());
        const title = await page.title().catch(() => 'N/A');
        console.log('Title:', title);

        await page.screenshot({ path: 'final_state.png', fullPage: true });
        const originVisible = await page.locator('#mc-input-origin').isVisible().catch(() => false);
        console.log('Origin input visible:', originVisible);

        const text = await page.evaluate(() => document.body.innerText.substring(0, 1000)).catch(() => 'N/A');
        console.log('Text content:', text);
    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        await context.close();
    }
})();
