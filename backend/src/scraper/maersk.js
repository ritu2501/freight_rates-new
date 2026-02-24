/**
 * Maersk Spot Rate Scraper
 *
 * Uses launchPersistentContext with .maersk-profile to preserve cookies
 * (including Akamai _abck sensor cookie) between sessions. This is critical
 * because Akamai validates the sensor cookie on every /authenticate request.
 *
 * NO route interception (page.route) — that proxies requests through Node.js
 * TLS stack and causes Akamai 403. All browser requests are native.
 */

const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ── Constants ─────────────────────────────────────────────────────────────
const SNAPSHOT_DIR = process.env.SNAPSHOT_DIR || path.join(__dirname, '..', '..', 'snapshots');
const MAERSK_BOOK_URL = 'https://www.maersk.com/book/';
const PROFILE_DIR = path.join(__dirname, '..', '..', '.maersk-profile');
const LOCKOUT_FILE = path.join(__dirname, '..', '..', '.last-login-attempt');
const MIN_LOGIN_INTERVAL_MS = 2 * 60 * 1000;

if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
if (!fs.existsSync(PROFILE_DIR)) fs.mkdirSync(PROFILE_DIR, { recursive: true });

// ══════════════════════════════════════════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════════════════════════════════════════

function encryptSnapshot(html) {
  const key = (process.env.ENCRYPTION_KEY || 'change-me-in-production-32chars!').padEnd(32, '0').slice(0, 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key), iv);
  let enc = cipher.update(html, 'utf8', 'hex');
  enc += cipher.final('hex');
  return { iv: iv.toString('hex'), data: enc };
}

function saveSnapshot(html, jobId) {
  const id = `snap_${uuidv4()}`;
  const encrypted = encryptSnapshot(html);
  const checksum = crypto.createHash('sha256').update(html).digest('hex');
  const meta = {
    snapshot_id: id, job_id: jobId, checksum, iv: encrypted.iv,
    created_at: new Date().toISOString(), size_bytes: Buffer.byteLength(html, 'utf8'),
  };
  fs.writeFileSync(path.join(SNAPSHOT_DIR, `${id}.enc`), encrypted.data, 'utf8');
  fs.writeFileSync(path.join(SNAPSHOT_DIR, `${id}.meta.json`), JSON.stringify(meta, null, 2), 'utf8');
  return id;
}

async function screenshot(page, label) {
  try {
    const dest = path.join(SNAPSHOT_DIR, `debug_${label}_${Date.now()}.png`);
    await page.screenshot({ path: dest, fullPage: false });
    console.log(`  [screenshot] ${dest}`);
  } catch (e) { /* page might be closed */ }
}

async function dismissOverlays(page) {
  try {
    const btn = page.locator('.coi-banner__accept').first();
    if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
      await btn.click({ force: true });
      await page.waitForTimeout(800);
    }
    await page.evaluate(() => {
      document.getElementById('coiOverlay')?.remove();
      document.getElementById('cookie-information-template-wrapper')?.remove();
    }).catch(() => { });
    const coach = page.locator('button.coach__button--finish');
    if (await coach.isVisible({ timeout: 800 }).catch(() => false)) {
      await coach.click();
      await page.waitForTimeout(500);
    }
  } catch { /* ignore */ }
}

async function safeInputValue(loc) {
  try { return (await loc.inputValue()) || ''; } catch { return ''; }
}

function mapContainer(type) {
  const m = {
    '20DRY': '20 Dry Standard', '40DRY': '40 Dry Standard', '40HIGH': '40 Dry High', '45HIGH': '45 Dry High',
    '20FT': '20 Dry Standard', '40FT': '40 Dry Standard', '40HC': '40 Dry High', '45FT': '45 Dry High',
  };
  return m[type?.toUpperCase()] || '40 Dry High';
}

