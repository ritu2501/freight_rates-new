
const sqlite3 = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'backend', 'freight_rates.db');

async function run() {
    const initSqlJs = require('sql.js');
    const SQL = await initSqlJs();
    if (!fs.existsSync(DB_PATH)) {
        console.error('DB not found at', DB_PATH);
        return;
    }
    const buf = fs.readFileSync(DB_PATH);
    const db = new SQL.Database(buf);

    const res = db.exec('SELECT id, from_port, to_port, status, error_message, updated_at FROM scrape_jobs ORDER BY created_at DESC LIMIT 5');
    if (res.length > 0) {
        const cols = res[0].columns;
        const rows = res[0].values.map(v => {
            const row = {};
            cols.forEach((c, i) => row[c] = v[i]);
            return row;
        });
        console.log(JSON.stringify(rows, null, 2));
    } else {
        console.log('No jobs found.');
    }
}

run().catch(console.error);
