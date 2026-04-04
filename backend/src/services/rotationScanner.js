/**
 * Rotation Scanner — Fase 2 (PRD v2 §5)
 *
 * When BTC is lateral, scan for altcoins with:
 *   1. Strong relative strength vs BTC (RS > 2)
 *   2. Breakout setup (EMA alignment + RSI + volume + ORB)
 *
 * Only LONG signals allowed — positive RS implies bullish momentum.
 */

import { getKlines } from './bingx.js';
import { calculateEMA, calculateVWAP, calculateRSI, calculateRelativeVolume, calculateORB } from './indicators.js';
import { sendWithButtons, esc, isEnabled } from './telegram.js';
import { calcQuantityFromPct } from './sizeCalculator.js';
import { checkPositionGuard } from './positionGuard.js';
import { getDynamicUniverse } from './dynamicUniverse.js';
import { calculateRS } from './relativeStrength.js';

// ─── Config ───────────────────────────────────────────────────────────────────

const SIGNAL_PCT   = parseFloat(process.env.SIGNAL_PCT ?? 10);
const RSI_UP       = parseFloat(process.env.RSI_UP ?? 55);
const VOL_REL_MIN  = parseFloat(process.env.VOL_REL_MIN ?? 1.2);
const CONCURRENCY  = 4;

// Deduplication: same pattern as scanner.js
const lastRotationSignal = new Map();

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Execute a full rotation scan cycle.
 * Called when BTC regime is 'lateral'.
 */
export async function runRotationScan() {
  const timestamp = new Date().toLocaleTimeString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
  });

  console.log(`[RotationScanner] Starting rotation scan at ${timestamp}`);

  // ── Check position guard (single position rule) ───────────────────────────
  const guard = await checkPositionGuard();
  if (guard.blocked) {
    console.log(`[RotationScanner] Skipping scan — ${guard.reason}`);
    return;
  }

  // ── Fetch BTC 1h candles for RS calculation ───────────────────────────────
  let btcCandles1h;
  try {
    btcCandles1h = await getKlines({ symbol: 'BTC-USDT', interval: '1h', limit: 50 });
  } catch (err) {
    console.error('[RotationScanner] Failed to fetch BTC candles:', err.message);
    return;
  }

  // ── Get dynamic universe ──────────────────────────────────────────────────
  const universe = await getDynamicUniverse();

  if (!universe.length) {
    console.log('[RotationScanner] No pairs in universe — skipping');
    return;
  }

  console.log(`[RotationScanner] Scanning ${universe.length} pairs from dynamic universe`);

  // ── Scan pairs with concurrency ───────────────────────────────────────────
  for (let i = 0; i < universe.length; i += CONCURRENCY) {
    await Promise.all(
      universe.slice(i, i + CONCURRENCY).map((pair) =>
        scanRotationPair(pair.symbol, btcCandles1h)
      )
    );

    if (i + CONCURRENCY < universe.length) {
      await sleep(500);
    }
  }

  console.log('[RotationScanner] Rotation scan complete');
}

// ─── Internal Functions ───────────────────────────────────────────────────────

/**
 * Scan a single pair for rotation setup.
 */
async function scanRotationPair(symbol, btcCandles1h) {
  try {
    // ── Calculate Relative Strength ─────────────────────────────────────────
    const rs = await calculateRS({ symbol, btcCandles1h });

    if (!rs) {
      return; // Couldn't calculate RS
    }

    if (rs.weak) {
      // RS < 0.5 — skip weak performers
      return;
    }

    if (!rs.strong) {
      // RS not > 2 — not strong enough for rotation
      return;
    }

    // ── Strong RS — check for breakout setup on 5m ──────────────────────────
    const candles5m = await getKlines({ symbol, interval: '5m', limit: 100 });

    if (candles5m.length < 22) {
      return; // Not enough data
    }

    // Calculate indicators (same as scanner.js)
    const ema8Series   = calculateEMA(candles5m, 8);
    const ema21Series  = calculateEMA(candles5m, 21);
    const vwapSeries   = calculateVWAP(candles5m);
    const rsiSeries    = calculateRSI(candles5m, 14);
    const relVolSeries = calculateRelativeVolume(candles5m, 20);
    const orbSeries    = calculateORB(candles5m);

    if (!ema8Series.length || !rsiSeries.length) return;

    const last = candles5m[candles5m.length - 1];
    const prev = candles5m[candles5m.length - 2];

    const ema8   = ema8Series[ema8Series.length - 1].value;
    const ema21  = ema21Series[ema21Series.length - 1].value;
    const vwap   = vwapSeries[vwapSeries.length - 1].value;
    const rsi    = rsiSeries[rsiSeries.length - 1].value;
    const relVol = relVolSeries[relVolSeries.length - 1]?.value ?? 0;
    const orb    = orbSeries[orbSeries.length - 1];

    // ── Check LONG conditions ───────────────────────────────────────────────
    // Rotation Mode = LONG only (strong RS implies bullish momentum)
    const condEMABuy  = last.close > ema8 && ema8 > ema21 && ema21 > vwap;
    const condRSIup   = rsi > RSI_UP;
    const condVol     = relVol > VOL_REL_MIN;
    const condORBup   = orb && last.close > orb.orbHigh;

    const condBuy = condEMABuy && condRSIup && condVol && condORBup;

    if (!condBuy) {
      return; // Setup not confirmed
    }

    // ── Check for new signal (deduplication) ────────────────────────────────
    const ema8Prev   = ema8Series[ema8Series.length - 2]?.value ?? ema8;
    const ema21Prev  = ema21Series[ema21Series.length - 2]?.value ?? ema21;
    const vwapPrev   = vwapSeries[vwapSeries.length - 2]?.value ?? vwap;
    const rsiPrev    = rsiSeries[rsiSeries.length - 2]?.value ?? rsi;
    const relVolPrev = relVolSeries[relVolSeries.length - 2]?.value ?? relVol;
    const orbPrev    = orbSeries[orbSeries.length - 2] ?? orb;

    const prevCondBuy =
      prev.close > ema8Prev &&
      ema8Prev > ema21Prev &&
      ema21Prev > vwapPrev &&
      rsiPrev > RSI_UP &&
      relVolPrev > VOL_REL_MIN &&
      orbPrev &&
      prev.close > orbPrev.orbHigh;

    const newBuy = condBuy && !prevCondBuy;

    // Check last signal
    const prevSignal = lastRotationSignal.get(symbol);
    if (newBuy && prevSignal === 'rotation-buy') return;
    if (!condBuy) {
      lastRotationSignal.delete(symbol);
      return;
    }
    if (!newBuy) return;

    lastRotationSignal.set(symbol, 'rotation-buy');

    // ── Send alert ──────────────────────────────────────────────────────────
    await sendRotationAlert({
      symbol,
      candle: last,
      ema8,
      ema21,
      vwap,
      rsi,
      relVol,
      orbHigh: orb?.orbHigh,
      orbLow: orb?.orbLow,
      rs,
    });

    console.log(
      `[RotationScanner] 🔄 ROTATION SIGNAL: ${symbol} @ ${last.close.toFixed(4)} | RS: ${rs.rs.toFixed(2)}`
    );
  } catch (err) {
    console.error(`[RotationScanner] Error scanning ${symbol}:`, err.message);
  }
}

