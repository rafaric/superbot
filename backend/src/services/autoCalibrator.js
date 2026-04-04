import { runBacktest, getRequiredCandles } from './backtester.js';
import { send, esc, isEnabled } from './telegram.js';

// Timeframes to evaluate
const CANDIDATE_TIMEFRAMES = ['5m', '15m', '1h'];
const VALIDATION_GATE = {
  minTrades:        150,    // Minimum trades for statistical significance
  minProfitFactor:  1.35,   // PF >= 1.35 (null = infinite = passes)
  maxDrawdownPct:   15,     // Max drawdown <= 15%
  minWinRate:       36,     // Win rate >= 36%
  minExpectancy:    0,      // Expectancy > 0 (must be positive)
};

// Active pairs stored in memory — scanner reads this
let activePairs = [];
let lastCalibration = null;

/**
 * Returns the current validation gate configuration.
 * Useful for introspection via API.
 */
export function getValidationGate() {
  return { ...VALIDATION_GATE };
}

/**
 * Computes expectancy from metrics.
 * Formula: (WR/100 × avgWinPct) - ((1-WR/100) × Math.abs(avgLossPct))
 */
function computeExpectancy(winRate, avgWinPct, avgLossPct) {
  const wr = winRate / 100;
  return (wr * avgWinPct) - ((1 - wr) * Math.abs(avgLossPct));
}

/**
 * Validates a pair's metrics against PRD §8 acceptance criteria.
 * @param {Object} metrics - Metrics object from runBacktest (bt.metrics shape)
 * @returns {{ passed: boolean, reasons: string[], details: Object }}
 */
export function validatePair(metrics) {
  const reasons = [];
  const {
    totalTrades,
    winRate,
    profitFactor,
    maxDrawdownPct,
    avgWinPct,
    avgLossPct,
  } = metrics;

  // Compute expectancy
  const expectancy = computeExpectancy(winRate, avgWinPct ?? 0, avgLossPct ?? 0);

  // Check each criterion
  if (totalTrades < VALIDATION_GATE.minTrades) {
    reasons.push(`Trades: ${totalTrades}/${VALIDATION_GATE.minTrades} ❌`);
  }

  // profitFactor can be null (no losses) — treat as passing (infinite PF = good)
  if (profitFactor !== null && profitFactor < VALIDATION_GATE.minProfitFactor) {
    reasons.push(`PF: ${profitFactor.toFixed(2)}/${VALIDATION_GATE.minProfitFactor} ❌`);
  }

  if (maxDrawdownPct > VALIDATION_GATE.maxDrawdownPct) {
    reasons.push(`DD: ${maxDrawdownPct.toFixed(1)}%/${VALIDATION_GATE.maxDrawdownPct}% ❌`);
  }

  if (winRate < VALIDATION_GATE.minWinRate) {
    reasons.push(`WR: ${winRate.toFixed(1)}%/${VALIDATION_GATE.minWinRate}% ❌`);
  }

  if (expectancy <= VALIDATION_GATE.minExpectancy) {
    reasons.push(`Exp: ${expectancy.toFixed(3)}/> 0 ❌`);
  }

  return {
    passed: reasons.length === 0,
    reasons,
    details: {
      totalTrades,
      winRate,
      profitFactor,
      maxDrawdownPct,
      expectancy,
    },
    // PRD v2.1: Metrics by regime (placeholder — will be populated when backtester integrates regime tracking)
    metricsByRegime: {
      TREND: { profitFactor: null, winRate: null },
      RANGE: { profitFactor: null, winRate: null },
      MIXED: { profitFactor: null, winRate: null },
    },
  };
}

export function getActivePairs() {
  return activePairs.length > 0 ? activePairs : null; // null = use all pairs (fallback)
}

export function getLastCalibration() {
  return lastCalibration;
}

/**
 * Runs backtest on all pairs × timeframes, keeps only those passing PRD §8 gate.
 * Called on startup and once daily at 3am Argentina time.
 */
