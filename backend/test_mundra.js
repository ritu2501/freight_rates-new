
require('dotenv').config();
const { scrapeMaerskSpotRate } = require('./src/scraper/maersk');

(async () => {
    try {
        const result = await scrapeMaerskSpotRate({
            from_port: 'Singapore',
            to_port: 'MUNDRA (GUJARAT)', // Testing with 'Mundra' first
            container_type: '40FT',
            number_of_containers: 1,
            weight_per_container: 2000,
            weight_unit: 'KG',
            ship_date: new Date(Date.now() + 10 * 86400000).toISOString().split('T')[0],
            commodity: 'General',
        });
        console.log('\n=== RESULT ===');
        console.log(JSON.stringify(result, null, 2));
    } catch (e) {
        console.error('FATAL:', e.message);
    }
})();
