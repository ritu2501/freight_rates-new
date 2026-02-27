/**
 * Maersk Spot Rate Scraper
 * 
 * Uses Playwright with a persistent Edge profile to scrape pricing data
 * from Maersk's booking portal.
 * 
 * Functions:
 *  - simulateScrape(params)       → Returns mock data for testing
 *  - scrapeMaerskSpotRate(params) → Live scraper using Playwright
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const { chromium } = require('playwright');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Configuration
const PROFILE_DIR = path.join(__dirname, '..', '..', '.maersk-profile');
const SNAPSHOT_DIR = path.join(__dirname, '..', '..', 'snapshots');
const BOOK_URL = 'https://www.maersk.com/book/';
const ENCRYPTION_KEY = process.env.SNAPSHOT_KEY || 'change-me-in-production-32chars!';
const DEFAULT_TIMEOUT = parseInt(process.env.SCRAPER_TIMEOUT_MS, 10) || 60000;

// Maersk Login Credentials (from .env or defaults)
const MAERSK_USERNAME = process.env.MAERSK_USERNAME || 'Eximsingpore';
const MAERSK_PASSWORD = process.env.MAERSK_PASSWORD || 'Qwerty@12345';

// Ensure directories exist
if (!fs.existsSync(PROFILE_DIR)) fs.mkdirSync(PROFILE_DIR, { recursive: true });
if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });

/**
 * Container type mapping (our format → Maersk format)
 */
const CONTAINER_MAP = {
  '20FT': '20\' Dry',
  '40FT': '40\' Dry',
  '40HC': '40\' High Cube Dry',
  '40HIGH': '40\' High Cube Dry', // Add common alias
  '45FT': '45\' High Cube Dry',
  'REEFER': '40\' Reefer High Cube',
  'OOG': '40\' Open Top',
};

/**
 * Simulate a scrape — returns mock data for development/testing
 */
function simulateScrape(params) {
  const {
    from_port, to_port, container_type = '40FT',
    ship_date, job_id,
  } = params;

  console.log(`[Scraper SIM] Job ${job_id} | ${from_port} → ${to_port} | ${container_type}`);

  // Simulate some delay
  const basePrice = 1500 + Math.floor(Math.random() * 2000);
  const transitDays = 10 + Math.floor(Math.random() * 25);
  const validUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const candidate = {
    price: basePrice,
    total_price: basePrice,
    ocean_freight: Math.round(basePrice * 0.75),
    origin_thc: Math.round(basePrice * 0.1),
    destination_thc: Math.round(basePrice * 0.1),
    origin_misc: Math.round(basePrice * 0.05),
    currency: 'USD',
    transit_days: transitDays,
    service_type: 'STANDARD',
    carrier: 'Maersk',
    valid_until: validUntil,
    confidence_score: 0.85,
    snapshot_id: null,
  };

  return {
    status: 'SUCCESS',
    source: 'SIMULATION',
    candidates: [candidate],
    snapshot_id: null,
  };
}

/**
 * Save encrypted HTML snapshot for compliance/debugging
 */
function saveSnapshot(html, jobId) {
  const snapshotId = `snap_${uuidv4()}`;
  const iv = crypto.randomBytes(16);
  const key = Buffer.from(ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32));
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  
  let encrypted = cipher.update(html, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const encPath = path.join(SNAPSHOT_DIR, `${snapshotId}.enc`);
  const metaPath = path.join(SNAPSHOT_DIR, `${snapshotId}.meta.json`);

  fs.writeFileSync(encPath, encrypted);
  fs.writeFileSync(metaPath, JSON.stringify({
    snapshot_id: snapshotId,
    job_id: jobId,
    checksum: crypto.createHash('sha256').update(html).digest('hex'),
    iv: iv.toString('hex'),
    created_at: new Date().toISOString(),
    size_bytes: html.length,
  }, null, 2));

  console.log(`[Scraper] Snapshot saved: ${snapshotId}`);
  return snapshotId;
}

/**
 * Fill a Maersk web component input field with proper event dispatching
 * This handles the mc-typeahead/mc-text-field components that use Shadow DOM
 */
