import type { Seat } from "./types";
import type { SpotContext } from "./types";

/**
 * Стандартные сайзы GTO Wizard / типичный солверный кэш 100bb:
 * - open IP: 2.5bb
 * - open SB: 3bb
 * - iso vs limp: 3.5bb (+1bb за каждый доп. лимп, опционально)
 * - 3-bet: ~3.5× размера опена
 * - 4-bet: ~2.2× размера 3-бета
 * - 5-bet+: all-in (стек)
 */

export const STANDARD_OPEN_BB = 2.5;
export const STANDARD_SB_OPEN_BB = 3;
export const STANDARD_ISO_BB = 3.5;
export const THREE_BET_MULT = 3.5;
export const SQUEEZE_MULT = 4;
export const FOUR_BET_MULT = 2.2;

function roundBb(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Сайз open-raise в зависимости от позиции (SB чуть крупнее).
 */
export function standardOpenSize(seat: Seat): number {
  return seat === "SB" ? STANDARD_SB_OPEN_BB : STANDARD_OPEN_BB;
}

/**
 * Сайз следующего рейза по контексту линии — без запроса у пользователя.
 */
export function standardRaiseSize(
  ctx: SpotContext,
  seat: Seat,
  stackDepth = 100,
): number {
  // Ещё никто не рейзил
  if (ctx.raiseCount === 0) {
    if (ctx.limpCount > 0) {
      // ISO: база 3.5bb + 1bb за каждый лимп после первого
      return roundBb(STANDARD_ISO_BB + Math.max(0, ctx.limpCount - 1));
    }
    return standardOpenSize(seat);
  }

  // 3-bet vs open · squeeze vs open + call(s)
  if (ctx.raiseCount === 1) {
    const open = ctx.lastRaiseSize ?? STANDARD_OPEN_BB;
    if (ctx.callersAfterRaise >= 1) {
      // Squeeze крупнее 3-bet: ~4× open + 1bb за лишнего коллера
      return roundBb(
        open * SQUEEZE_MULT + Math.max(0, ctx.callersAfterRaise - 1),
      );
    }
    return roundBb(open * THREE_BET_MULT);
  }

  // 4-bet vs 3-bet
  if (ctx.raiseCount === 2) {
    const threeBet = ctx.lastRaiseSize ?? roundBb(STANDARD_OPEN_BB * THREE_BET_MULT);
    return roundBb(threeBet * FOUR_BET_MULT);
  }

  // Дальше — пуш
  return stackDepth;
}
