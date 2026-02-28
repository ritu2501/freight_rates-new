# Freight Rates - Real-Time Spot Pricing Automation System

## Overview

This is a full-stack application that automates freight rate pricing by scraping Maersk shipping portal data and managing a pricing database.

### Key Features
- Query historical freight rates by port-to-port routes
- Trigger live Maersk spot rate scraping
- Auto-validate and accept or flag prices for manual review
- Track scraper failures with detailed reason codes
- REST API with rate limiting and error handling
- React-based frontend for pricing management

### Architecture
- **Backend**: Node.js/Express API server (port 4000)
- **Frontend**: React SPA (port 3000)
- **Database**: SQLite with sql.js (in-process)
- **Scraper**: Playwright-based automation for Maersk portal

---

## Setup Instructions

### Prerequisites
- Node.js 16+ (LTS recommended)
- npm or yarn

### 1. Clone & Install Dependencies

```bash
cd freight_rates-new
npm run install:all
```

This installs dependencies for root, backend, and frontend in one command.

### 2. Configure Environment Variables

Copy the example environment file and update with your actual credentials:

```bash
cp .env.example .env
```

Edit `.env` and set these **required** values:

```env
# Maersk Portal Login (REQUIRED)
MAERSK_USERNAME=your_username_here
MAERSK_PASSWORD=your_password_here

# Encryption Key (REQUIRED - keep secure in production)
SNAPSHOT_KEY=your-secure-encryption-key-32-chars-minimum-here

# Other options
USE_LIVE_SCRAPER=false        # Set to true to enable live scraping (default: simulation mode)
NODE_ENV=development
PORT=4000
CORS_ORIGIN=http://localhost:3000
```

⚠️ **SECURITY**: 
- Never commit `.env` with real credentials
- In production, use environment variable management (AWS Secrets Manager, HashiCorp Vault, etc.)
- Rotate the SNAPSHOT_KEY regularly

### 3. Initialize Database

```bash
npm run seed
```

This creates the SQLite database and seeds initial data (ports, routes, etc.).

### 4. Start Development Servers

**Option A: Run both backend & frontend concurrently**
```bash
npm run dev
```

**Option B: Run separately in different terminals**

Terminal 1 - Backend:
```bash
npm run dev:backend
```

Terminal 2 - Frontend:
```bash
npm run dev:frontend
```

### 5. Access the Application

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:4000
- **Health Check**: http://localhost:4000/api/health

---

## API Endpoints

### Pricing Management
- `GET /api/pricing` - List all pricing with optional filters
- `GET /api/pricing/countries` - List destination countries
- `GET /api/pricing/ports` - List ports (POL/POD)
- `POST /api/pricing/check` - Quick internal lookup
- `POST /api/pricing/scrape` - Trigger Maersk scrape job
- `POST /api/pricing/accept` - Accept scraped rate into database
- `GET /api/pricing/jobs` - List scrape jobs
- `GET /api/pricing/jobs/:id` - Get job details

### Health & Status
- `GET /api/health` - Server health check

---

## Available Scripts

### Backend
- `npm run dev` - Start development server
- `npm run start` - Run production server
- `npm run seed` - Initialize/seed database
- `npm run e2e` - Run end-to-end tests
- `npm run monitor` - Check recent scraper failures

### Frontend
- `npm start` - Start development server
- `npm run build` - Build for production

### Root
- `npm run install:all` - Install all dependencies
- `npm run dev` - Start both backend & frontend
- `npm run dev:backend` - Start only backend
- `npm run dev:frontend` - Start only frontend
- `npm run seed` - Seed database

---

## Project Structure

```
freight_rates-new/
├── .env                          # Environment config (git-ignored)
├── .env.example                  # Template for .env
├── .gitignore
├── package.json                  # Root workspace config
│
├── backend/                      # Express API server
│   ├── src/
│   │   ├── index.js             # Express app entry point
│   │   ├── db/
│   │   │   ├── database.js      # SQLite wrapper & initialization
│   │   │   ├── seed.js          # Database seeding
│   │   │   ├── normalize_ports.js
│   │   │   └── apply_port_changes.js
│   │   ├── routes/
│   │   │   └── pricing.js       # API route handlers
│   │   ├── scraper/
│   │   │   └── maersk.js        # Playwright scraper (1348+ lines)
│   │   └── validation/
│   │       └── validator.js     # Price validation logic
│   ├── test/
│   │   ├── e2e/
│   │   │   └── run_tests.js
│   │   └── fixtures/            # HTML test fixtures for scraper
│   ├── tools/
│   │   ├── check_failures.js    # Failure monitoring
│   │   ├── check_and_alert.js
│   │   └── run_live_scrape.js
│   ├── ops/
│   │   ├── RUNBOOK.md           # Operations guide
│   │   └── decrypt_snapshot.js  # Snapshot decryption tool
│   └── package.json
│
├── frontend/                     # React SPA
│   ├── src/
│   │   ├── index.js
│   │   ├── App.js
│   │   ├── api.js               # Axios client
│   │   ├── components/
│   │   │   ├── Header.js
│   │   │   ├── Sidebar.js
│   │   │   ├── ScrapeFormModal.js
│   │   │   └── ScrapeResultsModal.js
│   │   ├── pages/
│   │   │   └── FreightRatesPage.js
│   │   └── App.css
│   ├── public/
│   │   └── index.html
│   └── package.json
│
└── README.md (this file)
```

