const crypto = require('crypto');
const fs = require('fs');

// Get latest snapshot
const snapDir = './snapshots';
const metas = fs.readdirSync(snapDir).filter(f => f.endsWith('.meta.json')).sort().reverse();
const meta = JSON.parse(fs.readFileSync(snapDir + '/' + metas[0]));
console.log('Snapshot:', meta.snapshot_id);

const enc = fs.readFileSync(snapDir + '/' + meta.snapshot_id + '.enc', 'utf8');
const key = Buffer.from('change-me-in-production-32chars!'.padEnd(32, '0').slice(0,32));
const iv = Buffer.from(meta.iv, 'hex');
const d = crypto.createDecipheriv('aes-256-cbc', key, iv);
let html = d.update(enc, 'hex', 'utf8') + d.final('utf8');

console.log('\n=== Looking for departure/date elements ===');

// Find all elements with "departure" or "date" in data-test
const dateTests = html.match(/data-test="[^"]*(?:date|departure)[^"]*"/gi) || [];
console.log('Date-related data-test attributes:', dateTests.slice(0, 10));

// Find mc-date-picker or similar
console.log('\n=== mc-date-picker elements ===');
const datePickers = html.match(/<mc-date-picker[^>]*>/gi) || [];
datePickers.forEach(dp => console.log(dp.substring(0, 200)));

// Find mc-c-departure or similar
console.log('\n=== mc-c-departure elements ===');
const departures = html.match(/<mc-c-departure[^>]*>/gi) || [];
departures.forEach(dp => console.log(dp.substring(0, 300)));

// Find calendar elements
console.log('\n=== Calendar-related elements ===');
const calendars = html.match(/<[^>]*calendar[^>]*>/gi) || [];
calendars.slice(0, 5).forEach(c => console.log(c.substring(0, 150)));

// Look for the date input area
console.log('\n=== Date input elements ===');
const dateInputs = html.match(/<input[^>]*(?:date|departure)[^>]*>/gi) || [];
dateInputs.forEach(d => console.log(d.substring(0, 200)));

// Check for disabled submit button reason
console.log('\n=== Form validation - what is making submit disabled? ===');
// Look for required fields that are empty
const emptyRequired = html.match(/required[^>]*value=""/gi) || [];
console.log('Empty required fields:', emptyRequired.length);

// Check if "Select tomorrow" link state
console.log('\n=== Select tomorrow link ===');
const tomorrowLinks = html.match(/<a[^>]*select-tomorrow[^>]*>[^<]*<\/a>/gi) || [];
tomorrowLinks.forEach(l => console.log(l));

// Check for mc-c-date or departure-date component
console.log('\n=== mc-c components related to date ===');
const mcDateComponents = html.match(/<mc-c-[^>]*(?:date|departure)[^>]*>/gi) || [];
mcDateComponents.forEach(c => console.log(c.substring(0, 300)));

// Check what's inside the departure section
console.log('\n=== Content around departure section ===');
const depIndex = html.indexOf('departureDateSection');
if (depIndex > -1) {
  console.log(html.substring(depIndex - 50, depIndex + 500));
}

// Check for date-related CSS classes
console.log('\n=== Date-related classes ===');
const dateClasses = html.match(/class="[^"]*(?:date|calendar|departure)[^"]*"/gi) || [];
console.log('Date-related class mentions:', dateClasses.slice(0, 10));
