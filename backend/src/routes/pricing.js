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

/**
 * Input validation middleware
 */
function validatePort(port) {
  if (!port || typeof port !== 'string' || port.trim().length === 0) return false;
  // Allow alphanumeric, spaces, and hyphens
  return /^[a-zA-Z0-9\s\-]{2,10}$/.test(port.trim());
}

// Container type mapping (short code => display format)
const CONTAINER_TYPE_MAP = {
  '20FT': '20\' Dry',
  '40FT': '40\' Dry',
  '40HC': '40\' High Cube Dry',
  '40HIGH': '40\' High Cube Dry',
  '45FT': '45\' High Cube Dry',
  'REEFER': '40\' Reefer High Cube',
  'OOG': '40\' Open Top',
};

// Create reverse map for validation (what frontend sends)
const REVERSE_CONTAINER_MAP = {
  '20 DRY': '20FT',
  '40 DRY': '40FT',
  '40 HIGH CUBE DRY': '40HC',
  '40 REEFER HIGH CUBE': 'REEFER',
  '40 OPEN TOP': 'OOG',
  '45 HIGH CUBE DRY': '45FT',
  // Also accept short codes
  '20FT': '20FT',
  '40FT': '40FT',
  '40HC': '40HC',
  '40HIGH': '40HIGH',
  '45FT': '45FT',
  'REEFER': 'REEFER',
  'OOG': 'OOG',
};