/**
 * Send rotation alert via Telegram.
 */
async function sendRotationAlert({ symbol, candle, ema8, ema21, vwap, rsi, relVol, orbHigh, orbLow, rs }) {
  if (!isEnabled()) return;

  const price   = candle.close;
  const lev     = parseInt(process.env.SIGNAL_LEVERAGE ?? 10);

  const sized     = await calcQuantityFromPct({ symbol, price, pct: SIGNAL_PCT, leverage: lev });
  const ORDER_QTY = sized.error ? parseFloat(process.env.SIGNAL_ORDER_QTY ?? 0.001) : sized.quantity;
  if (sized.error) console.warn(`[RotationScanner] Size calc warning for ${symbol}: ${sized.error}`);

  // ORB-based SL/TP (same logic as scanner.js)
  const orbSL = orbLow ?? price * 0.99; // below ORB Low for longs
  const breakoutDist = Math.abs(price - orbSL);
  const orbTP = price + breakoutDist * 2;

  const slPrice = parseFloat(orbSL).toFixed(4);
  const tpPrice = parseFloat(orbTP).toFixed(4);

  const now = new Date().toLocaleTimeString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    hour: '2-digit',
    minute: '2-digit',
  });

  const rsDisplay = rs.rs.toFixed(2);
  const altRetPct = (rs.altReturn * 100).toFixed(2);
  const btcRetPct = (rs.btcReturn * 100).toFixed(2);

  // HTML format message
  const msg = [
    `🔄 <b>[ROTATION] Señal de COMPRA</b>`,
    `─────────────────────`,
    `Par: <b>${esc(symbol)}</b> | 5m | ${esc(now)}`,
    `Dirección: <b>LONG ▲</b>`,
    ``,
    `💵 Precio: <code>${esc(price.toFixed(4))}</code>`,
    ``,
    `➡️ <b>BTC Lateral</b> — Rotation Mode activo`,
    ``,
    `📊 <b>Relative Strength:</b>`,
    `RS: <code>${esc(rsDisplay)}</code> ${rs.strong ? '🟢 FUERTE' : ''}`,
    `Ret ALT (24h): <code>${esc(altRetPct)}%</code>`,
    `Ret BTC (24h): <code>${esc(btcRetPct)}%</code>`,
    ``,
    `📊 <b>Indicadores:</b>`,
    `EMA 8:  <code>${esc(ema8.toFixed(4))}</code>`,
    `EMA 21: <code>${esc(ema21.toFixed(4))}</code>`,
    `VWAP:   <code>${esc(vwap.toFixed(4))}</code>`,
    ``,
    `📋 <b>Filtros activos:</b>`,
    `EMA8 &gt; EMA21 &gt; VWAP ✅`,
    `RSI(14): <code>${esc(rsi.toFixed(1))}</code> &gt; ${RSI_UP} ✅`,
    `Vol Rel: <code>${esc(relVol.toFixed(2))}x</code> &gt; ${VOL_REL_MIN} ✅`,
    `ORB High: <code>${esc(orbHigh?.toFixed(4) ?? 'N/A')}</code> breakout ✅`,
    `RS &gt; 2: <code>${esc(rsDisplay)}</code> ✅`,
    ``,
    `🎯 <b>Sugerencia:</b>`,
    `Entrada: <code>${esc(price.toFixed(4))}</code>`,
    `SL: <code>${esc(slPrice)}</code> (ORB Low) | TP: <code>${esc(tpPrice)}</code> (1:2 R/R)`,
    `Cantidad: <code>${esc(String(ORDER_QTY))}</code> (${SIGNAL_PCT}% del balance)`,
    ``,
    `⚠️ <i>Rotation Mode: solo LONGS. Gestioná tu riesgo.</i>`,
  ].join('\n');

  const cbData = `exec|BUY|${symbol}|${ORDER_QTY}|${price.toFixed(4)}|${slPrice}|${tpPrice}`;

  sendWithButtons(msg, [
    [{ text: `✅ Ejecutar COMPRA (${ORDER_QTY} ${symbol.split('-')[0]})`, callback_data: cbData }],
    [{ text: '❌ Ignorar', callback_data: 'ignore' }],
  ]);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
