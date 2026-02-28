/**
 * Express server entry point
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const express = require('express');
const cors = require('cors');
const { initDbAsync } = require('./db/database');
const pricingRoutes = require('./routes/pricing');

const app = express();
const PORT = process.env.PORT || 4000;

// ─── Security & Middleware ─────────────────────────────────────────
// CORS with environment-based origin
const corsOptions = {
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: false
};
app.use(cors(corsOptions));

// Parse JSON payloads
app.use(express.json({ limit: '10mb' }));

// ─── Simple Rate Limiting Middleware ────────────────────────────────
const requestCounts = new Map();
const RATE_LIMIT_WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 900000; // 15 min
const RATE_LIMIT_REQUESTS = parseInt(process.env.RATE_LIMIT_REQUESTS, 10) || 100;

function rateLimiter(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();

  if (!requestCounts.has(ip)) {
    requestCounts.set(ip, []);
  }

  const ipRequests = requestCounts.get(ip);
  
  // Clean old requests outside the window
  const validRequests = ipRequests.filter(timestamp => now - timestamp < RATE_LIMIT_WINDOW);
  requestCounts.set(ip, validRequests);

  if (validRequests.length >= RATE_LIMIT_REQUESTS) {
    console.warn(`[RATE-LIMIT] IP ${ip} exceeded limit`);
    return res.status(429).json({
      status: 'TOO_MANY_REQUESTS',
      message: 'Rate limit exceeded. Please try again later.'
    });
  }

  validRequests.push(now);
  next();
}

app.use(rateLimiter);

// ─── Request Logging ───────────────────────────────────────────────
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ─── Health check ──────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Routes ────────────────────────────────────────────────────────
app.use('/api/pricing', pricingRoutes);

// ─── Error Handler ─────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[ERROR]', {
    message: err.message,
    path: req.path,
    method: req.method,
    stack: err.stack
  });
  
  res.status(500).json({
    status: 'SERVER_ERROR',
    message: 'An unexpected error occurred'
  });
});

// ─── 404 Handler ───────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    status: 'NOT_FOUND',
    message: `Route ${req.method} ${req.path} not found`
  });
});

// ─── Initialize & Start ────────────────────────────────────────────
initDbAsync()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`[Server] Freight Rates API running on http://localhost:${PORT}`);
      console.log(`[Server] Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`[Server] CORS Origin: ${corsOptions.origin}`);
      console.log(`[Server] Rate Limit: ${RATE_LIMIT_REQUESTS} requests per ${Math.round(RATE_LIMIT_WINDOW / 1000)}s`);
    });
  })
  .catch((err) => {
    console.error('[Server] Failed to init DB:', err);
    process.exit(1);
  });
