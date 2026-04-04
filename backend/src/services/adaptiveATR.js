/**
 * Adaptive ATR Service — Fase 3 (PRD v2)
 *
 * Ajusta dinámicamente el umbral ATR_PCT_MIN según el régimen de
 * volatilidad actual del mercado. En lugar de un valor fijo (0.35%),
 * adapta el filtro para evitar quedarse sin señales en mercados calmos
 * o aceptar entradas riesgosas en mercados agitados.
 *
 * Algoritmo:
 *   1. Pedir klines 1H de BTC-USDT (100 candles)
 *   2. Calcular ATR% promedio de últimas 20 velas → marketVolatility
 *   3. Determinar régimen: LOW / NORMAL / HIGH
 *   4. Ajustar ATR_PCT_MIN según régimen
 *   5. Cachear resultado por 1H (scheduler como btcTrendEngine)
 *
 * Régimen → ATR_PCT_MIN:
 *   LOW (<0.8%):     0.20  (más permisivo — mercado calmo)
 *   NORMAL (0.8-2%): 0.35  (default PRD)
 *   HIGH (>2%):      0.50  (más exigente — mercado agitado)
 */

import { getKlines } from './bingx.js';
import { calculateATR } from './indicators.js';

// ─── Config ───────────────────────────────────────────────────────────────────

const BTC_SYMBOL    = 'BTC-USDT';
const INTERVAL_1H   = '1h';
const CANDLES_LIMIT = 100;
const ATR_PERIOD    = 14;

// Volatility thresholds (as percentage)
const LOW_VOL_THRESHOLD    = 0.8;  // ATR% < 0.8 = low vol
const HIGH_VOL_THRESHOLD   = 2.0;  // ATR% > 2.0 = high vol

// ATR_PCT_MIN values per regime
const ATR_MIN_LOW    = 0.20;  // permissive
const ATR_MIN_NORMAL = 0.35;  // default
const ATR_MIN_HIGH   = 0.50;  // strict

// ─── State ────────────────────────────────────────────────────────────────────

/**
 * @type {{
 *   regime: 'LOW'|'NORMAL'|'HIGH',
 *   marketVolatility: number,
 *   atrThreshold: number,
 *   updatedAt: number
 * } | null}
 */
let currentState = null;
let schedulerTimer = null;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the current ATR threshold value (ATR_PCT_MIN).
 * @returns {number} Current threshold or default if not yet calculated
 */
export function getATRThreshold() {
  return currentState?.atrThreshold ?? ATR_MIN_NORMAL;
}

/**
 * Returns the full volatility state snapshot.
 * @returns {object|null}
 */
export function getATRVolatilityState() {
  return currentState;
}

/**
 * Forces an immediate recalculation of the adaptive ATR threshold.
 * Updates process.env.ATR_PCT_MIN with the calculated value.
 *
 * @returns {Promise<object|null>} Current state or null on error
 */
export async function recalcAdaptiveATR() {
  try {
    const candles = await getKlines({
      symbol:   BTC_SYMBOL,
      interval: INTERVAL_1H,
      limit:    CANDLES_LIMIT,
    });

    if (candles.length < ATR_PERIOD + 1) {
      console.warn(`[AdaptiveATR] Not enough candles: got ${candles.length}, need ${ATR_PERIOD + 1}`);
      return null;
    }

    // Calculate ATR series
    const atrSeries = calculateATR(candles, ATR_PERIOD);

    if (!atrSeries.length) {
      console.warn('[AdaptiveATR] ATR calculation returned empty series');
      return null;
    }

    // Get average ATR% over last 20 periods (or all available if less)
    const lookback      = Math.min(20, atrSeries.length);
    const recentATRs    = atrSeries.slice(-lookback);
    const recentCandles = candles.slice(-lookback);

    // Calculate ATR% for each candle in lookback period
    let sumAtrPct = 0;
    for (let i = 0; i < recentATRs.length; i++) {
      const atr   = recentATRs[i].value;
      const price = recentCandles[i].close;
      const atrPct = price > 0 ? (atr / price) * 100 : 0;
      sumAtrPct += atrPct;
    }

    const marketVolatility = sumAtrPct / lookback;

    // Determine regime and threshold
    let regime;
    let atrThreshold;

    if (marketVolatility < LOW_VOL_THRESHOLD) {
      regime       = 'LOW';
      atrThreshold = ATR_MIN_LOW;
    } else if (marketVolatility > HIGH_VOL_THRESHOLD) {
      regime       = 'HIGH';
      atrThreshold = ATR_MIN_HIGH;
    } else {
      regime       = 'NORMAL';
      atrThreshold = ATR_MIN_NORMAL;
    }

    // Update process.env so scanner picks it up automatically
    process.env.ATR_PCT_MIN = String(atrThreshold);

    currentState = {
      regime,
      marketVolatility: parseFloat(marketVolatility.toFixed(4)),
      atrThreshold,
      updatedAt: Date.now(),
    };

    console.log(
      `[AdaptiveATR] Regime: ${regime} | MarketVol: ${marketVolatility.toFixed(3)}% | ATR_PCT_MIN: ${atrThreshold}`
    );

    return currentState;
  } catch (err) {
    console.error('[AdaptiveATR] Error calculating adaptive threshold:', err.message);
    return null;
  }
}

/**
 * Starts the hourly scheduler.
 * Calculates immediately, then recalculates at the top of every hour + 10s buffer.
 */
export async function startAdaptiveATR() {
  if (schedulerTimer) return; // already running

  console.log('[AdaptiveATR] Starting adaptive ATR engine...');

  // Initial calculation
  await recalcAdaptiveATR();

  // Schedule next recalc at top of hour
  scheduleNext();
}

/**
 * Stops the hourly scheduler.
 */
export function stopAdaptiveATR() {
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
    console.log('[AdaptiveATR] Scheduler stopped');
  }
}

// ─── Internals ────────────────────────────────────────────────────────────────

/**
 * Schedules the next recalculation at the top of the hour + 10s buffer.
 * Uses setTimeout (not setInterval) to avoid drift.
 */
function scheduleNext() {
  const now      = Date.now();
  const nextHour = new Date(now);
  nextHour.setMinutes(0, 10, 0);  // :00:10 — 10s after the top of the hour
  nextHour.setHours(nextHour.getHours() + 1);

  const msUntilNext = nextHour.getTime() - now;
  console.log(`[AdaptiveATR] Next recalculation in ${Math.round(msUntilNext / 1000 / 60)} min`);

  schedulerTimer = setTimeout(async () => {
    await recalcAdaptiveATR();
    scheduleNext(); // reschedule
  }, msUntilNext);
}
