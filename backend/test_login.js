/**
 * Minimal login diagnostic — only tests login, logs every event.
 * Run: node test_login.js
 */
require('dotenv').config();
const { chromium } = require('playwright');

(async () => {
  const username = process.env.MAERSK_USERNAME;
  const password = process.env.MAERSK_PASSWORD;
  console.log(`[Diag] Credentials: user="${username}" pass="${password ? '***' : 'MISSING'}"`);

  let browser, context, page;

  try {
    // ─── STEP 1: Launch Edge ───
    console.log('[Diag] Launching Edge...');
    browser = await chromium.launch({
      headless: false,
      channel: 'msedge',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--start-maximized',
        '--disable-features=RendererCodeIntegrity',
        '--disable-blink-features=AutomationControlled',
      ],
    });

    // ─── STEP 2: Create context ───
    context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
    });
    page = await context.newPage();

    // ─── STEP 3: Monitor ALL events ───
    let pageClosed = false;
    let browserDisconnected = false;

    page.on('close', () => {
      pageClosed = true;
      console.log('[EVENT] >>> PAGE CLOSED <<<');
    });

    page.on('crash', () => {
      console.log('[EVENT] >>> PAGE CRASHED <<<');
    });

    page.on('dialog', async (dialog) => {
      console.log(`[EVENT] Dialog: type=${dialog.type()} message="${dialog.message()}"`);
      await dialog.accept();
    });

    page.on('popup', (popup) => {
      console.log(`[EVENT] Popup opened: ${popup.url()}`);
    });

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        console.log(`[CONSOLE] ${msg.text()}`);
      }
    });

    page.on('pageerror', (err) => {
      console.log(`[PAGE-ERROR] ${err.message}`);
    });

    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        console.log(`[NAV] Main frame → ${frame.url().substring(0, 120)}`);
      }
    });

    browser.on('disconnected', () => {
      browserDisconnected = true;
      console.log('[EVENT] >>> BROWSER DISCONNECTED <<<');
    });

    context.on('page', (newPage) => {
      console.log(`[EVENT] New page opened in context: ${newPage.url()}`);
    });

    // ─── STEP 4: Navigate ───
    console.log('[Diag] Navigating to https://www.maersk.com/book/ ...');
    await page.goto('https://www.maersk.com/book/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    console.log(`[Diag] Loaded. URL: ${page.url()}`);
    console.log(`[Diag] Page closed? ${pageClosed}  Browser disconnected? ${browserDisconnected}`);

    await page.waitForTimeout(3000);

    // Dismiss cookie
    const cookieBtn = page.locator('.coi-banner__accept').first();
    if (await cookieBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await cookieBtn.click({ force: true });
      console.log('[Diag] Cookie banner dismissed');
      await page.waitForTimeout(1000);
    }

    // Check if already on booking form
    const alreadyLoggedIn = await page.locator('#mc-input-origin').isVisible({ timeout: 3000 }).catch(() => false);
    if (alreadyLoggedIn) {
      console.log('[Diag] Already logged in! Booking form visible.');
      console.log('[Diag] SUCCESS — keeping browser open for 60s...');
      await page.waitForTimeout(60000);
      return;
    }

    // ─── STEP 5: Fill login ───
    console.log('[Diag] Login page detected. Waiting for it to settle...');
    await page.waitForTimeout(2000);

    // Dismiss overlays again
    await page.evaluate(() => {
      const overlay = document.getElementById('coiOverlay');
      if (overlay) overlay.remove();
      const wrapper = document.getElementById('cookie-information-template-wrapper');
      if (wrapper) wrapper.remove();
    }).catch(() => {});

    console.log(`[Diag] Current URL before fill: ${page.url()}`);
    console.log(`[Diag] Page closed? ${pageClosed}  Browser disconnected? ${browserDisconnected}`);

    // Username
    const usernameInput = page.locator('#mc-input-username');
    const usernameVisible = await usernameInput.isVisible({ timeout: 10000 }).catch(() => false);
    console.log(`[Diag] Username input visible: ${usernameVisible}`);
    
    if (!usernameVisible) {
      // Maybe it's a different login flow - screenshot and check
      await page.screenshot({ path: 'snapshots/diag_no_username.png' });
      console.log('[Diag] Username input NOT found. Screenshot saved. Checking page content...');
      const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 1000));
      console.log(`[Diag] Page text: ${bodyText}`);
      throw new Error('Username input not visible');
    }

    await usernameInput.fill(username);
    console.log(`[Diag] Username filled: "${username}"`);
    await page.waitForTimeout(500);

    // Password
    const passwordInput = page.locator('input[name="password"]:visible');
    const passwordVisible = await passwordInput.isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`[Diag] Password input visible: ${passwordVisible}`);
    
    if (!passwordVisible) {
      await page.screenshot({ path: 'snapshots/diag_no_password.png' });
      throw new Error('Password input not visible');
    }

    await passwordInput.fill(password);
    console.log('[Diag] Password filled');
    await page.waitForTimeout(500);

    console.log(`[Diag] Page closed? ${pageClosed}  Browser disconnected? ${browserDisconnected}`);

    // ─── STEP 6: Submit ───
    console.log('[Diag] Clicking submit...');
    const submitBtn = page.locator('button[type="submit"]');

    // Use Promise.all to click and wait for navigation simultaneously
    // This prevents race conditions where navigation happens before we start waiting
    try {
      await Promise.all([
        page.waitForNavigation({ timeout: 60000 }).catch((e) => {
          console.log(`[Diag] waitForNavigation result: ${e.message.substring(0, 100)}`);
        }),
        submitBtn.click(),
      ]);
    } catch (e) {
      console.log(`[Diag] Submit+navigation error: ${e.message.substring(0, 150)}`);
    }

    console.log(`[Diag] After submit — Page closed? ${pageClosed}  Browser disconnected? ${browserDisconnected}`);

    if (pageClosed || browserDisconnected) {
      console.log('[Diag] PROBLEM: Browser or page closed during/after login submission!');
      console.log('[Diag] This means either:');
      console.log('  1. Maersk redirected to a new page/window');
      console.log('  2. Edge crashed during OIDC redirect');
      console.log('  3. Something force-closed the browser');
      
      // Check if there are other pages in the context
      const pages = context.pages();
      console.log(`[Diag] Pages in context: ${pages.length}`);
      for (let i = 0; i < pages.length; i++) {
        console.log(`  Page ${i}: ${pages[i].url()}`);
      }
      return;
    }

    // ─── STEP 7: Wait and observe ───
    console.log(`[Diag] URL after submit: ${page.url()}`);
    await page.screenshot({ path: 'snapshots/diag_after_submit.png' }).catch(() => {});

    // Wait for things to settle
    console.log('[Diag] Waiting 10s for page to settle...');
    for (let i = 0; i < 10; i++) {
      if (pageClosed || browserDisconnected) {
        console.log(`[Diag] Browser/page closed at second ${i}!`);
        break;
      }
      await page.waitForTimeout(1000).catch(() => {});
      if (i % 3 === 0) {
        const url = page.url().substring(0, 100);
        console.log(`[Diag] t+${i}s URL: ${url}`);
      }
    }

    if (!pageClosed && !browserDisconnected) {
      console.log(`[Diag] Final URL: ${page.url()}`);
      await page.screenshot({ path: 'snapshots/diag_final.png' }).catch(() => {});

      const originVisible = await page.locator('#mc-input-origin').isVisible({ timeout: 5000 }).catch(() => false);
      if (originVisible) {
        console.log('[Diag] SUCCESS — Booking form visible!');
      } else {
        console.log('[Diag] Login form or error page still showing');
        const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 1500)).catch(() => 'N/A');
        console.log(`[Diag] Page text: ${bodyText}`);
      }

      // Keep browser open for inspection
      console.log('[Diag] Keeping browser open for 2 minutes for manual inspection...');
      await page.waitForTimeout(120000).catch(() => {});
    }

  } catch (err) {
    console.error(`[Diag] FATAL: ${err.message}`);
    if (page && !page.isClosed()) {
      await page.screenshot({ path: 'snapshots/diag_error.png' }).catch(() => {});
    }
  } finally {
    if (browser) {
      console.log('[Diag] Closing browser...');
      await browser.close().catch(() => {});
    }
  }
})();
