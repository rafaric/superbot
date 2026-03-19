import { Router } from 'express';
import { getKlines } from '../services/bingx.js';
import { calculateEMA, calculateVWAP, getLastEMA, getVWAPSeedForToday, getLastRSI, getRelativeVolume, getORB } from '../services/indicators.js';
import { wsManager } from '../ws/bingxStream.js';
import { updateIndicatorState } from '../index.js';

const router = Router();

/**
 * Calculates how many candles of a given interval fit from UTC midnight until now.
 * This ensures VWAP is always calculated from the start of the trading session.
 */
function candlesSinceUtcMidnight(intervalStr) {
  const intervalSeconds = {
    '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800,
    '1h': 3600, '2h': 7200, '4h': 14400, '6h': 21600,
    '1d': 86400, '3d': 259200, '1w': 604800, '1M': 2592000,
  };

  const sec = intervalSeconds[intervalStr] ?? 300;

  // For intervals >= 1 day, VWAP reset is irrelevant — just return 200
  if (sec >= 86400) return 200;

  const now = Math.floor(Date.now() / 1000);
  const utcMidnight = now - (now % 86400); // floor to UTC 00:00:00
  const secondsSinceMidnight = now - utcMidnight;

  // +1 for the current forming candle, +50 buffer for EMA seed (needs min 21 candles)
  const candlesNeeded = Math.ceil(secondsSinceMidnight / sec) + 51;

  // Cap at 1000 (BingX max) — for 1m on a late session this could be large
  return Math.min(candlesNeeded, 1000);
}

/**
 * GET /api/market/klines
 *
 * Query params:
 *   symbol   - default BTC-USDT
 *   interval - default 5m
 *   limit    - optional override (used for historical pagination)
 *   endTime  - optional, for historical pagination (ms timestamp)
 */
router.get('/klines', async (req, res) => {
  try {
    const {
      symbol = 'BTC-USDT',
      interval = '5m',
      limit,
      endTime,
    } = req.query;

    // If no explicit limit and this is the initial load (no endTime),
    // calculate exactly how many candles we need to cover today's VWAP session
    const resolvedLimit = endTime
      ? Math.min(Number(limit || 200), 1000)
      : Math.min(Number(limit || candlesSinceUtcMidnight(interval)), 1000);

    const candles = await getKlines({
      symbol,
      interval,
      limit: resolvedLimit,
      endTime: endTime ? Number(endTime) : undefined,
    });

    // Fetch 15m candles for RSI, VolRel and ORB filters (always 15m regardless of chart interval)
    let filterSeeds = { rsi15: null, volRel: null, orbHigh: null, orbLow: null };
    if (!endTime) { // only on initial load, not pagination
      try {
        const candles15m = await getKlines({ symbol, interval: '15m', limit: 50 });
        filterSeeds = {
          rsi15:   getLastRSI(candles15m, 14),
          volRel:  getRelativeVolume(candles15m, 20),
          ...getORB(candles15m),
        };
      } catch (e) {
        console.warn('[Market] Could not fetch 15m filter data:', e.message);
      }
    }

    const ema8 = calculateEMA(candles, 8);
    const ema21 = calculateEMA(candles, 21);
    const vwap = calculateVWAP(candles);

    const lastEMA8 = getLastEMA(candles, 8);
    const lastEMA21 = getLastEMA(candles, 21);
    const vwapSeed = getVWAPSeedForToday(candles);

    res.json({
      candles,
      indicators: { ema8, ema21, vwap },
      seeds: {
        lastEMA8,
        lastEMA21,
        vwapCumTPV: vwapSeed.cumTPV,
        vwapCumVol: vwapSeed.cumVol,
        // Filter seeds for RSI + VolRel + ORB strategy
        rsi15:   filterSeeds.rsi15,
        volRel:  filterSeeds.volRel,
        orbHigh: filterSeeds.orbHigh,
        orbLow:  filterSeeds.orbLow,
      },
    });
  } catch (err) {
    console.error('[Market] klines error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/subscribe', (req, res) => {
  const { symbol = 'BTC-USDT', interval = '5m' } = req.body;
  wsManager.subscribe(symbol, interval);
  res.json({ ok: true, symbol, interval });
});

router.post('/unsubscribe', (_req, res) => {
  wsManager.unsubscribe();
  res.json({ ok: true });
});

/**
 * POST /api/market/indicators
 * Frontend pushes current indicator values so the Telegram bot can report them.
 * Body: { symbol, ema8, ema21, vwap, price }
 */
router.post('/indicators', (req, res) => {
  const { symbol, ema8, ema21, vwap, price } = req.body;
  if (symbol && ema8 && ema21 && vwap && price) {
    updateIndicatorState(symbol, { ema8, ema21, vwap, price });
  }
  res.json({ ok: true });
});

export default router;
