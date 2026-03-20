import { getBalance, getPositions, getIncome } from './bingx.js';

/**
 * Account Poller — polls BingX REST every 3s and broadcasts snapshots.
 * Replaces the WebSocket account stream (which requires a listenKey).
 */
class AccountPoller {
  constructor() {
    this.listeners  = new Set();
    this.intervalId = null;
    this.pollMs     = 3000;
  }

  start() {
    if (this.intervalId) return;
    console.log('[AccountPoller] Starting polling every', this.pollMs, 'ms');
    this._poll();
    this.intervalId = setInterval(() => this._poll(), this.pollMs);
  }

  stop() {
    if (this.intervalId) { clearInterval(this.intervalId); this.intervalId = null; }
  }

  addListener(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async _poll() {
    try {
      const [balance, positions, income] = await Promise.all([
        getBalance().catch(() => null),
        getPositions().catch(() => []),
        getIncome({ incomeType: 'REALIZED_PNL', limit: 100 }).catch(() => []),
      ]);
      this._emit({ type: 'ACCOUNT_SNAPSHOT', data: { balance, positions, income, timestamp: Date.now() } });
    } catch (err) {
      console.error('[AccountPoller] Poll error:', err.message);
    }
  }

  _emit(event) {
    for (const fn of this.listeners) {
      try { fn(event); } catch (e) { console.error('[AccountPoller] Listener error:', e.message); }
    }
  }
}

export const accountWSManager = new AccountPoller();
