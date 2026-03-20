import { useState, useCallback, useEffect } from 'react';
import TradingChart   from './components/TradingChart.jsx';
import BacktestPanel from './components/BacktestPanel.jsx';
import AccountSidebar from './components/AccountSidebar.jsx';
import { AccountProvider } from './context/AccountContext.jsx';

export default function App() {
  const [symbol,    setSymbol]    = useState('BTC-USDT');
  const [markPrice, setMarkPrice] = useState(0);
  const [pairs,     setPairs]     = useState([]);
  const [showBacktest, setShowBacktest] = useState(false);
  const [mode,      setMode]      = useState(null); // 'demo' | 'live'
  const [switching, setSwitching] = useState(false);

  // Fetch current mode on mount
  useEffect(() => {
    apiFetch('/api/config/mode')
      .then((r) => r.json())
      .then((j) => { if (j.ok) setMode(j.mode); })
      .catch(() => {});
  }, []);

  const handleModeSwitch = useCallback(async () => {
    const newMode = mode === 'demo' ? 'live' : 'demo';
    if (!window.confirm(
      newMode === 'live'
        ? '⚠️ Vas a cambiar a CUENTA REAL. Las operaciones usarán dinero real. ¿Continuar?'
        : 'Cambiar a cuenta demo (VST)?'
    )) return;

    setSwitching(true);
    try {
      const res  = await apiFetch('/api/config/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: newMode }),
      });
      const json = await res.json();
      if (json.ok) {
        setMode(json.mode);
        // Full page reload to reinitialize all WS connections and data
        window.location.reload();
      }
    } catch (err) {
      console.error('Mode switch failed:', err);
    } finally {
      setSwitching(false);
    }
  }, [mode]);

  return (
    <AccountProvider>
      <div className="flex flex-col h-screen w-screen overflow-hidden bg-[#0a0e1a]">

        {/* Header */}
        <header className="flex items-center justify-between px-4 py-2 border-b border-[#1e2d45] shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-[#10b981] animate-pulse" />
              <span className="text-[#8899aa] text-xs font-medium tracking-widest uppercase">BingX Demo</span>
            </div>
            <button
              onClick={() => setShowBacktest((v) => !v)}
              className={`px-2.5 py-1 rounded text-xs font-medium border transition-all ${
                showBacktest
                  ? 'bg-[#3b82f6]/20 border-[#3b82f6]/40 text-[#3b82f6]'
                  : 'bg-[#1a2035] border-[#1e2d45] text-[#4a5568] hover:text-[#8899aa]'
              }`}
            >
              📊 Backtest
            </button>
          </div>
          <div className="flex items-center gap-3">
            {/* Mode indicator + switch */}
            {mode && (
              <button
                onClick={handleModeSwitch}
                disabled={switching}
                title={mode === 'demo' ? 'Cambiar a cuenta real' : 'Cambiar a demo'}
                className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                  mode === 'live'
                    ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/20'
                    : 'bg-[#1a2035] border-[#2a3f60] text-[#8899aa] hover:border-[#3b82f6]/40 hover:text-[#3b82f6]'
                } disabled:opacity-50`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${
                  mode === 'live' ? 'bg-emerald-400 animate-pulse' : 'bg-[#4a5568]'
                }`} />
                {switching ? 'Cambiando...' : mode === 'live' ? 'REAL' : 'DEMO'}
              </button>
            )}
            <span className="text-[#4a5568] text-xs num">
              {new Date().toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}
            </span>
          </div>
        </header>

        {/* Main */}
        <main className="flex flex-1 overflow-hidden">
          <div className="flex-1 overflow-hidden min-w-0">
            <TradingChart
              onSymbolChange={setSymbol}
              onPriceUpdate={setMarkPrice}
              onPairsLoaded={setPairs}
            />
          </div>
            {/* Backtest panel — collapsible below chart */}
            {showBacktest && (
              <div className="h-[480px] border-t border-[#1e2d45] overflow-hidden">
                <BacktestPanel symbol={symbol} tradingPairs={pairs} />
              </div>
            )}
          <AccountSidebar symbol={symbol} markPrice={markPrice} />
        </main>
          </div>
      

    </AccountProvider>
  );
}
