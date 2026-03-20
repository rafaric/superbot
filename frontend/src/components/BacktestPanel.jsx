import { useState, useCallback } from 'react';
import { apiFetch } from '../utils/api.js';

function fmt(v, d = 2) {
  if (v == null || isNaN(v)) return '—';
  return Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(Number(ts) * 1000).toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function MetricCard({ label, value, sub, valueClass = 'text-slate-100' }) {
  return (
    <div className="bg-[#111827] border border-[#1e2d45] rounded-lg p-3">
      <p className="text-[#4a5568] text-[10px] uppercase tracking-widest mb-1">{label}</p>
      <p className={`num text-base font-semibold leading-none ${valueClass}`}>{value}</p>
      {sub && <p className="text-[#4a5568] text-[10px] mt-1">{sub}</p>}
    </div>
  );
}

function VerdictBadge({ verdict }) {
  const map = {
    PROFITABLE:           { label: '✅ Rentable',          cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
    NEEDS_OPTIMIZATION:   { label: '⚠️ Necesita ajustes',  cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
    INSUFFICIENT_DATA:    { label: '📊 Datos insuficientes', cls: 'bg-[#1e2d45] text-[#8899aa] border-[#2a3f60]' },
  };
  const { label, cls } = map[verdict] ?? map.INSUFFICIENT_DATA;
  return (
    <span className={`text-xs px-3 py-1 rounded-full border font-medium ${cls}`}>{label}</span>
  );
}

export default function BacktestPanel({ symbol, tradingPairs = [] }) {
  const [params, setParams] = useState({
    symbol:   symbol ?? 'BTC-USDT',
    interval: '5m',
    limit:    300,
    rsiUp:    55,
    rsiDown:  45,
    volMin:   1.2,
    slRatio:  1.0,
    tpRatio:  2.0,
  });

  const [result,    setResult]    = useState(null);
  const [analysis,  setAnalysis]  = useState(null);
  const [loading,   setLoading]   = useState(false);
  const [tab,       setTab]       = useState('metrics'); // metrics | trades | optimizer

  const runBacktest = useCallback(async () => {
    setLoading(true); setResult(null); setAnalysis(null);
    try {
      const res  = await apiFetch('/api/backtest/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      const json = await res.json();
      if (json.ok) setResult(json);
      else alert(json.error);
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  }, [params]);

  const runOptimizer = useCallback(async () => {
    setLoading(true); setAnalysis(null);
    try {
      const res  = await apiFetch('/api/backtest/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: params.symbol, interval: params.interval, limit: params.limit }),
      });
      const json = await res.json();
      if (json.ok) { setAnalysis(json); setResult(json.baseline); setTab('optimizer'); }
      else alert(json.error);
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  }, [params]);

  const INTERVALS = ['1m','3m','5m','15m','1h','2h','4h','6h','1d'];
  const pairs = tradingPairs.length ? tradingPairs : ['BTC-USDT','ETH-USDT','SOL-USDT'];

  return (
    <div className="flex flex-col h-full bg-[#0a0e1a]">

      {/* Header */}
      <div className="px-4 py-3 border-b border-[#1e2d45] shrink-0">
        <h2 className="text-[#8899aa] text-xs font-medium tracking-widest uppercase">Backtest de Estrategia</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* ── Config ─────────────────────────────────────────────────── */}
        <div className="bg-[#111827] border border-[#1e2d45] rounded-lg p-4 space-y-3">
          <p className="text-[#8899aa] text-[10px] uppercase tracking-widest">Parámetros</p>

          <div className="grid grid-cols-2 gap-3">
            {/* Symbol */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-[#4a5568] uppercase tracking-widest">Par</label>
              <select value={params.symbol} onChange={(e) => setParams((p) => ({ ...p, symbol: e.target.value }))}
                className="bg-[#0a0e1a] border border-[#1e2d45] rounded px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-[#3b82f6]/60"
              >
                {pairs.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            {/* Interval */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-[#4a5568] uppercase tracking-widest">Intervalo</label>
              <select value={params.interval} onChange={(e) => setParams((p) => ({ ...p, interval: e.target.value }))}
                className="bg-[#0a0e1a] border border-[#1e2d45] rounded px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-[#3b82f6]/60"
              >
                {INTERVALS.map((i) => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>
          </div>

          {/* Candles */}
          <div className="flex flex-col gap-1">
            <div className="flex justify-between">
              <label className="text-[10px] text-[#4a5568] uppercase tracking-widest">Velas a testear</label>
              <span className="num text-xs text-[#3b82f6]">{params.limit}</span>
            </div>
            <input type="range" min="50" max="1000" step="50" value={params.limit}
              onChange={(e) => setParams((p) => ({ ...p, limit: Number(e.target.value) }))}
              className="w-full accent-[#3b82f6] h-1"
            />
          </div>

          {/* RSI */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <div className="flex justify-between">
                <label className="text-[10px] text-[#4a5568] uppercase">RSI Buy &gt;</label>
                <span className="num text-xs text-[#3b82f6]">{params.rsiUp}</span>
              </div>
              <input type="range" min="45" max="70" step="1" value={params.rsiUp}
                onChange={(e) => setParams((p) => ({ ...p, rsiUp: Number(e.target.value) }))}
                className="w-full accent-[#3b82f6] h-1"
              />
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex justify-between">
                <label className="text-[10px] text-[#4a5568] uppercase">RSI Sell &lt;</label>
                <span className="num text-xs text-[#3b82f6]">{params.rsiDown}</span>
              </div>
              <input type="range" min="30" max="55" step="1" value={params.rsiDown}
                onChange={(e) => setParams((p) => ({ ...p, rsiDown: Number(e.target.value) }))}
                className="w-full accent-[#3b82f6] h-1"
              />
            </div>
          </div>

          {/* VolRel + TP Ratio */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <div className="flex justify-between">
                <label className="text-[10px] text-[#4a5568] uppercase">Vol Rel &gt;</label>
                <span className="num text-xs text-[#3b82f6]">{params.volMin}x</span>
              </div>
              <input type="range" min="1.0" max="2.5" step="0.1" value={params.volMin}
                onChange={(e) => setParams((p) => ({ ...p, volMin: parseFloat(e.target.value) }))}
                className="w-full accent-[#3b82f6] h-1"
              />
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex justify-between">
                <label className="text-[10px] text-[#4a5568] uppercase">R/R</label>
                <span className="num text-xs text-[#3b82f6]">1:{params.tpRatio}</span>
              </div>
              <input type="range" min="1.0" max="4.0" step="0.5" value={params.tpRatio}
                onChange={(e) => setParams((p) => ({ ...p, tpRatio: parseFloat(e.target.value) }))}
                className="w-full accent-[#3b82f6] h-1"
              />
            </div>
          </div>

          {/* Buttons */}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button onClick={runBacktest} disabled={loading}
              className="py-2 rounded text-xs font-semibold bg-[#3b82f6] hover:bg-[#2563eb] text-white transition-all disabled:opacity-50"
            >
              {loading ? '⏳ Corriendo...' : '▶ Correr Backtest'}
            </button>
            <button onClick={runOptimizer} disabled={loading}
              className="py-2 rounded text-xs font-semibold bg-[#1a2035] hover:bg-[#1e2d45] text-[#8899aa] hover:text-slate-200 border border-[#1e2d45] transition-all disabled:opacity-50"
            >
              {loading ? '⏳ Analizando...' : '🧠 Auto-Optimizar'}
            </button>
          </div>
        </div>

        {/* ── Results ──────────────────────────────────────────────────── */}
        {result && (
          <>
            {/* Tab bar */}
            <div className="flex border-b border-[#1e2d45]">
              {[
                { key: 'metrics',   label: 'Métricas' },
                { key: 'trades',    label: `Trades (${result.trades?.length ?? 0})` },
                ...(analysis ? [{ key: 'optimizer', label: '🧠 Sugerencias' }] : []),
              ].map(({ key, label }) => (
                <button key={key} onClick={() => setTab(key)}
                  className={`flex-1 py-1.5 text-[10px] font-medium transition-colors ${
                    tab === key
                      ? 'text-[#3b82f6] border-b-2 border-[#3b82f6] -mb-px'
                      : 'text-[#4a5568] hover:text-[#8899aa]'
                  }`}
                >{label}</button>
              ))}
            </div>

            {/* Metrics tab */}
            {tab === 'metrics' && result.metrics && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <MetricCard label="Total Trades"  value={result.metrics.totalTrades} />
                  <MetricCard label="Win Rate"
                    value={`${fmt(result.metrics.winRate)}%`}
                    valueClass={result.metrics.winRate >= 50 ? 'text-emerald-400' : 'text-red-400'}
                  />
                  <MetricCard label="PnL Total"
                    value={`${result.metrics.totalPnlPct >= 0 ? '+' : ''}${fmt(result.metrics.totalPnlPct)}%`}
                    valueClass={result.metrics.totalPnlPct >= 0 ? 'text-emerald-400' : 'text-red-400'}
                    sub={`${result.metrics.wins}W / ${result.metrics.losses}L`}
                  />
                  <MetricCard label="Profit Factor"
                    value={result.metrics.profitFactor ?? '—'}
                    valueClass={result.metrics.profitFactor >= 1.5 ? 'text-emerald-400' : result.metrics.profitFactor >= 1 ? 'text-amber-400' : 'text-red-400'}
                  />
                  <MetricCard label="Avg Win"
                    value={`+${fmt(result.metrics.avgWinPct)}%`}
                    valueClass="text-emerald-400"
                  />
                  <MetricCard label="Avg Loss"
                    value={`${fmt(result.metrics.avgLossPct)}%`}
                    valueClass="text-red-400"
                  />
                  <MetricCard label="Max Drawdown"
                    value={`-${fmt(result.metrics.maxDrawdownPct)}%`}
                    valueClass="text-red-400"
                  />
                  <MetricCard label="Racha máx"
                    value={`${result.metrics.maxConsecWins}W / ${result.metrics.maxConsecLosses}L`}
                    sub="Wins / Losses"
                  />
                </div>
              </div>
            )}

            {/* Trades tab */}
            {tab === 'trades' && (
              <div className="space-y-2">
                {result.trades?.length === 0 && (
                  <p className="text-[#4a5568] text-xs text-center py-4">No se generaron señales en este período</p>
                )}
                {result.trades?.map((t, i) => (
                  <div key={i} className={`bg-[#111827] border rounded-lg p-3 space-y-1 ${
                    t.result === 'TP' ? 'border-emerald-500/30' : 'border-red-500/30'
                  }`}>
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                          t.type === 'LONG' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
                        }`}>{t.type}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                          t.result === 'TP' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
                        }`}>{t.result}</span>
                      </div>
                      <span className={`num text-sm font-semibold ${t.pnlPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {t.pnlPct >= 0 ? '+' : ''}{fmt(t.pnlPct)}%
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-1 text-[10px] text-[#4a5568]">
                      <span>Entrada: <span className="num text-slate-400">{fmt(t.entryPrice)}</span></span>
                      <span>Salida: <span className="num text-slate-400">{fmt(t.exitPrice)}</span></span>
                      <span className="num">{fmtDate(t.entryTime)}</span>
                      <span>RSI: <span className="num text-slate-400">{fmt(t.rsiAtEntry, 1)}</span></span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Optimizer tab */}
            {tab === 'optimizer' && analysis && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[#8899aa] text-xs">Resultado actual</span>
                  <VerdictBadge verdict={analysis.verdict} />
                </div>

                {analysis.problems?.length > 0 && (
                  <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 space-y-1">
                    <p className="text-amber-400 text-[10px] font-medium uppercase tracking-widest">Problemas detectados</p>
                    {analysis.problems.map((p) => (
                      <p key={p} className="text-amber-300/70 text-[11px]">• {problemLabel(p)}</p>
                    ))}
                  </div>
                )}

                {analysis.suggestions?.length === 0 && (
                  <p className="text-[#4a5568] text-xs text-center py-2">No hay sugerencias — la estrategia se ve bien.</p>
                )}

                {analysis.suggestions?.map((s, i) => (
                  <div key={i} className={`border rounded-lg p-3 space-y-2 ${
                    s.improvement ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-[#1e2d45] bg-[#111827]'
                  }`}>
                    <div className="flex justify-between items-start">
                      <p className="text-slate-200 text-xs font-medium flex-1 pr-2">{s.description}</p>
                      {s.improvement && <span className="text-[10px] text-emerald-400 shrink-0">✅ Mejora</span>}
                    </div>

                    {/* Before / After */}
                    <div className="grid grid-cols-2 gap-2 text-[10px]">
                      <div className="bg-[#0a0e1a] rounded p-2">
                        <p className="text-[#4a5568] mb-1">Actual</p>
                        <p className="num text-slate-400">PnL: <span className={s.baseline.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>{s.baseline.pnl >= 0 ? '+' : ''}{fmt(s.baseline.pnl)}%</span></p>
                        <p className="num text-slate-400">Win: {fmt(s.baseline.winRate)}%</p>
                        <p className="num text-slate-400">Trades: {s.baseline.trades}</p>
                      </div>
                      <div className="bg-[#0a0e1a] rounded p-2">
                        <p className="text-[#4a5568] mb-1">Proyectado</p>
                        <p className="num text-slate-400">PnL: <span className={s.projected.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>{s.projected.pnl >= 0 ? '+' : ''}{fmt(s.projected.pnl)}%</span></p>
                        <p className="num text-slate-400">Win: {fmt(s.projected.winRate)}%</p>
                        <p className="num text-slate-400">Trades: {s.projected.trades}</p>
                      </div>
                    </div>

                    {/* Proposed changes */}
                    <div className="text-[10px] text-[#4a5568] space-y-0.5">
                      {Object.entries(s.changes).map(([k, v]) => (
                        <span key={k} className="inline-block mr-2 bg-[#1a2035] px-1.5 py-0.5 rounded">
                          {k}: <span className="text-[#3b82f6]">{v}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function problemLabel(p) {
  const map = {
    pnl_negative:       'PnL total negativo',
    low_win_rate:       'Win rate menor al 40%',
    too_few_trades:     'Menos de 5 señales en el período',
    too_many_trades:    'Más de 50 señales — posible sobreajuste',
    high_drawdown:      'Drawdown máximo mayor al 20%',
    poor_profit_factor: 'Profit factor menor a 1',
  };
  return map[p] ?? p;
}
