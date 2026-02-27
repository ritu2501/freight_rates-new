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

app.use(cors());
app.use(express.json());

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/pricing', pricingRoutes);

// Initialize DB then start server
initDbAsync()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`[Server] Freight Rates API running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('[Server] Failed to init DB:', err);
    process.exit(1);
  });
