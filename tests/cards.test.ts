import { describe, expect, it } from 'vitest';
import { cardKey, createDeck, secureRandomInt, shuffleDeck, type Card } from '../src/cards.js';

describe('cards', () => {
  it('创建包含 52 张唯一牌的标准牌组', () => {
    const deck = createDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map(cardKey))).toHaveLength(52);
    expect(deck.filter(({ suit }) => suit === 'spades')).toHaveLength(13);
  });

  it('使用注入随机源执行 Fisher-Yates 洗牌且不修改原数组', () => {
    const cards: Card[] = [
      { rank: 2, suit: 'clubs' }, { rank: 3, suit: 'clubs' },
      { rank: 4, suit: 'clubs' }, { rank: 5, suit: 'clubs' },
    ];
    const shuffled = shuffleDeck(cards, () => 0);
    expect(shuffled.map(({ rank }) => rank)).toEqual([3, 4, 5, 2]);
    expect(cards.map(({ rank }) => rank)).toEqual([2, 3, 4, 5]);
    expect(shuffled[0]).not.toBe(cards[1]);
  });

  it('拒绝越界随机数和无效随机数上限', () => {
    expect(() => shuffleDeck(createDeck(), (max) => max)).toThrow(RangeError);
    expect(() => secureRandomInt(0)).toThrow(RangeError);
    expect(() => secureRandomInt(0x1_0000_0001)).toThrow(RangeError);
  });
});
