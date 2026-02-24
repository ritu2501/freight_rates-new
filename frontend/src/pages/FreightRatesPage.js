import React, { useState, useEffect, useCallback } from 'react';
import { getCountries, getPorts, getPricing, checkPrice } from '../api';
import ScrapeFormModal from '../components/ScrapeFormModal';
import ScrapeResultsModal from '../components/ScrapeResultsModal';

// Table column definitions
const COLUMNS = [
  { key: 'month_label',          label: 'Month' },
  { key: 'from_port',            label: 'Port of Loading' },
  { key: 'destination_country',  label: 'Destination Country' },
  { key: 'to_port',              label: 'Port of Destination' },
  { key: 'incoterm',             label: 'Incoterms' },
  { key: 'origin_local_haulage', label: 'Origin Local Haulage', numeric: true },
  { key: 'origin_thc',           label: 'Origin THC',           numeric: true },
  { key: 'customs',              label: 'Customs',              numeric: true },
  { key: 'origin_misc',          label: 'Origin Misc',          numeric: true },
  { key: 'ocean_freight',        label: 'Ocean Freight',        numeric: true },
  { key: 'destination_thc',      label: 'Dest THC',             numeric: true },
  { key: 'destination_haulage',  label: 'Dest Haulage',         numeric: true },
  { key: 'destination_misc',     label: 'Dest Misc',            numeric: true },
  { key: 'total_price',          label: 'Total',                numeric: true },
  { key: 'transit_days',         label: 'Transit Days' },
  { key: 'source',               label: 'Source' },
];

