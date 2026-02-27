const path = require('path');
const { chromium } = require('playwright');
const { detectCaptcha, detectConsent, detectAccessDenied, isBookingVisible } = require('../../src/scraper/maersk');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const fixturesDir = path.join(__dirname, '..', 'fixtures');
  const fixtures = [
    { file: 'login.html', expectCaptcha: false, expectBooking: false },
    { file: 'booking.html', expectCaptcha: false, expectBooking: true },
    { file: 'captcha.html', expectCaptcha: true, expectBooking: false },
    { file: 'consent.html', expectCaptcha: false, expectBooking: false, expectConsent: true },
    { file: 'rate_limit.html', expectCaptcha: false, expectBooking: false },
    { file: 'error.html', expectCaptcha: false, expectBooking: false },
    // additional regression fixtures
    { file: 'consent_alt.html', expectCaptcha: false, expectBooking: false, expectConsent: true },
    { file: 'localized_booking.html', expectCaptcha: false, expectBooking: true },
    { file: 'blocked_ip.html', expectCaptcha: false, expectBooking: false, expectAccessDenied: true },
    { file: 'portal_login.html', expectCaptcha: false, expectBooking: false, expectConsent: true },
  ];

  let failures = 0;

  for (const f of fixtures) {
    const filePath = 'file://' + path.join(fixturesDir, f.file);
    console.log(`\n[TEST] Loading fixture: ${f.file}`);
    await page.goto(filePath, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);

    const isCaptcha = await detectCaptcha(page).catch(() => false);
    const isConsent = await detectConsent(page).catch(() => false);
    const isAccessDenied = await detectAccessDenied(page).catch(() => false);
    const isBooking = await isBookingVisible(page).catch(() => false);

    const bookingEffective = isConsent ? false : isBooking;

    console.log(`  detectCaptcha => ${isCaptcha} (expected ${f.expectCaptcha})`);
    console.log(`  detectConsent => ${isConsent} (expected ${f.expectConsent || false})`);
    console.log(`  detectAccessDenied => ${isAccessDenied} (expected ${f.expectAccessDenied || false})`);
    console.log(`  bookingVisible => ${bookingEffective} (expected ${f.expectBooking})`);

    if (isCaptcha !== f.expectCaptcha) {
      console.error(`  ✖ Captcha detection mismatch for ${f.file}`);
      failures++;
    }
    if ((f.expectConsent || false) !== isConsent) {
      console.error(`  ✖ Consent detection mismatch for ${f.file}`);
      failures++;
    }
    if ((f.expectAccessDenied || false) !== isAccessDenied) {
      console.error(`  ✖ AccessDenied detection mismatch for ${f.file}`);
      failures++;
    }
    if (bookingEffective !== f.expectBooking) {
      console.error(`  ✖ Booking detection mismatch for ${f.file}`);
      failures++;
    }
  }

  await browser.close();
  if (failures > 0) {
    console.error(`\nE2E tests failed (${failures} failures)`);
    process.exit(2);
  }

  console.log('\nE2E tests passed');
  process.exit(0);
})();
