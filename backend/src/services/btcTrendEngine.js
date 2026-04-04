/**
 * BTC Trend Engine — PRD v2.1
 *
 * Calcula el régimen macro del mercado usando BTC-USDT en 1H.
 * Recalcula al cierre de cada vela 1H (scheduler interno).
 *
 * Régimen posible: 'TREND' | 'RANGE' | 'MIXED'
 *
 * Reglas (PRD v2.1):
 *   TREND → ADX > 22 AND distancia EMA% > 0.8% AND ATR actual > ATR avg20
 *   RANGE → ADX < 18 AND distancia EMA% < 0.4% AND ATR actual < ATR avg20
 *   MIXED → todo lo demás
 */

import { getKlines } from './bingx.js';
import { calculateEMA, calculateATR, calculateADX } from './indicators.js';

// ─── Config ───────────────────────────────────────────────────────────────────

const BTC_SYMBOL   = 'BTC-USDT';
const INTERVAL_1H  = '1h';
const CANDLES_NEEDED = 300; // PRD: need ~72 candles min, but 300 for EMA200 stability

// ADX thresholds (PRD v2.1)
const ADX_TREND_MIN = parseFloat(process.env.BTC_ADX_TREND_MIN ?? 22);
const ADX_RANGE_MAX = parseFloat(process.env.BTC_ADX_RANGE_MAX ?? 18);

// EMA distance thresholds (as ratio of price)
const EMA_DIST_TREND_MIN = parseFloat(process.env.BTC_EMA_DIST_TREND ?? 0.008); // 0.8%
const EMA_DIST_RANGE_MAX = parseFloat(process.env.BTC_EMA_DIST_RANGE ?? 0.004); // 0.4%

// Recalculation interval: top of every hour + small buffer (ms)
const RECALC_INTERVAL_MS = 60 * 60 * 1000; // 1h

// ─── State ────────────────────────────────────────────────────────────────────

/** @type {{ regime: 'TREND'|'RANGE'|'MIXED', adx: number, ema50: number, ema200: number, emaDist: number, atr: number, atrAvg20: number, price: number, updatedAt: number } | null} */
let currentState = null;
let schedulerTimer = null;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the current BTC regime.
 * @returns {'TREND'|'RANGE'|'MIXED'|null}  null = not yet calculated
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

    // Calculate indicators
    const ema50Series  = calculateEMA(candles, 50);
    const ema200Series = calculateEMA(candles, 200);
    const atrSeries    = calculateATR(candles, 14);
    const adxSeries    = calculateADX(candles, 14);

    if (!ema50Series.length || !ema200Series.length) {
      console.warn('[BtcTrendEngine] EMA calculation returned empty series');
      return null;
    }

    const ema50  = ema50Series[ema50Series.length - 1].value;
    const ema200 = ema200Series[ema200Series.length - 1].value;
    const price  = candles[candles.length - 1].close;

    // ADX
    const adx = adxSeries.length > 0 ? adxSeries[adxSeries.length - 1].value : 0;

    // EMA distance as ratio of price
    const emaDist = Math.abs(ema50 - ema200) / price;

    // ATR current vs ATR avg20
    const atr = atrSeries.length > 0 ? atrSeries[atrSeries.length - 1].value : 0;
    const atrLast20 = atrSeries.slice(-20);
    const atrAvg20 = atrLast20.length > 0
      ? atrLast20.reduce((sum, a) => sum + a.value, 0) / atrLast20.length
      : atr;

    const regime = determineRegime({ adx, emaDist, atr, atrAvg20 });

    currentState = { regime, adx, ema50, ema200, emaDist, atr, atrAvg20, price, updatedAt: Date.now() };

    console.log(
      `[BtcTrendEngine] Regime: ${regime} | BTC: ${price.toFixed(2)} | ADX: ${adx.toFixed(1)} | EMA dist: ${(emaDist * 100).toFixed(2)}% | ATR: ${atr.toFixed(2)} vs avg: ${atrAvg20.toFixed(2)}`
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
 * Determines market regime based on PRD v2.1 rules.
 *
 * TREND: ADX > 22 AND emaDist > 0.8% AND ATR > ATR avg20
 * RANGE: ADX < 18 AND emaDist < 0.4% AND ATR < ATR avg20
 * MIXED: everything else
 *
 * @param {{ adx: number, emaDist: number, atr: number, atrAvg20: number }}
 * @returns {'TREND'|'RANGE'|'MIXED'}
 */
function determineRegime({ adx, emaDist, atr, atrAvg20 }) {
  const isTrend =
    adx > ADX_TREND_MIN &&
    emaDist > EMA_DIST_TREND_MIN &&
    atr > atrAvg20;

  const isRange =
    adx < ADX_RANGE_MAX &&
    emaDist < EMA_DIST_RANGE_MAX &&
    atr < atrAvg20;

  if (isTrend) return 'TREND';
  if (isRange) return 'RANGE';
  return 'MIXED';
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
