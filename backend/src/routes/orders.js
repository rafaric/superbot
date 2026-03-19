import { Router } from 'express';
import { buildAuthQuery } from '../utils/auth.js';
import { notifyPositionOpened, notifyPositionClosed } from '../services/telegramNotifier.js';
import { calcQuantityFromPct } from '../services/sizeCalculator.js';

const router = Router();
const getBaseUrl = () => process.env.BINGX_BASE_URL;
const getApiKey = () => process.env.BINGX_API_KEY;

async function privatePost(path, params = {}) {
  // BingX POST: params go in the request BODY as form-encoded string (not JSON),
  // and the signature is included in the body too.
  const query = buildAuthQuery(params, process.env.BINGX_API_SECRET);
  const res = await fetch(`${getBaseUrl()}${path}`, {
    method: 'POST',
    headers: {
      'X-BX-APIKEY': getApiKey(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: query,
  });
  if (!res.ok) throw new Error(`BingX HTTP ${res.status}`);
  return res.json();
}

async function privateDelete(path, params = {}) {
  const query = buildAuthQuery(params, process.env.BINGX_API_SECRET);
  const res = await fetch(`${getBaseUrl()}${path}?${query}`, {
    method: 'DELETE',
    headers: { 'X-BX-APIKEY': getApiKey() },
  });
  if (!res.ok) throw new Error(`BingX HTTP ${res.status}`);
  return res.json();
}

async function privateGet(path, params = {}) {
  const query = buildAuthQuery(params, process.env.BINGX_API_SECRET);
  const res = await fetch(`${getBaseUrl()}${path}?${query}`, {
    headers: { 'X-BX-APIKEY': getApiKey() },
  });
  if (!res.ok) throw new Error(`BingX HTTP ${res.status}`);
  return res.json();
}

/**
 * POST /api/orders/market
 * Place a market order (BUY or SELL), one-way mode.
 * Body: { symbol, side, quantity, stopLoss?, takeProfit? }
 */
router.post('/market', async (req, res) => {
  try {
    const { symbol, side, quantity, stopLoss, takeProfit } = req.body;

    // If quantity not provided, calculate from balance percentage
    let resolvedQty = quantity;
    if (!resolvedQty && req.body.pct) {
      const sized = await calcQuantityFromPct({
        symbol,
        price:    parseFloat(req.body.price ?? 0),
        pct:      parseFloat(req.body.pct),
        leverage: parseFloat(req.body.leverage ?? 1),
      });
      if (sized.error) return res.status(400).json({ ok: false, error: sized.error });
      resolvedQty = sized.quantity;
    }

    if (!symbol || !side || !resolvedQty) {
      return res.status(400).json({ ok: false, error: 'symbol, side and (quantity or pct+price) are required' });
    }

    const sideUpper = side.toUpperCase(); // BUY | SELL
    // Hedge mode: BUY opens LONG, SELL opens SHORT
    const positionSide = sideUpper === 'BUY' ? 'LONG' : 'SHORT';

    const params = {
      symbol,
      side:         sideUpper,
      positionSide,
      type:         'MARKET',
      quantity:     String(resolvedQty),
    };

    if (takeProfit) {
      params.takeProfit = JSON.stringify({
        type:      'TAKE_PROFIT_MARKET',
        stopPrice: takeProfit,
        workingType: 'MARK_PRICE',
      });
    }

    if (stopLoss) {
      params.stopLoss = JSON.stringify({
        type:      'STOP_MARKET',
        stopPrice: stopLoss,
        workingType: 'MARK_PRICE',
      });
    }

    const data = await privatePost('/openApi/swap/v2/trade/order', params);
    if (data.code !== 0) return res.status(400).json({ ok: false, error: data.msg });

    // Telegram notification (fire-and-forget)
    notifyPositionOpened({
      symbol,
      side:     side.toUpperCase() === 'BUY' ? 'Long' : 'Short',
      quantity: resolvedQty,
      price:    data.data?.price ?? data.data?.avgPrice ?? '—',
      leverage: req.body.leverage ?? '—',
    });

    res.json({ ok: true, data: data.data });
  } catch (err) {
    console.error('[Orders] market error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/orders/close
 * Close a position at market price.
 * Body: { symbol, positionAmt }  — positionAmt is the full size to close (positive number)
 */
router.post('/close', async (req, res) => {
  try {
    const { symbol, positionSide: rawPS, quantity, positionAmt } = req.body;
    if (!symbol || (!rawPS && !positionAmt && !quantity)) {
      return res.status(400).json({ ok: false, error: 'symbol and positionSide/quantity are required' });
    }

    // Support both new (positionSide + quantity) and legacy (positionAmt) formats
    let positionSide, qty, side;

    if (rawPS && quantity) {
      // New format: explicit positionSide + quantity
      positionSide = rawPS.toUpperCase();
      qty          = Math.abs(parseFloat(quantity));
      side         = positionSide === 'LONG' ? 'SELL' : 'BUY';
    } else {
      // Legacy format: derive from positionAmt sign
      const amt    = parseFloat(positionAmt ?? 0);
      const isLong = amt > 0;
      side         = isLong ? 'SELL' : 'BUY';
      positionSide = isLong ? 'LONG' : 'SHORT';
      qty          = Math.abs(amt);
    }

    const params = {
      symbol,
      side,
      positionSide,
      type:     'MARKET',
      quantity: String(qty),
    };

    const data = await privatePost('/openApi/swap/v2/trade/order', params);
    if (data.code !== 0) return res.status(400).json({ ok: false, error: data.msg });

    // Telegram notification
    notifyPositionClosed({
      symbol,
      side:        parseFloat(positionAmt) > 0 ? 'Long' : 'Short',
      quantity:    qty,
      price:       data.data?.price ?? data.data?.avgPrice ?? '—',
      realizedPnl: data.data?.profit ?? 0,
    });

    res.json({ ok: true, data: data.data });
  } catch (err) {
    console.error('[Orders] close error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/orders/sltp
 * Update or set Stop Loss / Take Profit on an open position.
 * Body: { symbol, stopLoss?, takeProfit? }
 */
router.post('/sltp', async (req, res) => {
  try {
    const { symbol, stopLoss, takeProfit } = req.body;
    if (!symbol) return res.status(400).json({ ok: false, error: 'symbol is required' });

    const params = { symbol, positionSide: 'BOTH' };
    if (stopLoss)   params.stopLoss   = stopLoss;
    if (takeProfit) params.takeProfit = takeProfit;

    const data = await privatePost('/openApi/swap/v2/trade/positionMargin', params);
    if (data.code !== 0) {
      // fallback: try the dedicated SL/TP endpoint
      const data2 = await privatePost('/openApi/swap/v2/trade/order/sltp', {
        symbol,
        positionSide: 'BOTH',
        stopLoss:   stopLoss   ? JSON.stringify({ type: 'STOP_MARKET',        stopPrice: stopLoss,   workingType: 'MARK_PRICE' }) : undefined,
        takeProfit: takeProfit ? JSON.stringify({ type: 'TAKE_PROFIT_MARKET', stopPrice: takeProfit, workingType: 'MARK_PRICE' }) : undefined,
      });
      if (data2.code !== 0) return res.status(400).json({ ok: false, error: data2.msg });
      return res.json({ ok: true, data: data2.data });
    }

    res.json({ ok: true, data: data.data });
  } catch (err) {
    console.error('[Orders] sltp error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/orders/size?symbol=BTC-USDT&price=74000&pct=10&leverage=10
 * Preview calculated quantity before placing order.
 */
router.get('/size', async (req, res) => {
  try {
    const { symbol, price, pct = 10, leverage = 1 } = req.query;
    if (!symbol || !price) return res.status(400).json({ ok: false, error: 'symbol and price required' });

    const result = await calcQuantityFromPct({
      symbol,
      price:    parseFloat(price),
      pct:      parseFloat(pct),
      leverage: parseFloat(leverage),
    });

    // Always return 200 — frontend decides what to show/block based on ok/error
    res.json({ ok: !result.error, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/orders/leverage
 * Set leverage before opening a position.
 * Body: { symbol, leverage }
 */
router.post('/leverage', async (req, res) => {
  try {
    const { symbol, leverage } = req.body;
    if (!symbol || !leverage) return res.status(400).json({ ok: false, error: 'symbol and leverage required' });

    // BingX hedge mode requires separate calls for LONG and SHORT side
    const [resLong, resShort] = await Promise.all([
      privatePost('/openApi/swap/v2/trade/leverage', { symbol, leverage: String(leverage), side: 'LONG' }),
      privatePost('/openApi/swap/v2/trade/leverage', { symbol, leverage: String(leverage), side: 'SHORT' }),
    ]);

    // Accept if at least one side succeeded
    if (resLong.code !== 0 && resShort.code !== 0) {
      return res.status(400).json({ ok: false, error: resLong.msg || resShort.msg });
    }

    res.json({ ok: true, data: { long: resLong.data, short: resShort.data } });
  } catch (err) {
    console.error('[Orders] leverage error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
