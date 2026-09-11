/**
 * @Author TraeWork
 * @Date 2026-09-11
 * @Desc 主池、边池计算与摊牌筹码分配
 */
import { compareHandValues, type HandValue } from './hand-evaluator.js';
export interface Contribution { readonly playerId: string; readonly amount: number; readonly folded: boolean; }
export interface Pot { readonly amount: number; readonly eligiblePlayerIds: readonly string[]; }
export function calculatePots(contributions: readonly Contribution[]): Pot[] {
  validateContributions(contributions);
  const levels = [...new Set(contributions.map(({ amount }) => amount).filter((amount) => amount > 0))].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let previousLevel = 0;
  for (const level of levels) {
    const contributors = contributions.filter(({ amount }) => amount >= level);
    const amount = (level - previousLevel) * contributors.length;
    const eligiblePlayerIds = contributors.filter(({ folded }) => !folded).map(({ playerId }) => playerId);
    if (eligiblePlayerIds.length === 0) throw new Error('存在无人有资格赢取的筹码层，请先退回未匹配下注');
    pots.push({ amount, eligiblePlayerIds });
    previousLevel = level;
  }
  return pots;
}
export function distributePots(pots: readonly Pot[], hands: ReadonlyMap<string, HandValue>, seatOrder: readonly string[]): ReadonlyMap<string, number> {
  const payouts = new Map<string, number>();
  const seats = new Map(seatOrder.map((playerId, index) => [playerId, index]));
  for (const pot of pots) {
    const ranked = pot.eligiblePlayerIds.map((playerId) => {
      const hand = hands.get(playerId); if (!hand) throw new Error(`缺少玩家 ${playerId} 的摊牌牌型`);
      const seat = seats.get(playerId); if (seat === undefined) throw new Error(`座位顺序中缺少玩家 ${playerId}`);
      return { playerId, hand, seat };
    });
    const best = ranked.reduce((current, candidate) => compareHandValues(candidate.hand, current.hand) > 0 ? candidate : current);
    const winners = ranked.filter(({ hand }) => compareHandValues(hand, best.hand) === 0).sort((a, b) => a.seat - b.seat);
    const share = Math.floor(pot.amount / winners.length);
    let remainder = pot.amount % winners.length;
    for (const winner of winners) { const oddChip = remainder > 0 ? 1 : 0; payouts.set(winner.playerId, (payouts.get(winner.playerId) ?? 0) + share + oddChip); remainder -= oddChip; }
  }
  return payouts;
}
function validateContributions(contributions: readonly Contribution[]): void {
  if (contributions.length === 0) throw new RangeError('至少需要一名玩家的下注记录');
  if (new Set(contributions.map(({ playerId }) => playerId)).size !== contributions.length) throw new RangeError('玩家下注记录不能重复');
  for (const contribution of contributions) { if (!contribution.playerId) throw new TypeError('playerId 不能为空'); if (!Number.isSafeInteger(contribution.amount) || contribution.amount < 0) throw new RangeError('下注额必须是非负安全整数'); }
}
