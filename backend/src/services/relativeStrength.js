/**
 * Relative Strength (RS) Calculator — Fase 2 (PRD v2 §5.3)
 *
 * Calculates the relative strength of an altcoin vs BTC.
 * RS = altReturn / btcReturn
 *
 * Interpretation:
 *   RS > 2   → Strong (outperforming BTC significantly)
 *   RS < 0.5 → Weak (underperforming BTC significantly)
 *
 * Used in Rotation Mode to filter altcoins that are stronger than BTC
 * when BTC itself is moving sideways.
 */

import { getKlines } from './bingx.js';

// ─── Config ───────────────────────────────────────────────────────────────────

const RS_STRONG_MIN = parseFloat(process.env.RS_STRONG_MIN ?? 2);
const RS_WEAK_MAX   = parseFloat(process.env.RS_WEAK_MAX ?? 0.5);
const RS_LOOKBACK   = parseInt(process.env.RS_LOOKBACK ?? 24); // 24 candles (1h interval = 24h)

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Calculate relative strength of a symbol vs BTC.
 *
 * @param {{ symbol: string, btcCandles1h: Array }} options
 *   - symbol: The altcoin to evaluate (e.g. "ETH-USDT")
 *   - btcCandles1h: Pre-loaded BTC 1h candles to avoid double requests
 *
 * @returns {Promise<{ symbol: string, rs: number, altReturn: number, btcReturn: number, strong: boolean, weak: boolean } | null>}
 */
export async function calculateRS({ symbol, btcCandles1h }) {
  try {
    // Validate BTC candles
    if (!btcCandles1h || btcCandles1h.length < RS_LOOKBACK + 1) {
      console.warn(`[RelativeStrength] Not enough BTC candles (need ${RS_LOOKBACK + 1}, got ${btcCandles1h?.length ?? 0})`);
      return null;
    }

    // Fetch altcoin 1h candles
    const altCandles = await getKlines({ symbol, interval: '1h', limit: RS_LOOKBACK + 10 });

    if (altCandles.length < RS_LOOKBACK + 1) {
      console.warn(`[RelativeStrength] Not enough ${symbol} candles (need ${RS_LOOKBACK + 1}, got ${altCandles.length})`);
      return null;
    }

    // Calculate returns over the lookback period
    const btcReturn = calculateReturn(btcCandles1h, RS_LOOKBACK);
    const altReturn = calculateReturn(altCandles, RS_LOOKBACK);

    if (btcReturn === null || altReturn === null) {
      return null;
    }

    // RS formula: altReturn / btcReturn
    // Handle edge cases:
    // - If BTC return is 0 or very small, RS would be infinity/huge — treat as neutral
    // - If both returns are near 0, RS is meaningless
    let rs;
    const BTC_RETURN_MIN = 0.001; // 0.1% minimum movement to calculate meaningful RS

    if (Math.abs(btcReturn) < BTC_RETURN_MIN) {
      // BTC barely moved — use altReturn directly as relative performance indicator
      // Positive altReturn with flat BTC = strong
      rs = altReturn > 0 ? RS_STRONG_MIN + altReturn : RS_WEAK_MAX;
    } else {
      rs = altReturn / btcReturn;

      // If BTC went down and alt went up, RS should be positive
      // If BTC went down and alt went down less, RS > 1 (outperforming in a bear market)
      // The formula naturally handles this:
      // - BTC -5%, ALT -2% → RS = -0.02 / -0.05 = 0.4 (weak relative to BTC decline)
      // - BTC -5%, ALT +3% → RS = 0.03 / -0.05 = -0.6 (strong counter-trend move)

      // For rotation mode, we want assets that move UP when BTC is flat
      // So we actually want positive altReturn regardless of BTC direction
      // Let's simplify: in lateral BTC, we care about absolute altcoin strength
      if (btcReturn < 0 && altReturn > 0) {
        // Alt going up while BTC going down = very strong
        rs = RS_STRONG_MIN + Math.abs(rs);
      }
    }

    const strong = rs > RS_STRONG_MIN;
    const weak = rs < RS_WEAK_MAX;

    return {
      symbol,
      rs,
      altReturn,
      btcReturn,
      strong,
      weak,
    };
  } catch (err) {
    console.error(`[RelativeStrength] Error calculating RS for ${symbol}:`, err.message);
    return null;
  }
}

// ─── Internals ────────────────────────────────────────────────────────────────

/**
 * Calculate simple return over N candles.
 * return = (current_price - price_N_candles_ago) / price_N_candles_ago
 *
 * @param {Array} candles - OHLC candles (chronological order)
 * @param {number} lookback - Number of candles back
 * @returns {number|null} - Decimal return (0.05 = 5%)
 */
function calculateReturn(candles, lookback) {
  if (candles.length < lookback + 1) return null;

  const currentPrice = candles[candles.length - 1].close;
  const pastPrice = candles[candles.length - 1 - lookback].close;

  if (pastPrice <= 0) return null;

  return (currentPrice - pastPrice) / pastPrice;
}
