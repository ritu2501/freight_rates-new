const { initDbAsync, getDb } = require('../src/db/database');
const { Octokit } = require('@octokit/rest');

async function main() {
  await initDbAsync();
  const db = getDb();

  // Count failures by reason_code in last 24 hours
  const rows = db.prepare(`
    SELECT reason_code, COUNT(*) AS cnt
    FROM failure_records
    WHERE created_at >= datetime('now', '-1 day')
    GROUP BY reason_code
    ORDER BY cnt DESC
  `).all();

  let total = 0;
  rows.forEach(r => total += r.cnt);

  if (total === 0) {
    console.log('No failures in the last 24 hours.');
    return;
  }

  console.log(`Detected ${total} failures in the last 24 hours.`);
  rows.forEach(r => console.log(`  ${r.reason_code || 'UNKNOWN'}: ${r.cnt}`));

  // Create GitHub issue using GITHUB_TOKEN and GITHUB_REPOSITORY from environment
  const githubToken = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY; // owner/repo
  if (!githubToken || !repo) {
    console.error('GITHUB_TOKEN and GITHUB_REPOSITORY must be set to create an issue. Skipping alert.');
    return;
  }

  const [owner, repoName] = repo.split('/');
  const octokit = new Octokit({ auth: githubToken });

  const title = `Maersk scraper failures detected: ${total} in last 24h`;
  let body = 'Automated alert — the scraper recorded the following failures in the last 24 hours:\n\n';
  rows.forEach(r => {
    body += `- ${r.reason_code || 'UNKNOWN'}: ${r.cnt}\n`;
  });
  body += '\nCheck `failure_records` and `scrape_jobs` for details. Snapshots (if any) are available in `snapshots/`.';

  try {
    await octokit.issues.create({ owner, repo: repoName, title, body });
    console.log('Created GitHub issue alert.');
  } catch (err) {
    console.error('Failed to create GitHub issue:', err.message);
  }
}

main().catch(err => {
  console.error('Error running check_and_alert:', err);
  process.exit(1);
});
