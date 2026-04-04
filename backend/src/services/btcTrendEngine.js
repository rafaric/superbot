/**
 * BTC Trend Engine — Fase 1 (PRD v2 §3)
 *
 * Calcula el régimen macro del mercado usando BTC-USDT en 1H.
 * Recalcula al cierre de cada vela 1H (scheduler interno).
 *
 * Régimen posible: 'bullish' | 'bearish' | 'lateral'
 *
 * Reglas (PRD §3.1.4):
 *   Bullish  → price > EMA50 AND EMA50 > EMA200 AND slope > 0
 *   Bearish  → price < EMA50 AND EMA50 < EMA200 AND slope < 0
 *   Lateral  → todo lo demás (EMA50 ≈ EMA200, slope ≈ 0, ATR bajo)
 */

import { getKlines } from './bingx.js';
import { calculateEMA, calculateATR, getEMASlope } from './indicators.js';

// ─── Config ───────────────────────────────────────────────────────────────────

const BTC_SYMBOL   = 'BTC-USDT';
const INTERVAL_1H  = '1h';
const CANDLES_NEEDED = 300; // PRD §3.1.3

// Thresholds (tunable via env)
const SLOPE_THRESHOLD = parseFloat(process.env.BTC_SLOPE_THRESHOLD ?? 0.001); // 0.1%
const ATR_LATERAL_MAX = parseFloat(process.env.BTC_ATR_LATERAL_MAX ?? 1.5);   // ATR% < 1.5% = baja volatilidad

// Recalculation interval: top of every hour + small buffer (ms)
const RECALC_INTERVAL_MS = 60 * 60 * 1000; // 1h

// ─── State ────────────────────────────────────────────────────────────────────

/** @type {{ regime: 'bullish'|'bearish'|'lateral', ema50: number, ema200: number, slope: number, atrPct: number, price: number, updatedAt: number } | null} */
let currentState = null;
let schedulerTimer = null;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the current BTC regime.
 * @returns {'bullish'|'bearish'|'lateral'|null}  null = not yet calculated
 */
export function getBTCRegime() {
  return currentState?.regime ?? null;
}

/**
 * Returns the full trend state snapshot.
 */
export function getBTCTrendState() {
  return currentState;
}

/**
 * Forces an immediate recalculation (useful on startup or for testing).
 */
export async function recalcBTCTrend() {
  try {
    const candles = await getKlines({ symbol: BTC_SYMBOL, interval: INTERVAL_1H, limit: CANDLES_NEEDED });

    if (candles.length < 201) {
      console.warn('[BtcTrendEngine] Not enough candles to calculate EMA200 — need 200+, got', candles.length);
      return null;
    }

    const ema50Series  = calculateEMA(candles, 50);
    const ema200Series = calculateEMA(candles, 200);
    const atrSeries    = calculateATR(candles, 14);

    if (!ema50Series.length || !ema200Series.length) {
      console.warn('[BtcTrendEngine] EMA calculation returned empty series');
      return null;
    }

    const ema50  = ema50Series[ema50Series.length - 1].value;
    const ema200 = ema200Series[ema200Series.length - 1].value;
    const price  = candles[candles.length - 1].close;

    // Normalized slope over last 3 bars
    const slope  = getEMASlope(ema50Series, 3) ?? 0;

    // ATR% for lateral detection
    const lastATR = atrSeries.length ? atrSeries[atrSeries.length - 1].value : 0;
    const atrPct  = price > 0 ? (lastATR / price) * 100 : 0;

    const regime = determineRegime({ price, ema50, ema200, slope, atrPct });

    currentState = { regime, ema50, ema200, slope, atrPct, price, updatedAt: Date.now() };

    console.log(
      `[BtcTrendEngine] Regime: ${regime.toUpperCase()} | BTC: ${price.toFixed(2)} | EMA50: ${ema50.toFixed(2)} | EMA200: ${ema200.toFixed(2)} | Slope: ${(slope * 100).toFixed(3)}% | ATR%: ${atrPct.toFixed(2)}%`
    );

    return currentState;
  } catch (err) {
    console.error('[BtcTrendEngine] Error calculating trend:', err.message);
    return null;
  }
}

/**
 * Starts the hourly scheduler.
 * Calculates immediately, then recalculates at the top of every hour.
 */
export async function startBTCTrendEngine() {
  if (schedulerTimer) return; // already running

  // Initial calculation
  await recalcBTCTrend();

  // Schedule next recalc at the top of the next hour
  scheduleNext();
}

/**
 * Stops the hourly scheduler.
 */
export function stopBTCTrendEngine() {
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
  }
}

// ─── Internals ────────────────────────────────────────────────────────────────

/**
 * Determines market regime based on PRD rules.
 *
 * @param {{ price: number, ema50: number, ema200: number, slope: number, atrPct: number }}
 * @returns {'bullish'|'bearish'|'lateral'}
 */
function determineRegime({ price, ema50, ema200, slope, atrPct }) {
  const isBullish =
    price > ema50 &&
    ema50  > ema200 &&
    slope  > SLOPE_THRESHOLD;

  const isBearish =
    price < ema50 &&
    ema50  < ema200 &&
    slope  < -SLOPE_THRESHOLD;

  if (isBullish) return 'bullish';
  if (isBearish) return 'bearish';
  return 'lateral';
}

/**
 * Schedules the next recalculation at the top of the hour + 5s buffer.
 * Uses setTimeout (not setInterval) to avoid drift.
 */
function scheduleNext() {
  const now     = Date.now();
  const nextHour = new Date(now);
  nextHour.setMinutes(0, 5, 0);          // :00:05 — 5s after the top of the hour
  nextHour.setHours(nextHour.getHours() + 1);

  const msUntilNext = nextHour.getTime() - now;
  console.log(`[BtcTrendEngine] Next recalculation in ${Math.round(msUntilNext / 1000 / 60)} min`);

  schedulerTimer = setTimeout(async () => {
    await recalcBTCTrend();
    scheduleNext(); // reschedule
  }, msUntilNext);
}
