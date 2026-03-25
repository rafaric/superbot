import { getKlines } from './bingx.js';
import { calculateEMA, calculateVWAP, calculateRSI, calculateRelativeVolume, calculateORB } from './indicators.js';
import { sendWithButtons, esc, isEnabled } from './telegram.js';
import { calcQuantityFromPct } from './sizeCalculator.js';
import { TRADING_PAIRS } from '../index.js';
import { getActivePairs } from './autoCalibrator.js';
import { activePairs } from './autoCalibrator.js';

const SCAN_INTERVAL_MS = parseInt(process.env.SCAN_INTERVAL_MS ?? 15 * 60 * 1000); // default 15m
const SCAN_TIMEFRAME   = process.env.SCAN_TIMEFRAME ?? '15m';
const SIGNAL_PCT       = parseFloat(process.env.SIGNAL_PCT ?? 10);

const lastSignal = new Map();
let scanTimer = null;

export function startScanner() {
  if (scanTimer) return;
  console.log(`[Scanner] Starting — ${TRADING_PAIRS.length} pairs, every ${SCAN_INTERVAL_MS / 1000}s on ${SCAN_TIMEFRAME}`);
  runScan();
  scanTimer = setInterval(runScan, SCAN_INTERVAL_MS);
}

export function stopScanner() {
  if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
  console.log('[Scanner] Stopped');
}

async function runScan() {
  const timestamp  = new Date().toLocaleTimeString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
  const calibrated = getActivePairs();

  // Use calibrated pairs if available, otherwise fall back to all TRADING_PAIRS with default timeframe
  const pairsToScan = activePairs.length > 0
    ? activePairs
    : TRADING_PAIRS.map((symbol) => ({ symbol, interval: SCAN_TIMEFRAME }));

  console.log(`[Scanner] Running scan at ${timestamp} — ${pairsToScan.length} pairs`);

  const CONCURRENCY = 4;
  for (let i = 0; i < pairsToScan.length; i += CONCURRENCY) {
    await Promise.all(pairsToScan.slice(i, i + CONCURRENCY).map(({ symbol, interval }) =>
      scanPair(symbol, interval)
    ));
    if (i + CONCURRENCY < pairsToScan.length) await sleep(500);
  }
}

async function scanPair(symbol, interval = SCAN_TIMEFRAME) {
  try {
    const candles15m = await getKlines({ symbol, interval, limit: 200 });
    if (candles15m.length < 22) return;

    const ema8Series   = calculateEMA(candles15m, 8);
    const ema21Series  = calculateEMA(candles15m, 21);
    const vwapSeries   = calculateVWAP(candles15m);
    const rsiSeries    = calculateRSI(candles15m, 14);
    const relVolSeries = calculateRelativeVolume(candles15m, 20);
    const orbSeries    = calculateORB(candles15m);

    if (!ema8Series.length || !rsiSeries.length) return;

    const last = candles15m[candles15m.length - 1];
    const prev = candles15m[candles15m.length - 2];

    const ema8   = ema8Series[ema8Series.length - 1].value;
    const ema21  = ema21Series[ema21Series.length - 1].value;
    const vwap   = vwapSeries[vwapSeries.length - 1].value;
    const rsi    = rsiSeries[rsiSeries.length - 1].value;
    const relVol = relVolSeries[relVolSeries.length - 1]?.value ?? 0;
    const orb    = orbSeries[orbSeries.length - 1];

    const ema8Prev   = ema8Series[ema8Series.length - 2]?.value   ?? ema8;
    const ema21Prev  = ema21Series[ema21Series.length - 2]?.value  ?? ema21;
    const vwapPrev   = vwapSeries[vwapSeries.length - 2]?.value   ?? vwap;
    const rsiPrev    = rsiSeries[rsiSeries.length - 2]?.value     ?? rsi;
    const relVolPrev = relVolSeries[relVolSeries.length - 2]?.value ?? relVol;
    const orbPrev    = orbSeries[orbSeries.length - 2] ?? orb;

    const RSI_UP      = parseFloat(process.env.RSI_UP      ?? 55);
    const RSI_DOWN    = parseFloat(process.env.RSI_DOWN    ?? 45);
    const VOL_REL_MIN = parseFloat(process.env.VOL_REL_MIN ?? 1.2);

    const condEMABuy  = last.close > ema8  && ema8  > ema21 && ema21 > vwap;
    const condEMASell = last.close < ema8  && ema8  < ema21 && ema21 < vwap;
    const condRSIup   = rsi > RSI_UP;
    const condRSIdown = rsi < RSI_DOWN;
    const condVol     = relVol > VOL_REL_MIN;
    const condORBup   = orb  && last.close > orb.orbHigh;
    const condORBdown = orb  && last.close < orb.orbLow;

    const condBuy  = condEMABuy  && condRSIup   && condVol && condORBup;
    const condSell = condEMASell && condRSIdown  && condVol && condORBdown;

    const prevEMABuy   = prev.close > ema8Prev  && ema8Prev  > ema21Prev && ema21Prev > vwapPrev;
    const prevEMASell  = prev.close < ema8Prev  && ema8Prev  < ema21Prev && ema21Prev < vwapPrev;
    const prevCondBuy  = prevEMABuy  && rsiPrev > RSI_UP   && relVolPrev > VOL_REL_MIN && orbPrev && prev.close > orbPrev.orbHigh;
    const prevCondSell = prevEMASell && rsiPrev < RSI_DOWN  && relVolPrev > VOL_REL_MIN && orbPrev && prev.close < orbPrev.orbLow;

    const newBuy  = condBuy  && !prevCondBuy;
    const newSell = condSell && !prevCondSell;

    const prev_signal = lastSignal.get(symbol);
    if (newBuy  && prev_signal === 'buy')  return;
    if (newSell && prev_signal === 'sell') return;
    if (!condBuy && !condSell) { lastSignal.delete(symbol); return; }
    if (!newBuy && !newSell) return;

    lastSignal.set(symbol, newBuy ? 'buy' : 'sell');

    await sendSignalAlert({
      symbol, type: newBuy ? 'BUY' : 'SELL',
      candle: last, ema8, ema21, vwap, rsi, relVol,
      orbHigh: orb?.orbHigh, orbLow: orb?.orbLow,
      interval,
    });

  } catch (err) {
    console.error(`[Scanner] Error scanning ${symbol}:`, err.message);
  }
}

