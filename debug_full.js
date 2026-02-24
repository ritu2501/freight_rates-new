
const { chromium } = require('playwright');
const path = require('path');

(async () => {
    const PROFILE_DIR = path.join(__dirname, 'backend', '.maersk-profile');
    const context = await chromium.launchPersistentContext(PROFILE_DIR, {
        headless: true,
        channel: 'msedge',
        viewport: { width: 1920, height: 1080 }
    });
    const page = context.pages()[0] || await context.newPage();
    try {
        console.log('Navigating to Maersk...');
        await page.goto('https://www.maersk.com/book/', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(10000);
        console.log('URL:', page.url());
        console.log('Title:', await page.title());
        await page.screenshot({ path: 'debug_full.png', fullPage: true });

        const originVisible = await page.locator('#mc-input-origin').isVisible().catch(() => false);
        console.log('Origin input visible:', originVisible);

        const bodyContent = await page.evaluate(() => document.body.innerText.substring(0, 500));
        console.log('Text content:', bodyContent);
    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        await context.close();
    }
})();
