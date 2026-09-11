/**
 * @Author TraeWork
 * @Date 2026-09-11
 * @Desc 5 至 7 张牌的最佳德州扑克牌型计算与比较
 */
import { cardKey, isValidCard, type Card, type Rank } from './cards.js';
export enum HandCategory { HighCard, OnePair, TwoPair, ThreeOfAKind, Straight, Flush, FullHouse, FourOfAKind, StraightFlush }
export interface HandValue { readonly category: HandCategory; readonly kickers: readonly number[]; readonly cards: readonly Card[]; }
function compareNumberArrays(left: readonly number[], right: readonly number[]): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) { const difference = (left[index] ?? 0) - (right[index] ?? 0); if (difference !== 0) return Math.sign(difference); }
  return 0;
}
function straightHigh(ranks: readonly number[]): number | null {
  const unique = [...new Set(ranks)].sort((left, right) => right - left);
  if (unique.includes(14)) unique.push(1);
  for (let index = 0; index <= unique.length - 5; index += 1) if (unique[index]! - unique[index + 4]! === 4) return unique[index]!;
  return null;
}
export function evaluateFive(cards: readonly Card[]): HandValue {
  if (cards.length !== 5) throw new RangeError('evaluateFive 必须接收 5 张牌');
  validateCards(cards);
  const ranks = cards.map((card) => card.rank).sort((left, right) => right - left);
  const counts = new Map<number, number>();
  for (const rank of ranks) counts.set(rank, (counts.get(rank) ?? 0) + 1);
  const groups = [...counts.entries()].sort(([lr, lc], [rr, rc]) => rc - lc || rr - lr);
  const flush = cards.every((card) => card.suit === cards[0]!.suit);
  const highStraight = straightHigh(ranks);
  if (flush && highStraight !== null) return { category: HandCategory.StraightFlush, kickers: [highStraight], cards };
  if (groups[0]![1] === 4) return { category: HandCategory.FourOfAKind, kickers: [groups[0]![0], groups[1]![0]], cards };
  if (groups[0]![1] === 3 && groups[1]![1] === 2) return { category: HandCategory.FullHouse, kickers: [groups[0]![0], groups[1]![0]], cards };
  if (flush) return { category: HandCategory.Flush, kickers: ranks, cards };
  if (highStraight !== null) return { category: HandCategory.Straight, kickers: [highStraight], cards };
  if (groups[0]![1] === 3) return { category: HandCategory.ThreeOfAKind, kickers: [groups[0]![0], ...groups.slice(1).map(([rank]) => rank).sort((a, b) => b - a)], cards };
  if (groups[0]![1] === 2 && groups[1]![1] === 2) { const pairs = [groups[0]![0], groups[1]![0]].sort((a, b) => b - a); return { category: HandCategory.TwoPair, kickers: [...pairs, groups[2]![0]], cards }; }
  if (groups[0]![1] === 2) return { category: HandCategory.OnePair, kickers: [groups[0]![0], ...groups.slice(1).map(([rank]) => rank).sort((a, b) => b - a)], cards };
  return { category: HandCategory.HighCard, kickers: ranks, cards };
}
export function compareHandValues(left: HandValue, right: HandValue): number { return Math.sign(left.category - right.category) || compareNumberArrays(left.kickers, right.kickers); }
export function evaluateBestHand(cards: readonly Card[]): HandValue {
  if (cards.length < 5 || cards.length > 7) throw new RangeError('最佳牌型计算只接受 5 至 7 张牌');
  validateCards(cards);
  let best: HandValue | null = null;
  for (const combination of combinations(cards, 5)) { const candidate = evaluateFive(combination); if (best === null || compareHandValues(candidate, best) > 0) best = candidate; }
  return best!;
}
function combinations<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  const visit = (start: number, selected: T[]): void => { if (selected.length === size) { result.push([...selected]); return; } for (let index = start; index <= items.length - (size - selected.length); index += 1) { selected.push(items[index]!); visit(index + 1, selected); selected.pop(); } };
  visit(0, []); return result;
}
function validateCards(cards: readonly Card[]): void {
  if (cards.some((card) => !isValidCard(card))) throw new TypeError('包含无效卡牌');
  if (new Set(cards.map(cardKey)).size !== cards.length) throw new RangeError('卡牌不能重复');
}
export function rank(value: number): Rank { if (!Number.isInteger(value) || value < 2 || value > 14) throw new RangeError('点数必须在 2 到 14 之间'); return value as Rank; }
