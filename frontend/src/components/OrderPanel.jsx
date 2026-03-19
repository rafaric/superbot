import { useState, useCallback, useEffect } from 'react';
import { useAccount } from '../context/AccountContext.jsx';
import { apiFetch } from '../utils/api.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(v, d = 2) {
  if (v == null || isNaN(v)) return '—';
  return Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function Input({ label, value, onChange, placeholder, disabled }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] text-text-dim uppercase tracking-widest">{label}</label>
      <input
        type="number"
        step="any"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="num bg-bg-primary border border-border rounded px-2 py-1.5 text-xs text-slate-200
          focus:outline-none focus:border-[#3b82f6]/60 placeholder-border-bright disabled:opacity-40 w-full"
      />
    </div>
  );
}

function StatusMsg({ msg }) {
  if (!msg) return null;
  return (
    <div className={`text-[11px] px-2 py-1.5 rounded border ${
      msg.type === 'error'
        ? 'bg-red-500/10 border-red-500/30 text-red-400'
        : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
    }`}>{msg.text}</div>
  );
}

const LABEL_PCT       = '% del Balance';
const LABEL_LEVERAGE  = 'Apalancamiento';

// ─── New Order Form ───────────────────────────────────────────────────────────
function NewOrderForm({ symbol, markPrice, onSubmitReady }) {
  const { refresh } = useAccount();
  const [side,        setSide]        = useState('BUY');
  const [pct,         setPct]         = useState(10);
  const [leverage,    setLeverage]    = useState('10');
  const [savedPct,    setSavedPct]    = useState(10);
  const [savedLev,    setSavedLev]    = useState('10');
  const [saving,      setSaving]      = useState(false);
  const [saveStatus,  setSaveStatus]  = useState(null);

  // Load saved values from backend on mount
  useEffect(() => {
    apiFetch('/api/config/trading')
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) {
          setPct(j.pct);          setSavedPct(j.pct);
          setLeverage(String(j.leverage)); setSavedLev(String(j.leverage));
        }
      })
      .catch(() => {});
  }, []);

  const isDirty = pct !== savedPct || String(leverage) !== String(savedLev);

  const saveConfig = useCallback(async () => {
    setSaving(true); setSaveStatus(null);
    try {
      const res  = await apiFetch('/api/config/trading', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pct, leverage: parseInt(leverage) }),
      });
      const json = await res.json();
      if (json.ok) {
        setSavedPct(pct); setSavedLev(String(leverage));
        setSaveStatus({ type: 'success', text: '✓ Guardado' });
        setTimeout(() => setSaveStatus(null), 2000);
      } else {
        setSaveStatus({ type: 'error', text: json.error });
      }
    } catch (err) {
      setSaveStatus({ type: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  }, [pct, leverage]);
  const [useSLTP,     setUseSLTP]     = useState(false);
  const [stopLoss,    setStopLoss]    = useState('');
  const [takeProfit,  setTakeProfit]  = useState('');
  const [loading,     setLoading]     = useState(false);
  const [status,      setStatus]      = useState(null);
  const [sizePreview, setSizePreview] = useState(null);

  // Live size preview — always fetch, store both ok and error state
  useEffect(() => {
    if (!markPrice || !symbol) return;
    const timer = setTimeout(() => {
      apiFetch(`/api/orders/size?symbol=${symbol}&price=${markPrice}&pct=${pct}&leverage=${leverage}`)
        .then((r) => r.json())
        .then((json) => setSizePreview(json))
        .catch(() => setSizePreview(null));
    }, 400);
    return () => clearTimeout(timer);
  }, [pct, leverage, markPrice, symbol]);

  // Order is valid only if size preview exists and has no error
  const sizeOk = sizePreview?.ok === true;

  const submit = useCallback(async () => {
    if (!pct || pct <= 0 || pct > 100) {
      setStatus({ type: 'error', text: 'Ingresá un porcentaje entre 1 y 100' });
      return;
    }
    setLoading(true);
    setStatus(null);

    try {
      // Set leverage
      const levRes = await apiFetch('/api/orders/leverage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, leverage: parseInt(leverage) }),
      });
      if (!levRes.ok) {
        const j = await levRes.json().catch(() => ({}));
        console.warn('[Orders] Leverage update failed:', j.error);
      }

      // Place order
      const body = { symbol, side, pct, price: markPrice, leverage: parseInt(leverage) };
      if (useSLTP && stopLoss)   body.stopLoss   = parseFloat(stopLoss);
      if (useSLTP && takeProfit) body.takeProfit = parseFloat(takeProfit);

      const res  = await apiFetch('/api/orders/market', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();

      if (json.ok) {
        setStatus({ type: 'success', text: `✓ Orden ${side} ejecutada` });
        setStopLoss('');
        setTakeProfit('');
        setTimeout(refresh, 800);
      } else {
        setStatus({ type: 'error', text: json.error || 'Error al ejecutar orden' });
      }
    } catch (err) {
      setStatus({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  }, [symbol, side, pct, leverage, useSLTP, stopLoss, takeProfit, refresh, markPrice]);

  useEffect(() => {
    onSubmitReady?.({ submit, loading, sizeOk, sizePreview, side, leverage, pct });
  }, [submit, loading, sizeOk, sizePreview, side, leverage, pct]);

  return (
    <div className="flex flex-col flex-1 gap-3">
      {/* BUY / SELL toggle */}
      <div className="grid grid-cols-2 gap-1">
        {[{ side: 'BUY', label: '▲ LONG' }, { side: 'SELL', label: '▼ SHORT' }].map(({ side: s, label }) => (
          <button key={s} onClick={() => setSide(s)}
            className={`py-2 rounded text-xs font-semibold tracking-wide transition-all ${
              side === s
                ? s === 'BUY'
                  ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20'
                  : 'bg-red-500 text-white shadow-lg shadow-red-500/20'
                : 'bg-bg-card text-text-dim hover:text-text-secondary'
            }`}
          >{label}</button>
        ))}
      </div>

      {/* Mark price */}
      {markPrice > 0 && (
        <div className="flex justify-between text-[10px]">
          <span className="text-text-dim">Precio Mark</span>
          <span className="num text-slate-300">{fmt(markPrice)}</span>
        </div>
      )}

      {/* % of balance */}
      <div className="space-y-2">
        <div className="flex flex-col gap-4">
          <div className="flex justify-between">
            <label className="text-[10px] text-text-dim uppercase tracking-widest">{LABEL_PCT}</label>
            <span className="num text-xs text-[#3b82f6]">{pct}%</span>
          </div>
          <input type="range" min="1" max="100" step="1" value={pct}
            onChange={(e) => setPct(Number(e.target.value))}
            className="w-full accent-[#3b82f6] h-1"
          />
          <div className="flex gap-2">
            {[10, 25, 50, 75, 100].map((p) => (
              <button key={p} onClick={() => setPct(p)}
                className={`flex-1 py-0.5 rounded text-[10px] transition-all ${
                  pct === p ? 'bg-[#3b82f6]/30 text-[#3b82f6]' : 'bg-bg-card text-text-dim hover:text-text-secondary'
                }`}
              >{p}%</button>
            ))}
          </div>
        </div>

        {/* Leverage */}
        <div className="flex flex-col gap-5 mt-5 mb-5">
          <div className="flex justify-between">
            <label className="text-[10px] text-text-dim uppercase tracking-widest">{LABEL_LEVERAGE}</label>
            <span className="num text-xs text-[#3b82f6]">x{leverage}</span>
          </div>
          <input type="range" min="1" max="125" step="1" value={leverage}
            onChange={(e) => setLeverage(e.target.value)}
            className="w-full accent-[#3b82f6] h-1"
          />
        </div>

        {/* Save config button — only shown when values differ from saved */}
        {(isDirty || saveStatus) && (
          <div className="flex items-center gap-2">
            {isDirty && (
              <button
                onClick={saveConfig}
                disabled={saving}
                className="flex-1 py-1 rounded text-[10px] font-medium bg-[#3b82f6]/20 hover:bg-[#3b82f6]/30 text-[#3b82f6] border border-[#3b82f6]/30 transition-all disabled:opacity-50"
              >
                {saving ? 'Guardando...' : '💾 Guardar como predeterminado'}
              </button>
            )}
            {saveStatus && <StatusMsg msg={saveStatus} />}
          </div>
        )}

        {/* Size preview or warning */}
        {sizePreview && (
          sizeOk ? (
            <div className="bg-bg-primary border border-border rounded p-2 text-[10px] space-y-0.5">
              <div className="flex justify-between">
                <span className="text-text-dim">Cantidad estimada</span>
                <span className="num text-slate-300">{sizePreview.quantity} {symbol?.split('-')[0]}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-dim">Capital a usar</span>
                <span className="num text-slate-300">{Number(sizePreview.usedBalance).toFixed(2)} USDT</span>
              </div>
            </div>
          ) : (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded p-2 text-[10px] text-amber-400 flex gap-2">
              <span className="shrink-0">⚠️</span>
              <span>{sizePreview.error ?? 'Capital insuficiente para esta operación'}</span>
            </div>
          )
        )}
      </div>

      {/* SL/TP */}
      <button onClick={() => setUseSLTP((v) => !v)}
        className="flex items-center gap-2 text-[10px] text-text-secondary hover:text-slate-300 transition-colors"
      >
        <span className={`w-3 h-3 rounded-sm border flex items-center justify-center transition-colors ${
          useSLTP ? 'bg-[#3b82f6] border-[#3b82f6]' : 'border-border-bright'
        }`}>
          {useSLTP && <span className="text-white text-[8px]">✓</span>}
        </span>
        Incluir Stop Loss / Take Profit
      </button>

      {useSLTP && (
        <div className="grid grid-cols-2 gap-2">
          <Input label="Stop Loss"   value={stopLoss}   onChange={setStopLoss}   placeholder={markPrice ? fmt(markPrice * (side === 'BUY' ? 0.98 : 1.02)) : '0.00'} />
          <Input label="Take Profit" value={takeProfit} onChange={setTakeProfit} placeholder={markPrice ? fmt(markPrice * (side === 'BUY' ? 1.03 : 0.97)) : '0.00'} />
        </div>
      )}

      <StatusMsg msg={status} />
    </div>
  );
}

// ─── SL/TP Editor ─────────────────────────────────────────────────────────────
function SLTPEditor({ position }) {
  const { refresh } = useAccount();
  const [sl, setSL] = useState('');
  const [tp, setTP] = useState('');
  const [loading, setLoading] = useState(false);
  const [status,  setStatus]  = useState(null);
  const [open,    setOpen]    = useState(false);

  const submit = useCallback(async () => {
    if (!sl && !tp) { setStatus({ type: 'error', text: 'Ingresá al menos un valor' }); return; }
    setLoading(true); setStatus(null);
    try {
      const body = { symbol: position.symbol };
      if (sl) body.stopLoss   = parseFloat(sl);
      if (tp) body.takeProfit = parseFloat(tp);
      const res  = await apiFetch('/api/orders/sltp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.ok) {
        setStatus({ type: 'success', text: '✓ SL/TP actualizado' });
        setSL(''); setTP('');
        setTimeout(refresh, 800);
      } else {
        setStatus({ type: 'error', text: json.error });
      }
    } catch (err) {
      setStatus({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  }, [position.symbol, sl, tp, refresh]);

  return (
    <div className="border-t border-border pt-2 mt-2">
      <button onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between w-full text-[10px] text-text-secondary hover:text-slate-300"
      >
        <span>Ajustar SL / TP</span>
        <span>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Input label="Stop Loss"   value={sl} onChange={setSL} placeholder="Precio SL" />
            <Input label="Take Profit" value={tp} onChange={setTP} placeholder="Precio TP" />
          </div>
          <StatusMsg msg={status} />
          <button onClick={submit} disabled={loading}
            className="w-full py-1.5 rounded text-[11px] font-medium bg-bg-card hover:bg-border text-text-secondary hover:text-slate-200 border border-border transition-all disabled:opacity-50"
          >
            {loading ? 'Actualizando...' : 'Actualizar SL/TP'}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Position Card ────────────────────────────────────────────────────────────
function PositionCard({ position }) {
  const { refresh } = useAccount();
  const [closing, setClosing] = useState(false);
  const [status,  setStatus]  = useState(null);

  const close = useCallback(async () => {
    if (!window.confirm(`¿Cerrar posición ${position.symbol} ${position.side}?`)) return;
    setClosing(true); setStatus(null);
    try {
      // Use positionSide directly (hedge mode) — avoids sign inference errors
      const res  = await apiFetch('/api/orders/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol:       position.symbol,
          positionSide: position.positionSide ?? (position.side === 'Long' ? 'LONG' : 'SHORT'),
          quantity:     position.size,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        setStatus({ type: 'success', text: '✓ Posición cerrada' });
        setTimeout(refresh, 800);
      } else {
        setStatus({ type: 'error', text: json.error });
      }
    } catch (err) {
      setStatus({ type: 'error', text: err.message });
    } finally {
      setClosing(false);
    }
  }, [position, refresh]);

  const pnlColor = position.unrealizedProfit >= 0 ? 'text-emerald-400' : 'text-red-400';
  const pnlPct   = position.entryPrice > 0
    ? ((position.markPrice - position.entryPrice) / position.entryPrice) * 100
      * (position.side === 'Long' ? 1 : -1) * position.leverage
    : 0;

  return (
    <div className="bg-bg-panel border border-border rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-slate-200 text-xs font-semibold">{position.symbol}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
            position.side === 'Long' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
          }`}>{position.side}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-border text-text-secondary">x{position.leverage}</span>
        </div>
        <span className={`num text-sm font-semibold ${pnlColor}`}>
          {position.unrealizedProfit >= 0 ? '+' : ''}{fmt(position.unrealizedProfit)} USDT
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        <div><span className="text-text-dim">Entrada </span><span className="num text-slate-300">{fmt(position.entryPrice)}</span></div>
        <div><span className="text-text-dim">Mark </span><span className="num text-slate-300">{fmt(position.markPrice)}</span></div>
        <div><span className="text-text-dim">Tamaño </span><span className="num text-slate-300">{fmt(position.size, 4)}</span></div>
        <div>
          <span className="text-text-dim">ROE </span>
          <span className={`num font-medium ${pnlColor}`}>{pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%</span>
        </div>
      </div>
      <SLTPEditor position={position} />
      <StatusMsg msg={status} />
      <button onClick={close} disabled={closing}
        className="w-full py-1.5 rounded text-[11px] font-medium bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 transition-all disabled:opacity-50"
      >
        {closing ? 'Cerrando...' : '✕ Cerrar posición a mercado'}
      </button>
    </div>
  );
}

// ─── Main OrderPanel ──────────────────────────────────────────────────────────
export default function OrderPanel({ symbol, markPrice = 0 }) {
  const { positions } = useAccount();
  const [tab, setTab] = useState('nueva');
  const [btnState, setBtnState] = useState(null);

  return (
    <div className="flex flex-col border-t border-border">
      <div className="flex border-b border-border shrink-0">
        {[
          { key: 'nueva',      label: 'Nueva Orden' },
          { key: 'posiciones', label: `Posiciones${positions.length ? ` (${positions.length})` : ''}` },
        ].map(({ key, label }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex-1 py-2 text-[11px] font-medium transition-colors ${
              tab === key
                ? 'text-[#3b82f6] border-b-2 border-[#3b82f6] -mb-px'
                : 'text-text-dim hover:text-text-secondary'
            }`}
          >{label}</button>
        ))}
      </div>

      <div className="p-3 min-h-80">
        {tab === 'nueva' && <NewOrderForm symbol={symbol} markPrice={markPrice} onSubmitReady={setBtnState} />}
        {tab === 'posiciones' && (
          <div className="space-y-2">
            {positions.length === 0 ? (
              <div className="border border-dashed border-border rounded-lg p-4 text-center">
                <p className="text-text-dim text-xs">Sin posiciones abiertas</p>
              </div>
            ) : (
              positions.map((pos, i) => (
                <PositionCard key={`${pos.symbol}-${pos.side}-${i}`} position={pos} />
              ))
            )}
          </div>
        )}
      </div>

      {tab === 'nueva' && btnState && (
        <div className="px-3 pb-3 shrink-0">
          <button
            onClick={btnState.submit}
            disabled={btnState.loading || !btnState.sizeOk}
            title={!btnState.sizeOk ? (btnState.sizePreview?.error ?? 'Capital insuficiente') : ''}
            className={`w-full py-2.5 rounded text-xs font-semibold tracking-wide transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
              btnState.side === 'BUY'
                ? 'bg-emerald-500 hover:bg-emerald-400 text-white shadow-lg shadow-emerald-500/20'
                : 'bg-red-500 hover:bg-red-400 text-white shadow-lg shadow-red-500/20'
            }`}
          >
            {btnState.loading
              ? 'Ejecutando...'
              : !btnState.sizeOk
                ? '⚠️ Capital insuficiente'
                : `${btnState.side === 'BUY' ? '▲ Abrir Long' : '▼ Abrir Short'} · x${btnState.leverage} · ${btnState.pct}%`
            }
          </button>
        </div>
      )}
    </div>
  );
}
