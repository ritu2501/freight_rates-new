const crypto = require('crypto');
const fs = require('fs');

// Latest snapshot
const enc = fs.readFileSync('./snapshots/snap_f4ce4d2d-7421-4fcd-80fe-f79c72e698ea.enc', 'utf8');
const key = Buffer.from('change-me-in-production-32chars!'.padEnd(32, '0').slice(0, 32));
const iv = Buffer.from('c3a50381909a9b6ef9f1206fc564204a', 'hex');
const d = crypto.createDecipheriv('aes-256-cbc', key, iv);
let html = d.update(enc, 'hex', 'utf8') + d.final('utf8');

console.log('=== HTML size:', html.length, 'bytes ===\n');

// 1. Find ALL input elements (including in outer HTML)
const inputs = html.match(/<input[^>]*>/gi) || [];
console.log('=== ALL <input> elements (' + inputs.length + ') ===');
inputs.forEach((inp, i) => {
  const id = inp.match(/id="([^"]+)"/);
  const role = inp.match(/role="([^"]+)"/);
  const type = inp.match(/type="([^"]+)"/);
  const placeholder = inp.match(/placeholder="([^"]+)"/);
  const name = inp.match(/name="([^"]+)"/);
  const value = inp.match(/value="([^"]+)"/);
  console.log('  #' + (i+1) + ': id=' + (id?id[1]:'none') + ' role=' + (role?role[1]:'none') + 
    ' type=' + (type?type[1]:'none') + ' placeholder=' + (placeholder?placeholder[1]:'none') + 
    ' name=' + (name?name[1]:'none') + ' value=' + (value?value[1]:'none'));
});

// 2. Find mc-c-origin-destination component
console.log('\n=== mc-c-origin-destination component ===');
const odMatch = html.match(/<mc-c-origin-destination[^>]*>/gi);
if (odMatch) {
  odMatch.forEach(m => console.log(m.substring(0, 500)));
} else {
  console.log('NOT FOUND');
}

// 3. Find the booking form button
console.log('\n=== Submit/Continue button ===');
const buttons = html.match(/<mc-button[^>]*>/gi) || [];
buttons.forEach(btn => {
  if (btn.includes('submit') || btn.includes('Submit') || btn.includes('Continue') || btn.includes('continue') || btn.includes('buttonSubmit')) {
    console.log(btn.substring(0, 300));
  }
});

// 4. Look for date-related elements
console.log('\n=== Date elements ===');
const dateEls = html.match(/<[^>]*(date|departure|earliest)[^>]*>/gi) || [];
dateEls.slice(0, 10).forEach(el => {
  console.log(el.substring(0, 200));
});

// 5. Look at the URL in the HTML
const urlMatch = html.match(/<link[^>]*canonical[^>]*>/i);
console.log('\n=== Page URL hints ===');
if (urlMatch) console.log(urlMatch[0]);

// 6. Check for "Continue to book" or similar button text
console.log('\n=== Button text search ===');
const btnTexts = html.match(/Continue to book|Search|Find rates|Get quote|Submit/gi) || [];
console.log('Found button texts:', btnTexts);

// 7. Check for any select-tomorrow link
console.log('\n=== Select tomorrow link ===');
const tmLink = html.match(/<a[^>]*select-tomorrow[^>]*>[^<]*<\/a>/gi) || [];
tmLink.forEach(l => console.log(l));

// 8. Check for listbox and option elements
console.log('\n=== Listbox/Option elements ===');
const listboxes = (html.match(/role="listbox"/gi) || []).length;
const options = (html.match(/role="option"/gi) || []).length;
console.log('Listboxes:', listboxes, 'Options:', options);

// 9. Check if the form shows "required" for date
console.log('\n=== Required fields ===');
const required = html.match(/<[^>]*required[^>]*>/gi) || [];
required.slice(0, 5).forEach(r => console.log(r.substring(0, 200)));

// 10. Look for the disabled state on the submit button specifically
console.log('\n=== Submit button disabled state ===');
const submitBtns = html.match(/<mc-button[^>]*buttonSubmit[^>]*>/gi) || [];
submitBtns.forEach(btn => {
  console.log('disabled=' + (btn.includes('disabled') ? 'YES' : 'NO'));
  console.log(btn.substring(0, 400));
});

// 11. Check for any origin/destination values already filled
console.log('\n=== Values in origin/dest inputs ===');
const originInput = html.match(/<input[^>]*mc-input-origin[^>]*>/gi) || [];
const destInput = html.match(/<input[^>]*mc-input-destination[^>]*>/gi) || [];
if (originInput.length) console.log('Origin:', originInput[0].substring(0, 300));
if (destInput.length) console.log('Destination:', destInput[0].substring(0, 300));

// 12. Check for any iframes
console.log('\n=== Iframes ===');
const iframes = (html.match(/<iframe/gi) || []).length;
console.log('Iframe count:', iframes);

// 13. Check mc-card elements and their data-test attributes
console.log('\n=== mc-card elements ===');
const mcCards = html.match(/<mc-card[^>]*>/gi) || [];
console.log('Total mc-card elements:', mcCards.length);
mcCards.forEach((card, i) => {
  const dt = card.match(/data-test="([^"]+)"/);
  console.log('  #' + (i+1) + ': ' + (dt ? 'data-test=' + dt[1] : 'no-data-test') + ' | ' + card.substring(0, 150));
});
