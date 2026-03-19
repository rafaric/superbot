import { useRef, useState, useCallback, useEffect } from 'react';
import { useChart } from '../hooks/useChart.js';

const INTERVALS = [
  { label: '1m', value: '1m' }, { label: '3m',  value: '3m'  },
  { label: '5m', value: '5m' }, { label: '15m', value: '15m' },
  { label: '1h', value: '1h' }, { label: '2h',  value: '2h'  },
  { label: '4h', value: '4h' }, { label: '6h',  value: '6h'  },
  { label: '1d', value: '1d' }, { label: '3d',  value: '3d'  },
  { label: '1w', value: '1w' }, { label: '1M',  value: '1M'  },
];

// Inner component — only mounted when symbol is ready, so useChart never gets null
function ChartInner({ symbol, interval, onSymbolChange, onPriceUpdate, pairs, setSymbol, setInterval: setIntervalFn, livePrice, priceDir, setLivePrice, setPriceDir }) {
  const containerRef = useRef(null);

  const handlePriceUpdate = useCallback((price) => {
    setLivePrice((prev) => {
      setPriceDir(price > prev ? 'up' : price < prev ? 'down' : null);
      return price;
    });
    onPriceUpdate?.(price);
  }, [onPriceUpdate, setLivePrice, setPriceDir]);

  useChart(containerRef, symbol, interval, handlePriceUpdate);

  return <div ref={containerRef} className="flex-1 w-full" style={{ minHeight: 0 }} />;
}

export default function TradingChart({ onSymbolChange, onPriceUpdate }) {
  const [pairs,     setPairs]     = useState([]);
  const [symbol,    setSymbol]    = useState(null);
  const [interval,  setInterval]  = useState('5m');
  const [livePrice, setLivePrice] = useState(null);
  const [priceDir,  setPriceDir]  = useState(null);

  // Load trading pairs from backend on mount
  useEffect(() => {
    fetch('/api/config/pairs')
      .then((r) => r.json())
      .then(({ pairs: p }) => {
        if (p?.length) {
          setPairs(p);
          setSymbol(p[0]);
          onSymbolChange?.(p[0]);
        }
      })
      .catch(() => {
        // Fallback to BTC-USDT if config endpoint fails
        setPairs(['BTC-USDT']);
        setSymbol('BTC-USDT');
        onSymbolChange?.('BTC-USDT');
      });
  }, []);

  const handleSymbolChange = useCallback((s) => {
    setSymbol(s);
    onSymbolChange?.(s);
  }, [onSymbolChange]);

  return (
    <div className="flex flex-col h-full bg-bg-primary">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0 flex-wrap">

        {/* Symbol selector */}
        <div className="flex items-center gap-1 mr-2 flex-wrap">
          {pairs.map((s) => (
            <button key={s} onClick={() => handleSymbolChange(s)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-all duration-150 ${
                symbol === s
                  ? 'bg-bg-card text-[#3b82f6] border border-[#3b82f6]/40'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-card/50'
              }`}
            >
              {/* Show just the base currency for brevity: BTC-USDT → BTC */}
              {s.split('-')[0]}
            </button>
          ))}
        </div>

        <div className="w-px h-4 bg-border mx-1" />

        {/* Interval selector */}
        <div className="flex items-center gap-0.5">
          {INTERVALS.map(({ label, value }) => (
            <button key={value} onClick={() => setInterval(value)}
              className={`px-2 py-1 rounded text-xs font-medium transition-all duration-150 ${
                interval === value
                  ? 'bg-[#3b82f6]/20 text-[#3b82f6]'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-card/50'
              }`}
            >{label}</button>
          ))}
        </div>

        <div className="flex-1" />

        {/* Indicator legend */}
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-[#3b82f6] rounded inline-block" />
            <span className="text-text-secondary">EMA 8</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-[#f97316] rounded inline-block" />
            <span className="text-text-secondary">EMA 21</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-[#eab308] rounded inline-block"
              style={{ backgroundImage: 'repeating-linear-gradient(to right, #eab308 0, #eab308 4px, transparent 4px, transparent 8px)' }} />
            <span className="text-text-secondary">VWAP</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-2 bg-text-secondary/40 rounded-sm inline-block" />
            <span className="text-text-secondary">Vol</span>
          </span>
          <div className="w-px h-4 bg-border mx-1" />
          <span className="flex items-center gap-1.5">
            <span className="text-accent-green text-xs">▲</span>
            <span className="text-text-secondary">BUY</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="text-accent-red text-xs">▼</span>
            <span className="text-text-secondary">SELL</span>
          </span>
        </div>

        <div className="w-px h-4 bg-border mx-1" />

        {/* Live price */}
        {livePrice && (
          <div className={`num text-sm font-semibold px-2 py-0.5 rounded transition-colors duration-300 ${
            priceDir === 'up' ? 'text-accent-green' : priceDir === 'down' ? 'text-accent-red' : 'text-text-primary'
          }`}>
            {livePrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        )}
      </div>

      {/* Chart — only mount when symbol is ready so useChart never gets null */}
      {symbol ? (
        <ChartInner
          symbol={symbol}
          interval={interval}
          onSymbolChange={onSymbolChange}
          onPriceUpdate={onPriceUpdate}
          pairs={pairs}
          setSymbol={setSymbol}
          setInterval={setInterval}
          livePrice={livePrice}
          priceDir={priceDir}
          setLivePrice={setLivePrice}
          setPriceDir={setPriceDir}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <span className="text-text-dim text-xs animate-pulse">Cargando pares...</span>
        </div>
      )}
    </div>
  );
}
