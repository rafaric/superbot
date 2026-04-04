import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getMarkPrice } from './bingx.js';
import { send, isEnabled } from './telegram.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR   = resolve(__dirname, '../../data');
const TRADES_FILE = resolve(DATA_DIR, 'trades.json');

// Timeout por timeframe (ms): si no toca SL/TP, se cierra como TIMEOUT
const TIMEOUT_BY_INTERVAL = {
  '1m':  1  * 60 * 60 * 1000,
  '5m':  3  * 60 * 60 * 1000,
  '15m': 4  * 60 * 60 * 1000,
  '30m': 6  * 60 * 60 * 1000,
  '1h':  12 * 60 * 60 * 1000,
  '4h':  48 * 60 * 60 * 1000,
};

const DEFAULT_TIMEOUT = 8 * 60 * 60 * 1000;

// ─── Persistencia ─────────────────────────────────────────────────────────────

function loadTrades() {
  try {
    if (!existsSync(TRADES_FILE)) return [];
    return JSON.parse(readFileSync(TRADES_FILE, 'utf-8'));
  } catch {
    console.warn('[Journal] No se pudo leer trades.json, iniciando vacío');
    return [];
  }
}

function saveTrades(trades) {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(TRADES_FILE, JSON.stringify(trades, null, 2));
  } catch (err) {
    console.error('[Journal] Error al guardar trades.json:', err.message);
  }
}

// ─── ID único ─────────────────────────────────────────────────────────────────

