
const { chromium } = require('playwright');
const path = require('path');

async function snapshot(page, label) {
    const dest = path.join(__dirname, `debug_${label}_${Date.now()}.png`);
    await page.screenshot({ path: dest });
    console.log(`Screenshot: ${dest}`);
}

(async () => {
    const PROFILE_DIR = path.join(__dirname, 'backend', '.maersk-profile');
    const context = await chromium.launchPersistentContext(PROFILE_DIR, {
        headless: true,
        channel: 'msedge',
        viewport: { width: 1280, height: 800 },
        args: [
            '--disable-blink-features=AutomationControlled',
        ]
    });
    const page = context.pages()[0] || await context.newPage();
    try {
        console.log('Navigating...');
        await page.goto('https://www.maersk.com/book/', { waitUntil: 'networkidle', timeout: 60000 });
        await page.waitForTimeout(5000);
        await snapshot(page, 'final');
    } catch (e) {
        console.error('Error:', e.message);
        await snapshot(page, 'error');
    } finally {
        await context.close();
    }
})();
