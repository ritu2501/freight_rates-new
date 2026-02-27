const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const DB_PATH = process.env.DATABASE_PATH
  ? path.resolve(process.cwd(), process.env.DATABASE_PATH)
  : path.join(__dirname, '..', '..', 'freight_rates.db');

async function run() {
  const SQL = await initSqlJs();
  const buf = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(buf);

  // Remove stray commas in aliases
  try { db.exec("UPDATE port_aliases SET alias = TRIM(REPLACE(alias, ',', ''))"); } catch(e) {}

  // Safe updates: change exact matches in pricing.to_port
  try { db.exec("UPDATE pricing SET to_port = 'TUTICORIN (TAMIL NADU)' WHERE LOWER(to_port) = 'tuticorin'"); } catch(e) {}
  try { db.exec("UPDATE pricing SET to_port = 'MUNDRA (GUJARAT)' WHERE LOWER(to_port) = 'mundra'"); } catch(e) {}

  // Ensure canonical aliases exist
  try { db.exec("INSERT OR IGNORE INTO port_aliases(alias, un_locode, country) VALUES ('TUTICORIN (TAMIL NADU)', 'INTUT', 'India')"); } catch(e) {}
  try { db.exec("INSERT OR IGNORE INTO port_aliases(alias, un_locode, country) VALUES ('MUNDRA (GUJARAT)', 'INMUN', 'India')"); } catch(e) {}
  try { db.exec("INSERT OR IGNORE INTO port_aliases(alias, un_locode, country) VALUES ('EVERYWHERE', '', NULL)"); } catch(e) {}

  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
  console.log('Applied canonical POD names to pricing and port_aliases.');
}

run().catch((err) => { console.error(err); process.exit(1); });
