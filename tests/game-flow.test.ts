import { describe, expect, it } from 'vitest';
import { cardKey, createDeck, type Card, type Rank, type Suit } from '../src/cards.js';
import { currentActorId, nextDealerSeat, playAction, startHand, startNextHand, type TablePlayer, type TexasHoldemHand } from '../src/game-flow.js';

const config = { smallBlind: 5, bigBlind: 10 } as const;
const table: TablePlayer[] = [
  { id: 'A', seat: 0, stack: 1000 },
  { id: 'B', seat: 2, stack: 1000 },
  { id: 'C', seat: 5, stack: 1000 },
];
const card = (rank: number, suit: Suit): Card => ({ rank: rank as Rank, suit });
const orderedDeck = (prefix: readonly Card[]): Card[] => {
  const used = new Set(prefix.map(cardKey));
  return [...prefix, ...createDeck().filter((item) => !used.has(cardKey(item)))];
};
const checkStreet = (state: TexasHoldemHand, actorIds: readonly string[]): TexasHoldemHand => {
  let next = state;
  for (const playerId of actorIds) next = playAction(next, playerId, { type: 'check' });
  return next;
};
const chipTotal = (state: TexasHoldemHand): number => state.players.reduce((sum, player) => sum + player.stack + player.totalCommitted, 0);