function generateId() {
  return `trade_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Registra una nueva señal como trade simulado abierto.
 * @param {object} params
 * @param {string} params.symbol     — ej. 'AVAX-USDT'
 * @param {string} params.interval   — ej. '1h'
 * @param {string} params.side       — 'BUY' | 'SELL'
 * @param {number} params.entryPrice — precio de entrada (candle.close al momento de la señal)
 * @param {number} params.sl         — stop loss
 * @param {number} params.tp         — take profit
 */
export function openTrade({ symbol, interval, side, entryPrice, sl, tp }) {
  const trades = loadTrades();
  const id      = generateId();
  const timeout = TIMEOUT_BY_INTERVAL[interval] ?? DEFAULT_TIMEOUT;

  const trade = {
    id,
    symbol,
    interval,
    side,
    entryPrice,
    sl,
    tp,
    openedAt:  Date.now(),
    expiresAt: Date.now() + timeout,
    status:    'OPEN',      // OPEN | WIN | LOSS | TIMEOUT
    closePrice: null,
    closedAt:   null,
    pnlPct:     null,       // % de ganancia/pérdida relativo al entry
  };

  trades.push(trade);
  saveTrades(trades);
  console.log(`[Journal] Trade abierto: ${side} ${symbol} ${interval} @ ${entryPrice} | SL:${sl} TP:${tp} | exp: ${new Date(trade.expiresAt).toLocaleTimeString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}`);
  return trade;
}

/**
 * Revisa todos los trades abiertos contra el precio actual.
 * Cierra los que tocaron SL, TP, o expiraron.
 * Llamar periódicamente (ej. cada 60 segundos).
 */
export async function checkOpenTrades() {
  const trades = loadTrades();
  const open   = trades.filter((t) => t.status === 'OPEN');
  if (open.length === 0) return;

  const now = Date.now();
  let changed = false;

  for (const trade of open) {
    try {
      // Expiración antes de pedir precio
      if (now >= trade.expiresAt) {
        _closeTrade(trades, trade, 'TIMEOUT', trade.entryPrice);
        changed = true;
        continue;
      }

      const price = await getMarkPrice(trade.symbol);
      const isBuy = trade.side === 'BUY';

      const hitTP = isBuy ? price >= trade.tp : price <= trade.tp;
      const hitSL = isBuy ? price <= trade.sl : price >= trade.sl;

      if (hitTP) {
        _closeTrade(trades, trade, 'WIN', price);
        changed = true;
      } else if (hitSL) {
        _closeTrade(trades, trade, 'LOSS', price);
        changed = true;
      }
    } catch (err) {
      console.warn(`[Journal] Error al verificar ${trade.symbol}: ${err.message}`);
    }

    // Pausa entre requests para no saturar la API
    await _sleep(300);
  }

  if (changed) saveTrades(trades);
}

/**
 * Retorna estadísticas del día actual (hora AR).
 * @returns {{ total, wins, losses, timeouts, wr, pf, pnlPct, trades }}
 */
export function getDailyStats() {
  const trades = loadTrades();
  const today  = _todayAR();

  const dayTrades = trades.filter((t) => {
    if (!t.closedAt && !t.openedAt) return false;
    const ts = t.closedAt ?? t.openedAt;
    return _dateAR(ts) === today;
  });

  const closed  = dayTrades.filter((t) => t.status !== 'OPEN');
  const wins     = closed.filter((t) => t.status === 'WIN');
  const losses   = closed.filter((t) => t.status === 'LOSS');
  const timeouts = closed.filter((t) => t.status === 'TIMEOUT');
  const open     = dayTrades.filter((t) => t.status === 'OPEN');

  const grossProfit = wins.reduce((s, t) => s + Math.abs(t.pnlPct ?? 0), 0);
  const grossLoss   = losses.reduce((s, t) => s + Math.abs(t.pnlPct ?? 0), 0);
  const pf          = grossLoss === 0 ? (grossProfit > 0 ? Infinity : 0) : grossProfit / grossLoss;
  const wr          = closed.length > 0 ? wins.length / closed.length : 0;
  const pnlPct      = closed.reduce((s, t) => s + (t.pnlPct ?? 0), 0);

  return {
    total:    dayTrades.length,
    closed:   closed.length,
    wins:     wins.length,
    losses:   losses.length,
    timeouts: timeouts.length,
    open:     open.length,
    wr:       wr,
    pf:       pf,
    pnlPct:   pnlPct,
    trades:   dayTrades,
  };
}

/**
 * Envía el resumen diario por Telegram.
 */
export function sendDailySummary() {
  if (!isEnabled()) return;

  const stats = getDailyStats();
  const today = _todayAR();

  if (stats.total === 0) {
    send(`📋 <b>Resumen diario ${today}</b>\n─────────────────────\nSin señales hoy.`);
    return;
  }

  const pfStr = isFinite(stats.pf) ? stats.pf.toFixed(2) : '∞';
  const wrPct = (stats.wr * 100).toFixed(0);
  const pnlSign = stats.pnlPct >= 0 ? '+' : '';
  const pnlEmoji = stats.pnlPct > 0 ? '💚' : stats.pnlPct < 0 ? '🔴' : '⚪';

  const lines = [
    `📋 <b>Resumen diario ${today}</b>`,
    `─────────────────────`,
    `Señales: <b>${stats.total}</b> (${stats.open} abiertas)`,
    `✅ Wins: <b>${stats.wins}</b> | ❌ Losses: <b>${stats.losses}</b> | ⏱ Timeout: <b>${stats.timeouts}</b>`,
    ``,
    `📊 WR: <b>${wrPct}%</b> | PF: <b>${pfStr}</b>`,
    `${pnlEmoji} PnL simulado: <b>${pnlSign}${stats.pnlPct.toFixed(2)}%</b>`,
    ``,
  ];

  if (stats.trades.length > 0) {
    lines.push(`<b>Detalle:</b>`);
    for (const t of stats.trades) {
      const statusEmoji = t.status === 'WIN' ? '✅' : t.status === 'LOSS' ? '❌' : t.status === 'TIMEOUT' ? '⏱' : '🔵';
      const pnl = t.pnlPct != null ? ` (${t.pnlPct >= 0 ? '+' : ''}${t.pnlPct.toFixed(2)}%)` : '';
      const hora = t.closedAt
        ? new Date(t.closedAt).toLocaleTimeString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit' })
        : 'abierto';
      lines.push(`${statusEmoji} ${t.symbol} ${t.interval} ${t.side}${pnl} — ${hora}`);
    }
  }

  send(lines.join('\n'));
  console.log(`[Journal] Resumen diario enviado — ${stats.wins}W/${stats.losses}L/${stats.timeouts}T | PF:${pfStr} WR:${wrPct}%`);
}

/**
 * Inicia el polling de trades abiertos (cada POLL_INTERVAL_MS).
 * Inicia el cron de resumen diario (23:59 hora AR).
 */
export function startJournal() {
  const POLL_MS = parseInt(process.env.JOURNAL_POLL_MS ?? 60_000); // default 1 minuto

  // Polling de trades abiertos
  setInterval(async () => {
    try {
      await checkOpenTrades();
    } catch (err) {
      console.error('[Journal] Error en checkOpenTrades:', err.message);
    }
  }, POLL_MS);

  // Cron diario 23:59 hora AR
  _scheduleDailyAt(23, 59, () => {
    console.log('[Journal] Enviando resumen diario...');
    sendDailySummary();
  });

  const openCount = loadTrades().filter((t) => t.status === 'OPEN').length;
  console.log(`[Journal] Iniciado — polling cada ${POLL_MS / 1000}s | ${openCount} trades abiertos`);
}

// ─── Helpers privados ─────────────────────────────────────────────────────────

/**
 * Cierra un trade en el array en memoria (sin guardar — el caller guarda).
 */
function _closeTrade(trades, trade, status, closePrice) {
  const idx = trades.findIndex((t) => t.id === trade.id);
  if (idx === -1) return;

  const isBuy  = trade.side === 'BUY';
  const pnlPct = isBuy
    ? ((closePrice - trade.entryPrice) / trade.entryPrice) * 100
    : ((trade.entryPrice - closePrice) / trade.entryPrice) * 100;

  trades[idx] = {
    ...trade,
    status,
    closePrice,
    closedAt: Date.now(),
    pnlPct: parseFloat(pnlPct.toFixed(4)),
  };

  const emoji = status === 'WIN' ? '✅' : status === 'LOSS' ? '❌' : '⏱';
  console.log(`[Journal] ${emoji} ${status} — ${trade.side} ${trade.symbol} ${trade.interval} entry:${trade.entryPrice} close:${closePrice} pnl:${pnlPct.toFixed(2)}%`);

  // Notificación inmediata por Telegram al cerrar
  if (isEnabled()) {
    const pnlSign = pnlPct >= 0 ? '+' : '';
    const hora = new Date().toLocaleTimeString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit' });
    const statusLabel = status === 'WIN' ? 'WIN 🏆' : status === 'LOSS' ? 'LOSS 💸' : 'EXPIRADO ⏱';

    send([
      `${emoji} <b>[Journal] Trade cerrado — ${statusLabel}</b>`,
      `─────────────────────`,
      `${trade.side} <b>${trade.symbol}</b> ${trade.interval} | ${hora}`,
      `Entrada: <code>${trade.entryPrice}</code> → Cierre: <code>${closePrice}</code>`,
      `PnL simulado: <b>${pnlSign}${pnlPct.toFixed(2)}%</b>`,
    ].join('\n'));
  }
}

function _sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function _todayAR() {
  return new Date().toLocaleDateString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

function _dateAR(ts) {
  return new Date(ts).toLocaleDateString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

/**
 * Programa una función para ejecutarse cada día a HH:MM hora AR.
 * Se recalcula el delay en cada ejecución para ser preciso sin drift.
 */
function _scheduleDailyAt(hour, minute, fn) {
  function schedule() {
    const now = new Date();
    const ar  = new Date(now.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));

    const next = new Date(ar);
    next.setHours(hour, minute, 0, 0);
    if (next <= ar) next.setDate(next.getDate() + 1);

    const delay = next - ar;
    setTimeout(() => {
      fn();
      schedule(); // reprogramar para el día siguiente
    }, delay);

    console.log(`[Journal] Resumen diario programado en ${Math.round(delay / 60000)} min`);
  }
  schedule();
}
