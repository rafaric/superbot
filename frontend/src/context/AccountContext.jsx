import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';

const AccountContext = createContext(null);

export function AccountProvider({ children }) {
  const [balance, setBalance] = useState(null);
  const [positions, setPositions] = useState([]);
  const [realizedPnl, setRealizedPnl] = useState(0);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const wsRef = useRef(null);

  const applySnapshot = useCallback((snapshot) => {
    if (!snapshot) return;
    if (snapshot.balance) setBalance(normalizeBalance(snapshot.balance));
    if (snapshot.positions) setPositions(normalizePositions(snapshot.positions));
    if (snapshot.income) setRealizedPnl(sumRealizedPnl(snapshot.income));
    setLastUpdated(snapshot.timestamp || Date.now());
    setLoading(false);
  }, []);

  // Manual refresh — hits REST directly
  const refresh = useCallback(async () => {
    try {
      const [balRes, posRes, incRes] = await Promise.all([
        fetch('/api/account/balance'),
        fetch('/api/account/positions'),
        fetch('/api/account/income?limit=100'),
      ]);
      const [b, p, i] = await Promise.all([balRes.json(), posRes.json(), incRes.json()]);
      if (b.ok) setBalance(normalizeBalance(b.data));
      if (p.ok) setPositions(normalizePositions(p.data));
      if (i.ok) setRealizedPnl(sumRealizedPnl(i.data));
      setLastUpdated(Date.now());
    } catch (err) {
      console.error('[Account] Refresh error:', err);
    }
  }, []);

  // WS connection — receives ACCOUNT_SNAPSHOT every 3s from backend poller
  const connectWS = useCallback(() => {
    const port = import.meta.env.VITE_BACKEND_PORT || 3001;
    let cancelled = false;

    const timer = setTimeout(() => {
      if (cancelled) return;

      const ws = new WebSocket(`ws://localhost:${port}/ws/account`);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'ACCOUNT_SNAPSHOT') {
            applySnapshot(msg.data);
          }
        } catch (e) {
          console.error('[AccountWS] Parse error:', e);
        }
      };

      ws.onclose = () => console.log('[AccountWS] Disconnected');
      ws.onerror = () => {};
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      wsRef.current?.close();
    };
  }, [applySnapshot]);

  useEffect(() => {
    const cancel = connectWS();
    return cancel;
  }, [connectWS]);

  const totalUnrealizedPnl = positions.reduce(
    (sum, p) => sum + (p.unrealizedProfit || 0), 0
  );

  return (
    <AccountContext.Provider value={{
      balance,
      positions,
      realizedPnl,
      totalUnrealizedPnl,
      loading,
      lastUpdated,
      refresh,
    }}>
      {children}
    </AccountContext.Provider>
  );
}

export function useAccount() {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error('useAccount must be used within AccountProvider');
  return ctx;
}

// ─── Normalizers ─────────────────────────────────────────────────────────────

function normalizeBalance(data) {
  const b = Array.isArray(data) ? data[0] : data;
  if (!b) return null;
  return {
    totalWalletBalance: parseFloat(b.totalWalletBalance ?? b.balance ?? 0),
    availableBalance: parseFloat(b.availableBalance ?? b.availableMargin ?? 0),
    unrealizedProfit: parseFloat(b.unrealizedProfit ?? b.unrealizedPnl ?? 0),
    usedMargin: parseFloat(b.usedMargin ?? b.initialMargin ?? 0),
  };
}

function normalizePositions(data) {
  if (!Array.isArray(data)) return [];
  return data
    .filter((p) => {
      const amt = parseFloat(p.positionAmt ?? p.positionAmount ?? 0);
      const side = (p.positionSide ?? '').toUpperCase();
      // In hedge mode BingX returns both LONG and SHORT entries — filter out empty ones
      return amt !== 0 || side === 'LONG' || side === 'SHORT'
        ? parseFloat(p.unrealizedProfit ?? 0) !== 0 || Math.abs(amt) > 0
        : false;
    })
    .map((p) => {
      const amt  = parseFloat(p.positionAmt ?? p.positionAmount ?? 0);
      // Prefer explicit positionSide from BingX (hedge mode)
      const rawSide = (p.positionSide ?? '').toUpperCase();
      let side;
      if (rawSide === 'LONG')  side = 'Long';
      else if (rawSide === 'SHORT') side = 'Short';
      else side = amt >= 0 ? 'Long' : 'Short'; // fallback for one-way mode

      return {
        symbol:           p.symbol,
        side,
        positionSide:     rawSide || (amt >= 0 ? 'LONG' : 'SHORT'), // keep raw for close order
        size:             Math.abs(amt),
        leverage:         parseInt(p.leverage ?? 1),
        entryPrice:       parseFloat(p.entryPrice ?? p.avgPrice ?? 0),
        markPrice:        parseFloat(p.markPrice ?? 0),
        unrealizedProfit: parseFloat(p.unrealizedProfit ?? p.unRealizedProfit ?? 0),
        margin:           parseFloat(p.initialMargin ?? p.margin ?? 0),
      };
    })
    .filter((p) => p.size > 0); // final guard — remove truly empty positions
}

function sumRealizedPnl(data) {
  if (!Array.isArray(data)) return 0;
  return data.reduce((sum, item) => sum + parseFloat(item.income ?? item.realizedPnl ?? 0), 0);
}
