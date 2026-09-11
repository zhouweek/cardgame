import { describe, expect, it } from 'vitest';
import { HandCategory, compareHandValues, evaluateBestHand, evaluateFive, rank } from '../src/hand-evaluator.js';
import type { Card, Suit } from '../src/cards.js';

const c = (value: number, suit: Suit): Card => ({ rank: rank(value), suit });

describe('hand evaluator', () => {
  it.each([
    ['高牌', HandCategory.HighCard, [c(14,'spades'),c(11,'hearts'),c(9,'clubs'),c(6,'diamonds'),c(2,'clubs')]],
    ['一对', HandCategory.OnePair, [c(14,'spades'),c(14,'hearts'),c(9,'clubs'),c(6,'diamonds'),c(2,'clubs')]],
    ['两对', HandCategory.TwoPair, [c(14,'spades'),c(14,'hearts'),c(9,'clubs'),c(9,'diamonds'),c(2,'clubs')]],
    ['三条', HandCategory.ThreeOfAKind, [c(8,'spades'),c(8,'hearts'),c(8,'clubs'),c(6,'diamonds'),c(2,'clubs')]],
    ['顺子', HandCategory.Straight, [c(9,'spades'),c(8,'hearts'),c(7,'clubs'),c(6,'diamonds'),c(5,'clubs')]],
    ['同花', HandCategory.Flush, [c(14,'spades'),c(11,'spades'),c(9,'spades'),c(6,'spades'),c(2,'spades')]],
    ['葫芦', HandCategory.FullHouse, [c(8,'spades'),c(8,'hearts'),c(8,'clubs'),c(2,'diamonds'),c(2,'clubs')]],
    ['四条', HandCategory.FourOfAKind, [c(8,'spades'),c(8,'hearts'),c(8,'clubs'),c(8,'diamonds'),c(2,'clubs')]],
    ['同花顺', HandCategory.StraightFlush, [c(9,'spades'),c(8,'spades'),c(7,'spades'),c(6,'spades'),c(5,'spades')]],
  ])('识别%s', (_name, category, cards) => {
    expect(evaluateFive(cards).category).toBe(category);
  });

  it('将 A2345 识别为五高顺子', () => {
    const value = evaluateFive([c(14,'spades'),c(5,'hearts'),c(4,'clubs'),c(3,'diamonds'),c(2,'clubs')]);
    expect(value.category).toBe(HandCategory.Straight);
    expect(value.kickers).toEqual([5]);
  });

  it('从七张牌中选出皇家同花顺', () => {
    const value = evaluateBestHand([c(14,'hearts'),c(13,'hearts'),c(12,'hearts'),c(11,'hearts'),c(10,'hearts'),c(2,'clubs'),c(2,'diamonds')]);
    expect(value.category).toBe(HandCategory.StraightFlush);
    expect(value.kickers).toEqual([14]);
  });

  it('同为一对时比较踢脚', () => {
    const aceKicker = evaluateFive([c(9,'spades'),c(9,'hearts'),c(14,'clubs'),c(7,'diamonds'),c(2,'clubs')]);
    const kingKicker = evaluateFive([c(9,'clubs'),c(9,'diamonds'),c(13,'spades'),c(7,'hearts'),c(2,'hearts')]);
    expect(compareHandValues(aceKicker, kingKicker)).toBe(1);
  });

  it('拒绝重复牌和不足五张牌', () => {
    const duplicate = c(14, 'spades');
    expect(() => evaluateFive([duplicate, duplicate, c(2,'clubs'),c(3,'clubs'),c(4,'clubs')])).toThrow('卡牌不能重复');
    expect(() => evaluateBestHand([c(2,'clubs'),c(3,'clubs'),c(4,'clubs'),c(5,'clubs')])).toThrow(RangeError);
  });
});
