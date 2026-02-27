
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'backend', 'freight_rates.db');

async function run() {
    const SQL = await initSqlJs();
    const buf = fs.readFileSync(DB_PATH);
    const db = new SQL.Database(buf);

    const res = db.exec("SELECT * FROM scrape_jobs WHERE to_port LIKE '%MUNDRA (GUJARAT)%' AND status = 'SUCCESS' ORDER BY updated_at DESC LIMIT 5");
    if (res.length > 0) {
        const cols = res[0].columns;
        const rows = res[0].values.map(v => {
            const row = {};
            cols.forEach((c, i) => row[c] = v[i]);
            return row;
        });
        console.log(JSON.stringify(rows, null, 2));
    } else {
        console.log('No successful Mundra jobs found.');
    }
}

run().catch(console.error);
