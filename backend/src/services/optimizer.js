import { runBacktest } from './backtester.js';

/**
 * Analyzes backtest results and suggests strategy improvements.
 * If total PnL is negative or win rate is low, proposes parameter adjustments.
 */
export async function analyzeAndOptimize({ symbol, interval, limit = 300 }) {

  // Step 1: Run baseline backtest with current config
  const baseline = await runBacktest({
    symbol, interval, limit,
    rsiUp:    parseFloat(process.env.RSI_UP      ?? 55),
    rsiDown:  parseFloat(process.env.RSI_DOWN    ?? 45),
    volMin:   parseFloat(process.env.VOL_REL_MIN ?? 1.2),
    tpRatio:  2.0,
    slRatio:  1.0,
  });

  const suggestions = [];
  const { metrics } = baseline;

  // Step 2: Identify problems
  const problems = [];
  if (metrics.totalPnlPct   <= 0)   problems.push('pnl_negative');
  if (metrics.winRate        < 40)   problems.push('low_win_rate');
  if (metrics.totalTrades    < 5)    problems.push('too_few_trades');
  if (metrics.totalTrades    > 50)   problems.push('too_many_trades');
  if (metrics.maxDrawdownPct > 20)   problems.push('high_drawdown');
  if (metrics.profitFactor   < 1.0)  problems.push('poor_profit_factor');

  // Step 3: Generate targeted suggestions based on problems
  if (problems.includes('too_few_trades') || problems.includes('low_win_rate')) {
    // Loosen filters to get more signals
    suggestions.push({
      type:        'LOOSEN_FILTERS',
      description: 'Muy pocas señales — reducir exigencia de RSI y volumen',
      changes: {
        RSI_UP:       Math.max(50, parseFloat(process.env.RSI_UP ?? 55) - 3),
        RSI_DOWN:     Math.min(50, parseFloat(process.env.RSI_DOWN ?? 45) + 3),
        VOL_REL_MIN:  Math.max(1.0, parseFloat(process.env.VOL_REL_MIN ?? 1.2) - 0.1),
      },
    });
  }

  if (problems.includes('too_many_trades') && problems.includes('pnl_negative')) {
    // Tighten filters — too much noise
    suggestions.push({
      type:        'TIGHTEN_FILTERS',
      description: 'Demasiadas señales falsas — aumentar exigencia de RSI y volumen',
      changes: {
        RSI_UP:       Math.min(65, parseFloat(process.env.RSI_UP ?? 55) + 5),
        RSI_DOWN:     Math.max(35, parseFloat(process.env.RSI_DOWN ?? 45) - 5),
        VOL_REL_MIN:  Math.min(2.0, parseFloat(process.env.VOL_REL_MIN ?? 1.2) + 0.2),
      },
    });
  }

  if (problems.includes('high_drawdown') || metrics.avgLossPct < metrics.avgWinPct * -1.5) {
    suggestions.push({
      type:        'ADJUST_RISK_REWARD',
      description: 'Drawdown alto — probar SL más ajustado o TP más conservador',
      changes: { slRatio: 0.8, tpRatio: 1.5 },
    });
  }

  if (problems.includes('pnl_negative') && metrics.totalTrades >= 5) {
    // Try higher timeframe
    const tfMap = { '1m': '5m', '5m': '15m', '15m': '1h', '1h': '4h' };
    const higherTF = tfMap[interval];
    if (higherTF) {
      suggestions.push({
        type:        'HIGHER_TIMEFRAME',
        description: `PnL negativo en ${interval} — probar ${higherTF} para señales de mayor calidad`,
        changes: { interval: higherTF },
      });
    }
  }

  // Step 4: Run backtest on each suggestion to validate it actually improves things
  const testedSuggestions = [];
  for (const s of suggestions) {
    try {
      const testParams = {
        symbol, interval: s.changes.interval ?? interval, limit,
        rsiUp:    s.changes.RSI_UP      ?? parseFloat(process.env.RSI_UP ?? 55),
        rsiDown:  s.changes.RSI_DOWN    ?? parseFloat(process.env.RSI_DOWN ?? 45),
        volMin:   s.changes.VOL_REL_MIN ?? parseFloat(process.env.VOL_REL_MIN ?? 1.2),
        slRatio:  s.changes.slRatio     ?? 1.0,
        tpRatio:  s.changes.tpRatio     ?? 2.0,
      };
      const tested = await runBacktest(testParams);
      testedSuggestions.push({
        ...s,
        baseline: {
          pnl:      metrics.totalPnlPct,
          winRate:  metrics.winRate,
          trades:   metrics.totalTrades,
        },
        projected: {
          pnl:      tested.metrics.totalPnlPct,
          winRate:  tested.metrics.winRate,
          trades:   tested.metrics.totalTrades,
        },
        improvement: tested.metrics.totalPnlPct > metrics.totalPnlPct,
      });
    } catch (e) {
      console.warn('[Optimizer] Could not test suggestion:', e.message);
    }
  }

  // Sort: improvements first
  testedSuggestions.sort((a, b) => (b.improvement ? 1 : 0) - (a.improvement ? 1 : 0));

  return {
    baseline,
    problems,
    suggestions: testedSuggestions,
    verdict: metrics.totalPnlPct > 0 && metrics.winRate >= 40
      ? 'PROFITABLE'
      : metrics.totalTrades < 5
        ? 'INSUFFICIENT_DATA'
        : 'NEEDS_OPTIMIZATION',
  };
}
