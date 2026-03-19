import { send, esc, isEnabled } from './telegram.js';

const PNL_ALERT_UP   = parseFloat(process.env.PNL_ALERT_UP   ?? 5);
const PNL_ALERT_DOWN = parseFloat(process.env.PNL_ALERT_DOWN ?? -3);
const alertedPositions = new Map();

export function notifyPositionOpened({ symbol, side, quantity, price, leverage }) {
  if (!isEnabled()) return;
  send(
    `🟢 <b>Posición Abierta</b>\n` +
    `─────────────────────\n` +
    `Par: <b>${esc(symbol)}</b> | ${esc(side)} | x${esc(leverage)}\n` +
    `Cantidad: <code>${esc(quantity)}</code>\n` +
    `Precio: <code>${esc(Number(price).toFixed(2))}</code>`
  );
}

export function notifyPositionClosed({ symbol, side, quantity, price, realizedPnl }) {
  if (!isEnabled()) return;
  const pnl   = parseFloat(realizedPnl ?? 0);
  const sign  = pnl >= 0 ? '+' : '';
  const emoji = pnl >= 0 ? '🟢' : '🔴';
  send(
    `${emoji} <b>Posición Cerrada</b>\n` +
    `─────────────────────\n` +
    `Par: <b>${esc(symbol)}</b> | ${esc(side)}\n` +
    `Cantidad: <code>${esc(quantity)}</code>\n` +
    `Precio cierre: <code>${esc(Number(price).toFixed(2))}</code>\n` +
    `PnL realizado: <code>${sign}${esc(pnl.toFixed(2))} USDT</code>`
  );
}

export function checkPnLAlerts(positions) {
  if (!isEnabled() || !positions?.length) return;
  for (const pos of positions) {
    const key = `${pos.symbol}-${pos.side}`;
    const roe = pos.entryPrice > 0
      ? ((pos.markPrice - pos.entryPrice) / pos.entryPrice) * 100
        * (pos.side === 'Long' ? 1 : -1) * pos.leverage
      : 0;
    const alerted = alertedPositions.get(key);
    if (roe >= PNL_ALERT_UP && alerted !== 'up') {
      alertedPositions.set(key, 'up');
      send(
        `🚀 <b>Alerta PnL +${PNL_ALERT_UP}%</b>\n` +
        `${esc(pos.symbol)} ${pos.side} x${pos.leverage}\n` +
        `ROE: <code>+${esc(roe.toFixed(2))}%</code> | PnL: <code>+${esc(pos.unrealizedProfit.toFixed(2))} USDT</code>`
      );
    } else if (roe <= PNL_ALERT_DOWN && alerted !== 'down') {
      alertedPositions.set(key, 'down');
      send(
        `⚠️ <b>Alerta PnL ${PNL_ALERT_DOWN}%</b>\n` +
        `${esc(pos.symbol)} ${pos.side} x${pos.leverage}\n` +
        `ROE: <code>${esc(roe.toFixed(2))}%</code> | PnL: <code>${esc(pos.unrealizedProfit.toFixed(2))} USDT</code>`
      );
    } else if (roe > PNL_ALERT_DOWN && roe < PNL_ALERT_UP) {
      alertedPositions.delete(key);
    }
  }
}

export function notifyWSReconnect(stream) {
  if (!isEnabled()) return;
  send(`🔄 WebSocket reconectado: <code>${esc(stream)}</code>`);
}
