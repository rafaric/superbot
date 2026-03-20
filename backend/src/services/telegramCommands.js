import { send, esc } from './telegram.js';
import { getBalance, getPositions, getIncome } from './bingx.js';
import { startScanner, stopScanner } from './scanner.js';
import { sendCloseMenu } from './telegramTrader.js';
import { runCalibration, getActivePairs, getLastCalibration } from './autoCalibrator.js';
import { TRADING_PAIRS } from '../index.js';

export function buildCommandHandlers(indicatorsGetter) {
  return {

    '/start': async () => {
      send(
        `🤖 <b>BingX Trading Bot activo</b>\n` +
        `─────────────────────\n` +
        `Comandos disponibles:\n` +
        `/balance - Balance de la cuenta\n` +
        `/posiciones - Posiciones abiertas\n` +
        `/resumen - Resumen completo\n` +
        `/indicadores [PAR] - Estado de indicadores\n` +
        `/scanner - Estado del scanner autónomo\n` +
        `/cerrar - Cerrar posición abierta\n` +
        `/calibrar - Recalibrar pares activos\n` +
        `/activos - Ver pares activos`
      );
    },

    '/balance': async () => {
      const data = await getBalance();
      const b = Array.isArray(data) ? data[0] : data;
      if (!b) { send('❌ No se pudo obtener el balance.'); return; }
      const total      = parseFloat(b.totalWalletBalance  ?? b.balance        ?? 0);
      const available  = parseFloat(b.availableBalance    ?? b.availableMargin ?? 0);
      const unrealized = parseFloat(b.unrealizedProfit    ?? b.unrealizedPnl   ?? 0);
      send(
        `💰 <b>Balance de Cuenta</b>\n` +
        `─────────────────────\n` +
        `Total:        <code>${esc(total.toFixed(2))} USDT</code>\n` +
        `Disponible:   <code>${esc(available.toFixed(2))} USDT</code>\n` +
        `PnL no real.: <code>${esc(unrealized.toFixed(2))} USDT</code>`
      );
    },

    '/posiciones': async () => {
      const data = await getPositions();
      const open = (Array.isArray(data) ? data : [])
        .filter((p) => parseFloat(p.positionAmt ?? p.positionAmount ?? 0) !== 0);
      if (!open.length) { send('📭 No hay posiciones abiertas.'); return; }

      const lines = open.map((p) => {
        const side  = parseFloat(p.positionAmt ?? 0) > 0 ? 'Long' : 'Short';
        const entry = parseFloat(p.entryPrice ?? p.avgPrice ?? 0);
        const mark  = parseFloat(p.markPrice ?? 0);
        const pnl   = parseFloat(p.unrealizedProfit ?? p.unRealizedProfit ?? 0);
        const lev   = parseInt(p.leverage ?? 1);
        const emoji = pnl >= 0 ? '🟢' : '🔴';
        const sign  = pnl >= 0 ? '+' : '';
        return (
          `<b>${esc(p.symbol)}</b> | ${side} | x${lev}\n` +
          `Entrada: <code>${esc(entry.toFixed(2))}</code> | Mark: <code>${esc(mark.toFixed(2))}</code>\n` +
          `PnL: <code>${sign}${esc(pnl.toFixed(2))} USDT</code> ${emoji}`
        );
      });

      send(`📊 <b>Posiciones Abiertas</b>\n─────────────────────\n${lines.join('\n─────────────────────\n')}`);
    },

    '/resumen': async () => {
      const [balData, posData, incData] = await Promise.all([
        getBalance().catch(() => null),
        getPositions().catch(() => []),
        getIncome({ incomeType: 'REALIZED_PNL', limit: 100 }).catch(() => []),
      ]);
      const b    = balData ? (Array.isArray(balData) ? balData[0] : balData) : null;
      const open = (Array.isArray(posData) ? posData : []).filter((p) => parseFloat(p.positionAmt ?? 0) !== 0);
      const realizedPnl   = (Array.isArray(incData) ? incData : []).reduce((s, i) => s + parseFloat(i.income ?? i.realizedPnl ?? 0), 0);
      const unrealizedPnl = open.reduce((s, p) => s + parseFloat(p.unrealizedProfit ?? 0), 0);
      const total     = parseFloat(b?.totalWalletBalance ?? 0);
      const available = parseFloat(b?.availableBalance   ?? 0);

      send(
        `📈 <b>Resumen de Sesión</b>\n` +
        `─────────────────────\n` +
        `Balance:          <code>${esc(total.toFixed(2))} USDT</code>\n` +
        `Disponible:       <code>${esc(available.toFixed(2))} USDT</code>\n` +
        `PnL no realizado: <code>${unrealizedPnl >= 0 ? '+' : ''}${esc(unrealizedPnl.toFixed(2))} USDT</code>\n` +
        `PnL realizado:    <code>${realizedPnl >= 0 ? '+' : ''}${esc(realizedPnl.toFixed(2))} USDT</code>\n` +
        `Posiciones abiertas: <code>${open.length}</code>`
      );
    },

    '/indicadores': async (args) => {
      const symbol     = (args[0] ?? 'BTC-USDT').toUpperCase();
      const indicators = indicatorsGetter(symbol);
      if (!indicators) {
        send(`❓ Sin datos de indicadores para <code>${esc(symbol)}</code>. ¿Está abierto el gráfico?`);
        return;
      }
      const { ema8, ema21, vwap, price } = indicators;
      const condBuy  = price > ema8 && ema8 > ema21 && ema21 > vwap;
      const condSell = price < ema8 && ema8 < ema21 && ema21 < vwap;
      const signal   = condBuy ? '🟢 BUY' : condSell ? '🔴 SELL' : '⚪ Neutral';

      send(
        `📉 <b>Indicadores ${esc(symbol)}</b>\n` +
        `─────────────────────\n` +
        `Precio: <code>${esc(price.toFixed(2))}</code>\n` +
        `EMA 8:  <code>${esc(ema8.toFixed(2))}</code>\n` +
        `EMA 21: <code>${esc(ema21.toFixed(2))}</code>\n` +
        `VWAP:   <code>${esc(vwap.toFixed(2))}</code>\n` +
        `─────────────────────\n` +
        `Señal: <b>${signal}</b>`
      );
    },

    '/calibrar': async () => {
      send('⏳ Iniciando calibración de todos los pares...');
      try {
        await runCalibration(TRADING_PAIRS);
      } catch (err) {
        send(`❌ Error en calibración: ${esc(err.message)}`);
      }
    },

    '/activos': async () => {
      const pairs = getActivePairs();
      const last  = getLastCalibration();
      if (!pairs || pairs.length === 0) {
        send('📊 Sin calibración aún o ningún par rentable. Usá /calibrar para correr el análisis.');
        return;
      }
      const lines = [
        `✅ <b>Pares activos (${pairs.length})</b>`,
        last ? `Última calibración: <code>${new Date(last).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}</code>` : '',
        `─────────────────────`,
        ...pairs.map((r) => `• <b>${esc(r.symbol)}</b> ${r.interval} — PnL: <code>${r.pnl >= 0 ? '+' : ''}${r.pnl.toFixed(2)}%</code> WR: <code>${r.winRate}%</code>`),
      ].filter(Boolean);
      send(lines.join('\n'));
    },

    '/cerrar': async () => {
      await sendCloseMenu();
    },

    '/scanner': async (args) => {
      const sub = (args[0] ?? '').toLowerCase();
      if (sub === 'stop') {
        stopScanner();
        send('🔴 Scanner <b>detenido</b>.');
      } else if (sub === 'start') {
        startScanner();
        send('🟢 Scanner <b>iniciado</b>.');
      } else {
        const pairs = TRADING_PAIRS.map(esc).join(', ');
        send(
          `🔍 <b>Scanner Autónomo</b>\n` +
          `─────────────────────\n` +
          `Pares monitoreados:\n<code>${pairs}</code>\n\n` +
          `Comandos:\n` +
          `/scanner start - Iniciar\n` +
          `/scanner stop - Detener`
        );
      }
    },
  };
}
