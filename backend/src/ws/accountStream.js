import { getBalance, getPositions, getIncome } from '../services/bingx.js';

/**
 * Account Poller
 *
 * BingX's account WebSocket stream requires a listenKey (authenticated session token)
 * which has a complex lifecycle. For reliability in both demo and prod, we use
 * REST polling every 3 seconds instead — same data, simpler implementation.
 *
 * Broadcasts { type, data } events to registered listeners whenever data changes.
 */
class AccountPoller {
  constructor() {
    this.listeners = new Set();
    this.intervalId = null;
    this.pollMs = 3000;
    this.lastSnapshot = null;
  }

  start() {
    if (this.intervalId) return;
    console.log('[AccountPoller] Starting polling every', this.pollMs, 'ms');
    this._poll(); // immediate first fetch
    this.intervalId = setInterval(() => this._poll(), this.pollMs);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
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

      const snapshot = { balance, positions, income, timestamp: Date.now() };
      this.lastSnapshot = snapshot;

      this._emit({ type: 'ACCOUNT_SNAPSHOT', data: snapshot });
    } catch (err) {
      console.error('[AccountPoller] Poll error:', err.message);
    }
  }

  _emit(event) {
    for (const listener of this.listeners) {
      try { listener(event); } catch (e) {
        console.error('[AccountPoller] Listener error:', e.message);
      }
    }
  }

  getLastSnapshot() {
    return this.lastSnapshot;
  }
}

export const accountWSManager = new AccountPoller();
