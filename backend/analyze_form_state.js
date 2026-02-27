const crypto = require('crypto');
const fs = require('fs');

// Get latest snapshot
const snapDir = './snapshots';
const metas = fs.readdirSync(snapDir).filter(f => f.endsWith('.meta.json')).sort().reverse();
const meta = JSON.parse(fs.readFileSync(snapDir + '/' + metas[0]));
console.log('Snapshot:', meta.snapshot_id);
console.log('Created:', meta.created_at);

const enc = fs.readFileSync(snapDir + '/' + meta.snapshot_id + '.enc', 'utf8');
const key = Buffer.from('change-me-in-production-32chars!'.padEnd(32, '0').slice(0,32));
const iv = Buffer.from(meta.iv, 'hex');
const d = crypto.createDecipheriv('aes-256-cbc', key, iv);
let html = d.update(enc, 'hex', 'utf8') + d.final('utf8');

// Check form state
console.log('\n=== Submit Button State ===');
const btnMatch = html.match(/<mc-button[^>]*data-test="buttonSubmit"[^>]*>/gi);
if (btnMatch) console.log(btnMatch[0].substring(0, 300));

console.log('\n=== Origin Input State ===');
const originMatch = html.match(/<input[^>]*id="mc-input-origin"[^>]*>/gi);
if (originMatch) console.log(originMatch[0]);
else console.log('Origin input not found in expected format');

console.log('\n=== Destination Input State ===');
const destMatch = html.match(/<input[^>]*id="mc-input-destination"[^>]*>/gi);
if (destMatch) console.log(destMatch[0]);
else console.log('Destination input not found in expected format');

console.log('\n=== What values are selected? ===');
// Check if Singapore is in the page
if (html.includes('Singapore, Singapore')) console.log('✓ Singapore, Singapore is in the page');
if (html.includes('Mundra (GUJARAT)')) console.log('✓ Mundra (GUJARAT) is in the page');
if (html.includes('INMUN')) console.log('✓ INMUN (Mundra(GUJARAT) code) is in the page');

// Check for origin-destination web component
console.log('\n=== mc-c-origin-destination state ===');
const odMatch = html.match(/<mc-c-origin-destination[^>]*>/gi);
if (odMatch) console.log(odMatch[0].substring(0, 500));

// Find all mc-typeahead elements
console.log('\n=== mc-typeahead elements ===');
const typeaheads = html.match(/<mc-typeahead[^>]*>/gi) || [];
typeaheads.forEach((t, i) => {
  console.log('#' + (i+1) + ':', t.substring(0, 200));
});

// Check for date selection
console.log('\n=== Date/Departure elements ===');
const departures = html.match(/earliest.*?departure|departure.*?date/gi) || [];
console.log('Departure mentions:', departures.slice(0, 3));

// Check what makes the submit disabled
console.log('\n=== Form validation state ===');
// Look for required field indicators
const requiredCount = (html.match(/required/gi) || []).length;
console.log('Required mentions:', requiredCount);

// Look for enabled/disabled states on key elements
if (html.includes('disabled=""') || html.includes('disabled="disabled"')) {
  console.log('Found disabled elements in form');
}

// Check for earliest date element
console.log('\n=== Earliest Departure Date ===');
const dateEl = html.match(/data-test="earliestDepartureDate"[^>]*>/gi);
if (dateEl) console.log(dateEl[0]);

// Look for any error messages
console.log('\n=== Possible error messages ===');
const errors = html.match(/class="[^"]*error[^"]*"[^>]*>[^<]+/gi) || [];
errors.slice(0, 5).forEach(e => console.log(e.substring(0, 100)));