function normalizeContainerType(type) {
  if (!type) return null;
  // Try exact match first (handles "40FT" etc)
  const normalized = type.toUpperCase().trim().replace(/['']/g, "'");
  
  // Check direct short code match
  if (REVERSE_CONTAINER_MAP[normalized]) {
    return REVERSE_CONTAINER_MAP[normalized];
  }
  
  // Try to match with word-based lookup (handles "40 Dry", "40 High Cube Dry" etc)
  const simplified = type.toUpperCase().replace(/[''`]/g, '').trim();
  if (REVERSE_CONTAINER_MAP[simplified]) {
    return REVERSE_CONTAINER_MAP[simplified];
  }
  
  return null; // Invalid type
}

function validateContainerType(type) {
  if (!type) return true; // Optional, has default
  const normalized = normalizeContainerType(type);
  return normalized !== null;
}

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
  const { country, pol, pod, container_type } = req.query;

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
  // incoterm filter removed (no longer used)

  sql += ` ORDER BY month_label DESC, from_port, to_port`;

  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

// ─── Quick check — internal lookup ─────────────────────────────────────
router.post('/check', (req, res) => {
  const db = getDb();
  const { from_port, to_port, container_type } = req.body;

  if (!from_port || !to_port) {
    return res.status(400).json({
      status: 'INVALID_REQUEST',
      message: 'from_port and to_port are required.',
    });
  }

  const ct = container_type || '40FT';

  // Fetch ALL matching prices (not just one)
  const rows = db.prepare(`
    SELECT * FROM pricing
    WHERE from_port = ? COLLATE NOCASE
      AND to_port = ? COLLATE NOCASE
      AND container_type = ? COLLATE NOCASE
    ORDER BY created_at DESC
  `).all(from_port, to_port, ct);

  // Filter by TTL — keep only non-expired rows
  const validRows = rows.filter((row) => {
    const age = (Date.now() - new Date(row.created_at).getTime()) / 1000;
    const ttl = row.ttl_seconds || 86400;
    return age <= ttl;
  });

  if (validRows.length > 0) {
    return res.json({
      status: 'SUCCESS',
      source: validRows[0].source,
      found: true,
      data: validRows,          // array of ALL matching prices
      count: validRows.length,
      message: `${validRows.length} price(s) found in internal database.`,
    });
  }

  // No valid price found
  res.json({
    status: 'NOT_FOUND',
    source: null,
    found: false,
    data: [],
    count: 0,
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
    weight_per_container, weight_unit, commodity,
    price_owner, use_live_scraper,
    origin_inland, destination_inland,
  } = req.body;

  // Validate required fields
  const errors = [];
  if (!validatePort(from_port)) errors.push({ field: 'from_port', message: 'Required and must be 2-10 alphanumeric characters' });
  if (!validatePort(to_port)) errors.push({ field: 'to_port', message: 'Required and must be 2-10 alphanumeric characters' });
  if (container_type && !validateContainerType(container_type)) {
    errors.push({ field: 'container_type', message: 'Invalid container type. Valid types: 20FT, 40FT, 40HC, 40HIGH, 45FT, REEFER, OOG or their display formats (e.g., "40 Dry", "40 High Cube Dry")' });
  }
  if (number_of_containers && (typeof number_of_containers !== 'number' || number_of_containers < 1)) {
    errors.push({ field: 'number_of_containers', message: 'Must be a positive number' });
  }

  if (errors.length) {
    return res.status(400).json({ status: 'INVALID_REQUEST', errors });
  }

  const jobId = uuidv4();
  // Normalize container type to standard code (e.g., "40 Dry High" -> "40HC")
  const ct = normalizeContainerType(container_type) || '40FT';

  // Insert scrape job
  try {
    db.prepare(`
      INSERT INTO scrape_jobs (id, from_port, to_port, container_type, number_of_containers,
        weight_per_container, weight_unit, commodity, origin_inland, destination_inland, price_owner, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'RUNNING')
    `).run(jobId, from_port.toUpperCase(), to_port.toUpperCase(), ct,
      number_of_containers || 1, weight_per_container || null,
      weight_unit || 'kg', commodity || null,
      origin_inland || 'CY', destination_inland || 'CY',
      price_owner || 'system');
  } catch (dbErr) {
    console.error('[API] Failed to insert scrape job:', dbErr.message);
    return res.status(500).json({
      status: 'DATABASE_ERROR',
      message: 'Failed to create scrape job'
    });
  }

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
      try {
        if (liveMode) {
          scrapeResult = await scrapeMaerskSpotRate({ ...req.body, job_id: jobId });
        } else {
          scrapeResult = simulateScrape({ ...req.body, job_id: jobId });
        }
      } catch (scrapeErr) {
        console.error(`[API] Job ${jobId} Scrape error:`, {
          message: scrapeErr.message,
          code: scrapeErr.code,
          stack: scrapeErr.stack
        });

        try {
          db.prepare(`UPDATE scrape_jobs SET status='FAILED', error_message=?, updated_at=datetime('now') WHERE id=?`)
            .run(`Scrape error: ${scrapeErr.message}`, jobId);
          db.prepare(`INSERT INTO failure_records (scrape_job_id, reason_code, details) VALUES (?, ?, ?)`)
            .run(jobId, 'SCRAPER_ERROR', scrapeErr.message || '');
        } catch (updateErr) {
          console.error(`[API] Job ${jobId} Failed to update failure record:`, updateErr.message);
        }
        return;
      }

      if (scrapeResult.status === 'FAILED') {
        console.warn(`[API] Job ${jobId} Scrape returned FAILED status:`, scrapeResult.reason_code);
        db.prepare(`UPDATE scrape_jobs SET status='FAILED', error_message=?, snapshot_id=?, updated_at=datetime('now') WHERE id=?`)
          .run(scrapeResult.error || 'Unknown error', scrapeResult.snapshot_id || null, jobId);

        try {
          db.prepare(`INSERT INTO failure_records (scrape_job_id, reason_code, details) VALUES (?, ?, ?)`)
            .run(jobId, scrapeResult.reason_code || 'SCRAPER_ERROR', scrapeResult.error || '');
        } catch (e) {
          console.error(`[API] Job ${jobId} Failed to insert failure record:`, e.message);
        }
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
        try {
          console.log(`[API] Job ${jobId} Auto-Accepting candidate:`, autoAccepted.price);

          const destPort = db.prepare(`SELECT country FROM port_aliases WHERE alias = ? COLLATE NOCASE`).get(to_port);
          const destCountry = destPort ? destPort.country : null;
          const monthLabel = null;

          const pricingInsert = db.prepare(`
            INSERT INTO pricing (
              from_port, to_port, destination_country, container_type, month_label,
              origin_inland, destination_inland, origin_local_haulage, origin_thc, customs, origin_misc,
              ocean_freight, destination_thc, destination_haulage, destination_misc,
              total_price, currency, transit_days, service_type,
              source, confidence_score, valid_until, snapshot_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SCRAPE', ?, ?, ?)
          `).run(
            from_port.toUpperCase(), to_port.toUpperCase(), destCountry,
            ct, monthLabel,
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
            INSERT INTO pricing_history (pricing_id, from_port, to_port, container_type, price, currency, source, snapshot_id, action, actor, reason)
            VALUES (?, ?, ?, ?, ?, ?, 'SCRAPE', ?, 'AUTO_ACCEPT', 'system', 'High-confidence auto-accept')
          `).run(pricingInsert.lastInsertRowid, from_port.toUpperCase(), to_port.toUpperCase(),
            ct, autoAccepted.total_price || autoAccepted.price,
            autoAccepted.currency, autoAccepted.snapshot_id);

          console.log(`[API] Job ${jobId} Auto-accept completed successfully`);
        } catch (acceptErr) {
          console.error(`[API] Job ${jobId} Error during auto-accept:`, {
            message: acceptErr.message,
            stack: acceptErr.stack
          });
          // Don't fail the job - it had successful scrape results
        }
      }

    } catch (err) {
      console.error(`[API] Background Scrape Exception (Job ${jobId}):`, {
        message: err.message,
        stack: err.stack
      });
      try {
        db.prepare(`UPDATE scrape_jobs SET status='FAILED', error_message=?, updated_at=datetime('now') WHERE id=?`)
          .run(`Background error: ${err.message}`, jobId);
      } catch (updateErr) {
        console.error(`[API] Job ${jobId} Failed to update final error:`, updateErr.message);
      }
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

  // Require an actor for audit trail
  if (!actor || String(actor).trim() === '') {
    return res.status(400).json({ status: 'INVALID_REQUEST', message: 'actor is required' });
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
  const monthLabel = null;

  const insertResult = db.prepare(`
    INSERT INTO pricing (
      from_port, to_port, destination_country, container_type, month_label,
      origin_inland, destination_inland,
      origin_local_haulage, origin_thc, customs, origin_misc,
      ocean_freight, destination_thc, destination_haulage, destination_misc,
      total_price, currency, transit_days, service_type,
      source, confidence_score, valid_until, snapshot_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SCRAPE', ?, ?, ?)
  `).run(
    job.from_port.toUpperCase(), job.to_port.toUpperCase(), destCountry,
    job.container_type, monthLabel,
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
    INSERT INTO pricing_history (pricing_id, from_port, to_port, container_type, price, currency, source, snapshot_id, action, actor, reason)
    VALUES (?, ?, ?, ?, ?, ?, 'SCRAPE', ?, 'AGENT_ACCEPT', ?, 'Agent accepted scraped rate')
  `).run(pricingId, job.from_port.toUpperCase(), job.to_port.toUpperCase(),
    job.container_type, candidate.total_price || candidate.price,
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
