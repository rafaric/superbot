import { useEffect, useRef, useCallback } from 'react';
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  createSeriesMarkers,
} from 'lightweight-charts';
import { updateEMA, updateVWAP, isNewDay, intervalToSeconds } from '../utils/indicators.js';
import { apiFetch } from '../utils/api.js';

const BUFFER_MAX    = 1000;
const SCROLL_THRESHOLD = 20;
const HISTORY_CHUNK = 200;
const TZ_OFFSET_SEC = -3 * 3600; // Argentina UTC-3, no DST

export function useChart(containerRef, symbol, interval, onPriceUpdate) {
  const chartRef          = useRef(null);
  const candleSeriesRef   = useRef(null);
  const ema8SeriesRef     = useRef(null);
  const ema21SeriesRef    = useRef(null);
  const vwapSeriesRef     = useRef(null);
  const volumeSeriesRef   = useRef(null);
  const seriesMarkersRef  = useRef(null);
  const markersRef        = useRef([]);
  const prevSignalRef         = useRef(null); // 'buy' | 'sell' | null
  const lastSignalNotifiedRef = useRef(null); // tracks last notified signal to avoid duplicates

  const candlesRef        = useRef([]);
  const seedsRef          = useRef(null);
  // RSI15 + VolRel + ORB filter values — refreshed every 15m via REST poll
  const filterRef         = useRef({ rsi15: null, volRel: null, orbHigh: null, orbLow: null });
  // Extended indicator state for combined signal
  const rsiSeriesRef    = useRef([]);
  const relVolSeriesRef = useRef([]);
  const orbSeriesRef    = useRef([]);
  const wsRef           = useRef(null);
  const isFetchingHistory = useRef(false);
  const allHistoryLoaded  = useRef(false);
  const onPriceUpdateRef  = useRef(onPriceUpdate);
  useEffect(() => { onPriceUpdateRef.current = onPriceUpdate; });

  // ─── Chart initialization (once) ─────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: 'solid', color: 'transparent' },
        textColor: '#8899aa',
        fontSize: 11,
        fontFamily: "'JetBrains Mono', monospace",
      },
      grid: {
        vertLines: { color: '#1e2d45' },
        horzLines: { color: '#1e2d45' },
      },
      crosshair: {
        mode: 0, // 0 = Normal (follows cursor freely), 1 = Magnet (snaps to candles)
        vertLine: { color: '#3b82f6', labelBackgroundColor: '#1a2035' },
        horzLine: { color: '#3b82f6', labelBackgroundColor: '#1a2035' },
      },
      rightPriceScale: { borderColor: '#1e2d45', textColor: '#8899aa' },
      timeScale: {
        borderColor: '#1e2d45',
        textColor: '#8899aa',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 12,        // padding between last candle and right edge
        tickMarkFormatter: (timestamp, tickMarkType) => {
          const d = new Date((timestamp + TZ_OFFSET_SEC) * 1000);
          const hh = String(d.getUTCHours()).padStart(2, '0');
          const mm = String(d.getUTCMinutes()).padStart(2, '0');
          const dd = String(d.getUTCDate()).padStart(2, '0');
          const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
          if (tickMarkType <= 2) return `${dd}/${mo}`;
          return `${hh}:${mm}`;
        },
      },
      localization: {
        timeFormatter: (timestamp) => {
          const d = new Date((timestamp + TZ_OFFSET_SEC) * 1000);
          const hh = String(d.getUTCHours()).padStart(2, '0');
          const mm = String(d.getUTCMinutes()).padStart(2, '0');
          const dd = String(d.getUTCDate()).padStart(2, '0');
          const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
          const yyyy = d.getUTCFullYear();
          return `${dd}/${mo}/${yyyy} ${hh}:${mm}`;
        },
      },
      watermark: { visible: false },
    });

    chartRef.current = chart;

    // ── v5 API: addSeries(SeriesType, options) ────────────────────────────
    candleSeriesRef.current = chart.addSeries(CandlestickSeries, {
      upColor:        '#10b981',
      downColor:      '#ef4444',
      borderUpColor:  '#10b981',
      borderDownColor:'#ef4444',
      wickUpColor:    '#10b981',
      wickDownColor:  '#ef4444',
    });

    ema8SeriesRef.current = chart.addSeries(LineSeries, {
      color:                  '#3b82f6',
      lineWidth:              1,
      priceLineVisible:       false,
      lastValueVisible:       true,
      crosshairMarkerVisible: false,
    });

    ema21SeriesRef.current = chart.addSeries(LineSeries, {
      color:                  '#f97316',
      lineWidth:              1,
      priceLineVisible:       false,
      lastValueVisible:       true,
      crosshairMarkerVisible: false,
    });

    vwapSeriesRef.current = chart.addSeries(LineSeries, {
      color:                  '#eab308',
      lineWidth:              1,
      lineStyle:              2,
      priceLineVisible:       false,
      lastValueVisible:       true,
      crosshairMarkerVisible: false,
    });

    volumeSeriesRef.current = chart.addSeries(HistogramSeries, {
      priceFormat:      { type: 'volume' },
      priceScaleId:     'vol',
      lastValueVisible: false,
      priceLineVisible: false,
    });
    // In v5 scaleMargins must be applied via priceScale() after series creation
    chart.priceScale('vol').applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
      visible: false, // hide the volume price axis
    });

    // Signal markers attached to the candlestick series
    seriesMarkersRef.current = createSeriesMarkers(candleSeriesRef.current, []);

    // Infinite scroll left
    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (!range) return;
      if (range.from < SCROLL_THRESHOLD && !isFetchingHistory.current && !allHistoryLoaded.current) {
        fetchMoreHistoryRef.current?.();
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      if (chartRef.current && containerRef.current) {
        chartRef.current.applyOptions({
          width:  containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current         = null;
      candleSeriesRef.current  = null;
      ema8SeriesRef.current    = null;
      ema21SeriesRef.current   = null;
      vwapSeriesRef.current    = null;
      volumeSeriesRef.current  = null;
      seriesMarkersRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Reload on symbol/interval change ────────────────────────────────────
  useEffect(() => {
    if (!symbol) return; // wait until pairs are loaded

    allHistoryLoaded.current = false;
    candlesRef.current       = [];
    seedsRef.current         = null;
    markersRef.current            = [];
    prevSignalRef.current         = null;
    lastSignalNotifiedRef.current = null;
    rsiSeriesRef.current          = [];
    relVolSeriesRef.current       = [];
    orbSeriesRef.current          = [];
    seriesMarkersRef.current?.setMarkers([]);

    loadInitialData();
    const cancelWS = connectWebSocket();

    // Refresh 15m filter data every 15 minutes independently of chart interval
    const refreshFilters = async () => {
      try {
        const res  = await apiFetch(`/api/market/klines?symbol=${symbol}&interval=15m&limit=50`);
        const json = await res.json();
        if (json.seeds) {
          filterRef.current = {
            rsi15:   json.seeds.rsi15   ?? filterRef.current.rsi15,
            volRel:  json.seeds.volRel  ?? filterRef.current.volRel,
            orbHigh: json.seeds.orbHigh ?? filterRef.current.orbHigh,
            orbLow:  json.seeds.orbLow  ?? filterRef.current.orbLow,
          };
        }
      } catch (_) {}
    };
    const filterTimer = setInterval(refreshFilters, 15 * 60 * 1000); // every 15m

    return () => {
      cancelWS?.();
      disconnectWebSocket();
      clearInterval(filterTimer);
    };
  }, [symbol, interval]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Initial data load ────────────────────────────────────────────────────
  const loadInitialData = useCallback(async () => {
    try {
      const res = await apiFetch(
        `/api/market/klines?symbol=${symbol}&interval=${interval}&limit=${HISTORY_CHUNK}`
      );
      const { candles, indicators, seeds } = await res.json();
      if (!candles?.length) return;

      const unique = dedupeByTime(candles);
      candlesRef.current = unique;
      seedsRef.current   = seeds;
      // Store filter seeds from 15m data
      filterRef.current = {
        rsi15:   seeds.rsi15   ?? null,
        volRel:  seeds.volRel  ?? null,
        orbHigh: seeds.orbHigh ?? null,
        orbLow:  seeds.orbLow  ?? null,
      };

      candleSeriesRef.current?.setData(unique);
      ema8SeriesRef.current?.setData(indicators.ema8);
      ema21SeriesRef.current?.setData(indicators.ema21);
      vwapSeriesRef.current?.setData(indicators.vwap);
      volumeSeriesRef.current?.setData(
        unique.map((c) => ({
          time:  c.time,
          value: c.volume,
          color: c.close >= c.open ? 'rgba(16,185,129,0.5)' : 'rgba(239,68,68,0.5)',
        }))
      );

      // Compute historical BUY/SELL markers
      const markers = computeMarkersFromHistory(
        unique, indicators.ema8, indicators.ema21, indicators.vwap
      );
      markersRef.current = markers;
      seriesMarkersRef.current?.setMarkers(markers);

      chartRef.current?.timeScale().fitContent();
    } catch (err) {
      console.error('[Chart] Failed to load initial data:', err);
    }
  }, [symbol, interval]);

  // ─── Historical pagination (scroll left) ─────────────────────────────────
  const fetchMoreHistory = useCallback(async () => {
    if (isFetchingHistory.current || !candlesRef.current.length) return;
    isFetchingHistory.current = true;

    try {
      const oldest     = candlesRef.current[0];
      const intervalSec = intervalToSeconds(interval);
      const endTime    = (oldest.time - intervalSec) * 1000;

      const res = await apiFetch(
        `/api/market/klines?symbol=${symbol}&interval=${interval}&limit=${HISTORY_CHUNK}&endTime=${endTime}`
      );
      const { candles } = await res.json();
      if (!candles?.length) { allHistoryLoaded.current = true; return; }

      const merged  = dedupeByTime([...candles, ...candlesRef.current]);
      const trimmed = merged.length > BUFFER_MAX ? merged.slice(merged.length - BUFFER_MAX) : merged;

      candlesRef.current = trimmed;
      candleSeriesRef.current?.setData(trimmed);
      volumeSeriesRef.current?.setData(
        trimmed.map((c) => ({
          time:  c.time,
          value: c.volume,
          color: c.close >= c.open ? 'rgba(16,185,129,0.5)' : 'rgba(239,68,68,0.5)',
        }))
      );
    } catch (err) {
      console.error('[Chart] Failed to fetch history:', err);
    } finally {
      isFetchingHistory.current = false;
    }
  }, [symbol, interval]);

  const fetchMoreHistoryRef = useRef(fetchMoreHistory);
  useEffect(() => { fetchMoreHistoryRef.current = fetchMoreHistory; }, [fetchMoreHistory]);

  // ─── WebSocket ────────────────────────────────────────────────────────────
  const connectWebSocket = useCallback(() => {
    disconnectWebSocket();
    const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
    const wsUrl = backendUrl.replace(/^http/, 'ws');
    let cancelled = false;

    const timer = setTimeout(() => {
      if (cancelled) return;
      const ws = new WebSocket(`${wsUrl}/ws/ticks`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) { ws.close(); return; }
        ws.send(JSON.stringify({ type: 'subscribe', payload: { symbol, interval } }));
      };

      let pendingTick = null;
      let rafId       = null;
      const flushTick = () => {
        rafId = null;
        if (pendingTick) { handleTickRef.current(pendingTick); pendingTick = null; }
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'tick') {
            pendingTick = msg.payload;
            if (!rafId) rafId = requestAnimationFrame(flushTick);
          }
        } catch (e) { console.error('[WS] Parse error:', e); }
      };

      ws.onclose = () => console.log('[WS] Disconnected from backend');
      ws.onerror = () => {};
    }, 100);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [symbol, interval]);

  const disconnectWebSocket = useCallback(() => {
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
  }, []);

  // ─── Tick processing ──────────────────────────────────────────────────────
  const handleTick = useCallback((tick) => {
    const candles = candlesRef.current;
    const seeds   = seedsRef.current;
    if (!candles.length || !seeds) return;

    const intervalSec  = intervalToSeconds(interval);
    const lastCandle   = candles[candles.length - 1];
    const isNewCandle  = tick.time >= lastCandle.time + intervalSec;
    const isSameCandle = !isNewCandle && tick.time >= lastCandle.time;

    let updatedCandle;

    if (isNewCandle) {
      updatedCandle = {
        time:   tick.time,
        open:   lastCandle.close,
        high:   Math.max(tick.high, lastCandle.close),
        low:    Math.min(tick.low,  lastCandle.close),
        close:  tick.close,
        volume: tick.volume,
      };
      if (isNewDay(lastCandle.time, tick.time)) {
        const tp = (updatedCandle.high + updatedCandle.low + updatedCandle.close) / 3;
        seeds.vwapCumTPV = tp * updatedCandle.volume;
        seeds.vwapCumVol = updatedCandle.volume;
      }
      candles.push(updatedCandle);
      if (candles.length > BUFFER_MAX) candles.shift();
    } else if (isSameCandle) {
      updatedCandle = {
        ...lastCandle,
        high:   Math.max(lastCandle.high, tick.high),
        low:    Math.min(lastCandle.low,  tick.low),
        close:  tick.close,
        volume: tick.volume,
      };
      candles[candles.length - 1] = updatedCandle;
    } else {
      return;
    }

    // Incremental EMA
    const newEMA8  = updateEMA(updatedCandle.close, seeds.lastEMA8,  8);
    const newEMA21 = updateEMA(updatedCandle.close, seeds.lastEMA21, 21);
    seeds.lastEMA8  = newEMA8;
    seeds.lastEMA21 = newEMA21;

    // Incremental VWAP — only on kline ticks with real volume
    let newVWAP = seeds.vwapCumVol > 0
      ? seeds.vwapCumTPV / seeds.vwapCumVol
      : updatedCandle.close;
    if (updatedCandle.volume > 0) {
      const vr = updateVWAP(updatedCandle, seeds.vwapCumTPV, seeds.vwapCumVol);
      seeds.vwapCumTPV = vr.cumTPV;
      seeds.vwapCumVol = vr.cumVol;
      newVWAP = vr.vwap;
    }

    // ── Signal detection: EMA+VWAP trend + RSI15 + VolRel + ORB filters ────
    const { rsi15, volRel, orbHigh, orbLow } = filterRef.current;

    // Base trend (original strategy)
    const trendBuy  = updatedCandle.close > newEMA8 && newEMA8 > newEMA21 && newEMA21 > newVWAP;
    const trendSell = updatedCandle.close < newEMA8 && newEMA8 < newEMA21 && newEMA21 < newVWAP;

    // RSI 15m filter — null means no data yet, allow signal through
    const rsiOkBuy  = rsi15 == null || rsi15 > 55;
    const rsiOkSell = rsi15 == null || rsi15 < 45;

    // Relative volume filter: must be > 120% of 20-candle average
    const volOk = volRel == null || volRel > 1.2;

    // ORB filter: price must break last completed 15m candle range
    const orbOkBuy  = orbHigh == null || updatedCandle.close > orbHigh;
    const orbOkSell = orbLow  == null || updatedCandle.close < orbLow;

    // All filters must pass
    const condBuy  = trendBuy  && rsiOkBuy  && volOk && orbOkBuy;
    const condSell = trendSell && rsiOkSell && volOk && orbOkSell;
    const prev     = prevSignalRef.current;

    const newBuy  = condBuy  && prev !== 'buy';
    const newSell = condSell && prev !== 'sell';

    if (newBuy)                     prevSignalRef.current = 'buy';
    else if (newSell)               prevSignalRef.current = 'sell';
    else if (!condBuy && !condSell) prevSignalRef.current = null;

    // Send Telegram alert — only once per signal (deduplicated by time)
    if ((newBuy || newSell) && updatedCandle.time !== lastSignalNotifiedRef.current) {
      lastSignalNotifiedRef.current = updatedCandle.time;
      apiFetch('/api/signals/alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type:     newBuy ? 'BUY' : 'SELL',
          symbol,
          interval,
          price:    updatedCandle.close,
          ema8:     newEMA8,
          ema21:    newEMA21,
          vwap:     newVWAP,
          orbHigh:  filterRef.current.orbHigh,
          orbLow:   filterRef.current.orbLow,
        }),
      }).catch(() => {}); // fire-and-forget
    }

    if (newBuy || newSell) {
      const filtered = markersRef.current.filter((m) => m.time !== updatedCandle.time);
      filtered.push(newBuy ? {
        time: updatedCandle.time, position: 'belowBar',
        color: '#10b981', shape: 'arrowUp', text: 'BUY', size: 1,
      } : {
        time: updatedCandle.time, position: 'aboveBar',
        color: '#ef4444', shape: 'arrowDown', text: 'SELL', size: 1,
      });
      filtered.sort((a, b) => a.time - b.time);
      markersRef.current = filtered;
      seriesMarkersRef.current?.setMarkers(filtered);
    }

    // ── Push indicator state to backend (for Telegram /indicadores) ────────
    // Throttled: only on kline ticks with real volume to avoid flooding
    if (updatedCandle.volume > 0) {
      apiFetch('/api/market/indicators', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          ema8:  newEMA8,
          ema21: newEMA21,
          vwap:  newVWAP,
          price: updatedCandle.close,
        }),
      }).catch(() => {}); // fire-and-forget, never block the chart
    }

    // ── Paint (direct canvas — no React re-render) ────────────────────────
    onPriceUpdateRef.current?.(updatedCandle.close);
    candleSeriesRef.current?.update(updatedCandle);
    ema8SeriesRef.current?.update({ time: updatedCandle.time, value: newEMA8 });
    ema21SeriesRef.current?.update({ time: updatedCandle.time, value: newEMA21 });
    vwapSeriesRef.current?.update({ time: updatedCandle.time, value: newVWAP });
    if (updatedCandle.volume > 0) {
      volumeSeriesRef.current?.update({
        time:  updatedCandle.time,
        value: updatedCandle.volume,
        color: updatedCandle.close >= updatedCandle.open
          ? 'rgba(16,185,129,0.5)' : 'rgba(239,68,68,0.5)',
      });
    }
  }, [interval]);

  const handleTickRef = useRef(handleTick);
  useEffect(() => { handleTickRef.current = handleTick; }, [handleTick]);

  return { chartRef, candleSeriesRef };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dedupeByTime(candles) {
  const seen = new Map();
  for (const c of candles) seen.set(c.time, c);
  return Array.from(seen.values()).sort((a, b) => a.time - b.time);
}

