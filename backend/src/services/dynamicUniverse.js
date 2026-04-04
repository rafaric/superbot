/**
 * Dynamic Universe — Fase 2 (PRD v2 §7)
 *
 * Selects top N trading pairs by 24h USDT volume, then filters
 * by minimum ATR% and relative volume criteria.
 *
 * Used in Rotation Mode to find high-activity altcoins when BTC is lateral.
 */

import { getTickers24h, getKlines } from './bingx.js';
import { getATRPercent, getRelativeVolume } from './indicators.js';

// ─── Config ───────────────────────────────────────────────────────────────────

const UNIVERSE_TOP_N       = parseInt(process.env.UNIVERSE_TOP_N ?? 30);
const ATR_PCT_MIN          = parseFloat(process.env.ATR_PCT_MIN ?? 0.35);
const VOL_RATIO_MIN        = parseFloat(process.env.VOL_RATIO_MIN ?? 1.2);
const UNIVERSE_CACHE_TTL_MS = parseInt(process.env.UNIVERSE_CACHE_TTL_MS ?? 15 * 60 * 1000); // 15 min

// ─── Cache ────────────────────────────────────────────────────────────────────

let cachedUniverse = null;
let cacheTimestamp = 0;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Get the dynamic universe of tradeable pairs.
 * Returns cached result if within TTL.
 *
 * @returns {Promise<Array<{ symbol: string, quoteVolume: number, atrPct: number, volRatio: number }>>}
 */
export async function getDynamicUniverse() {
  const now = Date.now();

  if (cachedUniverse && (now - cacheTimestamp) < UNIVERSE_CACHE_TTL_MS) {
    console.log(`[DynamicUniverse] Returning cached universe (${cachedUniverse.length} pairs)`);
    return cachedUniverse;
  }

  return refreshUniverse();
}

/**
 * Force a full refresh of the universe, bypassing cache.
 *
 * @returns {Promise<Array<{ symbol: string, quoteVolume: number, atrPct: number, volRatio: number }>>}
 */
export async function refreshUniverse() {
  console.log('[DynamicUniverse] Refreshing universe...');

  try {
    // Step 1: Fetch all 24h tickers
    const tickers = await getTickers24h();

    // Step 2: Filter for USDT pairs, exclude BTC-USDT (macro reference)
    const usdtPairs = tickers.filter(
      (t) => t.symbol.endsWith('-USDT') && t.symbol !== 'BTC-USDT'
    );

    // Step 3: Sort by quote volume (USDT volume) descending
    const sorted = usdtPairs
      .map((t) => ({
        symbol: t.symbol,
        quoteVolume: parseFloat(t.quoteVolume ?? t.turnover ?? 0),
      }))
      .sort((a, b) => b.quoteVolume - a.quoteVolume);

    // Step 4: Take top N
    const topN = sorted.slice(0, UNIVERSE_TOP_N);
    console.log(`[DynamicUniverse] Top ${UNIVERSE_TOP_N} by volume: ${topN.slice(0, 5).map(p => p.symbol).join(', ')}...`);

    // Step 5: For each pair, calculate ATR% and volRatio via klines 5m
    const CONCURRENCY = 4;
    const enriched = [];

    for (let i = 0; i < topN.length; i += CONCURRENCY) {
      const batch = topN.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (pair) => {
          try {
            const candles = await getKlines({ symbol: pair.symbol, interval: '5m', limit: 50 });

            if (candles.length < 21) {
              return null; // Not enough data
            }

            const atrPct = getATRPercent(candles, 14);
            const volRatio = getRelativeVolume(candles, 20);

            if (atrPct === null || volRatio === null) return null;

            return {
              symbol: pair.symbol,
              quoteVolume: pair.quoteVolume,
              atrPct,
              volRatio,
            };
          } catch (err) {
            console.warn(`[DynamicUniverse] Error fetching ${pair.symbol}:`, err.message);
            return null;
          }
        })
      );

      enriched.push(...results.filter((r) => r !== null));

      // Small delay between batches
      if (i + CONCURRENCY < topN.length) {
        await new Promise((r) => setTimeout(r, 300));
      }
    }

    // Step 6: Filter by ATR% and volRatio thresholds
    const filtered = enriched.filter(
      (p) => p.atrPct > ATR_PCT_MIN && p.volRatio > VOL_RATIO_MIN
    );

    console.log(
      `[DynamicUniverse] Filtered ${filtered.length}/${enriched.length} pairs (ATR% > ${ATR_PCT_MIN}, volRatio > ${VOL_RATIO_MIN})`
    );

    // Update cache
    cachedUniverse = filtered;
    cacheTimestamp = Date.now();

    return filtered;
  } catch (err) {
    console.error('[DynamicUniverse] Error refreshing universe:', err.message);
    // Return stale cache if available, otherwise empty
    return cachedUniverse ?? [];
  }
}
