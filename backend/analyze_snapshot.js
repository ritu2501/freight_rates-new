const crypto = require('crypto');
const fs = require('fs');

const enc = fs.readFileSync('./snapshots/snap_97aa07dd-e3cb-4a04-95a6-283e4f5f4c16.enc', 'utf8');
const key = Buffer.from('change-me-in-production-32chars!');
const iv = Buffer.from('e95ceb5b4539a76a0025dd9e6a46f103', 'hex');
const d = crypto.createDecipheriv('aes-256-cbc', key, iv);
let html = d.update(enc, 'hex', 'utf8') + d.final('utf8');

// Find the mdsOriginDestinationComponent and mccOriginDestination elements
const odIdx = html.indexOf('mdsOriginDestinationComponent');
console.log('mdsOriginDestinationComponent at:', odIdx);
if (odIdx > -1) {
  console.log('Context:', html.substring(odIdx - 100, odIdx + 500));
}

console.log('\n---');
const odIdx2 = html.indexOf('mccOriginDestination');
console.log('mccOriginDestination at:', odIdx2);
if (odIdx2 > -1) {
  console.log('Context:', html.substring(odIdx2 - 100, odIdx2 + 800));
}

// Find all mc- custom elements
const customElements = html.match(/<mc-[a-z-]+[^>]*>/gi);
const uniqueCustom = {};
if (customElements) {
  customElements.forEach(el => {
    const tag = el.match(/<(mc-[a-z-]+)/i);
    if (tag) uniqueCustom[tag[1]] = (uniqueCustom[tag[1]] || 0) + 1;
  });
}
console.log('\n=== Custom mc- elements on page ===');
Object.entries(uniqueCustom).sort((a, b) => b[1] - a[1]).forEach(([tag, count]) => {
  console.log('  ' + tag + ': ' + count);
});

// Find mc-c-origin or similar  
console.log('\n=== Looking for origin/destination web components ===');
const odComponents = html.match(/<mc-c-[a-z-]*(origin|dest|location|from|to)[^>]*>/gi);
console.log('O/D components:', odComponents ? odComponents.map(c => c.substring(0, 100)) : 'NONE');

// Look for mc-input element (not HTML input, but web component)
const mcInputElements = html.match(/<mc-input[^>]*>/gi);
console.log('\nmc-input web components:', mcInputElements ? mcInputElements.length : 0);
if (mcInputElements) {
  mcInputElements.forEach((el, i) => {
    console.log('  #' + (i+1) + ':', el.substring(0, 200));
  });
}
