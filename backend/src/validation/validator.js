/**
 * Validation & Revenue-Protection module
 *
 * Validates scraped pricing results against business rules:
 * - Price > 0
 * - Valid ISO currency
 * - valid_until in the future
 * - Transit days within bounds
 * - Deviation check vs historical median (when baseline exists)
 */

const VALID_CURRENCIES = [
  'USD', 'EUR', 'GBP', 'CNY', 'JPY', 'KRW', 'SGD', 'AED',
  'INR', 'TRY', 'NGN', 'ZAR', 'BRL', 'CAD', 'AUD',
];

const DEFAULT_DEVIATION_PCT = 30;
const DEFAULT_BASELINE_SAMPLES = 5;
const DEFAULT_AUTO_ACCEPT = 0.8;
const DEFAULT_FLAG_REVIEW = 0.5;

/**
 * Validate a single price candidate
 * @param {Object} candidate - scraped price result
 * @param {Object} opts - validation context
 * @returns {{ valid: boolean, issues: string[], outcome: string }}
 */
function validateCandidate(candidate, opts = {}) {
  const issues = [];
  const historicalMedian = opts.historical_median;
  const baselineSamples = opts.baseline_samples || 0;
  const deviationPct = opts.deviation_pct || DEFAULT_DEVIATION_PCT;
  const minTransit = opts.min_transit_days || 1;
  const maxTransit = opts.max_transit_days || 90;

  // 1. Price > 0
  if (!candidate.price || candidate.price <= 0) {
    issues.push('PRICE_ZERO_OR_NEGATIVE');
  }

  // 2. Valid currency
  if (!candidate.currency || !VALID_CURRENCIES.includes(candidate.currency.toUpperCase())) {
    issues.push('CURRENCY_INVALID');
  }

  // 3. valid_until must be in the future
  if (candidate.valid_until) {
    const vu = new Date(candidate.valid_until);
    if (vu <= new Date()) {
      issues.push('VALID_UNTIL_PAST');
    }
  }

  // 4. Transit days within bounds
  if (candidate.transit_days != null) {
    if (candidate.transit_days < minTransit || candidate.transit_days > maxTransit) {
      issues.push('TRANSIT_DAYS_OUT_OF_RANGE');
    }
  }

  // 5. Deviation check
  if (historicalMedian && baselineSamples >= (opts.min_baseline || DEFAULT_BASELINE_SAMPLES)) {
    const deviation = Math.abs(candidate.price - historicalMedian) / historicalMedian * 100;
    if (deviation > deviationPct) {
      issues.push('DEVIATION_EXCEEDED');
    }
  }

  // Determine outcome
  const confidence = candidate.confidence_score || 0;
  let outcome;

  if (issues.length > 0) {
    outcome = confidence < DEFAULT_FLAG_REVIEW ? 'REJECT' : 'FLAG_REVIEW';
  } else if (confidence >= (opts.auto_accept_threshold || DEFAULT_AUTO_ACCEPT)) {
    outcome = 'AUTO_ACCEPT';
  } else if (confidence >= DEFAULT_FLAG_REVIEW) {
    outcome = 'FLAG_REVIEW';
  } else {
    outcome = 'REJECT';
  }

  return {
    valid: issues.length === 0,
    issues,
    outcome,
    confidence,
  };
}

/**
 * Validate an array of candidates and sort by outcome priority
 */
function validateCandidates(candidates, opts = {}) {
  return candidates
    .map((c) => ({
      ...c,
      validation: validateCandidate(c, opts),
    }))
    .sort((a, b) => {
      const order = { AUTO_ACCEPT: 0, FLAG_REVIEW: 1, REJECT: 2 };
      return (order[a.validation.outcome] || 9) - (order[b.validation.outcome] || 9);
    });
}

module.exports = { validateCandidate, validateCandidates };