async function fillMaerskInput(page, inputSelector, value, fieldName) {
  // Sanitize value for typing - strip parentheses if likely a port name
  const sanitizedValue = value.includes('(') ? value.split('(')[0].trim() : value;
  console.log(`[Scraper] Filling ${fieldName}: "${sanitizedValue}" (original: "${value}")`);
  
  // Try to find the input, even if it's inside a shadow DOM
  let input = page.locator(inputSelector).first();
  if (!(await input.isVisible().catch(() => false))) {
    // If not visible, it might be inside the mc-c-origin-destination component's shadow DOM
    // or just not matching the ID selector directly. Maersk sometimes uses mc-typeahead.
    const isOrigin = inputSelector.includes('origin');
    input = page.locator(`${isOrigin ? 'mc-typeahead[id*="origin"]' : 'mc-typeahead[id*="destination"]'} input, ${isOrigin ? '#mc-input-origin' : '#mc-input-destination'}`).first();
  }

  // Click to focus
  await input.click({ force: true });
  await page.waitForTimeout(800);
  
  // Clear existing value
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(500);
  
  // Type the value
  await page.keyboard.type(sanitizedValue, { delay: 150 });
  
  console.log(`[Scraper] Waiting for ${fieldName} autocomplete results...`);
  await page.waitForTimeout(3500);
  
  // Dispatch events
  await input.evaluate((el) => {
    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  });
  
  await page.waitForTimeout(1000);
}

/**
 * Select option from Maersk autocomplete dropdown
 */
async function selectDropdownOption(page, searchText, fieldName) {
  const sanitizedSearchText = searchText.includes('(') ? searchText.split('(')[0].trim() : searchText;
  console.log(`[Scraper] Selecting dropdown option for ${fieldName} (searching for "${sanitizedSearchText}")...`);
  
  // Wait for dropdown options to appear
  await page.waitForTimeout(2000);
  
  // Check if listbox is visible
  const listbox = page.locator('[role="listbox"]').first();
  const listboxVisible = await listbox.isVisible({ timeout: 5000 }).catch(() => false);
  console.log(`[Scraper] Listbox visible: ${listboxVisible}`);
  
  if (!listboxVisible) {
    console.log(`[Scraper] No listbox visible, pressing ArrowDown to trigger...`);
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(1500);
  }
  
  // Count available options
  const options = page.locator('[role="option"]');
  const optionCount = await options.count();
  console.log(`[Scraper] Found ${optionCount} options in dropdown`);
  
  if (optionCount === 0) {
    console.log(`[Scraper] Still no options found, trying fuzzy search...`);
    // Final attempt: wait longer
    await page.waitForTimeout(2000);
    if (await options.count() === 0) {
      console.log(`[Scraper] ERROR: No options ever appeared for ${fieldName}`);
      return false;
    }
  }
  
  // Try to find an option that matches the search text
  const searchTextLower = sanitizedSearchText.toLowerCase();
  const originTextLower = searchText.toLowerCase();
  
  // Get all options and their text
  const optionElements = await options.all();
  let bestMatch = null;

  for (const option of optionElements) {
    const text = (await option.textContent().catch(() => '')).trim();
    const textLower = text.toLowerCase();
    
    // Exact or close match
    if (textLower === searchTextLower || textLower === originTextLower || textLower.startsWith(searchTextLower)) {
      console.log(`[Scraper] Found matching option: "${text}"`);
      bestMatch = option;
      break;
    }

    // Contains sanitized or original
    if (textLower.includes(searchTextLower) || textLower.includes(originTextLower)) {
      if (!bestMatch) bestMatch = option;
    }
  }

  if (bestMatch) {
    await bestMatch.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await bestMatch.click({ force: true });
    await page.waitForTimeout(1500);
    return true;
  }
  
  // Fallback: click first option
  console.log(`[Scraper] No match found for "${sanitizedSearchText}", clicking first option as fallback`);
  const firstOption = options.first();
  const firstText = (await firstOption.textContent().catch(() => '')).trim();
  console.log(`[Scraper] Clicking first option: "${firstText}"`);
  await firstOption.click({ force: true });
  await page.waitForTimeout(1500);
  
  return true;
}

/**
 * Live scrape from Maersk booking portal
 */
