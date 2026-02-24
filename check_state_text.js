
const { chromium } = require('playwright');
const path = require('path');

(async () => {
    const PROFILE_DIR = path.join(__dirname, 'backend', '.maersk-profile');
    const context = await chromium.launchPersistentContext(PROFILE_DIR, {
        headless: true,
        channel: 'msedge',
    });
    const page = context.pages()[0] || await context.newPage();
    try {
        console.log('Navigating to Maersk...');
        await page.goto('https://www.maersk.com/book/', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(10000);
        const title = await page.title();
        const text = await page.evaluate(() => document.body.innerText.substring(0, 500));
        console.log('Page Title:', title);
        console.log('Page Text Preview:', text);
        await page.screenshot({ path: 'state_debug.png' });
    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        await context.close();
    }
})();
