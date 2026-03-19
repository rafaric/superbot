import { buildAuthQuery } from '../utils/auth.js';
import { send, sendWithButtons, esc } from './telegram.js';
import { getPositions } from './bingx.js';

const getBaseUrl = () => process.env.BINGX_BASE_URL;
const getApiKey  = () => process.env.BINGX_API_KEY;

async function privatePost(path, params = {}) {
  const query = buildAuthQuery(params, process.env.BINGX_API_SECRET);
  const res = await fetch(`${getBaseUrl()}${path}`, {
    method: 'POST',
    headers: { 'X-BX-APIKEY': getApiKey(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: query,
  });
  if (!res.ok) throw new Error(`BingX HTTP ${res.status}`);
  return res.json();
}

/**
 * Sends a message listing open positions with a "Cerrar" button for each.
 */
export async function sendCloseMenu() {
  const data = await getPositions();
  const open = (Array.isArray(data) ? data : [])
    .filter((p) => Math.abs(parseFloat(p.positionAmt ?? 0)) > 0);

  if (!open.length) {
    send('📭 No hay posiciones abiertas para cerrar.');
    return;
  }

  for (const p of open) {
    const amt         = parseFloat(p.positionAmt ?? 0);
    const side        = (p.positionSide ?? (amt > 0 ? 'LONG' : 'SHORT')).toUpperCase();
    const displaySide = side === 'LONG' ? 'Long' : 'Short';
    const qty         = Math.abs(amt);
    const entry       = parseFloat(p.entryPrice ?? p.avgPrice ?? 0);
    const mark        = parseFloat(p.markPrice ?? 0);
    const pnl         = parseFloat(p.unrealizedProfit ?? p.unRealizedProfit ?? 0);
    const lev         = parseInt(p.leverage ?? 1);
    const pnlSign     = pnl >= 0 ? '+' : '';
    const pnlEmoji    = pnl >= 0 ? '🟢' : '🔴';

    const msg = [
      `${pnlEmoji} <b>${esc(p.symbol)}</b> | ${displaySide} | x${lev}`,
      `Entrada: <code>${esc(entry.toFixed(2))}</code> | Mark: <code>${esc(mark.toFixed(2))}</code>`,
      `PnL: <code>${pnlSign}${esc(pnl.toFixed(2))} USDT</code>`,
    ].join('\n');

    // Encode: close|SYMBOL|SIDE|QTY
    const cbData = `close|${p.symbol}|${side}|${qty}`;

    sendWithButtons(msg, [
      [{ text: `✕ Cerrar ${displaySide} (${qty} ${p.symbol.split('-')[0]})`, callback_data: cbData }],
      [{ text: '↩ Mantener', callback_data: 'ignore' }],
    ]);
  }
}

/**
 * Executes a market close from a Telegram callback.
 * callbackData format: "close|BTC-USDT|LONG|0.001"
 */
export async function closePositionFromTelegram(callbackData) {
  const parts = callbackData.split('|');
  if (parts.length < 4) throw new Error('Invalid callback data');

  const [, symbol, positionSide, qtyStr] = parts;
  const qty  = parseFloat(qtyStr);
  // To close: LONG → SELL, SHORT → BUY
  const side = positionSide === 'LONG' ? 'SELL' : 'BUY';

  const params = {
    symbol,
    side,
    positionSide,
    type:     'MARKET',
    quantity: String(qty),
  };

  const data = await privatePost('/openApi/swap/v2/trade/order', params);
  if (data.code !== 0) throw new Error(data.msg ?? 'Close order failed');

  const filled  = data.data?.price ?? data.data?.avgPrice ?? '—';
  const pnl     = parseFloat(data.data?.profit ?? data.data?.realizedPnl ?? 0);
  const pnlSign = pnl >= 0 ? '+' : '';
  const emoji   = pnl >= 0 ? '🟢' : '🔴';

  send(
    `${emoji} <b>Posición Cerrada</b>\n` +
    `─────────────────────\n` +
    `Par: <b>${esc(symbol)}</b> | ${positionSide === 'LONG' ? 'Long' : 'Short'}\n` +
    `Cantidad: <code>${esc(String(qty))}</code>\n` +
    `Precio: <code>${esc(Number(filled).toFixed(2))}</code>\n` +
    `PnL realizado: <code>${pnlSign}${esc(pnl.toFixed(2))} USDT</code>`
  );
}
