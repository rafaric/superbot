/**
 * Indicators Service
 * Cold calculations for EMA, VWAP, RSI, Relative Volume, ORB.
 */

function sma(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// ─── EMA ─────────────────────────────────────────────────────────────────────

export function calculateEMA(candles, period) {
  if (candles.length < period) return [];
  const k = 2 / (period + 1);
  const result = [];
  let prevEMA = sma(candles.slice(0, period).map((c) => c.close));
  result.push({ time: candles[period - 1].time, value: prevEMA });
  for (let i = period; i < candles.length; i++) {
    const ema = (candles[i].close - prevEMA) * k + prevEMA;
    result.push({ time: candles[i].time, value: ema });
    prevEMA = ema;
  }
  return result;
}

export function getLastEMA(candles, period) {
  const series = calculateEMA(candles, period);
  return series.length ? series[series.length - 1].value : null;
}

// ─── VWAP ─────────────────────────────────────────────────────────────────────

export function calculateVWAP(candles) {
  if (!candles.length) return [];
  const result = [];
  let cumTPV = 0, cumVol = 0, currentDay = null;
  for (const candle of candles) {
    const day = Math.floor(candle.time / 86400);
    if (day !== currentDay) { cumTPV = 0; cumVol = 0; currentDay = day; }
    const tp = (candle.high + candle.low + candle.close) / 3;
    cumTPV += tp * candle.volume;
    cumVol += candle.volume;
    result.push({ time: candle.time, value: cumVol > 0 ? cumTPV / cumVol : tp });
  }
  return result;
}

export function getVWAPSeedForToday(candles) {
  let cumTPV = 0, cumVol = 0, currentDay = null;
  for (const candle of candles) {
    const day = Math.floor(candle.time / 86400);
    if (day !== currentDay) { cumTPV = 0; cumVol = 0; currentDay = day; }
    const tp = (candle.high + candle.low + candle.close) / 3;
    cumTPV += tp * candle.volume;
    cumVol += candle.volume;
  }
  return { cumTPV, cumVol };
}

// ─── RSI ─────────────────────────────────────────────────────────────────────

export function calculateRSI(candles, period = 14) {
  if (candles.length < period + 1) return [];
  const result = [];
  let avgGain = 0, avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const change = candles[i].close - candles[i - 1].close;
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;

  result.push({
    time: candles[period].time,
    value: avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss),
  });

  for (let i = period + 1; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close;
    avgGain = (avgGain * (period - 1) + (change > 0 ? change : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (change < 0 ? Math.abs(change) : 0)) / period;
    result.push({
      time: candles[i].time,
      value: avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss),
    });
  }
  return result;
}

export function getLastRSI(candles, period = 14) {
  const series = calculateRSI(candles, period);
  return series.length ? series[series.length - 1].value : null;
}

// ─── Relative Volume ──────────────────────────────────────────────────────────

export function calculateRelativeVolume(candles, period = 20) {
  if (candles.length < period + 1) return [];
  const result = [];
  for (let i = period; i < candles.length; i++) {
    const slice  = candles.slice(i - period, i);
    const smaVol = slice.reduce((s, c) => s + c.volume, 0) / period;
    result.push({ time: candles[i].time, value: smaVol > 0 ? candles[i].volume / smaVol : 0 });
  }
  return result;
}

export function getRelativeVolume(candles, period = 20) {
  if (candles.length < period + 1) return null;
  const recent = candles.slice(-period - 1);
  const smaVol = recent.slice(0, period).reduce((s, c) => s + c.volume, 0) / period;
  const lastVol = candles[candles.length - 1].volume;
  return smaVol > 0 ? lastVol / smaVol : null;
}

// ─── ORB ─────────────────────────────────────────────────────────────────────

/**
 * ORB series — each entry has the previous candle's high/low as the range.
 * Equivalent to Pine Script's ta.highest(high,1) / ta.lowest(low,1).
 */
export function calculateORB(candles) {
  if (candles.length < 2) return [];
  return candles.slice(1).map((c, i) => ({
    time:     c.time,
    orbHigh:  candles[i].high,
    orbLow:   candles[i].low,
  }));
}

export function getORB(candles15m) {
  if (!candles15m?.length) return { high: null, low: null };
  const ref = candles15m.length >= 2
    ? candles15m[candles15m.length - 2]
    : candles15m[candles15m.length - 1];
  return { high: ref.high, low: ref.low };
}

// ─── ATR ─────────────────────────────────────────────────────────────────────

/**
 * Returns ATR series (Wilder smoothing).
 * Each entry: { time, value }
 */
export function calculateATR(candles, period = 14) {
  if (candles.length < period + 1) return [];
  const result = [];

  // First ATR = simple average of first `period` true ranges
  let sum = 0;
  for (let i = 1; i <= period; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low  - candles[i - 1].close),
    );
    sum += tr;
  }
  let atr = sum / period;
  result.push({ time: candles[period].time, value: atr });

  // Wilder smoothing for remaining candles
  for (let i = period + 1; i < candles.length; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low  - candles[i - 1].close),
    );
    atr = (atr * (period - 1) + tr) / period;
    result.push({ time: candles[i].time, value: atr });
  }
  return result;
}

/**
 * Returns last ATR as a percentage of price (ATR%).
 * Useful for filtering minimum volatility.
 */
