import { buildAuthQuery } from '../utils/auth.js';
import { send, esc } from './telegram.js';
import { calcQuantityFromPct } from './sizeCalculator.js';

const getBaseUrl = () => process.env.BINGX_BASE_URL;
const getApiKey = () => process.env.BINGX_API_KEY;

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
 * Executes a trade from a Telegram signal callback.
 * Called when user taps "Ejecutar" button.
 *
 * @param {string} callbackData  Format: "exec|BUY|BTC-USDT|0.001|73000|72270|74460"
 */
export async function placeOrderFromSignal(callbackData) {
  const parts = callbackData.split('|');
  if (parts.length < 4) throw new Error('Invalid callback data');

  const [, type, symbol, qtyFromCallback, entryPrice, slPrice, tpPrice] = parts;
  const side         = type.toUpperCase();
  const positionSide = side === 'BUY' ? 'LONG' : 'SHORT';
  const lev          = parseInt(process.env.SIGNAL_LEVERAGE ?? 10);
  const pct          = parseFloat(process.env.SIGNAL_PCT ?? 10);

  // Recalculate quantity from current balance at execution time
  // (price may have moved since signal was generated)
  const sized    = await calcQuantityFromPct({ symbol, price: parseFloat(entryPrice), pct, leverage: lev });
  const quantity = sized.error ? parseFloat(qtyFromCallback) : sized.quantity;

  if (sized.error) {
    console.warn(`[SignalTrader] Size calc warning: ${sized.error} — using callback qty ${qtyFromCallback}`);
  } else {
    console.log(`[SignalTrader] Sized: ${quantity} ${symbol} (${pct}% of ${sized.availableBalance.toFixed(2)} USDT @ x${lev})`);
  }
  await Promise.all([
    privatePost('/openApi/swap/v2/trade/leverage', { symbol, leverage: lev, side: 'LONG' }),
    privatePost('/openApi/swap/v2/trade/leverage', { symbol, leverage: lev, side: 'SHORT' }),
  ]).catch(() => {}); // non-blocking

  // 2. Place market order with SL/TP
  const params = {
    symbol,
    side,
    positionSide,
    type:     'MARKET',
    quantity: String(quantity),
  };

  if (slPrice) {
    params.stopLoss = JSON.stringify({
      type:        'STOP_MARKET',
      stopPrice:   parseFloat(slPrice),
      workingType: 'MARK_PRICE',
    });
  }

  if (tpPrice) {
    params.takeProfit = JSON.stringify({
      type:        'TAKE_PROFIT_MARKET',
      stopPrice:   parseFloat(tpPrice),
      workingType: 'MARK_PRICE',
    });
  }

  const data = await privatePost('/openApi/swap/v2/trade/order', params);

  if (data.code !== 0) {
    throw new Error(data.msg ?? 'Order failed');
  }

  const filled = data.data?.price ?? data.data?.avgPrice ?? entryPrice;
  const emoji  = side === 'BUY' ? '🟢' : '🔴';

  send(
    `${emoji} <b>Orden ejecutada desde señal</b>\n` +
    `─────────────────────\n` +
    `Par: <b>${esc(symbol)}</b> | ${positionSide}\n` +
    `Cantidad: <code>${esc(String(quantity))}</code>\n` +
    `Precio fill: <code>${esc(Number(filled).toFixed(2))}</code>\n` +
    `Stop Loss: <code>${esc(slPrice ?? '—')}</code>\n` +
    `Take Profit: <code>${esc(tpPrice ?? '—')}</code>\n` +
    `Apalancamiento: <code>x${esc(String(lev))}</code>`
  );

  return data.data;
}
