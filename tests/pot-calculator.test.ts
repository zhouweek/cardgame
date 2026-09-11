import { describe, expect, it } from 'vitest';
import { evaluateFive, rank } from '../src/hand-evaluator.js';
import { calculatePots, distributePots } from '../src/pot-calculator.js';
import type { Card, Suit } from '../src/cards.js';
const c = (value: number, suit: Suit): Card => ({ rank: rank(value), suit });

describe('pot calculator', () => {
  it('按三档 All-in 生成主池和两个边池', () => {
    expect(calculatePots([
      { playerId: 'A', amount: 100, folded: false },
      { playerId: 'B', amount: 200, folded: false },
      { playerId: 'C', amount: 300, folded: false },
    ])).toEqual([
      { amount: 300, eligiblePlayerIds: ['A','B','C'] },
      { amount: 200, eligiblePlayerIds: ['B','C'] },
      { amount: 100, eligiblePlayerIds: ['C'] },
    ]);
  });

  it('弃牌玩家的筹码进入底池但没有获胜资格', () => {
    expect(calculatePots([
      { playerId: 'A', amount: 100, folded: false },
      { playerId: 'B', amount: 200, folded: true },
      { playerId: 'C', amount: 200, folded: false },
    ])).toEqual([
      { amount: 300, eligiblePlayerIds: ['A','C'] },
      { amount: 200, eligiblePlayerIds: ['C'] },
    ]);
  });

  it('平分底池时按传入座位顺序分配奇数筹码', () => {
    const tied = evaluateFive([c(14,'spades'),c(13,'hearts'),c(9,'clubs'),c(6,'diamonds'),c(2,'clubs')]);
    const payouts = distributePots([{ amount: 5, eligiblePlayerIds: ['A','B'] }], new Map([['A', tied], ['B', tied]]), ['B','A']);
    expect(Object.fromEntries(payouts)).toEqual({ B: 3, A: 2 });
  });

  it('跨多个底池累计赢家所得', () => {
    const strong = evaluateFive([c(14,'spades'),c(14,'hearts'),c(9,'clubs'),c(6,'diamonds'),c(2,'clubs')]);
    const weak = evaluateFive([c(13,'spades'),c(11,'hearts'),c(9,'diamonds'),c(6,'clubs'),c(2,'diamonds')]);
    const payouts = distributePots([
      { amount: 300, eligiblePlayerIds: ['A','B'] },
      { amount: 100, eligiblePlayerIds: ['A'] },
    ], new Map([['A', strong], ['B', weak]]), ['A','B']);
    expect(payouts.get('A')).toBe(400);
  });

  it('拒绝重复玩家和无人可赢取的筹码层', () => {
    expect(() => calculatePots([{playerId:'A',amount:10,folded:false},{playerId:'A',amount:10,folded:false}])).toThrow('不能重复');
    expect(() => calculatePots([{playerId:'A',amount:100,folded:false},{playerId:'B',amount:200,folded:true}])).toThrow('无人有资格');
  });
});
