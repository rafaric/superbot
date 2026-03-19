import { buildAuthQuery } from '../utils/auth.js';

const getBaseUrl = () => process.env.BINGX_BASE_URL;
const getApiKey = () => process.env.BINGX_API_KEY;

// Cache contract specs to avoid fetching on every order
const contractCache = new Map(); // symbol → { minQty, stepSize, minNotional }

/**
 * Fetches contract/instrument info for a symbol from BingX.
 * Returns { minQty, stepSize, minNotional }
 */
async function getContractSpec(symbol) {
  if (contractCache.has(symbol)) return contractCache.get(symbol);

  try {
    const res  = await fetch(`${getBaseUrl()}/openApi/swap/v2/quote/contracts`, {
      headers: { 'X-BX-APIKEY': getApiKey() },
    });
    const data = await res.json();

    if (data.code !== 0 || !Array.isArray(data.data)) {
      throw new Error(`Contracts API error: ${data.msg}`);
    }

    for (const c of data.data) {
      // BingX returns tradeMinQuantity and quantityStep per contract
      contractCache.set(c.symbol, {
        minQty:       parseFloat(c.tradeMinQuantity ?? c.minQty ?? 0.001),
        stepSize:     parseFloat(c.tradeMinQuantity ?? c.quantityStep ?? 0.001),
        minNotional:  parseFloat(c.minNotional ?? 5),
      });
    }

    return contractCache.get(symbol) ?? { minQty: 0.001, stepSize: 0.001, minNotional: 5 };
  } catch (err) {
    console.error('[SizeCalc] Could not fetch contract specs:', err.message);
    // Safe fallback
    return { minQty: 0.001, stepSize: 0.001, minNotional: 5 };
  }
}

/**
 * Fetches available balance from BingX account.
 */
async function getAvailableBalance() {
  const query = buildAuthQuery({}, process.env.BINGX_API_SECRET);
  const res   = await fetch(`${getBaseUrl()}/openApi/swap/v3/user/balance?${query}`, {
    headers: { 'X-BX-APIKEY': getApiKey() },
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`Balance API error: ${data.msg}`);

  const b = Array.isArray(data.data) ? data.data[0] : data.data;
  return parseFloat(b?.availableBalance ?? b?.availableMargin ?? 0);
}

/**
 * Rounds a quantity down to the nearest valid step size.
 * e.g. qty=0.0157, step=0.001 → 0.015
 */
function floorToStep(qty, stepSize) {
  if (stepSize <= 0) return qty;
  const decimals = Math.max(0, -Math.floor(Math.log10(stepSize)));
  const factor   = Math.pow(10, decimals);
  return Math.floor(qty * factor) / factor;
}

/**
 * Calculates order quantity from a % of available balance.
 *
 * @param {string} symbol     e.g. 'BTC-USDT'
 * @param {number} price      current mark price
 * @param {number} pct        percentage of balance to use (e.g. 10 = 10%)
 * @param {number} leverage   leverage multiplier
 * @returns {{ quantity, usedBalance, availableBalance, error? }}
 */
export async function calcQuantityFromPct({ symbol, price, pct = 10, leverage = 1 }) {
  try {
    const [available, spec] = await Promise.all([
      getAvailableBalance(),
      getContractSpec(symbol),
    ]);

    if (available <= 0) {
      return { quantity: 0, usedBalance: 0, availableBalance: 0, error: 'Sin balance disponible' };
    }

    // Capital to allocate
    const capital  = available * (pct / 100);

    // With leverage: we can control capital * leverage worth of the asset
    const notional = capital * leverage;

    // Quantity in base asset units
    let qty = notional / price;

    // Round down to valid step size
    qty = floorToStep(qty, spec.stepSize);

    // Enforce minimum quantity
    if (qty < spec.minQty) {
      return {
        quantity:         0,
        usedBalance:      capital,
        availableBalance: available,
        error: `Cantidad mínima para ${symbol} es ${spec.minQty} — necesitás más balance o mayor % / apalancamiento`,
      };
    }

    // Enforce minimum notional value
    const notionalValue = qty * price;
    if (notionalValue < spec.minNotional) {
      return {
        quantity:         0,
        usedBalance:      capital,
        availableBalance: available,
        error: `Valor nocional mínimo: ${spec.minNotional} USDT (actual: ${notionalValue.toFixed(2)} USDT)`,
      };
    }

    return {
      quantity:         qty,
      usedBalance:      capital,
      availableBalance: available,
      marginRequired:   capital, // in one-way / hedge mode margin = capital
    };
  } catch (err) {
    console.error('[SizeCalc] Error:', err.message);
    return { quantity: 0, usedBalance: 0, availableBalance: 0, error: err.message };
  }
}

/**
 * Clears the contract spec cache (useful when switching environments).
 */
export function clearContractCache() {
  contractCache.clear();
}
