require('dotenv').config();
const { scrapeMaerskSpotRate } = require('./src/scraper/maersk');

(async () => {
  try {
    const result = await scrapeMaerskSpotRate({
      from_port: 'Singapore',
      to_port: 'MUNDRA (GUJARAT)',
      container_type: '40 DRY HIGH',
      number_of_containers: 1,
      weight_per_container: 25000,
      weight_unit: 'KG',
      commodity: 'Wastepaper',
    });
    console.log('\n=== RESULT ===');
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error('FATAL:', e.message);
  }
})();
