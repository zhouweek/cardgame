/**
 * @Author TraeWork
 * @Date 2026-09-11
 * @Desc 德州扑克卡牌定义、牌组创建与无偏洗牌
 */
export const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'] as const;
export const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] as const;
export type Suit = (typeof SUITS)[number];
export type Rank = (typeof RANKS)[number];
export interface Card { readonly rank: Rank; readonly suit: Suit; }
export type RandomInt = (maxExclusive: number) => number;
export function createDeck(): Card[] { return SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit }))); }
export function cardKey(card: Card): string { return `${card.rank}-${card.suit}`; }
export function isValidCard(card: Card): boolean { return RANKS.includes(card.rank) && SUITS.includes(card.suit); }
export function secureRandomInt(maxExclusive: number): number {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0) throw new RangeError('maxExclusive 必须是正安全整数');
  const range = 0x1_0000_0000;
  if (maxExclusive > range) throw new RangeError('maxExclusive 不能超过 2^32');
  const limit = range - (range % maxExclusive);
  const values = new Uint32Array(1);
  let value: number;
  do { globalThis.crypto.getRandomValues(values); value = values[0]!; } while (value >= limit);
  return value % maxExclusive;
}
export function shuffleDeck(cards: readonly Card[], randomInt: RandomInt = secureRandomInt): Card[] {
  const shuffled = cards.map((card) => ({ ...card }));
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    if (!Number.isInteger(swapIndex) || swapIndex < 0 || swapIndex > index) throw new RangeError(`随机数生成器必须返回 0 到 ${index} 之间的整数`);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
  }
  return shuffled;
}