describe('完整德州扑克流程', () => {
  it('确定三人桌庄家、盲注、发牌顺序和翻牌前行动人', () => {
    const deck = createDeck();
    const state = startHand(table, config, { deck });
    expect(state.dealerSeat).toBe(0);
    expect(state.smallBlindSeat).toBe(2);
    expect(state.bigBlindSeat).toBe(5);
    expect(currentActorId(state)).toBe('A');
    expect(state.players.find(({ id }) => id === 'B')).toMatchObject({ stack: 995, committed: 5, totalCommitted: 5 });
    expect(state.players.find(({ id }) => id === 'C')).toMatchObject({ stack: 990, committed: 10, totalCommitted: 10 });
    expect(state.players.find(({ id }) => id === 'B')!.holeCards).toEqual([deck[0], deck[3]]);
    expect(state.players.find(({ id }) => id === 'C')!.holeCards).toEqual([deck[1], deck[4]]);
    expect(state.players.find(({ id }) => id === 'A')!.holeCards).toEqual([deck[2], deck[5]]);
    expect(state.remainingDeck).toHaveLength(46);
    expect(chipTotal(state)).toBe(3000);
  });

  it('大盲筹码不足时仍要求其他玩家面对完整大盲额', () => {
    const state = startHand([
      { id: 'A', seat: 0, stack: 100 },
      { id: 'B', seat: 1, stack: 100 },
      { id: 'C', seat: 2, stack: 7 },
    ], config, { deck: createDeck() });
    expect(state.players.find(({ id }) => id === 'C')).toMatchObject({ committed: 7, allIn: true });
    expect(state.bettingRound?.currentBet).toBe(10);
    expect(currentActorId(state)).toBe('A');
  });

  it('两人桌庄家兼小盲且翻牌前先行动、翻牌后大盲先行动', () => {
    let state = startHand(table.slice(0, 2), config, { deck: createDeck() });
    expect(state.dealerSeat).toBe(0);
    expect(state.smallBlindSeat).toBe(0);
    expect(state.bigBlindSeat).toBe(2);
    expect(currentActorId(state)).toBe('A');
    state = playAction(state, 'A', { type: 'call' });
    state = playAction(state, 'B', { type: 'check' });
    expect(state.street).toBe('flop');
    expect(currentActorId(state)).toBe('B');
  });

  it('完整推进 Preflop、Flop、Turn、River 并在摊牌后结算', () => {
    const initialTotal = table.reduce((sum, player) => sum + player.stack, 0);
    let state = startHand(table, config, { deck: createDeck() });
    state = playAction(state, 'A', { type: 'call' });
    state = playAction(state, 'B', { type: 'call' });
    state = playAction(state, 'C', { type: 'check' });
    expect(state.street).toBe('flop');
    expect(state.communityCards).toHaveLength(3);
    expect(state.burnedCards).toHaveLength(1);

    state = checkStreet(state, ['B', 'C', 'A']);
    expect(state.street).toBe('turn');
    expect(state.communityCards).toHaveLength(4);
    expect(state.burnedCards).toHaveLength(2);

    state = checkStreet(state, ['B', 'C', 'A']);
    expect(state.street).toBe('river');
    expect(state.communityCards).toHaveLength(5);
    expect(state.burnedCards).toHaveLength(3);

    state = checkStreet(state, ['B', 'C', 'A']);
    expect(state.street).toBe('complete');
    expect(state.settlement?.reason).toBe('showdown');
    expect(state.settlement?.pots).toEqual([{ amount: 30, eligiblePlayerIds: ['A', 'B', 'C'] }]);
    expect(state.players.reduce((sum, player) => sum + player.stack, 0)).toBe(initialTotal);
    expect(currentActorId(state)).toBeNull();
  });

  it('只剩一名玩家时立即结束并将全部已下注筹码交给该玩家', () => {
    let state = startHand(table, config, { deck: createDeck() });
    state = playAction(state, 'A', { type: 'fold' });
    state = playAction(state, 'B', { type: 'fold' });
    expect(state.street).toBe('complete');
    expect(state.settlement).toMatchObject({ reason: 'fold', payouts: { C: 15 }, winningPlayerIds: ['C'] });
    expect(state.players.find(({ id }) => id === 'C')!.stack).toBe(1005);
    expect(state.communityCards).toHaveLength(0);
  });

  it('全部 All-in 后自动发完公共牌并正确结算多级边池', () => {
    const deck = orderedDeck([
      card(13,'spades'), card(12,'spades'), card(14,'spades'),
      card(13,'hearts'), card(12,'hearts'), card(14,'hearts'),
      card(2,'clubs'), card(3,'clubs'), card(7,'diamonds'), card(9,'hearts'),
      card(4,'clubs'), card(11,'diamonds'), card(5,'clubs'), card(10,'spades'),
    ]);
    let state = startHand([
      { id: 'A', seat: 0, stack: 100 },
      { id: 'B', seat: 1, stack: 200 },
      { id: 'C', seat: 2, stack: 300 },
    ], config, { deck });
    state = playAction(state, 'A', { type: 'allIn' });
    state = playAction(state, 'B', { type: 'allIn' });
    state = playAction(state, 'C', { type: 'allIn' });
    expect(state.street).toBe('complete');
    expect(state.communityCards).toHaveLength(5);
    expect(state.burnedCards).toHaveLength(3);
    expect(state.settlement?.pots).toEqual([
      { amount: 300, eligiblePlayerIds: ['A','B','C'] },
      { amount: 200, eligiblePlayerIds: ['B','C'] },
      { amount: 100, eligiblePlayerIds: ['C'] },
    ]);
    expect(state.settlement?.payouts).toEqual({ A: 300, B: 200, C: 100 });
    expect(state.players.map(({ stack }) => stack)).toEqual([300, 200, 100]);
  });

  it('下一手庄家顺时针轮转并增加手牌编号', () => {
    let state = startHand(table, config, { deck: createDeck(), handNumber: 7 });
    state = playAction(state, 'A', { type: 'fold' });
    state = playAction(state, 'B', { type: 'fold' });
    const next = startNextHand(state, createDeck());
    expect(next.handNumber).toBe(8);
    expect(next.dealerSeat).toBe(2);
    expect(next.smallBlindSeat).toBe(5);
    expect(next.bigBlindSeat).toBe(0);
  });

  it('庄家轮转时跳过没有筹码的玩家', () => {
    expect(nextDealerSeat([
      { id: 'A', seat: 0, stack: 100 },
      { id: 'B', seat: 1, stack: 0 },
      { id: 'C', seat: 2, stack: 100 },
    ], 0)).toBe(2);
  });

  it('拒绝重复牌堆以及未结束牌局直接开启下一手', () => {
    const duplicateDeck = createDeck();
    duplicateDeck[1] = duplicateDeck[0]!;
    expect(() => startHand(table, config, { deck: duplicateDeck })).toThrow('重复卡牌');
    const state = startHand(table, config, { deck: createDeck() });
    expect(() => startNextHand(state, createDeck())).toThrow('尚未结束');
  });
});
