
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'backend', 'freight_rates.db');

async function run() {
    const SQL = await initSqlJs();
    const buf = fs.readFileSync(DB_PATH);
    const db = new SQL.Database(buf);

    const res = db.exec("SELECT result_json FROM scrape_jobs WHERE to_port LIKE '%MUNDRA (GUJARAT)%' AND status = 'SUCCESS' ORDER BY updated_at DESC LIMIT 1");
    if (res.length > 0) {
        console.log(res[0].values[0][0]);
    } else {
        console.log('No result_json found.');
    }
}

run().catch(console.error);
