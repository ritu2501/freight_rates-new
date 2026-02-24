import axios from 'axios';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:4000/api';

const api = axios.create({ baseURL: API_BASE });

/* ── Pricing ────────────────────────────────────────────────── */

export async function getCountries() {
  const { data } = await api.get('/pricing/countries');
  return data;
}

export async function getPorts(type, country) {
  const params = { type };
  if (country) params.country = country;
  const { data } = await api.get('/pricing/ports', { params });
  return data;
}

export async function getPricing(filters = {}) {
  const { data } = await api.get('/pricing', { params: filters });
  return data;
}

export async function checkPrice(payload) {
  const { data } = await api.post('/pricing/check', payload);
  return data;
}

export async function triggerScrape(payload) {
  // Let backend decide live vs simulated based on USE_LIVE_SCRAPER env var
  const { data } = await api.post('/pricing/scrape', payload, {
    timeout: 180000, // 3min timeout — live scraper needs time to open browser, login, fill form, extract rates
  });
  return data;
}

export async function acceptRate(payload) {
  const { data } = await api.post('/pricing/accept', payload);
  return data;
}

export async function getScrapeJobs() {
  const { data } = await api.get('/pricing/jobs');
  return data;
}

export async function getScrapeJob(id) {
  const { data } = await api.get(`/pricing/jobs/${id}`);
  return data;
}
