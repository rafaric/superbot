import { Router } from 'express';
import { TRADING_PAIRS } from '../index.js';

const router = Router();

/**
 * GET /api/config/pairs
 * Returns the list of trading pairs configured in TRADING_PAIRS env var.
 */
router.get('/pairs', (_req, res) => {
  res.json({ ok: true, pairs: TRADING_PAIRS });
});

export default router;
