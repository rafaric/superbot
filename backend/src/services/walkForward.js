/**
 * Walk-Forward Testing Service — Fase 3 (PRD v2)
 *
 * Divide datos históricos en ventanas sucesivas de train/test
 * para detectar overfitting. Si la estrategia funciona en train
 * pero no en test, el modelo está sobreajustado.
 *
 * Algoritmo:
 *   1. Pedir klines históricas (windowSize × (folds + 1))
 *   2. Dividir en folds ventanas solapadas
 *   3. Para cada fold: runBacktest en train, runBacktest en test
 *   4. Calcular efficiency ratio: avg(testPnl) / avg(trainPnl)
 *   5. Si efficiency < 0.5 → overfitting probable
 */

import { getKlines } from './bingx.js';
import { runBacktest } from './backtester.js';

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_FOLDS      = 5;
const DEFAULT_TRAIN_SIZE = 200;  // candles
const DEFAULT_TEST_SIZE  = 100;  // candles

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Runs walk-forward testing on historical data.
 *
 * @param {object} params
 * @param {string} params.symbol    e.g. 'BTC-USDT'
 * @param {string} params.interval  e.g. '5m'
 * @param {number} params.folds     Number of train/test windows (default 5)
 * @param {number} params.trainSize Candles for training per fold (default 200)
 * @param {number} params.testSize  Candles for testing per fold (default 100)
 * @param {number} params.rsiUp     RSI upper threshold
 * @param {number} params.rsiDown   RSI lower threshold
 * @param {number} params.volMin    Minimum relative volume
 */
export async function runWalkForward({
  symbol    = 'BTC-USDT',
  interval  = '5m',
  folds     = DEFAULT_FOLDS,
  trainSize = DEFAULT_TRAIN_SIZE,
  testSize  = DEFAULT_TEST_SIZE,
  rsiUp     = parseFloat(process.env.RSI_UP      ?? 55),
  rsiDown   = parseFloat(process.env.RSI_DOWN    ?? 45),
  volMin    = parseFloat(process.env.VOL_REL_MIN ?? 1.2),
} = {}) {
  // Calculate total candles needed: trainSize + (folds × testSize) + buffer for indicators
  const windowSize     = trainSize + testSize;
  const totalNeeded    = trainSize + (folds * testSize) + 50; // +50 for indicator warmup
  const limit          = Math.min(totalNeeded, 1000);

  console.log(`[WalkForward] Running ${folds} folds on ${symbol} ${interval} (train=${trainSize}, test=${testSize})`);

  const allCandles = await getKlines({ symbol, interval, limit });

  if (allCandles.length < windowSize) {
    throw new Error(`Not enough candles: got ${allCandles.length}, need at least ${windowSize}`);
  }

  const results = [];
  let cursor = 0;

  for (let fold = 1; fold <= folds; fold++) {
    const trainStart = cursor;
    const trainEnd   = trainStart + trainSize;
    const testStart  = trainEnd;
    const testEnd    = testStart + testSize;

    // Check if we have enough candles for this fold
    if (testEnd > allCandles.length) {
      console.log(`[WalkForward] Stopping at fold ${fold - 1} — not enough candles for fold ${fold}`);
      break;
    }

    const trainCandles = allCandles.slice(trainStart, trainEnd);
    const testCandles  = allCandles.slice(testStart, testEnd);

    // Run backtest on train window
    const trainResult = await runBacktestOnCandles(trainCandles, { rsiUp, rsiDown, volMin });

    // Run backtest on test window with same params
    const testResult = await runBacktestOnCandles(testCandles, { rsiUp, rsiDown, volMin });

    const trainPnl = trainResult.metrics.totalPnlPct;
    const testPnl  = testResult.metrics.totalPnlPct;

    // Calculate efficiency ratio for this fold
    // Handle edge cases: if trainPnl is 0 or negative, efficiency is 0 or capped
    let efficiencyRatio = 0;
    if (trainPnl > 0) {
      efficiencyRatio = testPnl / trainPnl;
    } else if (trainPnl === 0 && testPnl > 0) {
      efficiencyRatio = 1; // test profitable despite neutral train → no overfit
    } else if (trainPnl === 0 && testPnl <= 0) {
      efficiencyRatio = 0;
    } else if (trainPnl < 0 && testPnl < 0) {
      // Both negative — ratio of losses (inverted)
      efficiencyRatio = trainPnl / testPnl;
    }

    results.push({
      fold,
      trainMetrics: trainResult.metrics,
      testMetrics:  testResult.metrics,
      efficiencyRatio: parseFloat(efficiencyRatio.toFixed(4)),
    });

    // Advance cursor by testSize (sliding window)
    cursor += testSize;
  }

  // Calculate summary
  const avgTrainPnl   = results.reduce((s, r) => s + r.trainMetrics.totalPnlPct, 0) / results.length;
  const avgTestPnl    = results.reduce((s, r) => s + r.testMetrics.totalPnlPct, 0) / results.length;
  const avgEfficiency = results.reduce((s, r) => s + r.efficiencyRatio, 0) / results.length;

  // Determine overfit risk
  let overfitRisk;
  if (avgEfficiency >= 0.7) {
    overfitRisk = 'LOW';
  } else if (avgEfficiency >= 0.5) {
    overfitRisk = 'MEDIUM';
  } else {
    overfitRisk = 'HIGH';
  }

  // Build verdict message
  let verdict;
  if (overfitRisk === 'LOW') {
    verdict = `Strategy shows consistent out-of-sample performance (efficiency ${(avgEfficiency * 100).toFixed(1)}%). Low overfitting risk.`;
  } else if (overfitRisk === 'MEDIUM') {
    verdict = `Strategy shows moderate degradation in test periods (efficiency ${(avgEfficiency * 100).toFixed(1)}%). Consider reviewing parameters.`;
  } else {
    verdict = `Warning: significant performance drop in test periods (efficiency ${(avgEfficiency * 100).toFixed(1)}%). High overfitting risk — parameters may be curve-fitted.`;
  }

  console.log(`[WalkForward] Completed ${results.length} folds — avgEfficiency: ${(avgEfficiency * 100).toFixed(1)}% — Risk: ${overfitRisk}`);

  return {
    symbol,
    interval,
    folds: results.length,
    results,
    summary: {
      avgTrainPnl:  parseFloat(avgTrainPnl.toFixed(4)),
      avgTestPnl:   parseFloat(avgTestPnl.toFixed(4)),
      avgEfficiency: parseFloat(avgEfficiency.toFixed(4)),
      overfitRisk,
      verdict,
    },
  };
}

