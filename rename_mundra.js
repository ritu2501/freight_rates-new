
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'backend', 'freight_rates.db');

async function run() {
    const SQL = await initSqlJs();
    const buf = fs.readFileSync(DB_PATH);
    const db = new SQL.Database(buf);

    const res = db.exec("UPDATE port_aliases SET alias = 'MUNDRA (GUJARAT)' WHERE alias = 'MUNDRA'");
    console.log('Affected rows:', db.getRowsModified());

    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
    console.log('Database updated successfully');
}

run().catch(console.error);