function fmtDate(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) { const t = new Date(); t.setDate(t.getDate() + 1); return fmtDate(t.toISOString().split('T')[0]); }
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${String(d.getDate()).padStart(2, '0')} ${M[d.getMonth()]} ${d.getFullYear()}`;
}

function confidence(r) {
  let s = 0;
  if (r.price > 0) s += 0.35;
  if (['USD', 'EUR', 'GBP'].includes(r.currency)) s += 0.2;
  if (r.transit_days > 0 && r.transit_days < 90) s += 0.2;
  if (r.valid_until) s += 0.15;
  s += 0.1;
  return Math.round(s * 100) / 100;
}

function validUntil() { const d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString(); }

function isPageAlive(page) {
  try { return !page.isClosed(); } catch { return false; }
}

function isContextAlive(ctx) {
  try { ctx.pages(); return true; } catch { return false; }
}

function humanDelay(baseMs, jitterMs) {
  return baseMs + Math.floor(Math.random() * jitterMs);
}

// ══════════════════════════════════════════════════════════════════════════
// BROWSER STEALTH
// ══════════════════════════════════════════════════════════════════════════

async function hardenPage(page) {
  await page.addInitScript(() => {
    // Block window.close()
    window.close = function () { };

    // Remove webdriver flag
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true });

    // Chrome runtime
    if (!window.chrome) window.chrome = {};
    if (!window.chrome.runtime) {
      window.chrome.runtime = { connect: function () { }, sendMessage: function () { } };
    }

    // Plugins
    Object.defineProperty(navigator, 'plugins', {
      get: () => {
        const arr = [
          { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
          { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
          { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
        ];
        arr.item = (i) => arr[i] || null;
        arr.namedItem = (n) => arr.find(p => p.name === n) || null;
        arr.refresh = () => { };
        return arr;
      },
    });

    // Misc fingerprint
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
    Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });

    // Permissions
    const origPQ = window.navigator.permissions?.query;
    if (origPQ) {
      window.navigator.permissions.query = (params) =>
        params.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : origPQ.call(window.navigator.permissions, params);
    }

    // WebGL
    const getParam = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (p) {
      if (p === 37445) return 'Intel Inc.';
      if (p === 37446) return 'Intel Iris OpenGL Engine';
      return getParam.call(this, p);
    };

    // Hide overrides
    const origTS = Function.prototype.toString;
    const patched = new Set([window.close]);
    Function.prototype.toString = function () {
      if (patched.has(this)) return 'function close() { [native code] }';
      return origTS.call(this);
    };
  });
}

// ══════════════════════════════════════════════════════════════════════════
// LOGIN
// ══════════════════════════════════════════════════════════════════════════

async function loginToMaersk(page, context) {
  const username = process.env.MAERSK_USERNAME;
  const password = process.env.MAERSK_PASSWORD;
  if (!username || !password) throw new Error('MAERSK_USERNAME / MAERSK_PASSWORD not set in .env');

  // Stealth
  await hardenPage(page);

  // Navigate to /book/
  console.log('[Login] Navigating to /book/...');
  await page.goto(MAERSK_BOOK_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(humanDelay(3000, 2000));
  await dismissOverlays(page);

  // Already logged in? (persistent context may have session cookies)
  if (await page.locator('#mc-input-origin').isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log('[Login] Already logged in (session cookies from persistent profile)');
    return page;
  }

  // Rate-limit guard - ONLY trigger if we actually need to log in
  if (fs.existsSync(LOCKOUT_FILE)) {
    const last = parseInt(fs.readFileSync(LOCKOUT_FILE, 'utf8'), 10);
    const elapsed = Date.now() - last;
    if (elapsed < MIN_LOGIN_INTERVAL_MS) {
      const wait = Math.ceil((MIN_LOGIN_INTERVAL_MS - elapsed) / 1000);
      console.log('[Login] Rate-limited: ' + wait + 's remaining');
      throw new Error('Rate-limited: wait ' + wait + 's before retrying');
    }
  }
  fs.writeFileSync(LOCKOUT_FILE, String(Date.now()), 'utf8');

  // Read-only 403 logger
  page.on('response', (resp) => {
    if (resp.status() === 403) {
      console.log('[Login] 403 response: ' + resp.url().substring(0, 100));
    }
  });

  // Fill credentials with human-like typing
  console.log('[Login] Filling credentials...');
  await page.waitForTimeout(humanDelay(1500, 1500));
  await dismissOverlays(page);

  const usernameInput = page.locator('#mc-input-username');
  await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
  await usernameInput.click();
  await page.waitForTimeout(humanDelay(400, 300));

  // Type character by character
  for (const ch of username) {
    await usernameInput.press(ch);
    await page.waitForTimeout(humanDelay(60, 100));
  }
  await page.waitForTimeout(humanDelay(600, 400));

  // Tab to password
  await page.keyboard.press('Tab');
  await page.waitForTimeout(humanDelay(300, 300));

  const passwordInput = page.locator('input[name="password"]:visible');
  await passwordInput.waitFor({ state: 'visible', timeout: 5000 });

  for (const ch of password) {
    await passwordInput.press(ch);
    await page.waitForTimeout(humanDelay(50, 90));
  }
  await page.waitForTimeout(humanDelay(800, 500));
  await dismissOverlays(page);

  // Submit
  console.log('[Login] Submitting...');
  await page.locator('button[type="submit"]').click();

  // Wait for OIDC chain
  const loginDeadline = Date.now() + 90000;
  let loggedIn = false;
  let isRecoveryPage = false;
  let retryLoginDone = false;

  try { await page.waitForTimeout(12000); } catch { /* page may close */ }

  while (Date.now() < loginDeadline) {
    try { await page.waitForTimeout(3000); } catch { /* page closed */ }

    if (!isPageAlive(page)) {
      console.log('[Login] Page closed - opening new page...');
      if (!isContextAlive(context)) {
        console.log('[Login] Browser context is dead - cannot recover');
        throw new Error('Browser context destroyed during login');
      }
      try {
        page = await context.newPage();
        await hardenPage(page);
        isRecoveryPage = true;
        page.on('response', (resp) => {
          if (resp.status() === 403) {
            console.log('[Login] 403 on recovery: ' + resp.url().substring(0, 100));
          }
        });
        await page.goto(MAERSK_BOOK_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(humanDelay(4000, 2000));
        await dismissOverlays(page);
      } catch (e) {
        console.log('[Login] New page error: ' + e.message.substring(0, 80));
        if (e.message.includes('has been closed') || e.message.includes('destroyed')) {
          throw new Error('Browser context destroyed during login');
        }
        continue;
      }
    }

    // Booking form visible = logged in
    try {
      if (await page.locator('#mc-input-origin').isVisible({ timeout: 2000 }).catch(() => false)) {
        loggedIn = true;
        break;
      }
    } catch { continue; }

    let currentUrl = '';
    try { currentUrl = page.url(); } catch { continue; }
    const remaining = Math.ceil((loginDeadline - Date.now()) / 1000);
    console.log('[Login] ' + remaining + 's left | ' + currentUrl.substring(0, 80));

    // Recovery: re-fill on NEW page only
    if (isRecoveryPage && !retryLoginDone &&
      currentUrl.includes('accounts.maersk.com') && currentUrl.includes('/auth/login')) {
      const uInput = page.locator('#mc-input-username');
      const uVisible = await uInput.isVisible({ timeout: 2000 }).catch(() => false);
      if (uVisible) {
        console.log('[Login] Recovery: re-filling credentials...');
        retryLoginDone = true;
        try {
          await dismissOverlays(page);
          await uInput.click();
          await page.waitForTimeout(humanDelay(400, 300));
          for (const ch of username) {
            await uInput.press(ch);
            await page.waitForTimeout(humanDelay(60, 100));
          }
          await page.waitForTimeout(humanDelay(500, 400));
          await page.keyboard.press('Tab');
          await page.waitForTimeout(humanDelay(300, 200));
          const pInput = page.locator('input[name="password"]:visible');
          for (const ch of password) {
            await pInput.press(ch);
            await page.waitForTimeout(humanDelay(50, 90));
          }
          await page.waitForTimeout(humanDelay(800, 400));
          console.log('[Login] Recovery: submitting...');
          await page.locator('button[type="submit"]').click();
          await page.waitForTimeout(12000);
        } catch (e) {
          console.log('[Login] Recovery error: ' + e.message.substring(0, 80));
        }
        continue;
      }
    }

    // Landed on www.maersk.com but not /book/
    if (currentUrl.startsWith('https://www.maersk.com') && !currentUrl.includes('/book')) {
      try {
        if (currentUrl.includes('why-upgrade')) {
          const laterBtn = page.locator('text=Complete later').first();
          if (await laterBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
            console.log('[Login] Clicking "Complete later"...');
            await laterBtn.click();
            await page.waitForTimeout(3000);
          }
        }
        if (!page.url().includes('/book')) {
          console.log('[Login] Navigating to /book/...');
          await page.goto(MAERSK_BOOK_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
          await page.waitForTimeout(humanDelay(3000, 2000));
          await dismissOverlays(page);
        }
      } catch (e) {
        console.log('[Login] Nav error: ' + e.message.substring(0, 80));
      }
    }
  }

  if (loggedIn) {
    console.log('[Login] SUCCESS - booking form ready');
    return page;
  }

  // Last resort: wait for human
  console.log('[Login] Auto-login incomplete. URL: ' + (isPageAlive(page) ? page.url() : 'page closed'));
  await screenshot(page, 'login_incomplete').catch(() => { });

  console.log('\n=== WAITING for login in browser window (2 min) ===\n');

  const humanDeadline2 = Date.now() + 120000;
  while (Date.now() < humanDeadline2) {
    try { await page.waitForTimeout(5000); } catch { }

    if (!isPageAlive(page)) {
      if (!isContextAlive(context)) {
        console.log('[Login] Browser context is dead in manual wait');
        throw new Error('Browser context destroyed - cannot recover');
      }
      try {
        page = await context.newPage();
        await hardenPage(page);
        await page.goto(MAERSK_BOOK_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(3000);
      } catch (e) {
        if (e.message.includes('has been closed') || e.message.includes('destroyed')) {
          throw new Error('Browser context destroyed - cannot recover');
        }
        continue;
      }
    }

    try {
      if (await page.locator('#mc-input-origin').isVisible({ timeout: 2000 }).catch(() => false)) {
        console.log('[Login] Booking form detected!');
        return page;
      }
    } catch { }

    console.log('[Login] Waiting... ' + Math.ceil((humanDeadline2 - Date.now()) / 1000) + 's remaining');
  }

  throw new Error('Login failed - booking form not visible after all retries');
}

// ══════════════════════════════════════════════════════════════════════════
// FILL COMBOBOX
// ══════════════════════════════════════════════════════════════════════════

async function fillCombobox(page, selector, text, label) {
  console.log('[Form] ' + label + ': "' + text + '"');
  const input = typeof selector === 'string' ? page.locator(selector) : selector;
  await input.waitFor({ state: 'visible', timeout: 10000 });
  await input.scrollIntoViewIfNeeded().catch(() => { });
  await page.waitForTimeout(500);

  // Strategies: try multiple typing approaches
  const strategies = [
    { name: 'pressSequentially', textFn: (t) => t },
    { name: 'keyboard.insertText', textFn: (t) => t },
    { name: 'pressSequentially-short', textFn: (t) => t.split(/[\s,]+/)[0] },
  ];

  for (let attempt = 0; attempt < strategies.length; attempt++) {
    const strategy = strategies[attempt];
    const textToType = strategy.textFn(text);
    console.log('[Form] ' + label + ': attempt ' + (attempt + 1) + '/' + strategies.length + ' (' + strategy.name + ') text="' + textToType + '"');

    // Step 1: Click to focus
    await input.click();
    await page.waitForTimeout(humanDelay(300, 200));

    // Step 2: Clear existing text
    await input.click({ clickCount: 3 });
    await page.waitForTimeout(200);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(300);
    // Verify cleared
    const clearedVal = await safeInputValue(input);
    if (clearedVal && clearedVal.length > 0) {
      await input.fill('').catch(() => { });
      await page.waitForTimeout(300);
    }

    // Step 3: Type using the current strategy
    if (strategy.name === 'keyboard.insertText') {
      // insertText fires a single 'input' event — some web components respond to this
      await input.click();
      await page.waitForTimeout(120);
      await page.keyboard.insertText(textToType);
    } else {
      // pressSequentially fires individual key events
      await input.pressSequentially(textToType, { delay: humanDelay(60, 40) });
    }
    await page.waitForTimeout(600);

    // Step 4: Verify the input received the text
    const typedVal = await safeInputValue(input);
    console.log('[Form] ' + label + ': typed value = "' + typedVal + '"');
    if (!typedVal || typedVal.length < 2) {
      console.log('[Form] ' + label + ': text not received, trying JS event dispatch...');
      await input.evaluate((el, val) => {
        el.value = val;
        el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, composed: true, key: val.slice(-1) }));
      }, textToType).catch(() => { });
      await page.waitForTimeout(500);
      const jsVal = await safeInputValue(input);
      console.log('[Form] ' + label + ': after JS dispatch value = "' + jsVal + '"');
    }

    // Step 5: Wait for dropdown (location API needs time)
    await page.waitForTimeout(humanDelay(3000, 2000));

    // Step 6: Check for dropdown options (multiple selectors)
    const dropdownSelectors = [
      'li[role="option"]', '[role="option"]', '[role="listbox"] li',
      'ul[role="listbox"] li', 'mds-listbox-option', 'mc-option',
    ];
    for (const sel of dropdownSelectors) {
      const opt = page.locator(sel).first();
      if (await opt.isVisible({ timeout: 2000 }).catch(() => false)) {
        const t = await opt.textContent().catch(() => '');
        console.log('[Form] ' + label + ' selected: "' + t.trim() + '" (attempt ' + (attempt + 1) + ', ' + strategy.name + ')');
        await opt.click();
        await page.waitForTimeout(600);
        return true;
      }
    }

    // Step 7: Log what's visible for debugging
    const optCount = await page.locator('[role="option"]').count().catch(() => 0);
    const lbCount = await page.locator('[role="listbox"]').count().catch(() => 0);
    console.log('[Form] ' + label + ': no visible dropdown (options=' + optCount + ' listboxes=' + lbCount + ')');

    // Escape before next attempt
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }

  // Last resort: ArrowDown+Enter
  console.log('[Form] ' + label + ': all strategies failed — trying ArrowDown+Enter');
  await input.click();
  await page.waitForTimeout(120);
  await input.press('ArrowDown');
  await page.waitForTimeout(120);
  await input.press('Enter');
  await page.waitForTimeout(300);
  return false;
}

// ══════════════════════════════════════════════════════════════════════════
// MAIN SCRAPER — uses launchPersistentContext to reuse cookies/sessions
// ══════════════════════════════════════════════════════════════════════════

async function scrapeMaerskSpotRate(params) {
  const jobId = params.job_id || uuidv4();
  const startTime = Date.now();
  let context = null;

  try {
    const { chromium } = require('playwright');

    console.log('\n[Scraper] === Job ' + jobId + ' ===');
    console.log('[Scraper] Route: ' + params.from_port + ' -> ' + params.to_port);

    // Launch Edge with PERSISTENT CONTEXT — reuses cookies between sessions
    // This is critical: Akamai _abck sensor cookie persists, avoiding 403
    console.log('[Scraper] Using persistent profile: ' + PROFILE_DIR);
    context = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: true,
      channel: 'msedge',
      slowMo: 50,  // Reduced slowMo since it's headless now
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
      locale: 'en-US',
      timezoneId: 'Asia/Kolkata',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--start-maximized',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-component-update',
        '--disable-features=RendererCodeIntegrity',
      ],
    });

    // Apply stealth at context level so ALL pages (including recovery) get it
    await context.addInitScript(() => {
      window.close = function () { };
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true });
      if (!window.chrome) window.chrome = {};
      if (!window.chrome.runtime) window.chrome.runtime = { connect: function () { }, sendMessage: function () { } };
    });

    // Use the first page from persistent context — do NOT create extra blank tabs
    // launchPersistentContext always provides at least one page
    let page = context.pages()[0];
    // Close any extra about:blank tabs to avoid "2 blank tabs" issue
    const existingPages = context.pages();
    for (let i = 1; i < existingPages.length; i++) {
      try {
        if (existingPages[i].url() === 'about:blank' || existingPages[i].url() === '') {
          await existingPages[i].close();
        }
      } catch { }
    }
    console.log('[Scraper] Using initial context page (tabs: ' + context.pages().length + ')');

    // STEP 1: LOGIN
    page = await loginToMaersk(page, context);
    await screenshot(page, '01_logged_in');

    // ALWAYS navigate to a fresh booking page to clear any previous form data
    console.log('[Form] Navigating to fresh booking page to clear previous data...');
    await page.goto(MAERSK_BOOK_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    // Wait for booking form to load
    await page.locator('#mc-input-origin').waitFor({ state: 'visible', timeout: 15000 }).catch(() => { });
    await page.waitForTimeout(2000);
    await dismissOverlays(page);
    console.log('[Form] Fresh booking page loaded — filling all fields from scratch');

    // Read-only response listener for API extraction + location API monitoring
    const apiResponses = [];
    page.on('response', async (resp) => {
      const url = resp.url();
      // Monitor location search API (used by origin/destination autocomplete)
      if (url.includes('/geography/locations') || url.includes('/location')) {
        const query = url.includes('?') ? url.substring(url.indexOf('?')) : '';
        console.log('[API] Location search: status=' + resp.status() + ' ' + query.substring(0, 120));
        try {
          const body = await resp.json().catch(() => null);
          if (body) {
            const count = Array.isArray(body) ? body.length : (body.locations?.length || body.results?.length || '?');
            console.log('[API] Location results: ' + count + ' locations returned');
          }
        } catch { }
      }
      if (url.includes('/price') || url.includes('/rate') || url.includes('/offer') ||
        url.includes('/schedule') || url.includes('/quotation')) {
        try {
          const body = await resp.json().catch(() => null);
          if (body) apiResponses.push({ url, status: resp.status(), body });
        } catch { }
      }
    });

    // STEP 2: CLEAR any lingering values in origin field, then fill fresh
    const originInput = page.locator('#mc-input-origin');
    const existingOrigin = await safeInputValue(originInput);
    if (existingOrigin && existingOrigin.trim()) {
      console.log('[Form] Clearing previous origin: "' + existingOrigin + '"');
      await originInput.click({ clickCount: 3 });
      await originInput.fill('');
      await page.waitForTimeout(500);
      // Dismiss any dropdown that appeared
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }

    // STEP 3: ORIGIN — always fill with user's data
    await fillCombobox(page, '#mc-input-origin', params.from_port, 'Origin');
    // Wait longer after origin selection for destination to become available
    await page.waitForTimeout(5000);

    // STEP 4: DESTINATION — The mc-c-origin-destination web component has both inputs in shadow DOM
    // After origin is selected, the destination input should become available
    console.log('[Form] Looking for destination input...');

    // Try multiple selectors for destination with increasing timeouts
    const destSelectors = [
      '#mc-input-destination',
      'mc-c-origin-destination input[role="combobox"]:not([id="mc-input-origin"])',
      'input[id*="destination"][role="combobox"]',
      'input[placeholder*="city or port" i]:not([id="mc-input-origin"])',
      'input[placeholder*="destination" i]',
      'input[placeholder*="delivery" i]',
    ];

    let destLoc = null;
    let destVis = false;

    for (let attempt = 0; attempt < 5; attempt++) {
      for (const sel of destSelectors) {
        const loc = page.locator(sel).first();
        const vis = await loc.isVisible({ timeout: 2000 }).catch(() => false);
        if (vis) {
          destLoc = loc;
          destVis = true;
          const destId = await loc.getAttribute('id').catch(() => 'unknown');
          console.log('[Form] Destination input found with selector: ' + sel + ' (id=' + destId + ')');
          break;
        }
      }
      if (destVis) break;

      // Fallback: find all combobox inputs and pick the one that's not origin
      const allCbs = page.locator('input[role="combobox"]');
      const cbCount = await allCbs.count().catch(() => 0);
      console.log('[Form] Found ' + cbCount + ' combobox inputs (attempt ' + (attempt + 1) + '/5)');
      for (let i = 0; i < cbCount; i++) {
        const id = await allCbs.nth(i).getAttribute('id').catch(() => '');
        const vis = await allCbs.nth(i).isVisible({ timeout: 1000 }).catch(() => false);
        console.log('[Form]   Combobox #' + (i + 1) + ': id=' + id + ' visible=' + vis);
        if (id !== 'mc-input-origin' && id !== 'mc-input-username' && vis) {
          destLoc = allCbs.nth(i);
          destVis = true;
          console.log('[Form] Using combobox #' + (i + 1) + ' as destination (id=' + id + ')');
          break;
        }
      }
      if (destVis) break;

      console.log('[Form] Destination not found yet, waiting (attempt ' + (attempt + 1) + '/5)...');
      await page.waitForTimeout(3000);
    }

    if (destVis && destLoc) {
      // Keep it simple — just call fillCombobox like we do for origin
      // Do NOT pre-process (click, escape, etc.) — that confuses the web component
      await fillCombobox(page, destLoc, params.to_port, 'Destination');
      await page.waitForTimeout(2000);
    } else {
      console.log('[Form] WARNING: Could not find destination input — form will be incomplete');
    }

    await page.waitForTimeout(2000);

    // STEP 4b: INLAND TRANSPORT — select CY or SD radio buttons
    await dismissOverlays(page);
    const originInland = (params.origin_inland || 'CY').toUpperCase();
    const destInland = (params.destination_inland || 'CY').toUpperCase();
    console.log('[Form] Inland transport: origin=' + originInland + ', destination=' + destInland);

    // Origin inland: look for radio/toggle buttons near origin
    // Maersk uses radio buttons or toggle cards with CY/SD labels
    try {
      // Try multiple selectors for the inland transport toggles
      // Origin CY/SD — typically the first set of radio/toggle buttons
      const originRadios = page.locator(
        'mc-c-inland-transport:first-of-type input[type="radio"], ' +
        '[data-test*="origin"][data-test*="inland"] input[type="radio"], ' +
        '[data-test*="origin"][data-test*="transport"] input[type="radio"]'
      );
      const originRadioCount = await originRadios.count().catch(() => 0);

      if (originRadioCount > 0) {
        // Click the matching radio
        for (let i = 0; i < originRadioCount; i++) {
          const val = await originRadios.nth(i).getAttribute('value').catch(() => '');
          if (val && val.toUpperCase() === originInland) {
            await originRadios.nth(i).click({ force: true });
            console.log('[Form] Origin inland radio clicked: ' + originInland);
            break;
          }
        }
      } else {
        // Fallback: look for buttons/labels with CY or SD text in the origin section
        const allInlandBtns = page.locator(
          'mc-c-inland-transport, [class*="inland"], [data-test*="inland"]'
        );
        const inlandCount = await allInlandBtns.count().catch(() => 0);
        console.log('[Form] Found ' + inlandCount + ' inland transport sections');

        if (inlandCount >= 1) {
          // First section = origin
          const originSection = allInlandBtns.nth(0);
          if (originInland === 'SD') {
            const sdBtn = originSection.locator('label:has-text("SD"), button:has-text("SD"), [data-test*="sd"], input[value="SD"]').first();
            if (await sdBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
              await sdBtn.click({ force: true });
              console.log('[Form] Origin SD selected via label/button');
            }
          } else {
            const cyBtn = originSection.locator('label:has-text("CY"), button:has-text("CY"), [data-test*="cy"], input[value="CY"]').first();
            if (await cyBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
              await cyBtn.click({ force: true });
              console.log('[Form] Origin CY selected via label/button');
            }
          }
        }

        // Second section = destination (if exists)
        if (inlandCount >= 2) {
          const destSection = allInlandBtns.nth(1);
          if (destInland === 'SD') {
            const sdBtn = destSection.locator('label:has-text("SD"), button:has-text("SD"), [data-test*="sd"], input[value="SD"]').first();
            if (await sdBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
              await sdBtn.click({ force: true });
              console.log('[Form] Destination SD selected via label/button');
            }
          } else {
            const cyBtn = destSection.locator('label:has-text("CY"), button:has-text("CY"), [data-test*="cy"], input[value="CY"]').first();
            if (await cyBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
              await cyBtn.click({ force: true });
              console.log('[Form] Destination CY selected via label/button');
            }
          }
        }
      }

      // Also try generic approach: all radio inputs with value CY or SD on the page
      if (originRadioCount === 0) {
        const allRadios = page.locator('input[type="radio"]');
        const radioCount = await allRadios.count().catch(() => 0);
        let cyRadios = [];
        let sdRadios = [];
        for (let i = 0; i < radioCount; i++) {
          const val = (await allRadios.nth(i).getAttribute('value').catch(() => ''))?.toUpperCase();
          if (val === 'CY') cyRadios.push(i);
          if (val === 'SD') sdRadios.push(i);
        }
        console.log('[Form] Found ' + cyRadios.length + ' CY radios, ' + sdRadios.length + ' SD radios');
        // Origin = first pair, Destination = second pair
        if (cyRadios.length >= 1 && sdRadios.length >= 1) {
          if (originInland === 'SD' && sdRadios.length >= 1) {
            await allRadios.nth(sdRadios[0]).click({ force: true });
            console.log('[Form] Origin SD selected (generic radio)');
          } else if (originInland === 'CY' && cyRadios.length >= 1) {
            await allRadios.nth(cyRadios[0]).click({ force: true });
            console.log('[Form] Origin CY selected (generic radio)');
          }
        }
        if (cyRadios.length >= 2 && sdRadios.length >= 2) {
          if (destInland === 'SD') {
            await allRadios.nth(sdRadios[1]).click({ force: true });
            console.log('[Form] Destination SD selected (generic radio)');
          } else {
            await allRadios.nth(cyRadios[1]).click({ force: true });
            console.log('[Form] Destination CY selected (generic radio)');
          }
        }
      }
    } catch (e) {
      console.log('[Form] Inland transport selection error (non-fatal): ' + e.message.substring(0, 100));
    }
    await page.waitForTimeout(1000);
    await screenshot(page, '03_route');

    // STEP 5: COMMODITY — always clear and fill fresh
    await dismissOverlays(page);
    const comIn = page.locator('mc-c-commodity input[role="combobox"], input[placeholder*="commodity" i]').first();
    const comVis = await comIn.isVisible({ timeout: 3000 }).catch(() => false);
    if (comVis && !(await comIn.isDisabled().catch(() => true))) {
      // Clear any previous commodity value
      const comVal = await safeInputValue(comIn);
      if (comVal && comVal.trim()) {
        console.log('[Form] Clearing previous commodity: "' + comVal + '"');
        await comIn.click({ clickCount: 3 });
        await comIn.fill('');
        await page.waitForTimeout(500);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
      }
      const commodity = params.commodity || 'General';
      console.log('[Form] Commodity: "' + commodity + '"');
      await comIn.click(); await page.waitForTimeout(300);
      await comIn.pressSequentially(commodity, { delay: 80 });
      await page.waitForTimeout(2500);
      const cOpt = page.locator('li[role="option"]').first();
      if (await cOpt.isVisible({ timeout: 3000 }).catch(() => false)) await cOpt.click();
      else { await comIn.press('ArrowDown'); await page.waitForTimeout(300); await comIn.press('Enter'); }
      await page.waitForTimeout(1500);
    }

    // STEP 6: CONTAINER
    await page.waitForTimeout(3000);
    const contIn = page.locator('input[placeholder*="container type" i]:not([disabled]), mc-c-container-select input[role="combobox"]:not([disabled])').first();
    let contReady = false;
    for (let i = 0; i < 5; i++) {
      contReady = await contIn.isVisible({ timeout: 2000 }).catch(() => false);
      if (contReady && !(await contIn.isDisabled().catch(() => true))) break;
      contReady = false;
      await page.waitForTimeout(2000);
    }
    if (contReady) {
      // Clear any previous container type
      const existingCont = await safeInputValue(contIn);
      if (existingCont && existingCont.trim()) {
        console.log('[Form] Clearing previous container: "' + existingCont + '"');
        await contIn.click({ clickCount: 3 });
        await contIn.fill('');
        await page.waitForTimeout(500);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
      }
      const ct = mapContainer(params.container_type);
      console.log('[Form] Container: ' + ct);
      await contIn.click(); await page.waitForTimeout(500);
      await contIn.pressSequentially(ct, { delay: 80 });
      await page.waitForTimeout(1500);
      const cOpt = page.locator('li[role="option"]').first();
      if (await cOpt.isVisible({ timeout: 3000 }).catch(() => false)) await cOpt.click();
      else { await contIn.press('ArrowDown'); await page.waitForTimeout(300); await contIn.press('Enter'); }
      await page.waitForTimeout(1000);
    }

    // Quantity — always overwrite
    const qtyIn = page.locator('mc-c-container-select input[type="number"], input[data-test*="quantity"]').first();
    if (await qtyIn.isVisible({ timeout: 2000 }).catch(() => false) && !(await qtyIn.isDisabled().catch(() => true))) {
      await qtyIn.click({ clickCount: 3 });
      await qtyIn.fill(String(params.number_of_containers || 1));
      console.log('[Form] Quantity: ' + (params.number_of_containers || 1));
    }

    // STEP 6b: WEIGHT
    // RCA: Previously, weight was not always filled due to selector mismatch or unit confusion.
    // Now: Only convert if unit is lb, otherwise keep as kg. Always fill the website in kg.
    // Improved: Add more robust selector and error logging/screenshots for debugging.
    if (params.weight_per_container) {
      let weightToFill = params.weight_per_container;
      let unit = (params.weight_unit || 'kg').toLowerCase();
      if (unit === 'lb' || unit === 'lbs') {
        // Convert pounds to kg (1 lb = 0.453592 kg)
        weightToFill = (parseFloat(weightToFill) * 0.453592).toFixed(2);
        unit = 'kg';
      }
      // Try multiple selectors, including shadow DOM if needed
      let weightIn = page.locator('input[data-test*="weight"], input[placeholder*="weight" i], input[name*="weight" i]').first();
      if (!(await weightIn.isVisible({ timeout: 2000 }).catch(() => false))) {
        // Try a more generic selector as fallback
        weightIn = page.locator('input[type="number"]').filter({ hasText: '' }).first();
      }
      if (!(await weightIn.isVisible({ timeout: 2000 }).catch(() => false))) {
        // Try to find any visible input in the container weight section
        const allInputs = await page.locator('input').all();
        for (const inp of allInputs) {
          const ph = await inp.getAttribute('placeholder').catch(() => '');
          if (ph && ph.toLowerCase().includes('weight')) {
            weightIn = inp;
            break;
          }
        }
      }
      if (!(await weightIn.isVisible({ timeout: 2000 }).catch(() => false))) {
        console.log('[Form][ERROR] Weight input not found or not visible!');
        await screenshot(page, 'weight_input_not_found');
      } else if (await weightIn.isDisabled().catch(() => true)) {
        console.log('[Form][ERROR] Weight input is disabled!');
        await screenshot(page, 'weight_input_disabled');
      } else {
        await weightIn.click({ clickCount: 3 });
        await weightIn.fill(String(weightToFill));
        console.log(`[Form] Weight: ${weightToFill} kg (original: ${params.weight_per_container} ${params.weight_unit || 'kg'})`);
        await screenshot(page, 'weight_filled');
      }
    }

    // STEP 7: DATE — only fill if user explicitly provides a ship_date
    // Ship date is NOT a required field for getting results
    if (params.ship_date && params.ship_date.trim()) {
      const fd = fmtDate(params.ship_date);
      console.log('[Form] Date: ' + fd + ' (user-provided)');
      const dateIn = page.locator('mc-input-date#earliestDepartureDatePicker input, #earliestDepartureDatePicker input, input[placeholder*="DD MMM"]').first();
      const dateVis = await dateIn.isVisible({ timeout: 3000 }).catch(() => false);
      if (dateVis && !(await dateIn.isDisabled().catch(() => true))) {
        await dateIn.click({ clickCount: 3 });
        await page.waitForTimeout(300);
        await dateIn.fill('');
        await page.waitForTimeout(300);
        await dateIn.pressSequentially(fd, { delay: 80 });
        await page.waitForTimeout(500);
        await dateIn.press('Tab');
        await page.waitForTimeout(1000);
        console.log('[Form] Date filled successfully');
      } else {
        console.log('[Form] Date input not accessible — skipping');
      }
    } else {
      console.log('[Form] Date: skipped (not provided by user)');
    }

    await screenshot(page, '06_form');

    // STEP 8: SUBMIT (Maersk uses "Continue to book" button, NOT "Search")
    await dismissOverlays(page);
    await page.waitForTimeout(2000);

    // Wait for the submit button to become enabled
    const submitBtn = page.locator(
      'mc-button[data-test="buttonSubmit"], #od3cpContinueButton, mc-button:has-text("Continue to book"), mc-button:has-text("Continue"), button[data-test="buttonSubmit"]'
    ).first();

    let btnClicked = false;
    for (let btnAttempt = 0; btnAttempt < 5; btnAttempt++) {
      const btnVis = await submitBtn.isVisible({ timeout: 3000 }).catch(() => false);
      if (!btnVis) {
        console.log('[Scraper] Submit button not visible (attempt ' + (btnAttempt + 1) + '/5)');
        await page.waitForTimeout(2000);
        continue;
      }

      // Check if disabled
      const isDisabled = await submitBtn.evaluate(el => {
        return el.hasAttribute('disabled') || el.getAttribute('disabled') === '' || el.disabled;
      }).catch(() => true);

      if (isDisabled) {
        console.log('[Scraper] Submit button is disabled (attempt ' + (btnAttempt + 1) + '/5), waiting...');
        await page.waitForTimeout(3000);
        continue;
      }

      // Button is enabled — click it!
      await submitBtn.click();
      console.log('[Scraper] "Continue to book" clicked');
      btnClicked = true;
      break;
    }

    if (!btnClicked) {
      // Try force-clicking even if disabled as a last resort
      console.log('[Scraper] Force-clicking submit button...');
      await submitBtn.click({ force: true }).catch(e => {
        console.log('[Scraper] Force-click failed: ' + e.message.substring(0, 80));
      });
    }

    // STEP 9: WAIT FOR RESULTS & SCROLL TO LOAD ALL
    console.log('[Scraper] Waiting for results...');
    await page.waitForTimeout(10000);
    const loader = page.locator('mc-loading-indicator, .loading, [class*="spinner"]');
    if (await loader.isVisible({ timeout: 2000 }).catch(() => false)) {
      await loader.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => { });
      await page.waitForTimeout(2000);
    }

    // Scroll down to load ALL result cards (Maersk may lazy-load)
    let prevCardCount = 0;
    for (let scrollAttempt = 0; scrollAttempt < 8; scrollAttempt++) {
      const cardCount = await page.locator(
        'mc-card, .schedule-card, .offer-card, .rate-card, [data-test*="schedule"], [data-test*="result"], [data-test*="offer"]'
      ).count().catch(() => 0);
      console.log('[Scraper] Scroll #' + (scrollAttempt + 1) + ': ' + cardCount + ' cards visible');
      if (cardCount > 0 && cardCount === prevCardCount) break; // no new cards loaded
      prevCardCount = cardCount;
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(2000);
      // Check for "Show more" or "Load more" buttons
      const moreBtn = page.locator('button:has-text("Show more"), button:has-text("Load more"), a:has-text("Show more")').first();
      if (await moreBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await moreBtn.click();
        console.log('[Scraper] Clicked "Show more" button');
        await page.waitForTimeout(3000);
      }
    }
    await screenshot(page, '08_results');

    // STEP 10: EXTRACT RESULTS
    // Use page.content() for snapshot (outer HTML) but use Playwright's innerText/locators
    // for actual data extraction since Maersk uses Shadow DOM web components
    const html = await page.content();
    const snapshotId = saveSnapshot(html, jobId);

    // Also get the full visible text (Playwright's innerText pierces shadow DOM)
    const fullPageText = await page.locator('body').innerText({ timeout: 10000 }).catch(() => '');
    console.log('[Scraper] Full page text length: ' + fullPageText.length);
    console.log('[Scraper] Page text preview: ' + fullPageText.substring(0, 500).replace(/\n/g, ' | '));

    const domResults = await page.evaluate(() => {
      const rates = [];
      const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

      function extractDate(text) {
        // Match patterns like "04 MAR", "4 Mar 2026", "Mar 04", "2026-03-04"
        let dm = text.match(/(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(?:\w*)\s*(\d{4})?/i);
        if (dm) {
          const day = parseInt(dm[1]);
          const mon = dm[2].toUpperCase().substring(0, 3);
          const year = dm[3] ? parseInt(dm[3]) : new Date().getFullYear();
          const mi = MONTHS.indexOf(mon);
          if (mi >= 0) return year + '-' + String(mi + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
        }
        // Try "Mar 04, 2026" or "Mar 4"
        dm = text.match(/(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(?:\w*)\s+(\d{1,2})(?:[,\s]+(\d{4}))?/i);
        if (dm) {
          const day = parseInt(dm[2]);
          const mon = dm[1].toUpperCase().substring(0, 3);
          const year = dm[3] ? parseInt(dm[3]) : new Date().getFullYear();
          const mi = MONTHS.indexOf(mon);
          if (mi >= 0) return year + '-' + String(mi + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
        }
        // ISO format
        dm = text.match(/(\d{4})-(\d{2})-(\d{2})/);
        if (dm) return dm[0];
        return null;
      }

      // Helper: recursively get text from element including shadow DOM
      function getDeepText(el) {
        let text = '';
        if (el.shadowRoot) {
          for (const child of el.shadowRoot.childNodes) {
            text += getDeepText(child);
          }
        }
        for (const child of el.childNodes) {
          if (child.nodeType === Node.TEXT_NODE) {
            text += child.textContent;
          } else if (child.nodeType === Node.ELEMENT_NODE) {
            text += getDeepText(child);
          }
        }
        return text;
      }

      // Try multiple selectors for result cards
      const cardSelectors = [
        'mc-card, .schedule-card, .offer-card, .rate-card',
        '[data-test*="schedule"], [data-test*="result"], [data-test*="offer"]',
        '[data-test*="sailing"], [data-test*="price"]',
        '.booking-result, .sailing-result, .price-card',
      ];

      for (const sel of cardSelectors) {
        document.querySelectorAll(sel).forEach(card => {
          // Use deep text to pierce shadow DOM
          const text = getDeepText(card) || card.textContent || '';
          const pm = text.match(/(USD|EUR|GBP|INR|SGD)\s*[\$\u20AC\u00A3]?\s*([\d,]+(?:\.\d{2})?)/i) ||
            text.match(/([\d,]+(?:\.\d{2})?)\s*(USD|EUR|GBP|INR|SGD)/i);
          const tm = text.match(/(\d+)\s*(?:days?|transit)/i);
          const departureDate = extractDate(text);
          if (pm) {
            const currency = pm[1].length === 3 ? pm[1].toUpperCase() : pm[2].toUpperCase();
            const price = parseFloat((pm[1].length === 3 ? pm[2] : pm[1]).replace(/,/g, ''));
            if (price > 50 && price < 50000) {
              rates.push({
                price, currency, transit_days: tm ? parseInt(tm[1]) : null,
                departure_date: departureDate,
                extraction_method: 'DOM_SELECTOR', raw_text: text.substring(0, 500)
              });
            }
          }
        });
      }

      // Fallback: regex on full page innerText (this catches shadow DOM content too)
      if (!rates.length) {
        const fullText = document.body.innerText || '';
        // Look for price patterns with context
        const rx = /(USD|EUR|GBP|INR|SGD)\s*([\d,]+(?:\.\d{2})?)/gi;
        let m;
        while ((m = rx.exec(fullText)) !== null) {
          const p = parseFloat(m[2].replace(/,/g, ''));
          // Get surrounding text (100 chars before and after) for date/transit extraction
          const start = Math.max(0, m.index - 200);
          const end = Math.min(fullText.length, m.index + m[0].length + 200);
          const context = fullText.substring(start, end);
          const tm = context.match(/(\d+)\s*(?:days?|transit)/i);
          const departureDate = extractDate(context);
          if (p > 50 && p < 50000) {
            rates.push({
              price: p, currency: m[1].toUpperCase(),
              transit_days: tm ? parseInt(tm[1]) : null,
              departure_date: departureDate,
              extraction_method: 'REGEX_FALLBACK'
            });
          }
        }
      }
      return rates;
    });
    console.log('[Scraper] DOM extracted ' + domResults.length + ' results');
    domResults.forEach((r, i) => console.log('[Scraper]   #' + (i + 1) + ': ' + r.currency + ' ' + r.price + (r.departure_date ? ' dep=' + r.departure_date : '') + (r.transit_days ? ' transit=' + r.transit_days + 'd' : '')));

    const apiExtracted = extractFromApiResponses(apiResponses);
    console.log('[Scraper] API extracted ' + apiExtracted.length + ' results');
    // Merge both sources — prefer API data but include DOM results too
    let results = apiExtracted.length > 0 ? apiExtracted : domResults;
    // Deduplicate by price+currency+date (not just price+currency+transit)
    const seen = new Set();
    results = results.filter(r => {
      const k = r.price + '-' + r.currency + '-' + (r.departure_date || '') + '-' + (r.transit_days || '');
      if (seen.has(k)) return false; seen.add(k); return true;
    });
    console.log('[Scraper] Final unique results: ' + results.length);

    await context.close(); context = null;
    const elapsed = Date.now() - startTime;
    console.log('[Scraper] === Done: ' + results.length + ' results in ' + elapsed + 'ms ===\n');

    if (!results.length) {
      return { job_id: jobId, status: 'NO_RESULTS', snapshot_id: snapshotId, elapsed_ms: elapsed, candidates: [], message: 'No pricing data found.' };
    }

    const candidates = results.map(r => ({
      ...r, confidence_score: confidence(r), snapshot_id: snapshotId, valid_until: validUntil(),
      departure_date: r.departure_date || null,
      service_type: r.service_type || 'Spot', ocean_freight: r.ocean_freight || r.price,
      origin_thc: r.origin_thc || 0, destination_thc: r.destination_thc || 0, total_price: r.total_price || r.price,
    }));
    console.log('[Scraper] Returning ' + candidates.length + ' candidates');
    candidates.forEach((c, i) => console.log('[Scraper]   Candidate #' + (i + 1) + ': ' + c.currency + ' ' + c.price + (c.departure_date ? ' dep=' + c.departure_date : '')));

    return { job_id: jobId, status: 'SUCCESS', snapshot_id: snapshotId, elapsed_ms: elapsed, candidates, simulated: false };

  } catch (err) {
    if (context) await context.close().catch(() => { });
    console.error('[Scraper] === FAILED: ' + err.message + ' ===\n');
    return {
      job_id: jobId, status: 'FAILED', error: err.message, elapsed_ms: Date.now() - startTime,
      reason_code: /rate.?limit/i.test(err.message) ? 'RATE_LIMITED' :
        /captcha|blocked|forbidden/i.test(err.message) ? 'ANTI_BOT_DETECTED' : 'SCRAPER_ERROR',
      candidates: [],
    };
  }
}

function extractFromApiResponses(responses) {
  const rates = [];
  for (const { body } of responses) {
    try {
      if (!body) continue;
      const items = Array.isArray(body) ? body : body.schedules || body.offers || body.results || body.data || [];
      if (Array.isArray(items)) {
        items.forEach(item => {
          const price = item.price || item.totalPrice || item.amount || item.rate;
          const currency = item.currency || item.currencyCode || 'USD';
          // Extract departure date from various API field names
          const depDate = item.departureDate || item.departure_date || item.sailingDate ||
            item.etd || item.departureDateTime || item.departureDateLocal || null;
          // Normalize date to YYYY-MM-DD
          let normalizedDate = null;
          if (depDate) {
            try {
              const d = new Date(depDate);
              if (!isNaN(d.getTime())) normalizedDate = d.toISOString().split('T')[0];
            } catch { }
          }
          if (price && typeof price === 'number' && price > 50) {
            rates.push({
              price, currency: currency.toUpperCase(), transit_days: item.transitDays || item.transit_days || null,
              departure_date: normalizedDate,
              service_type: item.serviceType || item.service_type || 'Spot', extraction_method: 'API_INTERCEPT',
              ocean_freight: item.oceanFreight || item.ocean_freight || price,
              origin_thc: item.originThc || item.origin_thc || 0,
              destination_thc: item.destinationThc || item.destination_thc || 0,
              total_price: item.totalPrice || item.total_price || price,
            });
          }
        });
      }
    } catch { }
  }
  return rates;
}

// ══════════════════════════════════════════════════════════════════════════
// SIMULATED SCRAPER
// ══════════════════════════════════════════════════════════════════════════

function simulateScrape(params) {
  const jobId = params.job_id || uuidv4();
  const basePrices = {
    'SINGAPORE-TUTICORIN': { price: 680, transit: 7 }, 'SINGAPORE-CHENNAI': { price: 640, transit: 5 },
    'SHANGHAI-NHAVA SHEVA': { price: 880, transit: 16 }, 'SINGAPORE-JEBEL ALI': { price: 520, transit: 6 },
    'SHANGHAI-ISTANBUL': { price: 1450, transit: 25 }, 'SINGAPORE-MERSIN': { price: 1250, transit: 20 },
    'SHANGHAI-CHENNAI': { price: 780, transit: 14 }, 'SINGAPORE-NHAVA SHEVA': { price: 560, transit: 8 },
    'SHANGHAI-TUTICORIN': { price: 820, transit: 15 }, 'SINGAPORE-ISTANBUL': { price: 1350, transit: 22 },
    'SHANGHAI-MERSIN': { price: 1380, transit: 24 }, 'SINGAPORE-LAGOS': { price: 1680, transit: 28 },
    'SHANGHAI-LAGOS': { price: 1920, transit: 32 }, 'SHANGHAI-JEBEL ALI': { price: 720, transit: 12 },
  };
  const key = params.from_port.toUpperCase() + '-' + params.to_port.toUpperCase();
  const base = basePrices[key] || { price: 500 + Math.floor(Math.random() * 2000), transit: 7 + Math.floor(Math.random() * 30) };
  const price = Math.round(base.price * (0.9 + Math.random() * 0.2));
  const originThc = Math.round(80 + Math.random() * 60);
  const destThc = Math.round(40 + Math.random() * 50);
  const candidates = [{
    price, currency: 'USD', transit_days: base.transit, service_type: 'Maersk Spot - Direct',
    valid_until: validUntil(), confidence_score: Math.round((0.85 + Math.random() * 0.15) * 100) / 100,
    extraction_method: 'SIMULATED', snapshot_id: 'snap_sim_' + uuidv4().slice(0, 8),
    ocean_freight: price, origin_thc: originThc,
    destination_thc: destThc, total_price: price + originThc + destThc,
  }];
  return {
    job_id: jobId, status: 'SUCCESS', snapshot_id: candidates[0].snapshot_id,
    elapsed_ms: 1200 + Math.floor(Math.random() * 3000), candidates, simulated: true,
  };
}

module.exports = { scrapeMaerskSpotRate, simulateScrape, saveSnapshot, calculateConfidence: confidence };
