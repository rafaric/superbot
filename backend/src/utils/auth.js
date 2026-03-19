import crypto from 'crypto';

/**
 * Generates HMAC-SHA256 signature for BingX API.
 *
 * BingX signing rules (swap v2):
 * - All params joined as key=value&key=value (NO alphabetical sort required)
 * - timestamp must be included BEFORE signing
 * - Signature appended at the end of the query string
 */
export function buildAuthQuery(params, apiSecret) {
  const timestamp = Date.now();

  // Build query string preserving insertion order, timestamp last
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${v}`);

  entries.push(`timestamp=${timestamp}`);

  const queryString = entries.join('&');

  const signature = crypto
    .createHmac('sha256', apiSecret)
    .update(queryString)
    .digest('hex');

  return `${queryString}&signature=${signature}`;
}

// Keep legacy export for any callers that use generateSignature directly
export function generateSignature(params, apiSecret) {
  const qs = Object.entries(params)
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const signature = crypto
    .createHmac('sha256', apiSecret)
    .update(qs)
    .digest('hex');
  return { queryString: qs, signature };
}
