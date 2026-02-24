const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'freight_rates.db');

async function run() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    const db = new SQL.Database(buf);
    
    // Query last 10 jobs
    const res = db.exec("SELECT id, from_port, to_port, status, error_message, created_at FROM scrape_jobs ORDER BY created_at DESC LIMIT 10");
    if (res.length > 0) {
      console.log('Last 10 Scrape Jobs:');
      const columns = res[0].columns;
      const values = res[0].values;
      values.forEach(row => {
        const item = {};
        columns.forEach((col, i) => item[col] = row[i]);
        console.log(JSON.stringify(item, null, 2));
      });
    } else {
      console.log('No jobs found.');
    }
  } else {
    console.log('Database file not found at ' + DB_PATH);
  }
}

run().catch(console.error);
