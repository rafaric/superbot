import { Router } from 'express';
import { runBacktest } from '../services/backtester.js';
import { analyzeAndOptimize } from '../services/optimizer.js';

const router = Router();

/**
 * POST /api/backtest/run
 * Runs backtest with given parameters.
 * Body: { symbol, interval, limit, rsiUp, rsiDown, volMin, slRatio, tpRatio }
 */
router.post('/run', async (req, res) => {
  try {
    const {
      symbol   = 'BTC-USDT',
      interval = '5m',
      limit    = 300,
      rsiUp    = parseFloat(process.env.RSI_UP      ?? 55),
      rsiDown  = parseFloat(process.env.RSI_DOWN    ?? 45),
      volMin   = parseFloat(process.env.VOL_REL_MIN ?? 1.2),
      slRatio  = 1.0,
      tpRatio  = 2.0,
    } = req.body;

    console.log(`[Backtest] Running ${symbol} ${interval} x${limit} candles`);
    const result = await runBacktest({ symbol, interval, limit: Math.min(limit, 1000), rsiUp, rsiDown, volMin, slRatio, tpRatio });
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[Backtest] Error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/backtest/optimize
 * Runs backtest + analysis + suggestions.
 * Body: { symbol, interval, limit }
 */
router.post('/optimize', async (req, res) => {
  try {
    const { symbol = 'BTC-USDT', interval = '5m', limit = 300 } = req.body;
    console.log(`[Optimizer] Analyzing ${symbol} ${interval}`);
    const result = await analyzeAndOptimize({ symbol, interval, limit: Math.min(limit, 1000) });
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[Optimizer] Error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
