import { getKlinesPaginated } from './bingx.js';
import { calculateEMA, calculateVWAP, calculateRSI, calculateRelativeVolume, calculateORB } from './indicators.js';

/**
 * Returns candle requirements for a given timeframe.
 * Evaluation window is fixed per timeframe; warmup candles are extra for indicator stability.
 *
 * @param {string} timeframe - e.g. '5m', '15m', '1h'
 * @returns {{ totalCandles: number, evaluationCandles: number, warmupCandles: number }}
 */
export function getRequiredCandles(timeframe) {
  const config = {
    '5m':  { totalCandles: 8840, evaluationCandles: 8640, warmupCandles: 200 },
    '15m': { totalCandles: 3080, evaluationCandles: 2880, warmupCandles: 200 },
    '1h':  { totalCandles: 1640, evaluationCandles: 1440, warmupCandles: 200 },
  };
  return config[timeframe] ?? { totalCandles: 1700, evaluationCandles: 1500, warmupCandles: 200 };
}

/**
 * Runs a backtest of the full strategy over historical data.
 *
 * Strategy:
 *   BUY:  EMA8 > EMA21 > VWAP AND RSI > rsiUp AND VolRel > volMin AND close > ORB High
 *   SELL: EMA8 < EMA21 < VWAP AND RSI < rsiDown AND VolRel > volMin AND close < ORB Low
 *   Exit: SL = ORB opposite side, TP = entry + 2x breakout distance (1:2 R/R)
 *
 * @param {object} params
 */