export async function runCalibration(allPairs) {
  console.log(`[Calibrator] Starting calibration — ${allPairs.length} pairs × ${CANDIDATE_TIMEFRAMES.length} timeframes`);
  console.log(`[Calibrator] Validation gate: Trades≥${VALIDATION_GATE.minTrades}, PF≥${VALIDATION_GATE.minProfitFactor}, DD≤${VALIDATION_GATE.maxDrawdownPct}%, WR≥${VALIDATION_GATE.minWinRate}%, Exp>0`);
  CANDIDATE_TIMEFRAMES.forEach((tf) => {
    const req = getRequiredCandles(tf);
    console.log(`[Calibrator] ${tf}: ${req.evaluationCandles} eval candles + ${req.warmupCandles} warmup = ${req.totalCandles} total`);
  });
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
              // limit omitted — backtester uses getRequiredCandles(interval) policy
              rsiUp:   parseFloat(process.env.RSI_UP      ?? 55),
              rsiDown: parseFloat(process.env.RSI_DOWN    ?? 45),
              volMin:  parseFloat(process.env.VOL_REL_MIN ?? 1.2),
              tpRatio: 2.0, slRatio: 1.0,
            });

            // Validate against PRD §8 gate
            const validation = validatePair(bt.metrics);

            return {
              symbol, interval,
              trades:      bt.metrics.totalTrades,
              winRate:     bt.metrics.winRate,
              pnl:         bt.metrics.totalPnlPct,
              pf:          bt.metrics.profitFactor,
              drawdown:    bt.metrics.maxDrawdownPct,
              expectancy:  validation.details.expectancy,
              active:      validation.passed,
              reasons:     validation.reasons,
              // PRD v2.1: metrics by regime (placeholder)
              metricsByRegime: validation.metricsByRegime,
            };
          } catch (err) {
            console.warn(`[Calibrator] Error ${symbol} ${interval}:`, err.message);
            return {
              symbol, interval,
              trades: 0, winRate: 0, pnl: 0, pf: null, drawdown: 0, expectancy: 0,
              active: false,
              reasons: ['Error en backtest'],
              metricsByRegime: {
                TREND: { profitFactor: null, winRate: null },
                RANGE: { profitFactor: null, winRate: null },
                MIXED: { profitFactor: null, winRate: null },
              },
            };
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
  active.forEach((r) => console.log(`[Calibrator]   ✅ ${r.symbol} ${r.interval} — PnL:${r.pnl.toFixed(2)}% WR:${r.winRate.toFixed(1)}% Trades:${r.trades} PF:${r.pf?.toFixed(2) ?? '∞'}`));

  const rejected = results.filter((r) => !r.active);
  rejected.forEach((r) => console.log(`[Calibrator]   ❌ ${r.symbol} ${r.interval} — ${r.reasons.join(', ')}`));

  // Send Telegram summary
  if (isEnabled()) {
    const gate = VALIDATION_GATE;
    const lines = [
      `✅ <b>Calibración completada</b>`,
      `─────────────────────`,
      `<b>Gate PRD §8:</b> Trades≥${gate.minTrades} | PF≥${gate.minProfitFactor} | DD≤${gate.maxDrawdownPct}% | WR≥${gate.minWinRate}% | Exp>0`,
      ``,
      `Pares activos: <b>${active.length}</b> de ${results.length} combinaciones`,
      ``,
    ];

    if (active.length === 0) {
      lines.push(`⚠️ Ningún par cumple los criterios del gate.`);
      lines.push(`El scanner usará todos los pares como fallback.`);
    } else {
      lines.push(`<b>Activos:</b>`);
      active.slice(0, 8).forEach((r) => {
        lines.push(`• ${esc(r.symbol)} ${r.interval} — PnL: <code>${r.pnl >= 0 ? '+' : ''}${r.pnl.toFixed(2)}%</code> WR: <code>${r.winRate.toFixed(1)}%</code> PF: <code>${r.pf?.toFixed(2) ?? '∞'}</code>`);
      });
    }

    // Show rejection reasons (max 5 to avoid spam)
    if (rejected.length > 0) {
      lines.push(``);
      lines.push(`<b>Rechazados (${rejected.length}):</b>`);
      rejected.slice(0, 5).forEach((r) => {
        lines.push(`• ${esc(r.symbol)} ${r.interval} — ${r.reasons.slice(0, 3).join(', ')}`);
      });
      if (rejected.length > 5) {
        lines.push(`  <i>...y ${rejected.length - 5} más</i>`);
      }
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
