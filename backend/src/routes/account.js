import { Router } from 'express';
import { getBalance, getPositions, getIncome } from '../services/bingx.js';

const router = Router();

/**
 * GET /api/account/balance
 * Returns futures account balance
 */
router.get('/balance', async (_req, res) => {
  try {
    const data = await getBalance();
    res.json({ ok: true, data });
  } catch (err) {
    console.error('[Account] balance error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/account/positions
 * Returns open positions, optionally filtered by symbol
 */
router.get('/positions', async (req, res) => {
  try {
    const { symbol } = req.query;
    const data = await getPositions(symbol);
    res.json({ ok: true, data });
  } catch (err) {
    console.error('[Account] positions error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/account/income
 * Returns realized PnL history for current session
 */
router.get('/income', async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const data = await getIncome({ incomeType: 'REALIZED_PNL', limit: Number(limit) });
    res.json({ ok: true, data });
  } catch (err) {
    console.error('[Account] income error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
