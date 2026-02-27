/**
 * Pricing API routes
 *
 * GET  /api/pricing           — list all pricing (with optional filters)
 * GET  /api/pricing/countries  — list destination countries with counts
 * GET  /api/pricing/ports      — list POL / POD options (filtered)
 * POST /api/pricing/check      — quick-check: internal lookup
 * POST /api/pricing/scrape     — trigger Maersk scrape job
 * POST /api/pricing/accept     — accept a scraped result into pricing
 * GET  /api/pricing/jobs       — list scrape jobs
 * GET  /api/pricing/jobs/:id   — get job detail
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/database');
const { simulateScrape, scrapeMaerskSpotRate } = require('../scraper/maersk');
const { validateCandidates } = require('../validation/validator');

const router = express.Router();

// ─── List destination countries ────────────────────────────────────────
router.get('/countries', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT DISTINCT destination_country
    FROM pricing
    WHERE destination_country IS NOT NULL
    ORDER BY destination_country
  `).all();
  res.json(rows.map((r) => r.destination_country));
});

// ─── List ports (POL/POD) with optional country filter ─────────────────
router.get('/ports', (req, res) => {
  const db = getDb();
  const { type, country } = req.query; // type = 'pol' | 'pod'

  if (type === 'pol') {
    let sql = `SELECT DISTINCT from_port AS port FROM pricing`;
    const params = [];
    if (country) {
      sql += ` WHERE destination_country = ?`;
      params.push(country);
    }
    sql += ` ORDER BY from_port`;
    const rows = db.prepare(sql).all(...params);
    return res.json(rows.map((r) => r.port));
  }

  if (type === 'pod') {
    // Return union of pricing lanes and known port aliases for the country.
    const portsSet = new Set();

    // 1) add distinct to_port from pricing (filtered by country if provided)
    let sql = `SELECT DISTINCT to_port AS port FROM pricing`;
    const params = [];
    if (country) {
      sql += ` WHERE destination_country = ?`;
      params.push(country);
    }
    sql += ` ORDER BY to_port`;
    const rows = db.prepare(sql).all(...params);
    rows.forEach((r) => portsSet.add(r.port));

    // 2) add aliases from port_aliases for the country
    try {
      const aliasRows = country
        ? db.prepare(`SELECT alias FROM port_aliases WHERE country = ? ORDER BY alias`).all(country)
        : db.prepare(`SELECT alias FROM port_aliases ORDER BY alias`).all();
      aliasRows.forEach((r) => portsSet.add(r.alias));
    } catch (e) {
      // ignore
    }

    // Return sorted list
    return res.json(Array.from(portsSet).filter(Boolean).sort());
  }

  // All ports
  const rows = db.prepare(`
    SELECT alias, un_locode, country FROM port_aliases ORDER BY alias
  `).all();
  res.json(rows);
});

// ─── List pricing with optional filters ────────────────────────────────
router.get('/', (req, res) => {
  const db = getDb();
  const { country, pol, pod, container_type, incoterm } = req.query;

  let sql = `SELECT * FROM pricing WHERE 1=1`;
  const params = [];

  if (country) {
    sql += ` AND destination_country = ?`;
    params.push(country);
  }
  if (pol) {
    sql += ` AND from_port = ?`;
    params.push(pol);
  }
  if (pod) {
    sql += ` AND to_port = ?`;
    params.push(pod);
  }
  if (container_type) {
    sql += ` AND container_type = ?`;
    params.push(container_type);
  }
  if (incoterm) {
    sql += ` AND incoterm = ?`;
    params.push(incoterm);
  }

  sql += ` ORDER BY month_label DESC, from_port, to_port`;

  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

// ─── Quick check — internal lookup ─────────────────────────────────────
router.post('/check', (req, res) => {
  const db = getDb();
  const { from_port, to_port, ship_date, container_type } = req.body;

  if (!from_port || !to_port) {
    return res.status(400).json({
      status: 'INVALID_REQUEST',
      message: 'from_port and to_port are required.',
    });
  }

  const ct = container_type || '40FT';

  // Check pricing table
  const row = db.prepare(`
    SELECT * FROM pricing
    WHERE from_port = ? COLLATE NOCASE
      AND to_port = ? COLLATE NOCASE
      AND container_type = ? COLLATE NOCASE
    ORDER BY created_at DESC
    LIMIT 1
  `).get(from_port, to_port, ct);

  if (row) {
    // Check TTL
    const age = (Date.now() - new Date(row.created_at).getTime()) / 1000;
    const ttl = row.ttl_seconds || 86400;

    if (age <= ttl) {
      return res.json({
        status: 'SUCCESS',
        source: row.source,
        found: true,
        data: row,
        message: 'Price found in internal database.',
      });
    }
  }

  // No valid price found
  res.json({
    status: 'NOT_FOUND',
    source: null,
    found: false,
    message: 'No valid internal price found. You can request a Maersk spot rate.',
    from_port,
    to_port,
    container_type: ct,
  });
});

// ─── Trigger Maersk scrape ─────────────────────────────────────────────
router.post('/scrape', async (req, res) => {
  const db = getDb();
  const {
    from_port, to_port, container_type, number_of_containers,
    weight_per_container, weight_unit, ship_date, commodity,
    incoterm, price_owner, use_live_scraper,
    origin_inland, destination_inland,
  } = req.body;

  // Validate required fields
  const errors = [];
  if (!from_port) errors.push({ field: 'from_port', message: 'Required' });
  if (!to_port) errors.push({ field: 'to_port', message: 'Required' });

  if (errors.length) {
    return res.status(400).json({ status: 'INVALID_REQUEST', errors });
  }

  const jobId = uuidv4();
  const ct = container_type || '40FT';
  const inc = incoterm || 'EXW';

  // Insert scrape job
  db.prepare(`
    INSERT INTO scrape_jobs (id, from_port, to_port, container_type, number_of_containers,
      weight_per_container, weight_unit, ship_date, commodity, incoterm, origin_inland, destination_inland, price_owner, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'RUNNING')
  `).run(jobId, from_port, to_port, ct,
    number_of_containers || 1, weight_per_container || null,
    weight_unit || 'kg', ship_date || null, commodity || null, inc,
    origin_inland || 'CY', destination_inland || 'CY',
    price_owner || 'system');

  // Respond immediately with job ID
  res.json({
    status: 'STARTED',
    job_id: jobId,
    message: 'Scrape job started. Poll /api/pricing/jobs/:id for status.'
  });

  // Run the scrape in the background
  setImmediate(async () => {
    try {
      const liveMode = use_live_scraper !== undefined
        ? !!use_live_scraper
        : process.env.USE_LIVE_SCRAPER === 'true';

      console.log(`[API] Background Job ${jobId} | Mode: ${liveMode ? 'LIVE' : 'SIM'}`);

      let scrapeResult;
      if (liveMode) {
        scrapeResult = await scrapeMaerskSpotRate({ ...req.body, job_id: jobId });
      } else {
        scrapeResult = simulateScrape({ ...req.body, job_id: jobId });
      }

      if (scrapeResult.status === 'FAILED') {
        db.prepare(`UPDATE scrape_jobs SET status='FAILED', error_message=?, snapshot_id=?, updated_at=datetime('now') WHERE id=?`)
          .run(scrapeResult.error || 'Unknown error', scrapeResult.snapshot_id || null, jobId);

        try {
          db.prepare(`INSERT INTO failure_records (scrape_job_id, reason_code, details) VALUES (?, ?, ?)`)
            .run(jobId, scrapeResult.reason_code || 'SCRAPER_ERROR', scrapeResult.error || '');
        } catch { /* ignore if table missing */ }
        return;
      }

      // Compute historical median for deviation check
      const histRows = db.prepare(`
        SELECT price FROM pricing
        WHERE from_port = ? COLLATE NOCASE AND to_port = ? COLLATE NOCASE AND container_type = ? COLLATE NOCASE
        ORDER BY created_at DESC LIMIT 20
      `).all(from_port, to_port, ct);

      const historicalMedian = histRows.length >= 5
        ? histRows.map(r => r.price).sort((a, b) => a - b)[Math.floor(histRows.length / 2)]
        : null;

      // Validate candidates
      const finalCandidates = validateCandidates(scrapeResult.candidates || [], {
        historical_median: historicalMedian,
        baseline_samples: histRows.length,
      });

      // Update job with results
      db.prepare(`
        UPDATE scrape_jobs SET status='SUCCESS', result_json=?, snapshot_id=?, updated_at=datetime('now')
        WHERE id=?
      `).run(JSON.stringify(finalCandidates), scrapeResult.snapshot_id, jobId);

      // Auto-accept top candidate if applicable
      const autoAccepted = finalCandidates.find(c => c.validation.outcome === 'AUTO_ACCEPT');
      if (autoAccepted) {
        console.log(`[API] Job ${jobId} Auto-Accepting candidate:`, autoAccepted.price);

        const destPort = db.prepare(`SELECT country FROM port_aliases WHERE alias = ? COLLATE NOCASE`).get(to_port);
        const destCountry = destPort ? destPort.country : null;
        const monthLabel = formatMonthLabel(ship_date);

        const pricingInsert = db.prepare(`
          INSERT INTO pricing (
            from_port, to_port, destination_country, container_type, incoterm, month_label,
            origin_inland, destination_inland, origin_local_haulage, origin_thc, customs, origin_misc,
            ocean_freight, destination_thc, destination_haulage, destination_misc,
            total_price, currency, transit_days, service_type,
            source, confidence_score, valid_until, snapshot_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SCRAPE', ?, ?, ?)
        `).run(
          from_port.toUpperCase(), to_port.toUpperCase(), destCountry,
          ct, inc, monthLabel,
          origin_inland || 'CY', destination_inland || 'CY',
          autoAccepted.origin_local_haulage || null,
          autoAccepted.origin_thc || null,
          autoAccepted.customs || null,
          autoAccepted.origin_misc || null,
          autoAccepted.ocean_freight || autoAccepted.price,
          autoAccepted.destination_thc || null,
          autoAccepted.destination_haulage || null,
          autoAccepted.destination_misc || null,
          autoAccepted.total_price || autoAccepted.price,
          autoAccepted.currency, autoAccepted.transit_days, autoAccepted.service_type,
          autoAccepted.confidence_score, autoAccepted.valid_until, autoAccepted.snapshot_id
        );

        // Audit trail
        db.prepare(`
          INSERT INTO pricing_history (pricing_id, from_port, to_port, container_type, incoterm, price, currency, source, snapshot_id, action, actor, reason)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'SCRAPE', ?, 'AUTO_ACCEPT', 'system', 'High-confidence auto-accept')
        `).run(pricingInsert.lastInsertRowid, from_port.toUpperCase(), to_port.toUpperCase(),
          ct, inc, autoAccepted.total_price || autoAccepted.price,
          autoAccepted.currency, autoAccepted.snapshot_id);
      }

    } catch (err) {
      console.error(`[API] Background Scrape Exception (Job ${jobId}):`, err);
      db.prepare(`UPDATE scrape_jobs SET status='FAILED', error_message=?, updated_at=datetime('now') WHERE id=?`)
        .run(err.message, jobId);
    }
  });
});