function computeMarkersFromHistory(candles, ema8Series, ema21Series, vwapSeries) {
  // Historical markers use only EMA+VWAP (base trend condition).
  // RSI/VolRel/ORB filters require 15m data not available here — they only apply in real-time ticks.
  if (!candles.length || !ema8Series.length) return [];

  const ema8Map  = new Map(ema8Series.map((p)  => [p.time, p.value]));
  const ema21Map = new Map(ema21Series.map((p) => [p.time, p.value]));
  const vwapMap  = new Map(vwapSeries.map((p)  => [p.time, p.value]));

  const markers = [];
  let prevBuy = false, prevSell = false;

  for (const c of candles) {
    const e8  = ema8Map.get(c.time);
    const e21 = ema21Map.get(c.time);
    const vw  = vwapMap.get(c.time);
    if (e8 == null || e21 == null || vw == null) { prevBuy = false; prevSell = false; continue; }

    const condBuy  = c.close > e8 && e8 > e21 && e21 > vw;
    const condSell = c.close < e8 && e8 < e21 && e21 < vw;

    if (condBuy  && !prevBuy)  markers.push({ time: c.time, position: 'belowBar', color: '#10b981', shape: 'arrowUp',   text: 'BUY',  size: 1 });
    if (condSell && !prevSell) markers.push({ time: c.time, position: 'aboveBar', color: '#ef4444', shape: 'arrowDown', text: 'SELL', size: 1 });

    prevBuy  = condBuy;
    prevSell = condSell;
  }

  return markers;
}
