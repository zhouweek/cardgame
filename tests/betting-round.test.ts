import { describe, expect, it } from 'vitest';
import { applyAction, createBettingRound, type BettingPlayer } from '../src/betting-round.js';
const player = (id: string, stack = 1000, committed = 0, acted = false): BettingPlayer => ({ id, stack, committed, totalCommitted: committed, folded: false, allIn: stack === 0, actedSinceLastRaise: acted });

describe('betting round', () => {
  it('从指定玩家开始行动且不修改输入', () => {
    const players = [player('A'), player('B', 950, 50), player('C', 900, 100)];
    const round = createBettingRound(players, 0, 100, 100);
    expect(round.actorIndex).toBe(0);
    expect(round.players).not.toBe(players);
    expect(players[0]!.committed).toBe(0);
  });

  it('跟注后扣除筹码并推进到下一位玩家', () => {
    const round = createBettingRound([player('A'), player('B',900,100)], 0, 100, 100);
    const next = applyAction(round, 'A', { type: 'call' });
    expect(next.players[0]).toMatchObject({ stack: 900, committed: 100, totalCommitted: 100 });
    expect(next.actorIndex).toBe(1);
  });

  it('有待跟注筹码时拒绝过牌', () => {
    const round = createBettingRound([player('A'), player('B',900,100)], 0, 100, 100);
    expect(() => applyAction(round, 'A', { type: 'check' })).toThrow('不能过牌');
  });

  it('完整加注更新最小加注并重新开放其他玩家行动', () => {
    const players = [player('A',900,100,true), player('B',900,100,false), player('C',900,100,true)];
    const round = createBettingRound(players, 1, 100, 100);
    const next = applyAction(round, 'B', { type: 'raiseTo', amount: 250 });
    expect(next.currentBet).toBe(250);
    expect(next.minRaise).toBe(150);
    expect(next.players[0]!.actedSinceLastRaise).toBe(false);
    expect(next.actorIndex).toBe(2);
  });

  it('短码 All-in 提高跟注额但不重新开放加注权', () => {
    const players = [player('A',900,100,true), player('B',900,100,true), player('C',50,100,false)];
    const round = createBettingRound(players, 2, 100, 100);
    const afterAllIn = applyAction(round, 'C', { type: 'allIn' });
    expect(afterAllIn.currentBet).toBe(150);
    expect(afterAllIn.minRaise).toBe(100);
    expect(afterAllIn.actorIndex).toBe(0);
    expect(() => applyAction(afterAllIn, 'A', { type: 'raiseTo', amount: 250 })).toThrow('尚未重新开放');
    const afterCall = applyAction(afterAllIn, 'A', { type: 'call' });
    expect(afterCall.actorIndex).toBe(1);
  });

  it('所有可行动玩家下注一致后结束轮次', () => {
    let round = createBettingRound([player('A'), player('B')], 0, 0, 100);
    round = applyAction(round, 'A', { type: 'check' });
    round = applyAction(round, 'B', { type: 'check' });
    expect(round.complete).toBe(true);
    expect(round.actorIndex).toBeNull();
  });

  it('只剩一名未弃牌玩家时立即结束', () => {
    const round = createBettingRound([player('A'), player('B')], 0, 0, 100);
    const next = applyAction(round, 'A', { type: 'fold' });
    expect(next.complete).toBe(true);
  });

  it('拒绝非当前玩家操作和低于最小额度的加注', () => {
    const round = createBettingRound([player('A'), player('B',900,100)], 0, 100, 100);
    expect(() => applyAction(round, 'B', { type: 'call' })).toThrow('未轮到');
    expect(() => applyAction(round, 'A', { type: 'raiseTo', amount: 150 })).toThrow('低于最小加注');
  });
});
