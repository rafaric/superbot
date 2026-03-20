import { runBacktest } from './backtester.js';
import { send, esc, isEnabled } from './telegram.js';

// Timeframes to evaluate
const CANDIDATE_TIMEFRAMES = ['5m', '15m', '1h'];
// Minimum criteria to consider a pair+timeframe "active"
const MIN_TRADES     = 3;
const MIN_WIN_RATE   = 40;   // %
const MIN_PNL        = 0;    // must be positive
const CANDLES_TO_TEST = 300;

// Active pairs stored in memory — scanner reads this
let activePairs = [];
let lastCalibration = null;

export function getActivePairs() {
  return activePairs.length > 0 ? activePairs : null; // null = use all pairs (fallback)
}

export function getLastCalibration() {
  return lastCalibration;
}

/**
 * Runs backtest on all pairs × timeframes, keeps only profitable ones.
 * Called on startup and once daily at 3am Argentina time.
 */
export async function runCalibration(allPairs) {
  console.log(`[Calibrator] Starting calibration — ${allPairs.length} pairs × ${CANDIDATE_TIMEFRAMES.length} timeframes`);
  if (isEnabled()) send('🔄 <b>Calibración automática iniciada</b>\nAnalizando todos los pares...');

  const results = [];
  const CONCURRENCY = 3;

  for (let i = 0; i < allPairs.length; i += CONCURRENCY) {
    const batch = allPairs.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.flatMap((symbol) =>
        CANDIDATE_TIMEFRAMES.map(async (interval) => {
          try {
            const bt = await runBacktest({
              symbol, interval,
              limit:   CANDLES_TO_TEST,
              rsiUp:   parseFloat(process.env.RSI_UP      ?? 55),
              rsiDown: parseFloat(process.env.RSI_DOWN    ?? 45),
              volMin:  parseFloat(process.env.VOL_REL_MIN ?? 1.2),
              tpRatio: 2.0, slRatio: 1.0,
            });
            return {
              symbol, interval,
              trades:   bt.metrics.totalTrades,
              winRate:  bt.metrics.winRate,
              pnl:      bt.metrics.totalPnlPct,
              pf:       bt.metrics.profitFactor,
              active:   bt.metrics.totalTrades >= MIN_TRADES &&
                        bt.metrics.winRate     >= MIN_WIN_RATE &&
                        bt.metrics.totalPnlPct >  MIN_PNL,
            };
          } catch (err) {
            console.warn(`[Calibrator] Error ${symbol} ${interval}:`, err.message);
            return { symbol, interval, trades: 0, winRate: 0, pnl: 0, active: false };
          }
        })
      )
    );
    results.push(...batchResults);
    // Small delay between batches
    if (i + CONCURRENCY < allPairs.length) await sleep(800);
  }

  // Filter active ones, sort by PnL descending
  const active = results
    .filter((r) => r.active)
    .sort((a, b) => b.pnl - a.pnl);

  activePairs = active;
  lastCalibration = Date.now();

  // Log summary
  console.log(`[Calibrator] Done — ${active.length} active combinations out of ${results.length}`);
  active.forEach((r) => console.log(`  ✅ ${r.symbol} ${r.interval} — PnL:${r.pnl.toFixed(2)}% WR:${r.winRate}% Trades:${r.trades}`));

  const inactive = results.filter((r) => !r.active);
  inactive.forEach((r) => console.log(`  ❌ ${r.symbol} ${r.interval} — PnL:${r.pnl.toFixed(2)}% WR:${r.winRate}% Trades:${r.trades}`));

  // Send Telegram summary
  if (isEnabled()) {
    const lines = [
      `✅ <b>Calibración completada</b>`,
      `─────────────────────`,
      `Pares activos: <b>${active.length}</b> de ${results.length} combinaciones`,
      ``,
    ];

    if (active.length === 0) {
      lines.push(`⚠️ Ningún par cumple los criterios mínimos.`);
      lines.push(`El scanner usará todos los pares como fallback.`);
    } else {
      lines.push(`<b>Activos:</b>`);
      active.slice(0, 8).forEach((r) => {
        lines.push(`• ${esc(r.symbol)} ${r.interval} — PnL: <code>${r.pnl >= 0 ? '+' : ''}${r.pnl.toFixed(2)}%</code> WR: <code>${r.winRate}%</code>`);
      });
    }

    send(lines.join('\n'));
  }

  return active;
}

/**
 * Schedules daily calibration at 3:00 AM Argentina time (UTC-3 = 06:00 UTC).
 */
export function scheduleDailyCalibration(allPairs) {
  const runAt3am = () => {
    const now   = new Date();
    // Next 06:00 UTC
    const next  = new Date();
    next.setUTCHours(6, 0, 0, 0);
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    const msUntil = next - now;
    console.log(`[Calibrator] Next calibration in ${Math.round(msUntil / 1000 / 60)} minutes (3am AR)`);
    setTimeout(async () => {
      await runCalibration(allPairs);
      runAt3am(); // reschedule for next day
    }, msUntil);
  };
  runAt3am();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
