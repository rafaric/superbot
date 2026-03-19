import { WebSocket } from 'ws';
import { createGunzip } from 'zlib';

const WS_URL = process.env.BINGX_WS_URL || 'wss://open-api-ws.bingx.com/market';

class BingXWSManager {
  constructor() {
    this.ws = null;
    this.listeners = new Set();
    this.currentSubscription = null;
    this.reconnectAttempts = 0;
    this.maxReconnectDelay = 30000;
    this.shouldReconnect = false;
    this.pingInterval = null;

    // Latest kline state — updated by @kline stream
    this.currentKline = null;
  }

  subscribe(symbol, interval) {
    this.currentSubscription = { symbol, interval };
    this.shouldReconnect = true;
    this.reconnectAttempts = 0;
    this.currentKline = null;
    this._connect();
  }

  unsubscribe() {
    this.shouldReconnect = false;
    this._cleanup();
  }

  addListener(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _connect() {
    this._cleanup();
    if (!this.currentSubscription) return;

    const { symbol, interval } = this.currentSubscription;
    console.log(`[WS] Connecting — ${symbol} @ ${interval}`);
    this.ws = new WebSocket(WS_URL);

    this.ws.on('open', () => {
      console.log(`[WS] Connected. Subscribing to kline + trade streams`);
      if (this.reconnectAttempts > 0) {
        // Dynamic import to avoid circular deps
        import('../services/telegramNotifier.js').then(({ notifyWSReconnect }) => {
          notifyWSReconnect(`${this.currentSubscription.symbol}@kline+trade`);
        }).catch(() => {});
      }
      this.reconnectAttempts = 0;

      // Subscribe to kline stream (candle open/close/OHLCV)
      this.ws.send(JSON.stringify({
        id: `kline-${Date.now()}`,
        reqType: 'sub',
        dataType: `${symbol}@kline_${interval}`,
      }));

      // Subscribe to trade stream (every individual trade = real-time price)
      this.ws.send(JSON.stringify({
        id: `trade-${Date.now()}`,
        reqType: 'sub',
        dataType: `${symbol}@trade`,
      }));

      this.pingInterval = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) this.ws.send('Ping');
      }, 20000);
    });

    this.ws.on('message', (data, isBinary) => this._handleMessage(data, isBinary));

    this.ws.on('close', () => {
      console.log('[WS] Closed.');
      this._cleanup();
      if (this.shouldReconnect) this._scheduleReconnect();
    });

    this.ws.on('error', (err) => console.error('[WS] Error:', err.message));
  }

  _handleMessage(rawData, isBinary) {
    // Always check for Ping/Pong first regardless of binary flag —
    // BingX sometimes sends "Ping" as a binary frame
    const asText = rawData.toString('utf-8');
    if (asText === 'Ping' || asText === 'Pong') return;

    if (!isBinary) {
      try { this._parseAndEmit(JSON.parse(asText)); } catch (_) {}
      return;
    }

    const gunzip = createGunzip();
    const chunks = [];
    gunzip.on('data', (c) => chunks.push(c));
    gunzip.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf-8');
        if (text === 'Ping' || text === 'Pong') return;
        this._parseAndEmit(JSON.parse(text));
      } catch (e) {
        console.error('[WS] Gunzip parse error:', e.message);
      }
    });
    gunzip.on('error', () => {
      // Not gzip — already have asText, try parsing directly
      try {
        if (asText !== 'Ping' && asText !== 'Pong') this._parseAndEmit(JSON.parse(asText));
      } catch (_) {}
    });
    gunzip.write(rawData);
    gunzip.end();
  }

  _parseAndEmit(msg) {
    if (!msg?.dataType || !msg?.data) return;

    const dataType = msg.dataType;
    const raw = msg.data;

    // ── @trade stream ────────────────────────────────────────────────────
    // Emits on every individual trade with the latest price.
    // We merge this price into the current kline state so the frontend
    // gets a smooth price update without waiting for the kline tick.
    if (dataType.includes('@trade')) {
      const tradePrice = parseFloat(raw.p || raw.price || 0);
      if (!tradePrice) return;

      // If we have no kline yet (kline stream delayed), build a synthetic one
      // so trades can update the chart immediately
      if (!this.currentKline) {
        const now = Math.floor((raw.T || raw.E || Date.now()) / 1000);
        this.currentKline = {
          time: now,
          open: tradePrice,
          high: tradePrice,
          low: tradePrice,
          close: tradePrice,
          volume: 0,
          isClosed: false,
        };
      }

      const updated = {
        ...this.currentKline,
        high: Math.max(this.currentKline.high, tradePrice),
        low: Math.min(this.currentKline.low, tradePrice),
        close: tradePrice,
      };
      this.currentKline = updated;
      this._emit({ ...updated, source: 'trade' });
      return;
    }

    // ── @kline stream ────────────────────────────────────────────────────
    // Authoritative OHLCV data — updates every few seconds from BingX.
    if (dataType.includes('@kline')) {
      const tick = {
        time: Math.floor(Number(raw.T || raw.t || raw.startTime || raw.openTime) / 1000),
        open: parseFloat(raw.o),
        high: parseFloat(raw.h),
        low: parseFloat(raw.l),
        close: parseFloat(raw.c),
        volume: parseFloat(raw.v),
        isClosed: raw.confirm === true || raw.X === true,
        source: 'kline',
      };

      if (!tick.time || tick.close <= 0) return;

      this.currentKline = tick;
      this._emit(tick);
    }
  }

  _emit(tick) {
    for (const listener of this.listeners) {
      try { listener(tick); } catch (e) {
        console.error('[WS] Listener error:', e.message);
      }
    }
  }

  _scheduleReconnect() {
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), this.maxReconnectDelay);
    console.log(`[WS] Reconnecting in ${delay}ms...`);
    this.reconnectAttempts++;
    setTimeout(() => { if (this.shouldReconnect) this._connect(); }, delay);
  }

  _cleanup() {
    if (this.pingInterval) { clearInterval(this.pingInterval); this.pingInterval = null; }
    if (this.ws) {
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN) this.ws.close();
      this.ws = null;
    }
  }
}

export const wsManager = new BingXWSManager();
