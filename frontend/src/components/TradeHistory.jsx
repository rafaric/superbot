import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../utils/api.js';

function fmt(v, d = 2) {
  if (v == null || isNaN(v)) return '—';
  return Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(Number(ts)).toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function TradeHistory() {
  const [trades,   setTrades]   = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);
  const [filter,   setFilter]   = useState('ALL'); // ALL | REALIZED_PNL | FEE

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res  = await apiFetch(`/api/account/income?limit=50`);
      const json = await res.json();
      if (json.ok) setTrades(json.data ?? []);
      else setError(json.error);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = filter === 'ALL'
    ? trades
    : trades.filter((t) => t.incomeType === filter);

  const totalPnl = filtered.reduce((s, t) => s + parseFloat(t.income ?? 0), 0);

  return (
    <div className="flex flex-col h-full">

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#1e2d45] shrink-0">
        <span className="text-[#8899aa] text-xs font-medium tracking-widest uppercase">Historial</span>
        <button onClick={load} className="text-[#4a5568] hover:text-[#8899aa] text-xs transition-colors" title="Actualizar">↻</button>
      </div>

      {/* Filter tabs */}
      <div className="flex border-b border-[#1e2d45] shrink-0">
        {[
          { key: 'ALL',          label: 'Todo' },
          { key: 'REALIZED_PNL', label: 'PnL' },
          { key: 'FEE',          label: 'Comisiones' },
        ].map(({ key, label }) => (
          <button key={key} onClick={() => setFilter(key)}
            className={`flex-1 py-1.5 text-[10px] font-medium transition-colors ${
              filter === key
                ? 'text-[#3b82f6] border-b-2 border-[#3b82f6] -mb-px'
                : 'text-[#4a5568] hover:text-[#8899aa]'
            }`}
          >{label}</button>
        ))}
      </div>

      {/* Summary */}
      {!loading && filtered.length > 0 && (
        <div className="px-4 py-2 border-b border-[#1e2d45] shrink-0">
          <div className="flex justify-between text-[10px]">
            <span className="text-[#4a5568]">{filtered.length} operaciones</span>
            <span className={`num font-medium ${totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {totalPnl >= 0 ? '+' : ''}{fmt(totalPnl)} USDT
            </span>
          </div>
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading && (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-14 bg-[#1a2035] rounded animate-pulse" />
            ))}
          </div>
        )}

        {error && (
          <div className="text-red-400 text-xs text-center py-4">{error}</div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="border border-dashed border-[#1e2d45] rounded-lg p-4 text-center">
            <p className="text-[#4a5568] text-xs">Sin operaciones registradas</p>
          </div>
        )}

        {!loading && filtered.map((t, i) => {
          const income      = parseFloat(t.income ?? 0);
          const isPositive  = income >= 0;
          const isPnl       = t.incomeType === 'REALIZED_PNL';
          const isFee       = t.incomeType === 'FEE';
          const typeLabel   = isPnl ? 'PnL' : isFee ? 'Fee' : t.incomeType ?? '—';
          const typeColor   = isPnl
            ? (isPositive ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400')
            : 'bg-[#1e2d45] text-[#8899aa]';

          return (
            <div key={i} className="bg-[#111827] border border-[#1e2d45] rounded-lg p-3 space-y-1.5">
              {/* Row 1: symbol + type + amount */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-slate-200 text-xs font-semibold">{esc(t.symbol ?? '—')}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${typeColor}`}>
                    {typeLabel}
                  </span>
                </div>
                <span className={`num text-sm font-semibold ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                  {isPositive ? '+' : ''}{fmt(income)} USDT
                </span>
              </div>

              {/* Row 2: date + trade id */}
              <div className="flex justify-between text-[10px] text-[#4a5568]">
                <span className="num">{fmtDate(t.time ?? t.timestamp)}</span>
                {t.tradeId && <span className="num">#{t.tradeId}</span>}
              </div>

              {/* Row 3: extra details if available */}
              {(t.positionSide || t.info) && (
                <div className="text-[10px] text-[#4a5568]">
                  {t.positionSide && <span className="mr-2">{t.positionSide}</span>}
                  {t.info && <span>{t.info}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Simple HTML escape for display
function esc(str) {
  return String(str ?? '');
}
