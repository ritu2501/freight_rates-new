/**
 * Database layer using sql.js (pure JS SQLite).
 * Provides a synchronous-style wrapper that persists to disk.
 */
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', '..', 'freight_rates.db');

let _db = null;
let _ready = null;

/**
 * Wrapper that mimics better-sqlite3-style API on top of sql.js
 */
class DbWrapper {
  constructor(sqlDb) {
    this._db = sqlDb;
  }

  exec(sql) {
    this._db.run(sql);
    this._save();
  }

  prepare(sql) {
    const db = this._db;
    const self = this;

    return {
      run(...args) {
        const params = self._normalizeParams(args);
        db.run(sql, params);
        const res = db.exec("SELECT last_insert_rowid() AS id");
        const lastInsertRowid = res.length > 0 ? res[0].values[0][0] : 0;
        const changes = db.getRowsModified();
        self._save();
        return { lastInsertRowid, changes };
      },
      get(...args) {
        const params = self._normalizeParams(args);
        const stmt = db.prepare(sql);
        stmt.bind(params);
        if (stmt.step()) {
          const cols = stmt.getColumnNames();
          const vals = stmt.get();
          stmt.free();
          const row = {};
          cols.forEach((c, i) => { row[c] = vals[i]; });
          return row;
        }
        stmt.free();
        return undefined;
      },
      all(...args) {
        const params = self._normalizeParams(args);
        const results = [];
        const stmt = db.prepare(sql);
        stmt.bind(params);
        while (stmt.step()) {
          const cols = stmt.getColumnNames();
          const vals = stmt.get();
          const row = {};
          cols.forEach((c, i) => { row[c] = vals[i]; });
          results.push(row);
        }
        stmt.free();
        return results;
      },
    };
  }

  _normalizeParams(args) {
    if (args.length === 0) return {};
    if (args.length === 1 && typeof args[0] === 'object' && !Array.isArray(args[0])) {
      const obj = args[0];
      const mapped = {};
      for (const [k, v] of Object.entries(obj)) {
        mapped[k.startsWith('@') || k.startsWith('$') || k.startsWith(':') ? k : `@${k}`] = v === undefined ? null : v;
      }
      return mapped;
    }
    return args.flat();
  }

  _save() {
    try {
      const data = this._db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(DB_PATH, buffer);
    } catch (err) {
      console.error('[DB] Save error:', err.message);
    }
  }
}

async function initDb() {
  const SQL = await initSqlJs();
  let db;
  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }
  const wrapper = new DbWrapper(db);
  initTables(wrapper);
  return wrapper;
}

function getDb() {
  if (_db) return _db;
  throw new Error('DB not initialized. Call await initDbAsync() first.');
}

async function initDbAsync() {
  if (!_ready) {
    _ready = initDb().then((w) => { _db = w; return w; });
  }
  return _ready;
}

function initTables(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS port_aliases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    alias TEXT NOT NULL COLLATE NOCASE,
    un_locode TEXT NOT NULL COLLATE NOCASE,
    country TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  // sql.js doesn't support multi-statement exec well, do one at a time
  try { db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_port_alias ON port_aliases(alias)`); } catch(e) {}

  db.exec(`CREATE TABLE IF NOT EXISTS pricing (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_port TEXT NOT NULL COLLATE NOCASE,
    to_port TEXT NOT NULL COLLATE NOCASE,
    destination_country TEXT COLLATE NOCASE,
    container_type TEXT NOT NULL DEFAULT '40FT',
    incoterm TEXT DEFAULT 'EXW',
    origin_inland TEXT DEFAULT 'CY',
    destination_inland TEXT DEFAULT 'CY',
    ship_date_bucket TEXT,
    month_label TEXT,
    price REAL,
    currency TEXT DEFAULT 'USD',
    transit_days INTEGER,
    service_type TEXT,
    origin_local_haulage REAL,
    origin_thc REAL,
    customs REAL,
    origin_misc REAL,
    ocean_freight REAL,
    destination_thc REAL,
    destination_haulage REAL,
    destination_misc REAL,
    total_price REAL,
    valid_until TEXT,
    source TEXT DEFAULT 'DB',
    confidence_score REAL DEFAULT 1.0,
    snapshot_id TEXT,
    ttl_seconds INTEGER DEFAULT 86400,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_pricing_lane ON pricing(from_port, to_port, container_type, incoterm)`); } catch(e) {}

  db.exec(`CREATE TABLE IF NOT EXISTS pricing_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pricing_id INTEGER,
    from_port TEXT NOT NULL,
    to_port TEXT NOT NULL,
    container_type TEXT,
    incoterm TEXT,
    price REAL,
    currency TEXT,
    source TEXT,
    snapshot_id TEXT,
    action TEXT DEFAULT 'INSERT',
    actor TEXT,
    reason TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS scrape_jobs (
    id TEXT PRIMARY KEY,
    from_port TEXT NOT NULL,
    to_port TEXT NOT NULL,
    container_type TEXT DEFAULT '40FT',
    number_of_containers INTEGER DEFAULT 1,
    weight_per_container REAL,
    weight_unit TEXT DEFAULT 'kg',
    ship_date TEXT,
    commodity TEXT,
    incoterm TEXT DEFAULT 'EXW',
    origin_inland TEXT DEFAULT 'CY',
    destination_inland TEXT DEFAULT 'CY',
    price_owner TEXT,
    status TEXT DEFAULT 'PENDING',
    result_json TEXT,
    error_message TEXT,
    snapshot_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS failure_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scrape_job_id TEXT,
    reason_code TEXT,
    details TEXT,
    ops_ticket_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS ops_review (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scrape_job_id TEXT,
    pricing_id INTEGER,
    status TEXT DEFAULT 'PENDING',
    actor TEXT,
    action TEXT,
    reason TEXT,
    sla_deadline TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    resolved_at TEXT
  )`);

  // Migrations: add inland columns to existing tables
  try { db.exec(`ALTER TABLE pricing ADD COLUMN origin_inland TEXT DEFAULT 'CY'`); } catch(e) { /* column already exists */ }
  try { db.exec(`ALTER TABLE pricing ADD COLUMN destination_inland TEXT DEFAULT 'CY'`); } catch(e) { /* column already exists */ }
  try { db.exec(`ALTER TABLE scrape_jobs ADD COLUMN origin_inland TEXT DEFAULT 'CY'`); } catch(e) { /* column already exists */ }
  try { db.exec(`ALTER TABLE scrape_jobs ADD COLUMN destination_inland TEXT DEFAULT 'CY'`); } catch(e) { /* column already exists */ }
}

module.exports = { getDb, initDbAsync };