async function sendSignalAlert({ symbol, interval, type, candle, ema8, ema21, vwap, rsi, relVol, orbHigh, orbLow }) {
  if (!isEnabled()) return;

  const isBuy   = type === 'BUY';
  const emoji   = isBuy ? '🟢' : '🔴';
  const action  = isBuy ? 'COMPRA' : 'VENTA';
  const dir     = isBuy ? 'LONG ▲' : 'SHORT ▼';
  const price   = candle.close;
  const lev     = parseInt(process.env.SIGNAL_LEVERAGE ?? 10);

  const sized     = await calcQuantityFromPct({ symbol, price, pct: SIGNAL_PCT, leverage: lev });
  const ORDER_QTY = sized.error ? parseFloat(process.env.SIGNAL_ORDER_QTY ?? 0.001) : sized.quantity;
  if (sized.error) console.warn(`[Scanner] Size calc warning for ${symbol}: ${sized.error}`);

  // ORB-based SL/TP:
  // SL = opposite side of the ORB (invalidation level)
  // TP = entry + 2x the breakout distance (1:2 R/R)
  const orbSL = isBuy
    ? (orbLow  ?? price * 0.99)   // below ORB Low for longs
    : (orbHigh ?? price * 1.01);  // above ORB High for shorts

  const breakoutDist = Math.abs(price - orbSL);
  const orbTP = isBuy
    ? price + breakoutDist * 2
    : price - breakoutDist * 2;

  const slPrice = parseFloat(orbSL).toFixed(4);
  const tpPrice = parseFloat(orbTP).toFixed(4);
  const now = new Date().toLocaleTimeString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit',
  });

  const VOL_REL_MIN = parseFloat(process.env.VOL_REL_MIN ?? 1.2);
  const RSI_UP      = parseFloat(process.env.RSI_UP      ?? 55);
  const RSI_DOWN    = parseFloat(process.env.RSI_DOWN    ?? 45);

  // HTML format — only & < > need escaping, everything else is literal
  const msg = [
    `${emoji} <b>[SCANNER] Señal de ${esc(action)}</b>`,
    `─────────────────────`,
    `Par: <b>${esc(symbol)}</b> | ${esc(interval)} | ${esc(now)}`,
    `Dirección: <b>${esc(dir)}</b>`,
    ``,
    `💵 Precio: <code>${esc(price.toFixed(2))}</code>`,
    ``,
    `📊 <b>Indicadores:</b>`,
    `EMA 8:  <code>${esc(ema8.toFixed(2))}</code>`,
    `EMA 21: <code>${esc(ema21.toFixed(2))}</code>`,
    `VWAP:   <code>${esc(vwap.toFixed(2))}</code>`,
    ``,
    `📋 <b>Filtros activos:</b>`,
    isBuy
      ? `EMA8 &gt; EMA21 &gt; VWAP ✅`
      : `EMA8 &lt; EMA21 &lt; VWAP ✅`,
    `RSI(14): <code>${esc(rsi != null ? rsi.toFixed(1) : 'N/A')}</code> ${isBuy ? `&gt; ${RSI_UP}` : `&lt; ${RSI_DOWN}`} ✅`,
    `Vol Rel: <code>${esc(relVol != null ? relVol.toFixed(2) : 'N/A')}x</code> &gt; ${VOL_REL_MIN} ✅`,
    isBuy
      ? `ORB High: <code>${esc(orbHigh != null ? orbHigh.toFixed(2) : 'N/A')}</code> precio sobre ORB ✅`
      : `ORB Low: <code>${esc(orbLow != null ? orbLow.toFixed(2) : 'N/A')}</code> precio bajo ORB ✅`,
    ``,
    `🎯 <b>Sugerencia:</b>`,
    `Entrada: <code>${esc(price.toFixed(2))}</code>`,
    `SL: <code>${esc(slPrice)}</code> (ORB ${isBuy ? 'Low' : 'High'}) | TP: <code>${esc(tpPrice)}</code> (1:2 R/R)`,
    `Cantidad: <code>${esc(String(ORDER_QTY))}</code> (${SIGNAL_PCT}% del balance)`,
    ``,
    `⚠️ <i>Gestioná tu riesgo.</i>`,
  ].join('\n');

  const cbData = `exec|${type}|${symbol}|${ORDER_QTY}|${price.toFixed(2)}|${slPrice}|${tpPrice}`;
  console.log(`[Scanner] 🚨 Signal ${type} on ${symbol} @ ${price.toFixed(2)}`);

  sendWithButtons(msg, [
    [{ text: `${isBuy ? '✅' : '🔴'} Ejecutar ${action} (${ORDER_QTY} ${symbol.split('-')[0]})`, callback_data: cbData }],
    [{ text: '❌ Ignorar', callback_data: 'ignore' }],
  ]);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