export async function runBacktest({
  symbol     = 'BTC-USDT',
  interval   = '5m',
  limit      = null,        // if null, uses getRequiredCandles(interval).evaluationCandles
  rsiUp      = 55,
  rsiDown    = 45,
  volMin     = 1.2,
  slRatio    = 1.0,         // SL multiplier (1 = exact ORB distance)
  tpRatio    = 2.0,         // TP multiplier relative to SL distance
  feePct     = 0.05,        // 0.05% taker fee per side
} = {}) {

  // Resolve candle counts — use dynamic policy unless caller overrides
  const candleReq = getRequiredCandles(interval);
  const warmupCandles    = candleReq.warmupCandles;
  const evaluationCandles = limit ?? candleReq.evaluationCandles;
  const totalToFetch     = evaluationCandles + warmupCandles;

  // Fetch all candles (evaluation + warmup)
  const candles = await getKlinesPaginated({ symbol, interval, limit: totalToFetch });
  if (candles.length < warmupCandles + 50) throw new Error('Not enough historical data');

  // Calculate all indicators
  const ema8Series   = calculateEMA(candles, 8);
  const ema21Series  = calculateEMA(candles, 21);
  const vwapSeries   = calculateVWAP(candles);
  const rsiSeries    = calculateRSI(candles, 14);
  const relVolSeries = calculateRelativeVolume(candles, 20);
  const orbSeries    = calculateORB(candles);

  // Build lookup maps
  const ema8Map   = new Map(ema8Series.map((p)   => [p.time, p.value]));
  const ema21Map  = new Map(ema21Series.map((p)  => [p.time, p.value]));
  const vwapMap   = new Map(vwapSeries.map((p)   => [p.time, p.value]));
  const rsiMap    = new Map(rsiSeries.map((p)    => [p.time, p.value]));
  const relVolMap = new Map(relVolSeries.map((p) => [p.time, p.value]));
  const orbMap    = new Map(orbSeries.map((p)    => [p.time, p]));

  const trades   = [];
  let   position = null;  // { type, entry, sl, tp, entryTime, entryIndex }
  let   prevCond = { buy: false, sell: false };

  // Start from warmupCandles — indicators are stable by then, warmup candles are NOT evaluated
  for (let i = warmupCandles; i < candles.length; i++) {
    const c = candles[i];

    const ema8   = ema8Map.get(c.time);
    const ema21  = ema21Map.get(c.time);
    const vwap   = vwapMap.get(c.time);
    const rsi    = rsiMap.get(c.time);
    const relVol = relVolMap.get(c.time);
    const orb    = orbMap.get(c.time);

    if (!ema8 || !ema21 || !vwap || !rsi || !relVol || !orb) continue;

    // ── Check exit if in position ─────────────────────────────────────────
    if (position) {
      const hit_sl = position.type === 'LONG'
        ? c.low  <= position.sl
        : c.high >= position.sl;
      const hit_tp = position.type === 'LONG'
        ? c.high >= position.tp
        : c.low  <= position.tp;

      if (hit_sl || hit_tp) {
        const exitPrice = hit_tp ? position.tp : position.sl;
        const pnlPct    = position.type === 'LONG'
          ? (exitPrice - position.entry) / position.entry * 100
          : (position.entry - exitPrice) / position.entry * 100;
        const netPnlPct = pnlPct - feePct * 2; // entry + exit fee

        trades.push({
          type:       position.type,
          entryTime:  position.entryTime,
          exitTime:   c.time,
          entryPrice: position.entry,
          exitPrice,
          sl:         position.sl,
          tp:         position.tp,
          result:     hit_tp ? 'TP' : 'SL',
          pnlPct:     parseFloat(netPnlPct.toFixed(4)),
          rsiAtEntry: position.rsiAtEntry,
          volAtEntry: position.volAtEntry,
          // PRD v2.1: regime and pairScorer fields (placeholder — future integration)
          regime:           null,
          pairScore:        null,
          relativeMomentum: null,
          volumeExpansion:  null,
          breakoutStrength: null,
        });

        position  = null;
        prevCond  = { buy: false, sell: false };
        continue;
      }
    }

    // ── Entry conditions ──────────────────────────────────────────────────
    const condBuy  = c.close > ema8  && ema8  > ema21 && ema21 > vwap
                  && rsi > rsiUp && relVol > volMin
                  && c.close > orb.orbHigh;

    const condSell = c.close < ema8  && ema8  < ema21 && ema21 < vwap
                  && rsi < rsiDown && relVol > volMin
                  && c.close < orb.orbLow;

    const newBuy  = condBuy  && !prevCond.buy;
    const newSell = condSell && !prevCond.sell;

    prevCond = { buy: condBuy, sell: condSell };

    // Only enter if not already in position
    if (!position && (newBuy || newSell)) {
      const type   = newBuy ? 'LONG' : 'SHORT';
      const entry  = c.close;
      const slBase = newBuy ? orb.orbLow : orb.orbHigh;
      const dist   = Math.abs(entry - slBase) * slRatio;
      const sl     = newBuy ? entry - dist : entry + dist;
      const tp     = newBuy ? entry + dist * tpRatio : entry - dist * tpRatio;

      position = { type, entry, sl, tp, entryTime: c.time, rsiAtEntry: rsi, volAtEntry: relVol };
    }
  }

  // ── Compute metrics ───────────────────────────────────────────────────────
  const wins       = trades.filter((t) => t.result === 'TP');
  const losses     = trades.filter((t) => t.result === 'SL');
  const totalPnl   = trades.reduce((s, t) => s + t.pnlPct, 0);
  const winRate    = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;
  const avgWin     = wins.length   > 0 ? wins.reduce((s, t)   => s + t.pnlPct, 0) / wins.length   : 0;
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
    if (t.result === 'TP') { cw++; cl = 0; maxConsecWins   = Math.max(maxConsecWins, cw); }
    else                   { cl++; cw = 0; maxConsecLosses = Math.max(maxConsecLosses, cl); }
  }

  return {
    params: { symbol, interval, evaluationCandles, warmupCandles, rsiUp, rsiDown, volMin, slRatio, tpRatio, feePct },
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
    trades,  // full trade log
  };
}