export function getATRPercent(candles, period = 14) {
  const series = calculateATR(candles, period);
  if (!series.length) return null;
  const lastATR   = series[series.length - 1].value;
  const lastPrice = candles[candles.length - 1].close;
  return lastPrice > 0 ? (lastATR / lastPrice) * 100 : null;
}

// ─── EMA Slope ────────────────────────────────────────────────────────────────

/**
 * Calculates the normalized slope of an EMA series.
 * slope = (ema[last] - ema[last - lookback]) / ema[last - lookback]
 * Returns a decimal (e.g. 0.002 = +0.2%, -0.001 = -0.1%).
 *
 * @param {Array}  emaSeries  Output of calculateEMA()
 * @param {number} lookback   How many bars back to measure slope (default 3)
 */
export function getEMASlope(emaSeries, lookback = 3) {
  if (emaSeries.length < lookback + 1) return null;
  const current = emaSeries[emaSeries.length - 1].value;
  const prev    = emaSeries[emaSeries.length - 1 - lookback].value;
  return prev > 0 ? (current - prev) / prev : null;
}

// ─── ADX ─────────────────────────────────────────────────────────────────────

/**
 * Calculate ADX (Average Directional Index) using Wilder smoothing.
 * Returns array of { time, value } sorted chronologically.
 * @param {Array} candles
 * @param {number} period - default 14
 */
export function calculateADX(candles, period = 14) {
  // Need at least period*2 + 1 candles for stable ADX
  if (candles.length < period * 2 + 1) return [];

  const result = [];

  // Step 1: Calculate +DM, -DM, and TR for each candle (starting from index 1)
  const dmPlus  = [];
  const dmMinus = [];
  const trList  = [];

  for (let i = 1; i < candles.length; i++) {
    const high     = candles[i].high;
    const low      = candles[i].low;
    const prevHigh = candles[i - 1].high;
    const prevLow  = candles[i - 1].low;
    const prevClose = candles[i - 1].close;

    // Directional Movement
    const upMove   = high - prevHigh;
    const downMove = prevLow - low;

    let plusDM  = 0;
    let minusDM = 0;

    if (upMove > downMove && upMove > 0) {
      plusDM = upMove;
    }
    if (downMove > upMove && downMove > 0) {
      minusDM = downMove;
    }

    dmPlus.push(plusDM);
    dmMinus.push(minusDM);

    // True Range
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trList.push(tr);
  }

  // Step 2: Wilder smoothing for +DM, -DM, TR (first period = simple sum)
  let smoothedPlusDM  = dmPlus.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothedMinusDM = dmMinus.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothedTR      = trList.slice(0, period).reduce((a, b) => a + b, 0);

  // Step 3: Calculate +DI, -DI, DX series
  const dxList = [];

  // First DI values at index period-1 of dmPlus (which corresponds to candle index period)
  let plusDI  = smoothedTR > 0 ? (smoothedPlusDM / smoothedTR) * 100 : 0;
  let minusDI = smoothedTR > 0 ? (smoothedMinusDM / smoothedTR) * 100 : 0;
  let diSum   = plusDI + minusDI;
  let dx      = diSum > 0 ? (Math.abs(plusDI - minusDI) / diSum) * 100 : 0;
  dxList.push(dx);

  // Continue Wilder smoothing for remaining candles
  for (let i = period; i < dmPlus.length; i++) {
    smoothedPlusDM  = smoothedPlusDM - (smoothedPlusDM / period) + dmPlus[i];
    smoothedMinusDM = smoothedMinusDM - (smoothedMinusDM / period) + dmMinus[i];
    smoothedTR      = smoothedTR - (smoothedTR / period) + trList[i];

    plusDI  = smoothedTR > 0 ? (smoothedPlusDM / smoothedTR) * 100 : 0;
    minusDI = smoothedTR > 0 ? (smoothedMinusDM / smoothedTR) * 100 : 0;
    diSum   = plusDI + minusDI;
    dx      = diSum > 0 ? (Math.abs(plusDI - minusDI) / diSum) * 100 : 0;
    dxList.push(dx);
  }

  // Step 4: ADX = Wilder smoothed DX
  if (dxList.length < period) return [];

  // First ADX = simple average of first `period` DX values
  let adx = dxList.slice(0, period).reduce((a, b) => a + b, 0) / period;

  // The first ADX corresponds to candle index: 1 + period-1 + period-1 = period*2 - 1
  // But we have dmPlus starting at candle 1, so:
  // dxList[0] corresponds to candle[period]
  // dxList[period-1] corresponds to candle[period*2-1]
  // First ADX is at candle index period*2 - 1
  const firstADXCandleIdx = period * 2;
  result.push({ time: candles[firstADXCandleIdx].time, value: adx });

  // Wilder smoothing for remaining ADX values
  for (let i = period; i < dxList.length; i++) {
    adx = (adx * (period - 1) + dxList[i]) / period;
    const candleIdx = period + 1 + i; // offset: dmPlus starts at candle 1, dxList[i] maps to candle[period + i]
    if (candleIdx < candles.length) {
      result.push({ time: candles[candleIdx].time, value: adx });
    }
  }

  return result;
}

/**
 * Returns the last ADX value or null if not enough data.
 * @param {Array} candles
 * @param {number} period - default 14
 */
export function getLastADX(candles, period = 14) {
  const series = calculateADX(candles, period);
  return series.length > 0 ? series[series.length - 1].value : null;
}
