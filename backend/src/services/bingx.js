import { buildAuthQuery } from '../utils/auth.js';

// Read dynamically on every call so environment switches take effect immediately
const getBaseUrl = () => process.env.BINGX_BASE_URL ?? '';
const getApiKey  = () => process.env.BINGX_API_KEY ?? '';
const getSecret  = () => process.env.BINGX_API_SECRET ?? '';

/**
 * Generic public GET request to BingX.
 */
async function publicGet(path, params = {}) {
  const query = new URLSearchParams(params).toString();
  const url = `${getBaseUrl()}${path}${query ? '?' + query : ''}`;
  const res = await fetch(url, {
    headers: { 'X-BX-APIKEY': getApiKey() },
  });
  if (!res.ok) throw new Error(`BingX HTTP error: ${res.status}`);
  return res.json();
}

/**
 * Generic private GET request to BingX (requires signature).
 */
async function privateGet(path, params = {}) {
  const query = buildAuthQuery(params, getSecret());
  const url = `${getBaseUrl()}${path}?${query}`;
  const res = await fetch(url, {
    headers: { 'X-BX-APIKEY': getApiKey() },
  });
  if (!res.ok) throw new Error(`BingX HTTP error: ${res.status}`);
  return res.json();
}

/**
 * Private POST request to BingX.
 */
