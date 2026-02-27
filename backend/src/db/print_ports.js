const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', '..', 'freight_rates.db');

async function run() {
  const SQL = await initSqlJs();
  const buf = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(buf);

  const res1 = db.exec("SELECT DISTINCT to_port AS port FROM pricing WHERE destination_country = 'India' ORDER BY to_port");
  const ports = res1.length ? res1[0].values.map((v) => v[0]) : [];
  console.log('pricing to_port for India:', ports);

  const res2 = db.exec("SELECT alias FROM port_aliases ORDER BY alias");
  const aliases = res2.length ? res2[0].values.map((v) => v[0]) : [];
  console.log('port_aliases:', aliases);
}

run().catch((err) => { console.error(err); process.exit(1); });
