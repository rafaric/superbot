import { Router } from 'express';
import { sendWithButtons, esc } from '../services/telegram.js';
import { placeOrderFromSignal } from '../services/signalTrader.js';

const router = Router();

const DEFAULT_QTY = parseFloat(process.env.SIGNAL_ORDER_QTY ?? 0.001);

/**
 * POST /api/signals/alert
 * Called by the frontend when a BUY or SELL signal is detected.
 * Body: { type, symbol, interval, price, ema8, ema21, vwap }
 */
router.post('/alert', (req, res) => {
  const { type, symbol, interval, price, ema8, ema21, vwap } = req.body;

  if (!type || !symbol) {
    return res.status(400).json({ ok: false, error: 'type and symbol required' });
  }

  const isBuy   = type.toUpperCase() === 'BUY';
  const emoji   = isBuy ? '🟢' : '🔴';
  const action  = isBuy ? 'COMPRA' : 'VENTA';
  const dir     = isBuy ? 'LONG ▲' : 'SHORT ▼';

  const slPct   = isBuy ? 0.99 : 1.01;
  const tpPct   = isBuy ? 1.02 : 0.98;
  const slPrice = (price * slPct).toFixed(2);
  const tpPrice = (price * tpPct).toFixed(2);

  const msg = [
    `${emoji} <b>Señal de ${esc(action)}</b>`,
    `─────────────────────`,
    `Par: <b>${esc(symbol)}</b> | ${esc(interval)}`,
    `Dirección: <b>${esc(dir)}</b>`,
    ``,
    `💵 Precio actual: <code>${esc(price.toFixed(2))}</code>`,
    ``,
    `📊 <b>Indicadores:</b>`,
    `EMA 8:  <code>${esc(Number(ema8).toFixed(2))}</code>`,
    `EMA 21: <code>${esc(Number(ema21).toFixed(2))}</code>`,
    `VWAP:   <code>${esc(Number(vwap).toFixed(2))}</code>`,
    ``,
    `📋 <b>Condición cumplida:</b>`,
    isBuy
      ? `Precio &gt; EMA8 &gt; EMA21 &gt; VWAP ✅`
      : `Precio &lt; EMA8 &lt; EMA21 &lt; VWAP ✅`,
    ``,
    `🎯 <b>Sugerencia de entrada:</b>`,
    `Entrada: <code>${esc(price.toFixed(2))}</code>`,
    `SL: <code>${esc(slPrice)}</code> (1%) | TP: <code>${esc(tpPrice)}</code> (2%)`,
    `Cantidad: <code>${esc(String(DEFAULT_QTY))}</code>`,
    ``,
    `⚠️ <i>Siempre gestioná tu riesgo.</i>`,
  ].join('\n');

  const cbData = `exec|${type.toUpperCase()}|${symbol}|${DEFAULT_QTY}|${price.toFixed(2)}|${slPrice}|${tpPrice}`;

  sendWithButtons(msg, [
    [{ text: `${isBuy ? '✅' : '🔴'} Ejecutar ${action} (${DEFAULT_QTY} ${symbol.split('-')[0]})`, callback_data: cbData }],
    [{ text: '❌ Ignorar', callback_data: 'ignore' }],
  ]);

  res.json({ ok: true });
});

export default router;