// ─── Internals ────────────────────────────────────────────────────────────────

/**
 * Helper that runs the backtester logic on a pre-sliced candle array.
 * We simulate what runBacktest does but skip the API call since we already have candles.
 *
 * NOTE: This is a simplified approach — we re-import and call runBacktest
 * which will fetch fresh data. For true walk-forward, we'd need to modify
 * backtester to accept candles directly. For now, we use a workaround.
 */
async function runBacktestOnCandles(candles, { rsiUp, rsiDown, volMin }) {
  // The backtester calculates all indicators internally from candles.
  // We need to pass enough candles for warmup (50+) + test period.
  // Since runBacktest fetches its own data, we need a different approach.
  //
  // Workaround: We'll implement a lightweight inline backtest that mirrors
  // the backtester logic but uses our pre-sliced candles directly.

  // Import indicator functions
  const { calculateEMA, calculateVWAP, calculateRSI, calculateRelativeVolume, calculateORB } = await import('./indicators.js');

  const feePct = 0.05;

  if (candles.length < 50) {
    return {
      metrics: {
        totalTrades: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        totalPnlPct: 0,
        avgWinPct: 0,
        avgLossPct: 0,
        profitFactor: null,
        maxDrawdownPct: 0,
        maxConsecWins: 0,
        maxConsecLosses: 0,
      },
      trades: [],
    };
  }

  // Calculate indicators
  const ema8Series   = calculateEMA(candles, 8);
  const ema21Series  = calculateEMA(candles, 21);
  const vwapSeries   = calculateVWAP(candles);
  const rsiSeries    = calculateRSI(candles, 14);
  const relVolSeries = calculateRelativeVolume(candles, 20);
  const orbSeries    = calculateORB(candles);

  // Build lookup maps
  const ema8Map   = new Map(ema8Series.map(p => [p.time, p.value]));
  const ema21Map  = new Map(ema21Series.map(p => [p.time, p.value]));
  const vwapMap   = new Map(vwapSeries.map(p => [p.time, p.value]));
  const rsiMap    = new Map(rsiSeries.map(p => [p.time, p.value]));
  const relVolMap = new Map(relVolSeries.map(p => [p.time, p.value]));
  const orbMap    = new Map(orbSeries.map(p => [p.time, p]));

  const trades   = [];
  let position   = null;
  let prevCond   = { buy: false, sell: false };

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];

    const ema8   = ema8Map.get(c.time);
    const ema21  = ema21Map.get(c.time);
    const vwap   = vwapMap.get(c.time);
    const rsi    = rsiMap.get(c.time);
    const relVol = relVolMap.get(c.time);
    const orb    = orbMap.get(c.time);

    if (!ema8 || !ema21 || !vwap || !rsi || !relVol || !orb) continue;

    // Check exit if in position
    if (position) {
      const hitSl = position.type === 'LONG'
        ? c.low <= position.sl
        : c.high >= position.sl;
      const hitTp = position.type === 'LONG'
        ? c.high >= position.tp
        : c.low <= position.tp;

      if (hitSl || hitTp) {
        const exitPrice = hitTp ? position.tp : position.sl;
        const pnlPct = position.type === 'LONG'
          ? (exitPrice - position.entry) / position.entry * 100
          : (position.entry - exitPrice) / position.entry * 100;
        const netPnlPct = pnlPct - feePct * 2;

        trades.push({
          type:       position.type,
          entryTime:  position.entryTime,
          exitTime:   c.time,
          entryPrice: position.entry,
          exitPrice,
          sl:         position.sl,
          tp:         position.tp,
          result:     hitTp ? 'TP' : 'SL',
          pnlPct:     parseFloat(netPnlPct.toFixed(4)),
          rsiAtEntry: position.rsiAtEntry,
          volAtEntry: position.volAtEntry,
        });

        position = null;
        prevCond = { buy: false, sell: false };
        continue;
      }
    }

    // Entry conditions
    const condBuy  = c.close > ema8 && ema8 > ema21 && ema21 > vwap
                  && rsi > rsiUp && relVol > volMin
                  && c.close > orb.orbHigh;

    const condSell = c.close < ema8 && ema8 < ema21 && ema21 < vwap
                  && rsi < rsiDown && relVol > volMin
                  && c.close < orb.orbLow;

    const newBuy  = condBuy && !prevCond.buy;
    const newSell = condSell && !prevCond.sell;

    prevCond = { buy: condBuy, sell: condSell };

    if (!position && (newBuy || newSell)) {
      const type   = newBuy ? 'LONG' : 'SHORT';
      const entry  = c.close;
      const slBase = newBuy ? orb.orbLow : orb.orbHigh;
      const dist   = Math.abs(entry - slBase);
      const sl     = newBuy ? entry - dist : entry + dist;
      const tp     = newBuy ? entry + dist * 2 : entry - dist * 2;

      position = { type, entry, sl, tp, entryTime: c.time, rsiAtEntry: rsi, volAtEntry: relVol };
    }
  }

  // Compute metrics
  const wins       = trades.filter(t => t.result === 'TP');
  const losses     = trades.filter(t => t.result === 'SL');
  const totalPnl   = trades.reduce((s, t) => s + t.pnlPct, 0);
  const winRate    = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;
  const avgWin     = wins.length > 0 ? wins.reduce((s, t) => s + t.pnlPct, 0) / wins.length : 0;
  const avgLoss    = losses.length > 0 ? losses.reduce((s, t) => s + t.pnlPct, 0) / losses.length : 0;
  const profitFactor = losses.length > 0 && avgLoss !== 0
    ? Math.abs(wins.reduce((s, t) => s + t.pnlPct, 0) / losses.reduce((s, t) => s + t.pnlPct, 0))
    : null;

  // Max drawdown
  let peak = 0, cumPnl = 0, maxDrawdown = 0;
  for (const t of trades) {
    cumPnl += t.pnlPct;
    if (cumPnl > peak) peak = cumPnl;
    const dd = peak - cumPnl;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  // Consecutive wins/losses
  let maxConsecWins = 0, maxConsecLosses = 0, cw = 0, cl = 0;
  for (const t of trades) {
    if (t.result === 'TP') { cw++; cl = 0; maxConsecWins = Math.max(maxConsecWins, cw); }
    else { cl++; cw = 0; maxConsecLosses = Math.max(maxConsecLosses, cl); }
  }

  return {
    metrics: {
      totalTrades:     trades.length,
      wins:            wins.length,
      losses:          losses.length,
      winRate:         parseFloat(winRate.toFixed(2)),
      totalPnlPct:     parseFloat(totalPnl.toFixed(4)),
      avgWinPct:       parseFloat(avgWin.toFixed(4)),
      avgLossPct:      parseFloat(avgLoss.toFixed(4)),
      profitFactor:    profitFactor ? parseFloat(profitFactor.toFixed(3)) : null,
      maxDrawdownPct:  parseFloat(maxDrawdown.toFixed(4)),
      maxConsecWins,
      maxConsecLosses,
    },
    trades,
  };
}
