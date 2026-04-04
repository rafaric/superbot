/**
 * Monte Carlo Simulation Service — Fase 3 (PRD v2)
 *
 * Dado un array de trades reales (del backtester), simula N permutaciones
 * aleatorias del orden de los trades para obtener distribuciones de
 * drawdown y PnL. Esto estima el riesgo real sin depender del orden
 * histórico específico.
 *
 * Algoritmo:
 *   1. Recibir array de trades (con pnlPct)
 *   2. Extraer array de PnLs
 *   3. Para N simulaciones: shuffle (Fisher-Yates), calcular DD y PnL final
 *   4. Calcular percentiles p5, p25, p50, p75, p95
 *   5. Calcular probabilidad de ruina (drawdown > ruinThreshold)
 *
 * NOTA: Esta función es SÍNCRONA — no hace llamadas a API.
 */

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_SIMULATIONS    = 1000;
const DEFAULT_RUIN_THRESHOLD = 20; // 20% drawdown = ruina

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Runs Monte Carlo simulation on an array of trades.
 * This is a SYNCHRONOUS function — no API calls, works on pre-computed trades.
 *
 * @param {object}   params
 * @param {Array}    params.trades         Array of trade objects with pnlPct
 * @param {number}   params.simulations    Number of random permutations (default 1000)
 * @param {number}   params.ruinThreshold  Max drawdown % considered as "ruin" (default 20)
 * @returns {object} Distribution statistics and ruin probability
 */
export function runMonteCarlo({
  trades,
  simulations   = DEFAULT_SIMULATIONS,
  ruinThreshold = DEFAULT_RUIN_THRESHOLD,
} = {}) {
  if (!trades || !Array.isArray(trades) || trades.length === 0) {
    return {
      simulations: 0,
      pnlDistribution:      { p5: 0, p25: 0, p50: 0, p75: 0, p95: 0 },
      drawdownDistribution: { p5: 0, p25: 0, p50: 0, p75: 0, p95: 0 },
      ruinProbability:      0,
      verdict: 'No trades provided for Monte Carlo simulation.',
    };
  }

  // Extract PnL array from trades
  const pnlArray = trades.map(t => t.pnlPct);

  console.log(`[MonteCarlo] Running ${simulations} simulations on ${pnlArray.length} trades`);

  const pnlResults = [];
  const ddResults  = [];
  let ruinCount    = 0;

  for (let i = 0; i < simulations; i++) {
    // Shuffle the PnL array (Fisher-Yates)
    const shuffled = fisherYatesShuffle([...pnlArray]);

    // Calculate cumulative PnL and max drawdown for this permutation
    const { finalPnl, maxDrawdown } = calculateEquityCurve(shuffled);

    pnlResults.push(finalPnl);
    ddResults.push(maxDrawdown);

    if (maxDrawdown >= ruinThreshold) {
      ruinCount++;
    }
  }

  // Sort results for percentile calculation
  pnlResults.sort((a, b) => a - b);
  ddResults.sort((a, b) => a - b);

  const pnlDistribution = {
    p5:  percentile(pnlResults, 5),
    p25: percentile(pnlResults, 25),
    p50: percentile(pnlResults, 50),
    p75: percentile(pnlResults, 75),
    p95: percentile(pnlResults, 95),
  };

  const drawdownDistribution = {
    p5:  percentile(ddResults, 5),
    p25: percentile(ddResults, 25),
    p50: percentile(ddResults, 50),
    p75: percentile(ddResults, 75),
    p95: percentile(ddResults, 95),
  };

  const ruinProbability = ruinCount / simulations;

  // Build verdict
  let verdict;
  if (ruinProbability < 0.05) {
    verdict = `Low risk: Only ${(ruinProbability * 100).toFixed(1)}% of simulations hit ${ruinThreshold}% drawdown. Strategy appears robust.`;
  } else if (ruinProbability < 0.15) {
    verdict = `Moderate risk: ${(ruinProbability * 100).toFixed(1)}% ruin probability. Consider tighter risk management.`;
  } else if (ruinProbability < 0.30) {
    verdict = `Elevated risk: ${(ruinProbability * 100).toFixed(1)}% chance of hitting ${ruinThreshold}% drawdown. Review position sizing.`;
  } else {
    verdict = `High risk: ${(ruinProbability * 100).toFixed(1)}% ruin probability. Strategy may be too aggressive for current parameters.`;
  }

  console.log(`[MonteCarlo] Completed — Median PnL: ${pnlDistribution.p50.toFixed(2)}% | Median DD: ${drawdownDistribution.p50.toFixed(2)}% | Ruin: ${(ruinProbability * 100).toFixed(1)}%`);

  return {
    simulations,
    pnlDistribution,
    drawdownDistribution,
    ruinProbability: parseFloat(ruinProbability.toFixed(4)),
    verdict,
  };
}

// ─── Internals ────────────────────────────────────────────────────────────────

/**
 * Fisher-Yates shuffle — in-place, unbiased random permutation.
 * Time: O(n), Space: O(1)
 *
 * @param {Array} array Array to shuffle (will be mutated)
 * @returns {Array} The same array, shuffled
 */
function fisherYatesShuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    // Random index from 0 to i (inclusive)
    const j = Math.floor(Math.random() * (i + 1));
    // Swap elements
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/**
 * Calculates the final PnL and maximum drawdown from an array of PnL percentages.
 *
 * @param {number[]} pnlArray Array of PnL percentages in sequence
 * @returns {{ finalPnl: number, maxDrawdown: number }}
 */
function calculateEquityCurve(pnlArray) {
  let cumPnl      = 0;
  let peak        = 0;
  let maxDrawdown = 0;

  for (const pnl of pnlArray) {
    cumPnl += pnl;

    if (cumPnl > peak) {
      peak = cumPnl;
    }

    const drawdown = peak - cumPnl;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  return {
    finalPnl:    parseFloat(cumPnl.toFixed(4)),
    maxDrawdown: parseFloat(maxDrawdown.toFixed(4)),
  };
}

/**
 * Calculates the p-th percentile of a sorted array.
 *
 * @param {number[]} sortedArray Sorted array of numbers
 * @param {number}   p           Percentile (0-100)
 * @returns {number}
 */
function percentile(sortedArray, p) {
  if (sortedArray.length === 0) return 0;
  if (sortedArray.length === 1) return sortedArray[0];

  const index = (p / 100) * (sortedArray.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;

  if (upper >= sortedArray.length) return sortedArray[sortedArray.length - 1];
  if (lower === upper) return sortedArray[lower];

  // Linear interpolation between lower and upper
  return parseFloat((sortedArray[lower] * (1 - weight) + sortedArray[upper] * weight).toFixed(4));
}
