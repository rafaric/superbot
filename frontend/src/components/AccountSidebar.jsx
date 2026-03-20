import React from 'react';
import { useAccount } from '../context/AccountContext.jsx';
import OrderPanel from './OrderPanel.jsx';
import TradeHistory from './TradeHistory.jsx';

function fmt(value, decimals = 2) {
  if (value == null || isNaN(value)) return '—';
  return value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function pnlClass(value) {
  if (value > 0) return 'text-emerald-400';
  if (value < 0) return 'text-red-400';
  return 'text-slate-400';
}

function StatCard({ label, value, sub, valueClass = 'text-slate-100' }) {
  return (
    <div className="bg-[#111827] border border-[#1e2d45] rounded-lg p-3">
      <p className="text-[#4a5568] text-[10px] uppercase tracking-widest mb-1">{label}</p>
      <p className={`num text-lg font-semibold leading-none ${valueClass}`}>{value}</p>
      {sub && <p className="text-[#4a5568] text-[10px] mt-1 num">{sub}</p>}
    </div>
  );
}

function Skeleton({ className = '' }) {
  return <div className={`bg-[#1a2035] rounded animate-pulse ${className}`} />;
}

export default function AccountSidebar({ symbol, markPrice }) {
  const {
    balance, positions, realizedPnl, totalUnrealizedPnl,
    loading, lastUpdated, refresh,
  } = useAccount();
  const [activeTab, setActiveTab] = React.useState('account');

  return (
    <aside className="w-72 flex flex-col h-full bg-[#0a0e1a] border-l border-[#1e2d45] overflow-y-auto">

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#1e2d45] shrink-0">
        <span className="text-[#8899aa] text-xs font-medium tracking-widest uppercase">Cuenta</span>
        <button onClick={refresh} className="text-[#4a5568] hover:text-[#8899aa] transition-colors text-xs" title="Actualizar">↻</button>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-[#1e2d45] shrink-0">
        {[
          { key: 'account',  label: 'Balance' },
          { key: 'orders',   label: 'Órdenes' },
          { key: 'history',  label: 'Historial' },
        ].map(({ key, label }) => (
          <button key={key} onClick={() => setActiveTab(key)}
            className={`flex-1 py-2 text-[10px] font-medium transition-colors ${
              activeTab === key
                ? 'text-[#3b82f6] border-b-2 border-[#3b82f6] -mb-px'
                : 'text-[#4a5568] hover:text-[#8899aa]'
            }`}
          >{label}</button>
        ))}
      </div>

      {activeTab === 'history' && <div className="flex-1 overflow-hidden"><TradeHistory /></div>}

      {activeTab !== 'history' && <div className="flex-1 p-3 space-y-3">

        {/* Balance */}
        {loading ? <Skeleton className="h-16" /> : (
          <StatCard
            label="Balance Total"
            value={balance ? `${fmt(balance.totalWalletBalance)} USDT` : '—'}
            sub={balance ? `Disponible: ${fmt(balance.availableBalance)} USDT` : undefined}
          />
        )}

        {/* PnL grid */}
        <div className="grid grid-cols-2 gap-2">
          {loading ? (<><Skeleton className="h-16" /><Skeleton className="h-16" /></>) : (
            <>
              <StatCard label="PnL No Realizado" value={`${totalUnrealizedPnl >= 0 ? '+' : ''}${fmt(totalUnrealizedPnl)}`} valueClass={pnlClass(totalUnrealizedPnl)} />
              <StatCard label="PnL Realizado"    value={`${realizedPnl >= 0 ? '+' : ''}${fmt(realizedPnl)}`}                valueClass={pnlClass(realizedPnl)} />
            </>
          )}
        </div>

        {/* Margin bar */}
        {!loading && balance && (
          <div className="bg-[#111827] border border-[#1e2d45] rounded-lg p-3">
            <div className="flex justify-between text-[10px] text-[#4a5568] mb-1.5">
              <span className="uppercase tracking-widest">Margen</span>
              <span className="num">{fmt(balance.usedMargin)} / {fmt(balance.totalWalletBalance)} USDT</span>
            </div>
            <div className="h-1 bg-[#1e2d45] rounded-full overflow-hidden">
              <div
                className="h-full bg-[#3b82f6] rounded-full transition-all duration-500"
                style={{ width: balance.totalWalletBalance > 0 ? `${Math.min((balance.usedMargin / balance.totalWalletBalance) * 100, 100)}%` : '0%' }}
              />
            </div>
          </div>
        )}

      </div>}

      {/* Order panel — only on orders tab */}
      {activeTab === 'orders' && <OrderPanel symbol={symbol} markPrice={markPrice} />}

      {/* Footer */}
      {activeTab !== 'history' && lastUpdated && (
        <div className="px-4 py-2 border-t border-[#1e2d45] shrink-0">
          <p className="text-[#4a5568] text-[10px] num">
            Actualizado: {new Date(lastUpdated).toLocaleTimeString('es-AR')}
          </p>
        </div>
      )}
    </aside>
  );
}
