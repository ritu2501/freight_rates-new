const { initDbAsync, getDb } = require('../src/db/database');

async function main() {
  await initDbAsync();
  const db = getDb();

  // Count failures by reason_code in last 7 days
  const rows = db.prepare(`
    SELECT reason_code, COUNT(*) AS cnt
    FROM failure_records
    WHERE created_at >= datetime('now', '-7 days')
    GROUP BY reason_code
    ORDER BY cnt DESC
  `).all();

  if (!rows || rows.length === 0) {
    console.log('No failures recorded in the last 7 days.');
    return;
  }

  console.log('Failures in last 7 days:');
  rows.forEach(r => console.log(`  ${r.reason_code || 'UNKNOWN'}: ${r.cnt}`));
}

main().catch(err => {
  console.error('Error running check_failures:', err);
  process.exit(1);
});