export default function FreightRatesPage() {
  // Data
  const [countries, setCountries] = useState([]);
  const [polOptions, setPolOptions] = useState([]);
  const [podOptions, setPodOptions] = useState([]);
  const [pricing, setPricing] = useState([]);

  // Filters
  const [selectedCountry, setSelectedCountry] = useState(null);
  const [selectedPol, setSelectedPol] = useState('');
  const [selectedPod, setSelectedPod] = useState('');

  // Modals
  const [showScrapeForm, setShowScrapeForm] = useState(false);
  const [scrapeResult, setScrapeResult] = useState(null);
  const [scrapePrefill, setScrapePrefill] = useState(null);

  // Loading
  const [loading, setLoading] = useState(true);

  // ── Data loading ─────────────────────────────────────────
  const loadCountries = useCallback(async () => {
    try {
      const data = await getCountries();
      setCountries(data);
      if (data.length && !selectedCountry) {
        setSelectedCountry(data[0]);
      }
    } catch (err) {
      console.error('Failed to load countries:', err);
    }
  }, [selectedCountry]);

  const loadPorts = useCallback(async () => {
    if (!selectedCountry) return;
    try {
      const [pol, pod] = await Promise.all([
        getPorts('pol', selectedCountry),
        getPorts('pod', selectedCountry),
      ]);
      setPolOptions(pol);
      setPodOptions(pod);
    } catch (err) {
      console.error('Failed to load ports:', err);
    }
  }, [selectedCountry]);

  const loadPricing = useCallback(async () => {
    setLoading(true);
    try {
      const filters = {};
      if (selectedCountry) filters.country = selectedCountry;
      if (selectedPol) filters.pol = selectedPol;
      if (selectedPod) filters.pod = selectedPod;
      const data = await getPricing(filters);
      setPricing(data);
    } catch (err) {
      console.error('Failed to load pricing:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedCountry, selectedPol, selectedPod]);

  useEffect(() => { loadCountries(); }, [loadCountries]);
  useEffect(() => { loadPorts(); }, [loadPorts]);
  useEffect(() => { loadPricing(); }, [loadPricing]);

  // ── Event handlers ───────────────────────────────────────
  const handleCountrySelect = (country) => {
    setSelectedCountry(country);
    setSelectedPol('');
    setSelectedPod('');
  };

  const handleGetSpotRate = (row) => {
    setScrapePrefill({
      from_port: row?.from_port || selectedPol || '',
      to_port: row?.to_port || selectedPod || '',
      container_type: row?.container_type || '40HIGH',
      incoterm: row?.incoterm || 'EXW',
      weight_per_container: row?.weight_per_container || '',
      number_of_containers: row?.number_of_containers || 1,
      origin_inland: row?.origin_inland || 'CY',
      destination_inland: row?.destination_inland || 'CY',
      price_owner: row?.price_owner || 'self',
    });
    setShowScrapeForm(true);
  };

  const handleGlobalGetSpotRate = () => {
    setScrapePrefill({
      from_port: selectedPol || '',
      to_port: selectedPod || '',
    });
    setShowScrapeForm(true);
  };

  const handleScrapeResult = (result) => {
    setShowScrapeForm(false);
    setScrapeResult(result);
  };

  const handleRateAccepted = () => {
    // Reload pricing after accepting
    setTimeout(() => {
      loadPricing();
    }, 500);
  };

  const handleResultsClose = () => {
    setScrapeResult(null);
    loadPricing(); // refresh
  };

  // ── Render helpers ───────────────────────────────────────
  const formatValue = (col, value, row) => {
    if (col.key === 'source') {
      const colors = { DB: '#6366f1', SHEET: '#f59e0b', SCRAPE: '#22c55e' };
      return (
        <span style={{
          padding: '2px 8px',
          borderRadius: 4,
          fontSize: 11,
          fontWeight: 600,
          background: (colors[value] || '#94a3b8') + '20',
          color: colors[value] || '#94a3b8',
        }}>
          {value || '-'}
        </span>
      );
    }

    if (col.numeric) {
      if (value == null || value === '') return <span className="no-data">-</span>;
      return parseFloat(value).toFixed(col.key === 'total_price' ? 2 : 4);
    }

    return value || <span className="no-data">-</span>;
  };

  return (
    <div>
      <h1 className="page-title">FREIGHT RATES</h1>
      <p className="page-subtitle">Destination Country</p>

      {/* Country tabs */}
      <div className="country-tabs">
        {countries.map((c) => (
          <button
            key={c}
            className={`country-tab ${selectedCountry === c ? 'active' : ''}`}
            onClick={() => handleCountrySelect(c)}
          >
            {c}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="filters-row">
        <select
          className="filter-select"
          value={selectedPol}
          onChange={(e) => setSelectedPol(e.target.value)}
        >
          <option value="">Select a POL</option>
          {polOptions.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>

        <select
          className="filter-select"
          value={selectedPod}
          onChange={(e) => setSelectedPod(e.target.value)}
        >
          <option value="">Select a POD</option>
          {podOptions.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>

        {/* GET SPOT RATE — main CTA when no internal rate */}
        <button className="btn-spot-rate" onClick={handleGlobalGetSpotRate}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="22,12 18,12 15,21 9,3 6,12 2,12"/>
          </svg>
          Get Maersk Spot Rate
        </button>
      </div>

      {/* Table */}
      <div className="rates-table-wrapper">
        <table className="rates-table">
          <thead>
            <tr>
              {COLUMNS.map((col) => (
                <th key={col.key}>{col.label}</th>
              ))}
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={COLUMNS.length + 1} style={{ textAlign: 'center', padding: 40 }}>
                  <span className="spinner spinner-dark" style={{ width: 24, height: 24 }}></span>
                  <div style={{ marginTop: 8, color: '#64748b' }}>Loading rates...</div>
                </td>
              </tr>
            ) : pricing.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length + 1} style={{ textAlign: 'center', padding: 40 }}>
                  <div style={{ color: '#64748b', marginBottom: 16 }}>
                    No rates found for this selection.
                  </div>
                  <button className="btn-spot-rate" onClick={handleGlobalGetSpotRate}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="22,12 18,12 15,21 9,3 6,12 2,12"/>
                    </svg>
                    Get Maersk Spot Rate
                  </button>
                </td>
              </tr>
            ) : (
              pricing.map((row, i) => (
                <tr key={row.id || i}>
                  {COLUMNS.map((col) => (
                    <td key={col.key}>{formatValue(col, row[col.key], row)}</td>
                  ))}
                  <td>
                    <button
                      className="btn-spot-rate"
                      style={{ fontSize: 12, padding: '6px 14px' }}
                      onClick={() => handleGetSpotRate(row)}
                      title="Refresh rate from Maersk"
                    >
                      ↻ Refresh
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Modals */}
      {showScrapeForm && (
        <ScrapeFormModal
          prefill={scrapePrefill}
          onClose={() => setShowScrapeForm(false)}
          onResult={handleScrapeResult}
        />
      )}

      {scrapeResult && (
        <ScrapeResultsModal
          result={scrapeResult}
          onClose={handleResultsClose}
          onAccepted={handleRateAccepted}
        />
      )}
    </div>
  );
}
