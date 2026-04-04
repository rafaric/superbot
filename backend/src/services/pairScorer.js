/**
 * Pair Scorer — PRD v2.1
 *
 * Computes a composite score for ranking trading pairs based on:
 *   - Relative momentum (40%)
 *   - Volume expansion (25%)
 *   - Breakout strength (20%)
 *   - Trend alignment (15%)
 */

import { calculateEMA, calculateATR } from './indicators.js';

// Score weights
const WEIGHT_MOMENTUM  = 0.40;
const WEIGHT_VOLUME    = 0.25;
const WEIGHT_BREAKOUT  = 0.20;
const WEIGHT_ALIGNMENT = 0.15;

// Minimum score to consider a pair actionable
export const SCORE_THRESHOLD = 0.65;

/**
 * Compute 6H return from candles.
 * Assumes 15m candles → 24 candles = 6H
 * @param {Array} candles
 * @returns {number} Return as percentage (e.g., 2.5 = +2.5%)
 */
function get6HReturn(candles) {
  // For 15m candles: 6H = 24 candles
  // For 1H candles: 6H = 6 candles
  // Adaptive: use time difference to calculate how many candles = 6H
  if (candles.length < 2) return 0;

  const lastCandle = candles[candles.length - 1];
  const firstCandle = candles[0];

  // Time per candle in seconds (approximate from first two candles)
  const candleIntervalSec = candles.length >= 2
    ? candles[1].time - candles[0].time
    : 900; // default 15m

  const sixHoursInSec = 6 * 60 * 60;
  const candlesFor6H = Math.floor(sixHoursInSec / candleIntervalSec);

  // Get the candle ~6H ago
  const idx6HAgo = Math.max(0, candles.length - 1 - candlesFor6H);
  const candle6HAgo = candles[idx6HAgo];

  if (!candle6HAgo || candle6HAgo.close === 0) return 0;

  return ((lastCandle.close - candle6HAgo.close) / candle6HAgo.close) * 100;
}

/**
 * Compute volume expansion ratio.
 * Volume expansion = current volume / SMA20 volume
 * @param {Array} candles
 * @returns {number}
 */
function getVolumeExpansion(candles) {
  if (candles.length < 21) return 1;

  const last20 = candles.slice(-21, -1); // last 20 candles excluding current
  const avgVol = last20.reduce((sum, c) => sum + c.volume, 0) / last20.length;
  const currentVol = candles[candles.length - 1].volume;

  return avgVol > 0 ? currentVol / avgVol : 1;
}

/**
 * Compute breakout strength.
 * breakoutStrength = max(0, (close - maxHigh20) / ATR)
 * @param {Array} candles
 * @returns {number}
 */
function getBreakoutStrength(candles) {
  if (candles.length < 21) return 0;

  const atrSeries = calculateATR(candles, 14);
  if (!atrSeries.length) return 0;

  const atr = atrSeries[atrSeries.length - 1].value;
  if (atr === 0) return 0;

  // Max high of last 20 candles (excluding current)
  const last20 = candles.slice(-21, -1);
  const maxHigh20 = Math.max(...last20.map((c) => c.high));

  const close = candles[candles.length - 1].close;

  return Math.max(0, (close - maxHigh20) / atr);
}

/**
 * Compute trend alignment.
 * EMA20 > EMA50 → 1, else → 0
 * @param {Array} candles
 * @returns {number}
 */
function getTrendAlignment(candles) {
  const ema20Series = calculateEMA(candles, 20);
  const ema50Series = calculateEMA(candles, 50);

  if (!ema20Series.length || !ema50Series.length) return 0;

  const ema20 = ema20Series[ema20Series.length - 1].value;
  const ema50 = ema50Series[ema50Series.length - 1].value;

  return ema20 > ema50 ? 1 : 0;
}

/**
 * Normalize a raw value to 0-1 range with soft clamping.
 * Uses tanh for smooth normalization.
 * @param {number} value
 * @param {number} scale - Expected typical max value
 */
function normalize(value, scale) {
  return Math.tanh(value / scale);
}

/**
 * Score a trading pair based on momentum, volume, breakout, and trend.
 *
 * @param {Array} pairCandles - Candles for the trading pair
 * @param {Array} btcCandles - Candles for BTC (same timeframe)
 * @returns {{ score: number, relativeMomentum: number, volumeExpansion: number, breakoutStrength: number, trendAlignment: number }}
 */
export function scorePair(pairCandles, btcCandles) {
  // Raw metrics
  const pairReturn = get6HReturn(pairCandles);
  const btcReturn = get6HReturn(btcCandles);
  const relativeMomentum = pairReturn - btcReturn;

  const volumeExpansion = getVolumeExpansion(pairCandles);
  const breakoutStrength = getBreakoutStrength(pairCandles);
  const trendAlignment = getTrendAlignment(pairCandles);

  // Normalize raw values to 0-1 range for scoring
  const normMomentum  = normalize(relativeMomentum, 5);   // ±5% is strong
  const normVolume    = normalize(volumeExpansion - 1, 2); // 3x volume is strong
  const normBreakout  = normalize(breakoutStrength, 2);    // 2 ATR breakout is strong
  const normAlignment = trendAlignment;                     // Already 0 or 1

  // Weighted score
  const score =
    (normMomentum * WEIGHT_MOMENTUM) +
    (normVolume * WEIGHT_VOLUME) +
    (normBreakout * WEIGHT_BREAKOUT) +
    (normAlignment * WEIGHT_ALIGNMENT);

  // Clamp to 0-1
  const finalScore = Math.max(0, Math.min(1, score));

  return {
    score: parseFloat(finalScore.toFixed(4)),
    relativeMomentum: parseFloat(relativeMomentum.toFixed(4)),
    volumeExpansion: parseFloat(volumeExpansion.toFixed(4)),
    breakoutStrength: parseFloat(breakoutStrength.toFixed(4)),
    trendAlignment,
  };
}
