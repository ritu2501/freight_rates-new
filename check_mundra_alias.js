
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'backend', 'freight_rates.db');

async function run() {
    const SQL = await initSqlJs();
    const buf = fs.readFileSync(DB_PATH);
    const db = new SQL.Database(buf);

    const res = db.exec("SELECT * FROM port_aliases WHERE alias LIKE '%MUNDRA%'");
    console.log(JSON.stringify(res, null, 2));
}

run().catch(console.error);