async function privatePost(path, params = {}) {
  const query = buildAuthQuery(params, getSecret());
  const url = `${getBaseUrl()}${path}`;
  const res = await fetch(`${url}?${query}`, {
    method: 'POST',
    headers: {
      'X-BX-APIKEY': getApiKey(),
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`BingX HTTP error: ${res.status}`);
  return res.json();
}

/**
 * Fetch K-lines (candlestick data) from BingX.
 * Transforms response to lightweight-charts format (timestamps in seconds).
 *
 * @param {string} symbol  e.g. "BTC-USDT"
 * @param {string} interval e.g. "5m", "1h"
 * @param {number} limit   number of candles (max 1000)
 * @param {number} [endTime] optional end timestamp in ms for historical pagination
 */
export async function getKlines({ symbol = 'BTC-USDT', interval = '5m', limit = 200, endTime } = {}) {
  const params = { symbol, interval, limit };
  if (endTime) params.endTime = endTime;

  const data = await publicGet('/openApi/swap/v3/quote/klines', params);

  // Validate BingX response code
  if (data.code !== 0) {
    throw new Error(`BingX API error ${data.code}: ${data.msg}`);
  }

  if (!Array.isArray(data.data)) {
    throw new Error('Unexpected BingX klines response shape');
  }

  // Map to lightweight-charts OHLC format
  // BingX returns: [{ open, close, high, low, volume, time (ms), ... }]
  const candles = data.data
    .map((k) => ({
      time: Math.floor(Number(k.time) / 1000), // ms → seconds (Unix)
      open: parseFloat(k.open),
      high: parseFloat(k.high),
      low: parseFloat(k.low),
      close: parseFloat(k.close),
      volume: parseFloat(k.volume),
    }))
    .filter(
      (c) =>
        c.time > 0 &&
        c.open > 0 &&
        c.high > 0 &&
        c.low > 0 &&
        c.close > 0
    )
    .sort((a, b) => a.time - b.time); // ensure chronological order

  return candles;
}

const PAGINATION_DELAY_MS = 100;
const MAX_PAGES = 10; // supports up to 10000 candles (8840 needed for 5m/30d warmup)
const MAX_PER_REQUEST = 1000;

/**
 * Fetch K-lines with pagination support for limits > 1000.
 * BingX caps at 1000 candles per request, so we paginate backwards using endTime.
 *
 * @param {string} symbol   e.g. "BTC-USDT"
 * @param {string} interval e.g. "5m", "1h"
 * @param {number} limit    number of candles (no cap, but safety max of 5000)
 */
export async function getKlinesPaginated({ symbol = 'BTC-USDT', interval = '5m', limit = 200 } = {}) {
  // Fast path: no pagination needed
  if (limit <= MAX_PER_REQUEST) {
    return getKlines({ symbol, interval, limit });
  }

  const effectiveLimit = Math.min(limit, MAX_PER_REQUEST * MAX_PAGES); // safety cap: 5000
  const allCandles = [];
  let endTime = undefined;
  let pagesLoaded = 0;

  console.log(`[BingX] Fetching ${effectiveLimit} candles with pagination (${Math.ceil(effectiveLimit / MAX_PER_REQUEST)} pages max)`);

  while (allCandles.length < effectiveLimit && pagesLoaded < MAX_PAGES) {
    const batchLimit = Math.min(MAX_PER_REQUEST, effectiveLimit - allCandles.length);
    const batch = await getKlines({ symbol, interval, limit: batchLimit, endTime });

    if (batch.length === 0) {
      console.log(`[BingX] No more data at page ${pagesLoaded + 1}`);
      break;
    }

    pagesLoaded++;
    console.log(`[BingX] Page ${pagesLoaded}: fetched ${batch.length} candles`);

    // Merge batch into allCandles
    allCandles.push(...batch);

    // Set endTime for next page: oldest candle timestamp - 1ms
    // batch[0] is the oldest since getKlines sorts chronologically
    const oldestTimeMs = batch[0].time * 1000;
    endTime = oldestTimeMs - 1;

    // Stop if we got fewer candles than requested (no more historical data)
    if (batch.length < batchLimit) {
      break;
    }

    // Delay between requests to avoid hammering the API
    if (pagesLoaded < MAX_PAGES && allCandles.length < effectiveLimit) {
      await new Promise((resolve) => setTimeout(resolve, PAGINATION_DELAY_MS));
    }
  }

  // Deduplicate by time (in case of overlap)
  const seen = new Set();
  const deduped = [];
  for (const c of allCandles) {
    if (!seen.has(c.time)) {
      seen.add(c.time);
      deduped.push(c);
    }
  }

  // Sort chronologically and return the last `limit` candles
  deduped.sort((a, b) => a.time - b.time);
  const result = deduped.slice(-effectiveLimit);

  console.log(`[BingX] Pagination complete: ${result.length} candles total`);
  return result;
}

/**
 * Fetch account balance (futures).
 */
export async function getBalance() {
  const data = await privateGet('/openApi/swap/v3/user/balance');
  if (data.code !== 0) throw new Error(`BingX error: ${data.msg}`);
  return data.data;
}

/**
 * Fetch open positions.
 */
export async function getPositions(symbol) {
  const params = symbol ? { symbol } : {};
  const data = await privateGet('/openApi/swap/v2/user/positions', params);
  if (data.code !== 0) throw new Error(`BingX error: ${data.msg}`);
  return data.data;
}

/**
 * Fetch realized PnL history.
 */
export async function getIncome({ incomeType = 'REALIZED_PNL', limit = 50 } = {}) {
  const data = await privateGet('/openApi/swap/v2/user/income', { incomeType, limit });
  if (data.code !== 0) throw new Error(`BingX error: ${data.msg}`);
  return data.data;
}

/**
 * Place an order with optional SL/TP.
 */
export async function placeOrder(orderParams) {
  const data = await privatePost('/openApi/swap/v2/trade/order', orderParams);
  if (data.code !== 0) throw new Error(`BingX order error: ${data.msg}`);
  return data.data;
}

/**
 * Set leverage for a symbol.
 */
export async function setLeverage({ symbol, leverage, side = 'BOTH' }) {
  const data = await privatePost('/openApi/swap/v2/trade/leverage', { symbol, leverage, side });
  if (data.code !== 0) throw new Error(`BingX leverage error: ${data.msg}`);
  return data.data;
}

/**
 * Fetch all perpetual futures tickers (24h stats).
 * Used by dynamicUniverse to rank pairs by volume.
 */
export async function getTickers24h() {
  const data = await publicGet('/openApi/swap/v2/quote/ticker', {});
  if (data.code !== 0) throw new Error(`BingX error: ${data.msg}`);
  return Array.isArray(data.data) ? data.data : [];
}

/**
 * Fetch the current mark price for a single symbol.
 * Returns a number (the mark price) or throws on error.
 */
export async function getMarkPrice(symbol) {
  const data = await publicGet('/openApi/swap/v2/quote/premiumIndex', { symbol });
  if (data.code !== 0) throw new Error(`BingX getMarkPrice error: ${data.msg}`);
  const price = parseFloat(data.data?.markPrice ?? data.data?.price ?? 0);
  if (!price) throw new Error(`BingX getMarkPrice: no price for ${symbol}`);
  return price;
}
