# Ops Runbook — Maersk Scraper

Purpose
- Quickly diagnose scraper failures, inspect snapshots, and recover jobs.

Key concepts
- `scrape_jobs` table: contains job entries. On failure `status='FAILED'`, `error_message`, `reason_code`, and `snapshot_id` may be populated.
- `snapshots/`: encrypted HTML snapshots saved as `snap_<uuid>.enc` with metadata `snap_<uuid>.meta.json`.
- `failure_records`: records aggregated failures for ops review.

Common reason codes
- `UNKNOWN_STATE` — page not recognized (neither login nor booking form).
- `CAPTCHA_DETECTED` — a captcha or anti-bot challenge was detected.
- `LOGIN_FAILED` — automated login failed after retry.
- `ACCESS_DENIED` — server blocked access (WAF/Akamai).
- `FORM_ERROR`, `FORM_INCOMPLETE` — form interaction errors.

Quick checks
1. List recent failed jobs:

```bash
sqlite3 freight_rates.db "SELECT id, status, error_message, reason_code, snapshot_id, created_at FROM scrape_jobs WHERE status='FAILED' ORDER BY created_at DESC LIMIT 20;"
```

2. Inspect failure records:

```bash
sqlite3 freight_rates.db "SELECT * FROM failure_records ORDER BY created_at DESC LIMIT 50;"
```

3. Decrypt and view a snapshot (requires `SNAPSHOT_KEY` from environment):

```bash
node ops/decrypt_snapshot.js snapshots/snap_<id>.enc snapshots/snap_<id>.meta.json
```

If `decrypt_snapshot.js` is present, you can write the output to a file and open it locally:

```bash
node ops/decrypt_snapshot.js snapshots/snap_<id>.enc snapshots/snap_<id>.meta.json > /tmp/snapshot.html
open /tmp/snapshot.html
```

Recovery steps
1. If `CAPTCHA_DETECTED` or `ACCESS_DENIED`:
   - Try re-running job after 10–30 minutes.
   - Rotate the persistent profile: stop the service, remove `.maersk-profile` (or move it), and restart so a fresh profile is created.
   - If captcha persists, escalate to product/security — human intervention or captcha-solving service required.

2. If `LOGIN_FAILED`:
   - Verify `MAERSK_USERNAME` / `MAERSK_PASSWORD` in environment or vault.
   - Manually login using the same profile (open a browser with `--user-data-dir` pointing to `.maersk-profile`) and resolve any MFA.
   - Re-run the job.

3. If `UNKNOWN_STATE`:
   - Download the snapshot and open it locally to inspect the unexpected HTML.
   - Update the scraper selectors or add a new page-state branch in `backend/src/scraper/maersk.js`.

Automation & monitoring
- Run `npm run e2e` in `backend` to validate detection logic against fixtures.
- Use `node tools/check_failures.js` to print counts of recent failures by `reason_code`.

Contact / Escalation
- Primary: dev on-call
- Secondary: ops

Revision
- 2026-02-26 — Initial runbook (automated generation)
