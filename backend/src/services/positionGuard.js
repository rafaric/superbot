/**
 * Position Guard — Fase 1 (PRD v2 §6)
 *
 * Enforces the single-position rule:
 *   "máximo 1 posición abierta simultánea"
 *
 * Usage:
 *   const guard = await checkPositionGuard();
 *   if (guard.blocked) { console.log(guard.reason); return; }
 */

import { getPositions } from './bingx.js';

/**
 * Returns whether a new position can be opened.
 *
 * @returns {{ blocked: boolean, reason: string|null, openCount: number, positions: Array }}
 */
export async function checkPositionGuard() {
  try {
    const positions = await getPositions();

    // BingX returns positions with positionAmt != 0 as open
    const open = (positions ?? []).filter(
      (p) => parseFloat(p.positionAmt ?? p.posAmt ?? 0) !== 0
    );

    if (open.length >= 1) {
      const symbols = open.map((p) => p.symbol).join(', ');
      return {
        blocked:    true,
        reason:     `Single-position rule: already holding ${open.length} position(s) [${symbols}]`,
        openCount:  open.length,
        positions:  open,
      };
    }

    return { blocked: false, reason: null, openCount: 0, positions: [] };
  } catch (err) {
    // If we can't check, fail open (don't block on API errors)
    console.warn('[PositionGuard] Could not fetch positions — skipping guard:', err.message);
    return { blocked: false, reason: null, openCount: 0, positions: [] };
  }
}