async function scrapeMaerskSpotRate(params) {
  const {
    from_port, to_port, container_type = '40FT',
    number_of_containers = 1, weight_per_container,
    weight_unit = 'KG', ship_date, commodity,
    job_id,
  } = params;

  console.log(`[Scraper LIVE] Job ${job_id} | ${from_port} → ${to_port} | ${container_type}`);

  let context = null;
  let snapshotId = null;

  try {
    // Launch persistent browser context
    context = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: process.env.SCRAPER_HEADLESS !== 'false',
      channel: 'msedge',
      viewport: { width: 1920, height: 1080 },
      locale: 'en-US',
      timezoneId: 'Asia/Singapore',
      args: [
        '--no-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });

    const page = context.pages()[0] || await context.newPage();

    // Minimal stealth to hide automation
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true });
    });

    // Navigate to booking page with retry
    console.log('[Scraper] Navigating to Maersk booking page...');
    let navigated = false;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await page.goto(BOOK_URL, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT });
        navigated = true;
        break;
      } catch (e) {
        console.warn(`[Scraper] Navigation attempt ${attempt} failed: ${e.message}`);
        if (attempt === 1) await page.waitForTimeout(3000);
      }
    }
    
    if (!navigated) throw new Error('Failed to navigate to Maersk after 2 attempts');
    
    await page.waitForTimeout(8000); // Increased wait for heavy components

    // Dismiss cookie banner if present - handle multiple formats
    const cookieSelectors = [
      '.coi-banner__accept',
      '[data-test*="cookie-accept"]',
      '#accept-cookies',
      '.mds-cookie-banner__button--accept',
      'mc-button:has-text("Accept")',
      'mc-button:has-text("Close")'
    ];
    
    for (const selector of cookieSelectors) {
      const btn = page.locator(selector).first();
      if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
        await btn.click({ force: true });
        console.log(`[Scraper] Cookie/Overlay dismissed with: ${selector}`);
        await page.waitForTimeout(1000);
      }
    }

    // Check if we need to login
    let currentUrl = page.url();
    let bookingFormVisible = await page.locator('#mc-input-origin, mc-c-origin-destination, [data-test="mccOriginDestination"]').first().isVisible({ timeout: 15000 }).catch(() => false);
    
    // Check for "Access Denied" or Akamai challenge
    const pageTitle = await page.title().catch(() => '');
    const pageText = await page.evaluate(() => document.body.innerText.substring(0, 1000)).catch(() => '');
    
    if (pageTitle.includes('Access Denied') || pageText.includes('Access Denied') || pageText.includes('you don\'t have permission')) {
      const html = await page.content();
      snapshotId = saveSnapshot(html, job_id);
      await context.close();
      return {
        status: 'FAILED',
        error: 'Access Denied by Maersk (Bot detection). Try refreshing persistent session.',
        reason_code: 'ACCESS_DENIED',
        snapshot_id: snapshotId,
        candidates: [],
      };
    }

    if (currentUrl.includes('accounts.maersk.com') || !bookingFormVisible) {
      console.log('[Scraper] Login required or booking form not yet visible. Current URL: ' + currentUrl);
      
      // Additional check: maybe we are on a login page that isn't accounts.maersk.com (rare but possible)
      const isActuallyLoginPage = await page.evaluate(() => {
        return document.body.innerText.includes('Sign in to your account') || 
               document.body.innerText.includes('Welcome to Maersk') ||
               !!document.querySelector('input[type="password"]');
      });

      if (isActuallyLoginPage && !currentUrl.includes('accounts.maersk.com')) {
        console.log('[Scraper] Detected login elements on current page.');
      }

      // If we are on the homepage or a landing page, try to find a "Book" link
      if (!currentUrl.includes('book') && !currentUrl.includes('accounts') && !isActuallyLoginPage) {
        console.log('[Scraper] Not on booking page, trying to navigate to /book/ again...');
        await page.goto(BOOK_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(5000);
        currentUrl = page.url();
        bookingFormVisible = await page.locator('mc-c-origin-destination, [data-test="mccOriginDestination"]').first().isVisible({ timeout: 5000 }).catch(() => false);
      }

      // Check for a login/sign-in button that might need to be clicked

      // If we are on the booking page but the component isn't visible yet, wait a bit more
      if (currentUrl.includes('maersk.com/book') && !bookingFormVisible) {
        console.log('[Scraper] On booking page, waiting for O/D component to initialize...');
        await page.waitForTimeout(5000);
        const secondCheck = await page.locator('mc-c-origin-destination, [data-test="mccOriginDestination"]').first().isVisible({ timeout: 5000 }).catch(() => false);
        if (secondCheck) {
          console.log('[Scraper] O/D component finally visible.');
          // Continue to filling form
        } else {
           // still not visible, maybe login is actually required
           console.log('[Scraper] O/D component still not visible, assuming login required.');
        }
      }

      if (currentUrl.includes('accounts.maersk.com') || !(await page.locator('mc-c-origin-destination, [data-test="mccOriginDestination"]').first().isVisible().catch(() => false))) {
        console.log('[Scraper] Performing automatic login...');
        
        // Wait for login page to load
        await page.waitForTimeout(3000);
        
        // Dismiss any overlays
        await page.evaluate(() => {
          const overlay = document.getElementById('coiOverlay');
          if (overlay) overlay.remove();
          const wrapper = document.getElementById('cookie-information-template-wrapper');
          if (wrapper) wrapper.remove();
        }).catch(() => {});
        
        // Check if username input is visible - try multiple selectors
        const usernameSelectors = [
          '#mc-input-username',
          'input[name="username"]',
          'input[id*="username"]',
          'mc-input[id*="username"] input',
          '#username'
        ];
        
        let usernameInput = null;
        let usernameVisible = false;
        
        for (const selector of usernameSelectors) {
          const el = page.locator(selector).first();
          if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
            usernameInput = el;
            usernameVisible = true;
            console.log(`[Scraper] Found username input with selector: ${selector}`);
            break;
          }
        }
        
        if (usernameVisible) {
          console.log(`[Scraper] Filling login credentials (user: ${MAERSK_USERNAME})...`);
          
          // Fill username
          await usernameInput.click();
          await usernameInput.fill(MAERSK_USERNAME);
          await page.waitForTimeout(500);
          
          // Fill password
          const passwordInput = page.locator('input[name="password"]:visible, input[type="password"]:visible, #mc-input-password').first();
          if (await passwordInput.isVisible({ timeout: 5000 }).catch(() => false)) {
            await passwordInput.click();
            await passwordInput.fill(MAERSK_PASSWORD);
            await page.waitForTimeout(500);
          } else {
            throw new Error('Password input not found on login page');
          }
          
          // Click submit button
          console.log('[Scraper] Submitting login form...');
          const loginBtn = page.locator('button[type="submit"]').first();
          await loginBtn.click();
          
          // Wait for redirect to booking page
          console.log('[Scraper] Waiting for login redirect...');
          await page.waitForTimeout(10000);
          
          // Check if we reached the booking page
          let loginSuccess = false;
          for (let i = 0; i < 6; i++) { // Wait up to 30 seconds
            const currentUrl = page.url();
            console.log(`[Scraper] Login check ${i+1}/6 - URL: ${currentUrl.substring(0, 80)}`);
            
            if (currentUrl.includes('maersk.com/book') && !currentUrl.includes('accounts.maersk.com')) {
              const originVisible = await page.locator('#mc-input-origin, mc-c-origin-destination').first().isVisible({ timeout: 5000 }).catch(() => false);
              if (originVisible) {
                loginSuccess = true;
                console.log('[Scraper] Login successful! Booking form visible.');
                break;
              }
            }
            await page.waitForTimeout(5000);
          }
          
          if (!loginSuccess) {
            const html = await page.content();
            snapshotId = saveSnapshot(html, job_id);
            await context.close();
            return {
              status: 'FAILED',
              error: 'Login failed or timed out. Check credentials.',
              reason_code: 'LOGIN_FAILED',
              snapshot_id: snapshotId,
              candidates: [],
            };
          }
        } else {
          // Not on login page but also no booking form - unknown state
          const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500)).catch(() => 'No text');
          const currentUrl = page.url();
          const html = await page.content();
          snapshotId = saveSnapshot(html, job_id);
          await context.close();
          return {
            status: 'FAILED',
            error: `Unknown page state. URL: ${currentUrl}. Snippet: ${bodyText.replace(/\n/g, ' ')}`,
            reason_code: 'UNKNOWN_STATE',
            snapshot_id: snapshotId,
            candidates: [],
          };
        }
      }
    }

    console.log('[Scraper] Session valid. Filling booking form...');

    // Take screenshot before filling
    await page.screenshot({ path: path.join(SNAPSHOT_DIR, `debug_before_fill_${job_id}.png`) }).catch(() => {});

    // Fill Origin using keyboard simulation (triggers web component events properly)
    await fillMaerskInput(page, '#mc-input-origin', from_port, 'Origin');
    await selectDropdownOption(page, from_port, 'Origin');
    
    // Take screenshot after origin
    await page.screenshot({ path: path.join(SNAPSHOT_DIR, `debug_after_origin_${job_id}.png`) }).catch(() => {});
    
    // Verify origin was selected - check the displayed text
    const originValue = await page.inputValue('#mc-input-origin').catch(() => 
      page.$eval('#mc-input-origin', el => el.value).catch(() => '')
    );
    console.log(`[Scraper] Origin value after selection: "${originValue}"`);
    
    // Check if origin is properly selected (should contain the port name)
    if (!originValue || !originValue.toLowerCase().includes(from_port.toLowerCase().substring(0, 4))) {
      console.log(`[Scraper] WARNING: Origin may not be properly selected`);
    }
    
    await page.waitForTimeout(1000);

    // Fill Destination
    await fillMaerskInput(page, '#mc-input-destination', to_port, 'Destination');
    await selectDropdownOption(page, to_port, 'Destination');
    
    // Take screenshot after destination
    await page.screenshot({ path: path.join(SNAPSHOT_DIR, `debug_after_dest_${job_id}.png`) }).catch(() => {});
    
    // Verify destination was selected
    const destValue = await page.inputValue('#mc-input-destination').catch(() =>
      page.$eval('#mc-input-destination', el => el.value).catch(() => '')
    );
    console.log(`[Scraper] Destination value after selection: "${destValue}"`);
    
    // Check if destination is properly selected
    if (!destValue || !destValue.toLowerCase().includes(to_port.toLowerCase().substring(0, 4))) {
      console.log(`[Scraper] WARNING: Destination may not be properly selected`);
    }
    
    await page.waitForTimeout(1000);

    // Check if submit button is already enabled after O/D selection
    const submitBtnCheck = page.locator('[data-test="buttonSubmit"], mc-button[data-test="buttonSubmit"]').first();
    const isDisabledAfterOD = await submitBtnCheck.getAttribute('disabled');
    const isActuallyDisabledAfterOD = isDisabledAfterOD !== null && isDisabledAfterOD !== 'false';
    console.log(`[Scraper] Submit button disabled after O/D fill: ${isActuallyDisabledAfterOD}`);
    
    // Date selection - now treated as optional if form is already valid
    if (!ship_date && !isActuallyDisabledAfterOD) {
      console.log('[Scraper] Date is optional and form is already valid. Skipping date selection.');
    } else {
      console.log(`[Scraper] Handling departure date (requested: ${ship_date || 'default'})...`);
      
      let datePickerOpened = false;
      const datePickerSelectors = [
        'mc-date-picker',
        '[data-test="mds-date-picker"]',
        '[data-test="edDatePickerTest"]',
        '.mds-edd-date-picker',
        'input[name="earliestDepartureDatePicker"]',
      ];
      
      for (const selector of datePickerSelectors) {
        const picker = page.locator(selector).first();
        if (await picker.isVisible({ timeout: 1500 }).catch(() => false)) {
          console.log(`[Scraper] Opening date picker: ${selector}`);
          await picker.click({ force: true });
          datePickerOpened = true;
          await page.waitForTimeout(1500);
          break;
        }
      }
      
      if (datePickerOpened) {
        const calendar = page.locator('[role="dialog"], [role="grid"], .mds-calendar, .mc-calendar').first();
        if (await calendar.isVisible({ timeout: 3000 }).catch(() => false)) {
          let dateSelected = false;
          if (ship_date) {
            try {
              const dayToFind = new Date(ship_date).getDate().toString();
              const dayCell = calendar.locator(`[role="gridcell"]:not([aria-disabled="true"]):text-is("${dayToFind}"), button:not([disabled]):text-is("${dayToFind}")`).first();
              if (await dayCell.isVisible({ timeout: 1500 }).catch(() => false)) {
                await dayCell.click();
                console.log(`[Scraper] Selected requested day: ${dayToFind}`);
                dateSelected = true;
              }
            } catch (e) { /* ignore */ }
          }
          
          if (!dateSelected) {
            const firstAvailable = calendar.locator('[role="gridcell"]:not([aria-disabled="true"]), button:not([disabled])').first();
            if (await firstAvailable.isVisible({ timeout: 1500 }).catch(() => false)) {
              await firstAvailable.click();
              console.log('[Scraper] Selected first available date');
            }
          }
          await page.waitForTimeout(1000);
        }
      } else {
        // Fallback: "Select tomorrow" link
        const tomorrowLink = page.locator('a.select-tomorrow-link:not(.mds-link--disabled), text=Select tomorrow').first();
        if (await tomorrowLink.isVisible({ timeout: 1500 }).catch(() => false)) {
          console.log('[Scraper] Clicking "Select tomorrow" link...');
          await tomorrowLink.click({ force: true });
          await page.waitForTimeout(1500);
        }
      }
    }
    
    // Take screenshot after date handling
    await page.screenshot({ path: path.join(SNAPSHOT_DIR, `debug_after_date_${job_id}.png`) }).catch(() => {});
    
    // Verify current date value
    const dateInput = page.locator('input[name="earliestDepartureDatePicker"], [data-test="earliestDepartureDate"] input, mc-date-picker input').first();
    const finalDateStr = await dateInput.getAttribute('value').catch(() => 
      page.evaluate(() => {
        const input = document.querySelector('input[name="earliestDepartureDatePicker"]');
        return input ? input.value : 'not set';
      })
    );
    console.log(`[Scraper] Departure date status: ${finalDateStr}`);
    
    await page.waitForTimeout(1000);

    // Handle container type selection
    if (container_type && CONTAINER_MAP[container_type]) {
      console.log(`[Scraper] Setting container type: ${container_type}`);
      
      const containerSelectors = [
        '[data-test*="container"]',
        '[data-test*="equipment"]',
        'select[name*="container"]',
        'mc-select[data-test*="container"]',
        '.mc-select',
      ];
      
      for (const selector of containerSelectors) {
        const containerSelect = page.locator(selector).first();
        if (await containerSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
          try {
            await containerSelect.click();
            await page.waitForTimeout(800);
            
            const optionLabel = CONTAINER_MAP[container_type];
            const option = page.locator(`[role="option"]:has-text("${optionLabel}"), option:has-text("${optionLabel}"), .mc-select__option:has-text("${optionLabel}")`).first();
            
            if (await option.isVisible({ timeout: 2000 }).catch(() => false)) {
              await option.click();
              console.log(`[Scraper] Selected container type: ${optionLabel}`);
              await page.waitForTimeout(1000);
              break;
            } else {
              // Try selectOption for native select
              await containerSelect.selectOption({ label: optionLabel }).catch(() => {});
            }
          } catch (e) {
            console.log(`[Scraper] Container selection error: ${e.message}`);
          }
        }
      }
    }

    // Final checks before submission
    await page.waitForTimeout(2000); // Wait for form to settle

    // Try to catch "Something went wrong" banner if it already appeared
    const errorMsgOnForm = await page.locator('.mc-banner--error, .mc-c-error-message, [data-test*="error"]').first().textContent().catch(() => null);
    if (errorMsgOnForm && errorMsgOnForm.trim().length > 0) {
      console.log(`[Scraper] WARNING: Website already showing error: "${errorMsgOnForm.trim()}"`);
    }

    // Take screenshot before submit
    await page.screenshot({ path: path.join(SNAPSHOT_DIR, `debug_before_submit_${job_id}.png`) }).catch(() => {});

    // Check form state
    const formState = await page.evaluate(() => {
      const origin = document.querySelector('#mc-input-origin');
      const dest = document.querySelector('#mc-input-destination');
      return {
        originValue: origin ? origin.value : 'NOT_FOUND',
        destValue: dest ? dest.value : 'NOT_FOUND',
        originFilled: origin && origin.value.length > 0,
        destFilled: dest && dest.value.length > 0,
      };
    });
    console.log('[Scraper] Form state:', JSON.stringify(formState));

    // Submit the form
    console.log('[Scraper] Submitting booking search...');
    
    const submitSelectors = [
      '[data-test="buttonSubmit"]',
      'mc-button[data-test="buttonSubmit"]',
      'button[type="submit"]',
      'button:has-text("Search")',
      'mc-button:has-text("Search")',
    ];
    
    let submitBtn = null;
    for (const selector of submitSelectors) {
      const btn = page.locator(selector).first();
      if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
        submitBtn = btn;
        console.log(`[Scraper] Found submit button with selector: ${selector}`);
        break;
      }
    }
    
    if (!submitBtn) {
      const html = await page.content();
      snapshotId = saveSnapshot(html, job_id);
      await context.close();
      return {
        status: 'FAILED',
        error: 'Submit button not found on page',
        reason_code: 'FORM_ERROR',
        snapshot_id: snapshotId,
        candidates: [],
      };
    }

    // Check if button is enabled
    // Note: mc-button might use an 'is-disabled' attribute or similar instead of native 'disabled'
    const isDisabled = await submitBtn.getAttribute('disabled');
    const isActuallyDisabled = isDisabled !== null && isDisabled !== 'false';
    
    if (isActuallyDisabled) {
      console.log('[Scraper] Submit button is DISABLED - form may be incomplete. Attempting to wait...');
      await page.waitForTimeout(3000);
      if (await submitBtn.getAttribute('disabled') !== null) {
        const html = await page.content();
        snapshotId = saveSnapshot(html, job_id);
        await context.close();
        return {
          status: 'FAILED',
          error: 'Submit button is disabled. Check if O/D and Date are properly selected.',
          reason_code: 'FORM_INCOMPLETE',
          snapshot_id: snapshotId,
          candidates: [],
        };
      }
    }

    await submitBtn.click({ force: true });

    // Wait for results page or error
    console.log('[Scraper] Waiting for results or error banner...');
    
    // Set a race between price results and error messages
    const waitResult = await Promise.race([
      // Price card appears
      page.locator('[data-test*="price"], .price, [class*="price"], [class*="rate"], .mc-card').first()
        .waitFor({ state: 'visible', timeout: 35000 }).then(() => 'SUCCESS'),
        
      // Error banner appears
      page.locator('.mc-banner--error, .mc-c-error-message, [data-test*="error"], :text("Something went wrong")').first()
        .waitFor({ state: 'visible', timeout: 35000 }).then(() => 'ERROR'),
        
      // No routes message
      page.locator(':text("no results"), :text("No routes"), :text("not available")').first()
        .waitFor({ state: 'visible', timeout: 35000 }).then(() => 'NO_RESULTS'),
    ]).catch(() => 'TIMEOUT');

    console.log(`[Scraper] Navigation/Wait outcome: ${waitResult}`);

    // Save snapshot
    const html = await page.content();
    snapshotId = saveSnapshot(html, job_id);

    if (waitResult !== 'SUCCESS') {
      // Check for specific error messages
      const errorMsg = await page.locator('.mc-banner--error, .mc-c-error-message, [data-test*="error"]').first().textContent().catch(() => null);
      const isSomethingWentWrong = html.includes('Something went wrong') || (errorMsg && errorMsg.includes('Something went wrong'));
      
      await context.close();

      if (waitResult === 'NO_RESULTS' || html.includes('No routes available')) {
        return {
          status: 'FAILED',
          error: 'No routes available for this origin-destination pair.',
          reason_code: 'NO_ROUTES',
          snapshot_id: snapshotId,
          candidates: [],
        };
      }

      const finalError = errorMsg ? errorMsg.trim() : (isSomethingWentWrong ? 'Website reported: Something went wrong.' : 'Failed to load pricing results within timeout.');
      
      return {
        status: 'FAILED',
        error: finalError,
        reason_code: isSomethingWentWrong ? 'WEBSITE_ERROR' : 'TIMEOUT',
        snapshot_id: snapshotId,
        candidates: [],
      };
    }

    // Extract pricing data from the page
    console.log('[Scraper] Extracting pricing data...');
    const candidates = await extractPricingCandidates(page, snapshotId);

    await context.close();

    if (candidates.length === 0) {
      return {
        status: 'FAILED',
        error: 'Could not extract pricing data from results page.',
        reason_code: 'PARSE_ERROR',
        snapshot_id: snapshotId,
        candidates: [],
      };
    }

    console.log(`[Scraper] Found ${candidates.length} pricing candidate(s)`);
    return {
      status: 'SUCCESS',
      source: 'MAERSK_LIVE',
      snapshot_id: snapshotId,
      candidates,
    };

  } catch (err) {
    console.error('[Scraper] Error:', err.message);
    
    if (context) {
      try {
        const page = context.pages()[0];
        if (page) {
          const html = await page.content().catch(() => '');
          if (html) {
            snapshotId = saveSnapshot(html, job_id);
          }
        }
        await context.close();
      } catch { /* ignore */ }
    }

    return {
      status: 'FAILED',
      error: err.message,
      reason_code: 'SCRAPER_ERROR',
      snapshot_id: snapshotId,
      candidates: [],
    };
  }
}