// ─── Accept a scraped result into pricing ──────────────────────────────
router.post('/accept', (req, res) => {
  const db = getDb();
  const { job_id, candidate_index, actor } = req.body;

  if (!job_id) {
    return res.status(400).json({ status: 'INVALID_REQUEST', message: 'job_id required' });
  }

  const job = db.prepare(`SELECT * FROM scrape_jobs WHERE id = ?`).get(job_id);
  if (!job) {
    return res.status(404).json({ status: 'NOT_FOUND', message: 'Job not found' });
  }

  const candidates = JSON.parse(job.result_json || '[]');
  const idx = candidate_index || 0;
  const candidate = candidates[idx];
  if (!candidate) {
    return res.status(400).json({ status: 'INVALID_REQUEST', message: 'Invalid candidate index' });
  }

  // Look up destination country
  const destPort = db.prepare(`SELECT country FROM port_aliases WHERE alias = ? COLLATE NOCASE`).get(job.to_port);
  const destCountry = destPort ? destPort.country : null;
  const monthLabel = formatMonthLabel(job.ship_date);

  const insertResult = db.prepare(`
    INSERT INTO pricing (
      from_port, to_port, destination_country, container_type, incoterm, month_label,
      origin_inland, destination_inland,
      origin_local_haulage, origin_thc, customs, origin_misc,
      ocean_freight, destination_thc, destination_haulage, destination_misc,
      total_price, currency, transit_days, service_type,
      source, confidence_score, valid_until, snapshot_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SCRAPE', ?, ?, ?)
  `).run(
    job.from_port.toUpperCase(), job.to_port.toUpperCase(), destCountry,
    job.container_type, job.incoterm, monthLabel,
    job.origin_inland || 'CY', job.destination_inland || 'CY',
    candidate.origin_local_haulage || null,
    candidate.origin_thc || null,
    candidate.customs || null,
    candidate.origin_misc || null,
    candidate.ocean_freight || candidate.price,
    candidate.destination_thc || null,
    candidate.destination_haulage || null,
    candidate.destination_misc || null,
    candidate.total_price || candidate.price,
    candidate.currency, candidate.transit_days, candidate.service_type,
    candidate.confidence_score, candidate.valid_until, candidate.snapshot_id
  );

  const pricingId = insertResult.lastInsertRowid;

  // Audit trail
  db.prepare(`
    INSERT INTO pricing_history (pricing_id, from_port, to_port, container_type, incoterm, price, currency, source, snapshot_id, action, actor, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'SCRAPE', ?, 'AGENT_ACCEPT', ?, 'Agent accepted scraped rate')
  `).run(pricingId, job.from_port.toUpperCase(), job.to_port.toUpperCase(),
    job.container_type, job.incoterm, candidate.total_price || candidate.price,
    candidate.currency, candidate.snapshot_id, actor || 'agent');

  res.json({
    status: 'SUCCESS',
    pricing_id: pricingId,
    message: 'Rate accepted and saved to pricing database.',
  });
});

// ─── List scrape jobs ──────────────────────────────────────────────────
router.get('/jobs', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`SELECT * FROM scrape_jobs ORDER BY created_at DESC LIMIT 50`).all();
  res.json(rows);
});

// ─── Get job detail ────────────────────────────────────────────────────
router.get('/jobs/:id', (req, res) => {
  const db = getDb();
  const job = db.prepare(`SELECT * FROM scrape_jobs WHERE id = ?`).get(req.params.id);
  if (!job) return res.status(404).json({ status: 'NOT_FOUND' });

  const candidates = JSON.parse(job.result_json || '[]');
  res.json({ ...job, candidates });
});

// ─── Helper ────────────────────────────────────────────────────────────
function formatMonthLabel(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]}, ${d.getFullYear()}`;
}

module.exports = router;
