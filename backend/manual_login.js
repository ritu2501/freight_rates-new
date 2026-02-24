/**
 * Manual Login Helper
 * 
 * Opens Edge browser with the persistent profile used by the scraper.
 * Log in manually with your keyboard — Akamai won't block manual input.
 * Once you reach the /book/ page, the session cookies are saved automatically.
 * 
 * Usage:  node manual_login.js
 * After:  Subsequent scrapes will use the saved session (no re-login needed).
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const PROFILE_DIR = path.join(__dirname, '.maersk-profile');
const BOOK_URL = 'https://www.maersk.com/book/';

// We navigate to /book/ first — it will auto-redirect to the login page
// with a fresh nonce. Using a hardcoded nonce won't work since they expire.

if (!fs.existsSync(PROFILE_DIR)) fs.mkdirSync(PROFILE_DIR, { recursive: true });

(async () => {
  console.log('========================================');
  console.log('  Maersk Manual Login Helper');
  console.log('========================================');
  console.log('');
  console.log('An Edge browser will open to the Maersk login page.');
  console.log('Please log in MANUALLY using your keyboard:');
  console.log('  Username: Eximsingpore');
  console.log('  Password: (your password)');
  console.log('');
  console.log('Once you reach the booking page, the session');
  console.log('will be saved and the browser will close.');
  console.log('');
  console.log('Profile dir: ' + PROFILE_DIR);
  console.log('========================================');
  console.log('');

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    channel: 'msedge',
    viewport: { width: 1366, height: 900 },
    locale: 'en-US',
    timezoneId: 'Asia/Kolkata',
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  const page = context.pages()[0] || await context.newPage();

  // Minimal stealth — just hide webdriver flag
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true });
  });

  console.log('[Login] Navigating to Maersk login page...');
  // First try /book/ — if already logged in, it goes straight to booking form
  await page.goto(BOOK_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);

  // Check if already logged in
  const alreadyLoggedIn = await page.locator('#mc-input-origin').isVisible({ timeout: 8000 }).catch(() => false);
  if (alreadyLoggedIn) {
    console.log('');
    console.log('✓ Already logged in! Session is valid.');
    console.log('  You can now run scrapes — they will use this session.');
    console.log('');
    await context.close();
    process.exit(0);
  }

  // Not logged in — check if we're on the login page or need to navigate there
  const currentUrl = page.url();
  console.log('[Login] Current URL: ' + currentUrl);

  // If we're NOT on accounts.maersk.com, navigate to /book/ which redirects to login
  if (!currentUrl.includes('accounts.maersk.com')) {
    console.log('[Login] Not on login page — navigating to /book/ to trigger login redirect...');
    await page.goto(BOOK_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);
  }

  console.log('[Login] Login page URL: ' + page.url());
  console.log('');
  console.log('>>> Please log in MANUALLY using your keyboard <<<');
  console.log('>>> Username: Eximsingpore                      <<<');
  console.log('>>> Waiting up to 5 minutes for login...        <<<');
  console.log('');

  // Poll for successful login (booking page loads with origin input)
  const deadline = Date.now() + 5 * 60 * 1000; // 5 minutes
  let success = false;

  while (Date.now() < deadline) {
    await page.waitForTimeout(3000);

    const url = page.url();
    
    // Check if we reached the booking page or any logged-in Maersk page
    if (url.includes('maersk.com/book') || url.includes('maersk.com/portaluser/oidc/callback') || 
        (url.includes('maersk.com') && !url.includes('accounts.maersk.com'))) {
      const originVisible = await page.locator('#mc-input-origin').isVisible({ timeout: 5000 }).catch(() => false);
      if (originVisible) {
        success = true;
        break;
      }
      // Sometimes the callback redirects but booking page hasn't loaded yet
      if (url.includes('callback')) {
        console.log('[Login] OIDC callback detected — waiting for redirect to booking...');
        await page.waitForTimeout(5000);
        continue;
      }
    }

    const remaining = Math.ceil((deadline - Date.now()) / 1000);
    if (remaining % 15 < 3) {
      console.log('[Login] Waiting... (' + remaining + 's remaining) | URL: ' + url.substring(0, 80));
    }
  }

  if (success) {
    console.log('');
    console.log('========================================');
    console.log('  ✓ LOGIN SUCCESSFUL!');
    console.log('========================================');
    console.log('');
    console.log('Session cookies saved to persistent profile.');
    console.log('Subsequent scrapes will auto-use this session.');
    console.log('Closing browser in 3 seconds...');
    await page.waitForTimeout(3000);
  } else {
    console.log('');
    console.log('========================================');
    console.log('  ✗ Login timed out (5 min).');
    console.log('========================================');
    console.log('  Please try again: node manual_login.js');
  }

  await context.close();
  process.exit(success ? 0 : 1);
})();
