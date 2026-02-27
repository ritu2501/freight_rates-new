const { scrapeMaerskSpotRate } = require('../src/scraper/maersk');
const { v4: uuidv4 } = require('uuid');

(async () => {
  const jobId = `manual-${uuidv4()}`;

  // Example route — change as needed
  const params = {
    from_port: process.env.TEST_FROM_PORT || 'SGSIN',
    to_port: process.env.TEST_TO_PORT || 'NLRTM',
    container_type: process.env.TEST_CONTAINER || '40FT',
    number_of_containers: parseInt(process.env.TEST_NUM || '1', 10),
    weight_per_container: process.env.TEST_WEIGHT ? parseFloat(process.env.TEST_WEIGHT) : null,
    weight_unit: process.env.TEST_WEIGHT_UNIT || 'KG',
    job_id: jobId,
  };

  console.log('[run_live_scrape] Starting live scrape with params:', params);

  try {
    const result = await scrapeMaerskSpotRate(params);
    console.log('[run_live_scrape] Result:', JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('[run_live_scrape] Error:', err);
    process.exit(1);
  }
})();
