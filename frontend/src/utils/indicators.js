/**
 * Frontend EMA & VWAP hot-update utilities.
 * These are used to incrementally update indicators on each WebSocket tick
 * WITHOUT recalculating the entire historical series.
 */

/**
 * EMA multiplier (k) for a given period.
 */
export function emaK(period) {
  return 2 / (period + 1);
}

/**
 * Incremental EMA update.
 * @param {number} closePrice  Current candle close price
 * @param {number} prevEMA     Previous EMA value
 * @param {number} period      EMA period (8 or 21)
 * @returns {number} New EMA value
 */
export function updateEMA(closePrice, prevEMA, period) {
  const k = emaK(period);
  return (closePrice - prevEMA) * k + prevEMA;
}

/**
 * Incremental VWAP update.
 * @param {object} candle   { high, low, close, volume }
 * @param {number} cumTPV   Running sum of (typicalPrice * volume)
 * @param {number} cumVol   Running sum of volume
 * @returns {{ vwap, cumTPV, cumVol }}
 */
export function updateVWAP(candle, cumTPV, cumVol) {
  const typicalPrice = (candle.high + candle.low + candle.close) / 3;
  const newCumTPV = cumTPV + typicalPrice * candle.volume;
  const newCumVol = cumVol + candle.volume;
  const vwap = newCumVol > 0 ? newCumTPV / newCumVol : typicalPrice;
  return { vwap, cumTPV: newCumTPV, cumVol: newCumVol };
}

/**
 * Detects if a new trading day has started (UTC).
 * Used to reset VWAP accumulators.
 */
export function isNewDay(prevTimeSec, currentTimeSec) {
  return Math.floor(prevTimeSec / 86400) !== Math.floor(currentTimeSec / 86400);
}

/**
 * Converts interval string to seconds.
 */
export function intervalToSeconds(interval) {
  const map = {
    '1m': 60,
    '3m': 180,
    '5m': 300,
    '15m': 900,
    '30m': 1800,
    '1h': 3600,
    '2h': 7200,
    '4h': 14400,
    '6h': 21600,
    '1d': 86400,
    '3d': 259200,
    '1w': 604800,
    '1M': 2592000,
  };
  return map[interval] ?? 300;
}