---

## Key Fixes Applied

### Security
- ✅ Removed hardcoded Maersk credentials
- ✅ Required environment variable validation
- ✅ Replaced weak encryption key fallback with proper .env handling
- ✅ Added CORS configuration from env
- ✅ Added rate limiting middleware (100 req/15min per IP)
- ✅ Added error handler middleware

### Reliability
- ✅ Fixed database initialization race conditions
- ✅ Fixed background job error handling with detailed logging
- ✅ Added comprehensive error messages and stack traces
- ✅ Added input validation for port names and container types
- ✅ Improved database save error reporting

### Debugging
- ✅ Added detailed request logging
- ✅ Added structured error logging with context
- ✅ Added validation environment function
- ✅ Improved console output formatting

---

## Troubleshooting

### Issue: "Missing required environment variables"
**Solution**: Update `.env` file with required values (MAERSK_USERNAME, MAERSK_PASSWORD, SNAPSHOT_KEY)

### Issue: Database locks when running multiple processes
**Solution**: The database uses sql.js (in-memory SQLite). Ensure only one backend instance runs at a time.

### Issue: Scraper timeouts
**Solution**: Increase `SCRAPER_TIMEOUT_MS` in environment variables (default: 60000ms = 60 seconds)

### Issue: CORS errors on frontend
**Solution**: Ensure `CORS_ORIGIN` in `.env` matches your frontend URL (default: http://localhost:3000)

### Issue: Port already in use
**Solution**: Change PORT in `.env` or kill the process using the port:
```bash
# Windows
netstat -ano | findstr :4000
taskkill /PID <PID> /F

# macOS/Linux
lsof -i :4000
kill -9 <PID>
```

---

## Monitoring & Operations

### Check Recent Scraper Failures
```bash
npm run monitor
```

Shows failure counts by reason code in the last 7 days.

### Decrypt Snapshot for Inspection
```bash
node backend/ops/decrypt_snapshot.js snapshots/snap_<id>.enc snapshots/snap_<id>.meta.json
```

### Database Queries
The database is stored in `freight_rates.db` (SQLite format). Use any SQLite client:

```bash
sqlite3 freight_rates.db "SELECT * FROM scrape_jobs LIMIT 10;"
```

---

## Production Deployment

### Pre-Deployment Checklist
- [ ] All environment variables set in production secrets manager
- [ ] SNAPSHOT_KEY is a strong, unique encryption key
- [ ] MAERSK_USERNAME / MAERSK_PASSWORD stored securely
- [ ] Node.js LTS version specified
- [ ] Database backed up regularly
- [ ] Rate limits configured appropriately

### Environment Setup
```env
NODE_ENV=production
PORT=4000
CORS_ORIGIN=https://your-domain.com

# Use production secrets manager for these
MAERSK_USERNAME=<from-vault>
MAERSK_PASSWORD=<from-vault>
SNAPSHOT_KEY=<from-vault>
API_SECRET_KEY=<from-vault>
```

### Start Production Server
```bash
NODE_ENV=production node backend/src/index.js
```

---

## Development Notes

### Adding New Routes
Add in `backend/src/routes/pricing.js`, ensuring:
- Input validation using `validatePort()`, `validateContainerType()`
- Try-catch error handling with detailed logging
- Proper HTTP status codes and error messages

### Database Migrations
Migration files in `backend/src/db/` use `db.exec()` for schema changes. Old migrations use try-catch to handle existing columns.

### Testing
Run end-to-end tests against HTML fixtures:
```bash
npm run e2e
```

---

## Contributing

1. Never commit `.env` with real credentials
2. Add proper error handling and logging
3. Validate all user inputs
4. Use try-catch for database operations
5. Add comments for complex business logic

---

## License

Proprietary - All rights reserved

---

## Support

For issues or questions, check:
- `backend/ops/RUNBOOK.md` - Operations guide for scraper issues
- Console logs for detailed error information
- Database state for data consistency checks

Last Updated: February 28, 2026
