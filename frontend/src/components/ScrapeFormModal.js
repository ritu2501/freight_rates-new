import React, { useState } from 'react';
import { triggerScrape, getScrapeJob } from '../api';

const CONTAINER_TYPES = [
  { value: '20DRY',  label: '20 Dry Standard' },
  { value: '40DRY',  label: '40 Dry Standard' },
  { value: '40HIGH', label: '40 Dry High' },
  { value: '45HIGH', label: '45 Dry High' },
];


export default function ScrapeFormModal({ prefill, onClose, onResult }) {
  const [form, setForm] = useState({
    from_port: prefill?.from_port || '',
    to_port: prefill?.to_port || '',
    origin_inland: prefill?.origin_inland || 'CY',
    destination_inland: prefill?.destination_inland || 'CY',
    container_type: prefill?.container_type || '40HIGH',
    number_of_containers: prefill?.number_of_containers || 1,
    weight_per_container: prefill?.weight_per_container || '',
    weight_unit: prefill?.weight_unit || 'kg',
    commodity: 'Wastepaper',
    price_owner: prefill?.price_owner || 'self',
    ship_date: prefill?.ship_date || '',
  });

  const [loading, setLoading] = useState(false);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState(null);
  const [validation, setValidation] = useState({});

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    if (validation[name]) {
      setValidation((prev) => ({ ...prev, [name]: null }));
    }
  };

  const validate = () => {
    const errs = {};
    if (!form.from_port.trim()) errs.from_port = 'Origin city/port is required';
    if (!form.to_port.trim()) errs.to_port = 'Destination city/port is required';
    if (!form.container_type) errs.container_type = 'Container type is required';
    if (!form.number_of_containers || form.number_of_containers < 1) errs.number_of_containers = 'At least 1 container';
    if (!form.weight_per_container || parseFloat(form.weight_per_container) <= 0) errs.weight_per_container = 'Cargo weight is required';
    if (!form.price_owner) errs.price_owner = 'Price owner is required';
    setValidation(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    setError(null);

    try {
      const payload = {
        ...form,
        number_of_containers: parseInt(form.number_of_containers) || 1,
        weight_per_container: form.weight_per_container ? parseFloat(form.weight_per_container) : undefined,
        weight_unit: form.weight_unit || 'kg',
      };
      const result = await triggerScrape(payload);
      if (result && result.status === 'STARTED' && result.job_id) {
        setPolling(true);
        // Poll for job status
        let pollCount = 0;
        const poll = async () => {
          try {
            const job = await getScrapeJob(result.job_id);
            if (job.status === 'SUCCESS' || job.status === 'FAILED') {
              setPolling(false);
              onResult({ ...job, formData: payload });
            } else if (pollCount < 60) { // up to 5 min
              pollCount++;
              setTimeout(poll, 5000);
            } else {
              setPolling(false);
              setError('Timed out waiting for Maersk rates. Please try again later.');
            }
          } catch (err) {
            setPolling(false);
            setError('Error fetching job status.');
          }
        };
        poll();
      } else {
        // If backend returned a structured no-results or failed status, show it in the results modal
        onResult({ ...result, formData: payload });
      }
    } catch (err) {
      const msg = err.response?.data?.message || err.message || '';
      const status = err.response?.data?.status;
      if (err.response?.data && (status === 'NO_RESULTS' || status === 'FAILED')) {
        onResult({ ...err.response.data, formData: form });
        return;
      }
      if (err.code === 'ECONNABORTED' || msg.includes('timeout')) {
        setError('Request timed out. The server may be busy — please try again in a moment.');
      } else if (err.response?.status >= 500) {
        setError('We\'re having trouble connecting to Maersk right now. Please try again in a few minutes.');
      } else {
        setError(msg || 'Unable to fetch rates. Please try again later.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal maersk-form-modal">
        <div className="modal-header">
          <h2>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#42b0d5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
              <path d="M16 3h-8l-2 4h12l-2-4z"/>
              <line x1="12" y1="11" x2="12" y2="17"/>
              <line x1="9" y1="14" x2="15" y2="14"/>
            </svg>
            Get Maersk Spot Rate
          </h2>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="status-banner error">⚠ {error}</div>}
            {polling && (
              <div className="status-banner info">
                <span className="spinner spinner-dark" style={{ width: 18, height: 18, marginRight: 8 }}></span>
                Fetching live rates from Maersk... This may take up to 2-3 minutes.<br/>
                Please do not close this window.
              </div>
            )}

            {/* ── Section 1: Location Details ── */}
            <div className="form-section">
              <h3 className="section-title">Location details</h3>

              <div className="form-grid">
                <div className="form-group">
                  <label>From (City, Country/Region) <span className="required">*</span></label>
                  <div className={`input-with-icon ${validation.from_port ? 'input-error' : ''}`}>
                    <span className="input-icon">📍</span>
                    <input
                      name="from_port"
                      value={form.from_port}
                      onChange={handleChange}
                      placeholder="Enter city or port"
                      required
                      readOnly={!!prefill?.from_port}
                    />
                  </div>
                  {validation.from_port && <span className="field-error">{validation.from_port}</span>}
                </div>

                <div className="form-group">
                  <label>To (City, Country/Region) <span className="required">*</span></label>
                  <div className={`input-with-icon ${validation.to_port ? 'input-error' : ''}`}>
                    <span className="input-icon">📍</span>
                    <input
                      name="to_port"
                      value={form.to_port}
                      onChange={handleChange}
                      placeholder="Enter city or port"
                      required
                      readOnly={!!prefill?.to_port}
                    />
                  </div>
                  {validation.to_port && <span className="field-error">{validation.to_port}</span>}
                </div>
              </div>

              {/* Inland Transportation */}
              <div className="form-grid" style={{ marginTop: 16 }}>
                <div className="form-group">
                  <label className="sub-label">Inland transportation</label>
                  <div className="radio-group">
                    <label className={`radio-card ${form.origin_inland === 'CY' ? 'active' : ''}`}>
                      <input type="radio" name="origin_inland" value="CY" checked={form.origin_inland === 'CY'} onChange={handleChange} />
                      <span className="radio-badge">CY</span>
                      <span className="radio-text">I will arrange to deliver the container to the port/inland location</span>
                    </label>
                    <label className={`radio-card ${form.origin_inland === 'SD' ? 'active' : ''}`}>
                      <input type="radio" name="origin_inland" value="SD" checked={form.origin_inland === 'SD'} onChange={handleChange} />
                      <span className="radio-badge radio-badge-alt">SD</span>
                      <span className="radio-text">I want Maersk to pick up the container at my facility</span>
                    </label>
                  </div>
                </div>

                <div className="form-group">
                  <label className="sub-label">Inland transportation</label>
                  <div className="radio-group">
                    <label className={`radio-card ${form.destination_inland === 'CY' ? 'active' : ''}`}>
                      <input type="radio" name="destination_inland" value="CY" checked={form.destination_inland === 'CY'} onChange={handleChange} />
                      <span className="radio-badge">CY</span>
                      <span className="radio-text">I will arrange for pick up of the container from the port/inland location</span>
                    </label>
                    <label className={`radio-card ${form.destination_inland === 'SD' ? 'active' : ''}`}>
                      <input type="radio" name="destination_inland" value="SD" checked={form.destination_inland === 'SD'} onChange={handleChange} />
                      <span className="radio-badge radio-badge-alt">SD</span>
                      <span className="radio-text">I want Maersk to deliver the container at my facility</span>
                    </label>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Section 2: Commodity (fixed) ── */}
            <div className="form-section">
              <h3 className="section-title">Commodity</h3>
              <div className="form-group">
                <div className="commodity-fixed">
                  <span className="commodity-icon">📦</span>
                  <span className="commodity-value">Wastepaper</span>
                  <span className="commodity-badge">Fixed</span>
                </div>
              </div>
            </div>

            {/* ── Section 3: How will your cargo be shipped? ── */}
            <div className="form-section">
              <h3 className="section-title">How will your cargo be shipped?</h3>

              <div className="form-grid form-grid-3">
                <div className="form-group">
                  <label>Container type and size <span className="required">*</span></label>
                  <select
                    name="container_type"
                    value={form.container_type}
                    onChange={handleChange}
                    className={validation.container_type ? 'input-error' : ''}
                    required
                  >
                    <option value="">Select container type and size</option>
                    {CONTAINER_TYPES.map((ct) => (
                      <option key={ct.value} value={ct.value}>{ct.label}</option>
                    ))}
                  </select>
                  {validation.container_type && <span className="field-error">{validation.container_type}</span>}
                </div>

                <div className="form-group">
                  <label>Number of containers <span className="required">*</span></label>
                  <div className="qty-control">
                    <button type="button" className="qty-btn" onClick={() => setForm(p => ({ ...p, number_of_containers: Math.max(1, (parseInt(p.number_of_containers) || 1) - 1) }))}>−</button>
                    <input
                      name="number_of_containers"
                      type="number"
                      min="1"
                      max="999"
                      value={form.number_of_containers}
                      onChange={handleChange}
                      className="qty-input"
                      required
                    />
                    <button type="button" className="qty-btn" onClick={() => setForm(p => ({ ...p, number_of_containers: Math.min(999, (parseInt(p.number_of_containers) || 1) + 1) }))}>+</button>
                  </div>
                  {validation.number_of_containers && <span className="field-error">{validation.number_of_containers}</span>}
                </div>

                <div className="form-group">
                  <label>Cargo weight per container <span className="required">*</span></label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div className={`input-with-suffix ${validation.weight_per_container ? 'input-error' : ''}`} style={{ flex: 1 }}>
                      <input
                        name="weight_per_container"
                        type="number"
                        step="0.01"
                        min="1"
                        value={form.weight_per_container}
                        onChange={handleChange}
                        placeholder="Enter cargo weight"
                        required
                      />
                    </div>
                    <select
                      name="weight_unit"
                      value={form.weight_unit}
                      onChange={handleChange}
                      style={{ minWidth: 60, height: 36 }}
                    >
                      <option value="kg">kg</option>
                      <option value="lb">lb</option>
                    </select>
                  </div>
                  {validation.weight_per_container && <span className="field-error">{validation.weight_per_container}</span>}
                </div>
              </div>
            </div>

            {/* ── Section 4: Who is the Price Owner? ── */}
            <div className="form-section">
              <h3 className="section-title">Who is the Price Owner?</h3>
              <div className="radio-group-simple">
                <label className={`radio-simple ${form.price_owner === 'self' ? 'active' : ''}`}>
                  <input type="radio" name="price_owner" value="self" checked={form.price_owner === 'self'} onChange={handleChange} />
                  I am the price owner
                </label>
                <label className={`radio-simple ${form.price_owner === 'other' ? 'active' : ''}`}>
                  <input type="radio" name="price_owner" value="other" checked={form.price_owner === 'other'} onChange={handleChange} />
                  Select a price owner
                </label>
              </div>
              {validation.price_owner && <span className="field-error">{validation.price_owner}</span>}
            </div>

            {/* ── Section 5: When is your cargo ready to ship? ── */}
            <div className="form-section">
              <h3 className="section-title">When is your cargo ready to ship?</h3>
              <p className="section-subtitle">Optional — leave empty to skip</p>

              <div className="form-group" style={{ maxWidth: 280 }}>
                <label>Departure date</label>
                <input
                  name="ship_date"
                  type="date"
                  value={form.ship_date}
                  onChange={handleChange}
                  placeholder="Optional"
                  min={new Date().toISOString().split('T')[0]}
                />
                <span style={{ fontSize: 11, color: '#94a3b8', marginTop: 4, display: 'block' }}>
                  Optional — not required for getting rates
                </span>
              </div>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn-cancel" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-submit" disabled={loading}>
              {loading ? (
                <>
                  <span className="spinner"></span>
                  Fetching Rates...
                </>
              ) : (
                'Search'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
