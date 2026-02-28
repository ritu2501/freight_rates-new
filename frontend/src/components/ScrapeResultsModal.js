import React, { useState } from 'react';
import { acceptRate } from '../api';

const CONTAINER_LABELS = {
  '20FT': '20 Dry Standard',
  '40FT': '40 Dry Standard',
  '40HC': '40 High Cube Dry',
  '45FT': '45 High Cube Dry',
};

function formatDateCard(dateStr) {
  if (!dateStr) return { day: '--', month: '---' };
  const d = new Date(dateStr + 'T00:00:00');
  const day = String(d.getDate()).padStart(2, '0');
  const month = d.toLocaleString('en', { month: 'short' }).toUpperCase();
  return { day, month };
}

function splitPrice(val) {
  if (val == null) return { whole: '0', cents: '00' };
  const parts = val.toFixed(2).split('.');
  return {
    whole: Number(parts[0]).toLocaleString('en-US'),
    cents: parts[1],
  };
}

export default function ScrapeResultsModal({ result, onClose, onAccepted }) {
  const [acceptingIdx, setAcceptingIdx] = useState(null);
  const [accepted, setAccepted] = useState(null);
  const [expandedIdx, setExpandedIdx] = useState(null);

  if (!result) return null;

  const { candidates, job_id, status, auto_accepted, simulated, elapsed_ms, formData } = result;

  const shipDate = formData?.ship_date;
  const containerType = formData?.container_type || '40HC';
  const numContainers = formData?.number_of_containers || 1;
  const containerLabel = CONTAINER_LABELS[containerType] || containerType;

  const handleAccept = async (idx) => {
    setAcceptingIdx(idx);
    try {
      const resp = await acceptRate({ job_id, candidate_index: idx, actor: 'agent' });
      setAccepted({ idx, pricing_id: resp.pricing_id });
      if (onAccepted) onAccepted(resp);
    } catch (err) {
      alert('Failed to accept rate: ' + (err.response?.data?.message || err.message));
    } finally {
      setAcceptingIdx(null);
    }
  };

  const toggleDetails = (idx) => {
    setExpandedIdx(expandedIdx === idx ? null : idx);
  };

  const fmtPrice = (v) => v != null ? v.toFixed(2) : '-';

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 640 }}>
        <div className="modal-header">
          <h2>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#0ea5e9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22,12 18,12 15,21 9,3 6,12 2,12" />
            </svg>
            Maersk Spot Rates
          </h2>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {/* Status banners */}
          {status === 'SUCCESS' && auto_accepted && (
            <div className="status-banner success">
              ✓ Rate auto-accepted with high confidence and saved to pricing database.
            </div>
          )}
          {status === 'PENDING_MANUAL_REVIEW' && (
            <div className="status-banner pending">
              ⏳ Results require review. Select a rate to accept or forward to Ops.
            </div>
          )}
          {status === 'FAILED' && result.reason_code === 'RATE_LIMITED' && (
            <div className="status-banner error">
              ⚠ <b>Rate-limited:</b> Maersk is currently limiting login attempts.
              Please wait about 2 minutes before trying again.
            </div>
          )}
          {status === 'FAILED' && result.reason_code === 'ANTI_BOT_DETECTED' && (
            <div className="status-banner error">
              🛡️ <b>Security Block:</b> Maersk's anti-bot system is active.
              The system will automatically retry with a different profile in a moment.
            </div>
          )}
          {status === 'FAILED' && !['RATE_LIMITED', 'ANTI_BOT_DETECTED'].includes(result.reason_code) && (
            <div className="status-banner error">
              ✕ <b>Something went wrong:</b> {result.error || 'The scraper encountered an unexpected error.'}
            </div>
          )}
          {status === 'NO_RESULTS' && (
            <div className="no-price-found">
              <div className="no-price-icon">🔍</div>
              <h3 className="no-price-title">No prices found</h3>
              <p className="no-price-text">
                We couldn't find any Maersk spot rates for this route at the moment.
                This could be because the route is not currently available or rates
                haven't been published yet.
              </p>
              <p className="no-price-text" style={{ marginTop: 8 }}>
                Please try again later or contact the operations team for assistance.
              </p>
            </div>
          )}

          {simulated && (
            <div className="status-banner info" style={{ marginBottom: 12 }}>
              ℹ Simulated result (demo mode). Connect Maersk credentials for live data.
              <span style={{ marginLeft: 'auto', fontSize: 12, opacity: 0.7 }}>
                {elapsed_ms}ms
              </span>
            </div>
          )}

          {accepted && (
            <div className="status-banner success">
              ✓ Rate #{accepted.idx + 1} accepted and saved (ID: {accepted.pricing_id}). Refreshing table...
            </div>
          )}

          {/* Maersk-style rate cards */}
          <div className="maersk-results">
            {(!candidates || candidates.length === 0) && status !== 'NO_RESULTS' && status !== 'FAILED' && (
              <div className="no-price-found">
                <div className="no-price-icon">📭</div>
                <h3 className="no-price-title">No prices available</h3>
                <p className="no-price-text">
                  We searched Maersk but couldn't find any pricing for this route.
                  Please try a different route or check back later.
                </p>
              </div>
            )}

            {candidates && candidates.map((c, idx) => {
              // Use each candidate's own departure date; fall back to form ship_date
              const dateInfo = formatDateCard(c.departure_date || shipDate);
              const { whole, cents } = splitPrice(c.total_price || c.price);
              const isExpanded = expandedIdx === idx;

              return (
                <div className="maersk-rate-card" key={idx}>
                  {/* Main row: date | price info */}
                  <div className="maersk-rate-row">
                    <div className="maersk-date-block">
                      <span className="maersk-date-day">{dateInfo.day}</span>
                      <span className="maersk-date-month">{dateInfo.month}</span>
                    </div>
                    <div className="maersk-rate-info">
                      <div className="maersk-price-line">
                        <span className="maersk-price-whole">{whole}</span>
                        <span className="maersk-price-currency">{c.currency || 'USD'}</span>
                        <span className="maersk-price-cents">{cents}</span>
                      </div>
                      <div className="maersk-rate-desc">
                        All-inclusive, {c.service_type || 'Maersk Spot'}
                      </div>
                      <div className="maersk-rate-container">
                        {numContainers} x &nbsp; {containerLabel}
                      </div>
                      <button
                        className="maersk-details-btn"
                        onClick={() => toggleDetails(idx)}
                      >
                        Price details
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          {isExpanded
                            ? <polyline points="18 15 12 9 6 15" />
                            : <><path d="M7 17L17 7" /><polyline points="7 7 17 7 17 17" /></>
                          }
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* Expandable price details */}
                  {isExpanded && (
                    <div className="maersk-details-panel">
                      <table className="maersk-breakdown-table">
                        <tbody>
                          {c.origin_local_haulage != null && c.origin_local_haulage > 0 && (
                            <tr>
                              <td className="bd-label">Origin Haulage</td>
                              <td className="bd-value">{c.currency} {fmtPrice(c.origin_local_haulage)}</td>
                            </tr>
                          )}
                          {c.origin_thc != null && c.origin_thc > 0 && (
                            <tr>
                              <td className="bd-label">Origin THC</td>
                              <td className="bd-value">{c.currency} {fmtPrice(c.origin_thc)}</td>
                            </tr>
                          )}
                          {c.customs != null && c.customs > 0 && (
                            <tr>
                              <td className="bd-label">Customs</td>
                              <td className="bd-value">{c.currency} {fmtPrice(c.customs)}</td>
                            </tr>
                          )}
                          {c.origin_misc != null && c.origin_misc > 0 && (
                            <tr>
                              <td className="bd-label">Origin Miscellaneous</td>
                              <td className="bd-value">{c.currency} {fmtPrice(c.origin_misc)}</td>
                            </tr>
                          )}
                          <tr>
                            <td className="bd-label">Ocean Freight</td>
                            <td className="bd-value">{c.currency} {fmtPrice(c.ocean_freight || c.price)}</td>
                          </tr>
                          {c.destination_thc != null && c.destination_thc > 0 && (
                            <tr>
                              <td className="bd-label">Destination THC</td>
                              <td className="bd-value">{c.currency} {fmtPrice(c.destination_thc)}</td>
                            </tr>
                          )}
                          {c.destination_haulage != null && c.destination_haulage > 0 && (
                            <tr>
                              <td className="bd-label">Destination Haulage</td>
                              <td className="bd-value">{c.currency} {fmtPrice(c.destination_haulage)}</td>
                            </tr>
                          )}
                          {c.destination_misc != null && c.destination_misc > 0 && (
                            <tr>
                              <td className="bd-label">Destination Miscellaneous</td>
                              <td className="bd-value">{c.currency} {fmtPrice(c.destination_misc)}</td>
                            </tr>
                          )}
                        </tbody>
                        <tfoot>
                          <tr className="bd-total">
                            <td className="bd-label">Total</td>
                            <td className="bd-value">{c.currency} {fmtPrice(c.total_price || c.price)}</td>
                          </tr>
                        </tfoot>
                      </table>

                      {c.transit_days && (
                        <div className="maersk-transit">
                          Transit time: <strong>{c.transit_days} days</strong>
                        </div>
                      )}
                      {c.valid_until && (
                        <div className="maersk-valid-until">
                          Valid until: <strong>{new Date(c.valid_until).toLocaleDateString()}</strong>
                        </div>
                      )}

                      {/* Accept button */}
                      <div className="maersk-accept-row">
                        {accepted?.idx === idx ? (
                          <span style={{ color: '#16a34a', fontWeight: 600, fontSize: 13 }}>✓ Accepted</span>
                        ) : (
                          <button
                            className="btn-accept"
                            onClick={() => handleAccept(idx)}
                            disabled={acceptingIdx !== null || accepted !== null}
                          >
                            {acceptingIdx === idx ? (
                              <><span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }}></span> Saving...</>
                            ) : (
                              'Accept & Save to Pricing'
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn-cancel" onClick={onClose}>
            {accepted ? 'Done' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
}