/**
 * Extract pricing candidates from the results page
 */
async function extractPricingCandidates(page, snapshotId) {
  const candidates = [];

  try {
    // Try multiple selector strategies to find price cards
    const priceCards = await page.locator('[data-test*="card"], .mc-card, [class*="quote"], [class*="result"]').all();

    if (priceCards.length === 0) {
      // Fallback: try to extract from page text
      const pageText = await page.evaluate(() => document.body.innerText);
      const priceMatch = pageText.match(/USD\s*([\d,]+)/i) || pageText.match(/([\d,]+)\s*USD/i);
      const transitMatch = pageText.match(/(\d+)\s*days?/i);

      if (priceMatch) {
        candidates.push({
          price: parseFloat(priceMatch[1].replace(/,/g, '')),
          total_price: parseFloat(priceMatch[1].replace(/,/g, '')),
          currency: 'USD',
          transit_days: transitMatch ? parseInt(transitMatch[1], 10) : null,
          service_type: 'STANDARD',
          carrier: 'Maersk',
          valid_until: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          confidence_score: 0.6, // Lower confidence for text extraction
          snapshot_id: snapshotId,
        });
      }
    } else {
      // Extract from each price card
      for (const card of priceCards.slice(0, 5)) { // Limit to top 5 results
        try {
          const cardText = await card.textContent();
          
          // Extract price
          const priceMatch = cardText.match(/USD\s*([\d,]+)/i) || cardText.match(/([\d,]+)\s*USD/i);
          if (!priceMatch) continue;

          const price = parseFloat(priceMatch[1].replace(/,/g, ''));
          if (isNaN(price) || price <= 0) continue;

          // Extract transit days
          const transitMatch = cardText.match(/(\d+)\s*days?/i);
          const transitDays = transitMatch ? parseInt(transitMatch[1], 10) : null;

          // Extract service type
          let serviceType = 'STANDARD';
          if (cardText.toLowerCase().includes('express')) serviceType = 'EXPRESS';
          else if (cardText.toLowerCase().includes('economy')) serviceType = 'ECONOMY';

          // Try to extract component prices
          const oceanMatch = cardText.match(/ocean[^\d]*([\d,]+)/i);
          const thcMatch = cardText.match(/thc[^\d]*([\d,]+)/i);

          candidates.push({
            price: price,
            total_price: price,
            ocean_freight: oceanMatch ? parseFloat(oceanMatch[1].replace(/,/g, '')) : null,
            origin_thc: thcMatch ? parseFloat(thcMatch[1].replace(/,/g, '')) / 2 : null,
            destination_thc: thcMatch ? parseFloat(thcMatch[1].replace(/,/g, '')) / 2 : null,
            currency: 'USD',
            transit_days: transitDays,
            service_type: serviceType,
            carrier: 'Maersk',
            valid_until: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            confidence_score: 0.75,
            snapshot_id: snapshotId,
          });
        } catch (cardErr) {
          console.warn('[Scraper] Failed to parse price card:', cardErr.message);
        }
      }
    }
  } catch (err) {
    console.error('[Scraper] Extract error:', err.message);
  }

  // Sort by price ascending
  candidates.sort((a, b) => a.price - b.price);

  return candidates;
}

module.exports = {
  simulateScrape,
  scrapeMaerskSpotRate,
};
