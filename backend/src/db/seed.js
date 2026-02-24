/**
 * Seed script — populates the DB with sample ports, pricing, and lane data
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const { initDbAsync, getDb } = require('./database');

async function main() {
  await initDbAsync();
  const db = getDb();

  // ── Port aliases ──
  const ports = [
    { alias: 'TUTICORIN (TAMIL NADU),', un_locode: 'INTUT', country: 'India' },
    { alias: 'CHENNAI', un_locode: 'INMAA', country: 'India' },
    { alias: 'NHAVA SHEVA', un_locode: 'INNSA', country: 'India' },
    { alias: 'MUNDRA (GUJARAT),', un_locode: 'INMUN', country: 'India' },
    { alias: 'KOLKATA', un_locode: 'INCCU', country: 'India' },
    { alias: 'COCHIN', un_locode: 'INCOK', country: 'India' },
    { alias: 'VISAKHAPATNAM', un_locode: 'INVTZ', country: 'India' },
    { alias: 'ISTANBUL', un_locode: 'TRIST', country: 'Turkey' },
    { alias: 'MERSIN', un_locode: 'TRMER', country: 'Turkey' },
    { alias: 'IZMIR', un_locode: 'TRIZM', country: 'Turkey' },
    { alias: 'GEMLIK', un_locode: 'TRGEM', country: 'Turkey' },
    { alias: 'LAGOS', un_locode: 'NGLOS', country: 'Nigeria' },
    { alias: 'APAPA', un_locode: 'NGAPP', country: 'Nigeria' },
    { alias: 'TINCAN', un_locode: 'NGTIN', country: 'Nigeria' },
    { alias: 'SINGAPORE', un_locode: 'SGSIN', country: 'Singapore' },
    { alias: 'SHANGHAI', un_locode: 'CNSHA', country: 'China' },
    { alias: 'NINGBO', un_locode: 'CNNGB', country: 'China' },
    { alias: 'BUSAN', un_locode: 'KRPUS', country: 'South Korea' },
    { alias: 'JEBEL ALI', un_locode: 'AEJEA', country: 'UAE' },
    { alias: 'ROTTERDAM', un_locode: 'NLRTM', country: 'Netherlands' },
  ];

  const insertPort = db.prepare(
    `INSERT OR IGNORE INTO port_aliases (alias, un_locode, country) VALUES (?, ?, ?)`
  );
  for (const p of ports) {
    try { insertPort.run(p.alias, p.un_locode, p.country); } catch(e) { /* ignore dups */ }
  }
  console.log(`Seeded ${ports.length} port aliases.`);

  // ── Pricing rows ──
  const pricingRows = [
    {
      from_port: 'SINGAPORE', to_port: 'TUTICORIN', destination_country: 'India',
      container_type: '40FT', incoterm: 'EXW', month_label: 'Mar, 2026',
      origin_local_haulage: 11.0, origin_thc: null, customs: 34.0, origin_misc: 32.0,
      ocean_freight: 650, destination_thc: 45, destination_haulage: null, destination_misc: null,
      total_price: 772, currency: 'USD', transit_days: 7, service_type: 'Direct',
      source: 'DB', confidence_score: 1.0, valid_until: '2026-03-31T23:59:59Z',
    },
    {
      from_port: 'SINGAPORE', to_port: 'CHENNAI', destination_country: 'India',
      container_type: '40FT', incoterm: 'EXW', month_label: 'Mar, 2026',
      origin_local_haulage: 11.0, origin_thc: null, customs: 34.0, origin_misc: 32.0,
      ocean_freight: 620, destination_thc: 42, destination_haulage: null, destination_misc: null,
      total_price: 739, currency: 'USD', transit_days: 5, service_type: 'Direct',
      source: 'DB', confidence_score: 1.0, valid_until: '2026-03-31T23:59:59Z',
    },
    {
      from_port: 'SHANGHAI', to_port: 'NHAVA SHEVA', destination_country: 'India',
      container_type: '40FT', incoterm: 'FOB', month_label: 'Mar, 2026',
      origin_local_haulage: 15.0, origin_thc: 120, customs: 50.0, origin_misc: 25.0,
      ocean_freight: 850, destination_thc: 60, destination_haulage: 80, destination_misc: 30,
      total_price: 1230, currency: 'USD', transit_days: 16, service_type: 'Direct',
      source: 'DB', confidence_score: 1.0, valid_until: '2026-03-31T23:59:59Z',
    },
    {
      from_port: 'SHANGHAI', to_port: 'ISTANBUL', destination_country: 'Turkey',
      container_type: '40FT', incoterm: 'FOB', month_label: 'Mar, 2026',
      origin_local_haulage: 15.0, origin_thc: 120, customs: 55.0, origin_misc: 20.0,
      ocean_freight: 1400, destination_thc: 80, destination_haulage: 100, destination_misc: 35,
      total_price: 1825, currency: 'USD', transit_days: 25, service_type: 'Direct',
      source: 'DB', confidence_score: 1.0, valid_until: '2026-03-31T23:59:59Z',
    },
    {
      from_port: 'SINGAPORE', to_port: 'MERSIN', destination_country: 'Turkey',
      container_type: '40FT', incoterm: 'EXW', month_label: 'Mar, 2026',
      origin_local_haulage: 11.0, origin_thc: null, customs: 34.0, origin_misc: 32.0,
      ocean_freight: 1200, destination_thc: 70, destination_haulage: null, destination_misc: null,
      total_price: 1347, currency: 'USD', transit_days: 20, service_type: 'Direct',
      source: 'DB', confidence_score: 1.0, valid_until: '2026-03-31T23:59:59Z',
    },
    {
      from_port: 'SHANGHAI', to_port: 'LAGOS', destination_country: 'Nigeria',
      container_type: '40FT', incoterm: 'FOB', month_label: 'Mar, 2026',
      origin_local_haulage: 15.0, origin_thc: 120, customs: 60.0, origin_misc: 25.0,
      ocean_freight: 2200, destination_thc: 90, destination_haulage: 150, destination_misc: 45,
      total_price: 2705, currency: 'USD', transit_days: 35, service_type: 'Transshipment',
      source: 'DB', confidence_score: 1.0, valid_until: '2026-03-31T23:59:59Z',
    },
  ];

  const insertPricing = db.prepare(`
    INSERT INTO pricing (
      from_port, to_port, destination_country, container_type, incoterm, month_label,
      origin_local_haulage, origin_thc, customs, origin_misc,
      ocean_freight, destination_thc, destination_haulage, destination_misc,
      total_price, currency, transit_days, service_type,
      source, confidence_score, valid_until
    ) VALUES (
      @from_port, @to_port, @destination_country, @container_type, @incoterm, @month_label,
      @origin_local_haulage, @origin_thc, @customs, @origin_misc,
      @ocean_freight, @destination_thc, @destination_haulage, @destination_misc,
      @total_price, @currency, @transit_days, @service_type,
      @source, @confidence_score, @valid_until
    )
  `);

  for (const row of pricingRows) {
    insertPricing.run(row);
  }
  console.log(`Seeded ${pricingRows.length} pricing rows.`);
  console.log('Done!');
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
