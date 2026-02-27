const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', '..', 'freight_rates.db');

async function run() {
  const SQL = await initSqlJs();
  const buf = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(buf);

  const mapping = {
    'TUTICORIN': 'TUTICORIN (TAMIL NADU)',
    'MUNDRA': 'MUNDRA (GUJARAT)',
    'EVERYWHERE': 'EVERYWHERE'
  };

  // Normalize existing aliases: remove stray commas and trim
  try {
    db.exec("UPDATE port_aliases SET alias = TRIM(REPLACE(alias, ',', ''))");
  } catch (e) {
    // ignore
  }

  for (const [oldKey, canonical] of Object.entries(mapping)) {
    // Update pricing rows to use canonical to_port
    const updPricing = `UPDATE pricing SET to_port = '${canonical}' WHERE LOWER(to_port) = LOWER('${oldKey}') OR LOWER(to_port) LIKE LOWER('%${oldKey}%')`;
    try { db.exec(updPricing); } catch (e) { /* ignore */ }

    // Ensure canonical entry exists in port_aliases
    const insertSql = `INSERT OR IGNORE INTO port_aliases (alias, un_locode, country) VALUES ('${canonical}', '', NULL)`;
    try { db.exec(insertSql); } catch (e) { /* ignore */ }
  }

  // Save changes
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
  console.log('Port normalization complete.');
}

run().catch((err) => { console.error(err); process.exit(1); });
