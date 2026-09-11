/**
 * @Author TraeWork
 * @Date 2026-09-11
 * @Desc 德州扑克完整手牌流程：庄家轮转、盲注、发牌、街道推进与结算
 */
import { applyAction, createBettingRound, type BettingPlayer, type BettingRound, type PlayerAction } from './betting-round.js';
import { cardKey, createDeck, isValidCard, shuffleDeck, type Card } from './cards.js';
import { evaluateBestHand, type HandValue } from './hand-evaluator.js';
import { calculatePots, distributePots, type Pot } from './pot-calculator.js';

export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'complete';

export interface TablePlayer {
  readonly id: string;
  readonly seat: number;
  readonly stack: number;
}

export interface GameConfig {
  readonly smallBlind: number;
  readonly bigBlind: number;
}

export interface HandPlayer extends BettingPlayer {
  readonly seat: number;
  readonly holeCards: readonly Card[];
}

export interface HandSettlement {
  readonly reason: 'fold' | 'showdown';
  readonly pots: readonly Pot[];
  readonly payouts: Readonly<Record<string, number>>;
  readonly winningPlayerIds: readonly string[];
  readonly handValues: Readonly<Record<string, HandValue>>;
}

export interface TexasHoldemHand {
  readonly handNumber: number;
  readonly config: GameConfig;
  readonly dealerSeat: number;
  readonly smallBlindSeat: number;
  readonly bigBlindSeat: number;
  readonly street: Street;
  readonly players: readonly HandPlayer[];
  readonly communityCards: readonly Card[];
  readonly burnedCards: readonly Card[];
  readonly remainingDeck: readonly Card[];
  readonly bettingRound: BettingRound | null;
  readonly settlement: HandSettlement | null;
}

export interface StartHandOptions {
  readonly previousDealerSeat?: number | null;
  readonly handNumber?: number;
  readonly deck?: readonly Card[];
}

export function nextDealerSeat(players: readonly TablePlayer[], previousDealerSeat: number | null): number {
  const active = players.filter(({ stack }) => stack > 0).sort((left, right) => left.seat - right.seat);
  if (active.length < 2) throw new RangeError('至少需要两名有筹码的玩家');
  if (previousDealerSeat === null) return active[0]!.seat;
  return active.find(({ seat }) => seat > previousDealerSeat)?.seat ?? active[0]!.seat;
}

export function startHand(
  tablePlayers: readonly TablePlayer[],
  config: GameConfig,
  options: StartHandOptions = {},
): TexasHoldemHand {
  validateTable(tablePlayers, config);
  const activeTablePlayers = tablePlayers.filter(({ stack }) => stack > 0).sort((left, right) => left.seat - right.seat);
  const dealerSeat = nextDealerSeat(activeTablePlayers, options.previousDealerSeat ?? null);
  const smallBlindSeat = activeTablePlayers.length === 2 ? dealerSeat : nextSeat(activeTablePlayers, dealerSeat);
  const bigBlindSeat = nextSeat(activeTablePlayers, smallBlindSeat);
  const sourceDeck = options.deck ? validateDeck(options.deck) : shuffleDeck(createDeck());
  const { holeCards, remainingDeck } = dealHoleCards(activeTablePlayers, smallBlindSeat, sourceDeck);

  let players: HandPlayer[] = activeTablePlayers.map((player) => ({
    ...player,
    committed: 0,
    totalCommitted: 0,
    folded: false,
    allIn: false,
    actedSinceLastRaise: false,
    holeCards: holeCards.get(player.id)!,
  }));
  players = postBlind(players, smallBlindSeat, config.smallBlind);
  players = postBlind(players, bigBlindSeat, config.bigBlind);

  // 大盲即使筹码不足，其他玩家翻牌前仍需面对完整大盲额。
  const currentBet = config.bigBlind;
  const firstActorSeat = activeTablePlayers.length === 2 ? dealerSeat : nextSeat(activeTablePlayers, bigBlindSeat);
  const firstActorIndex = players.findIndex(({ seat }) => seat === firstActorSeat);
  const bettingRound = createBettingRound(players, firstActorIndex, currentBet, config.bigBlind);
  const state: TexasHoldemHand = {
    handNumber: options.handNumber ?? 1,
    config: { ...config },
    dealerSeat,
    smallBlindSeat,
    bigBlindSeat,
    street: 'preflop',
    players,
    communityCards: [],
    burnedCards: [],
    remainingDeck,
    bettingRound,
    settlement: null,
  };
  return bettingRound.complete ? resolveCompletedRound(state) : state;
}

export function startNextHand(completedHand: TexasHoldemHand, deck?: readonly Card[]): TexasHoldemHand {
  if (completedHand.street !== 'complete') throw new Error('当前手牌尚未结束');
  return startHand(
    completedHand.players.map(({ id, seat, stack }) => ({ id, seat, stack })),
    completedHand.config,
    { previousDealerSeat: completedHand.dealerSeat, handNumber: completedHand.handNumber + 1, ...(deck ? { deck } : {}) },
  );
}

export function playAction(state: TexasHoldemHand, playerId: string, action: PlayerAction): TexasHoldemHand {
  if (state.street === 'complete' || state.bettingRound === null) throw new Error('当前手牌不能继续操作');
  const bettingRound = applyAction(state.bettingRound, playerId, action);
  const players = syncPlayers(state.players, bettingRound.players);
  const next = { ...state, players, bettingRound };
  return bettingRound.complete ? resolveCompletedRound(next) : next;
}

export function currentActorId(state: TexasHoldemHand): string | null {
  if (state.bettingRound?.actorIndex === null || state.bettingRound === null) return null;
  return state.bettingRound.players[state.bettingRound.actorIndex]?.id ?? null;
}

function resolveCompletedRound(state: TexasHoldemHand): TexasHoldemHand {
  const unfolded = state.players.filter(({ folded }) => !folded);
  if (unfolded.length === 1) return settleByFold(state, unfolded[0]!.id);
  const playersAbleToAct = unfolded.filter(({ allIn }) => !allIn);
  if (playersAbleToAct.length <= 1) return settleShowdown(runOutBoard(state));
  if (state.street === 'river') return settleShowdown(state);
  return openNextStreet(state);
}

function openNextStreet(state: TexasHoldemHand): TexasHoldemHand {
  const dealt = dealNextStreet(state.street, state.remainingDeck);
  const players = state.players.map((player) => ({ ...player, committed: 0, actedSinceLastRaise: false }));
  const firstActorIndex = nextActionIndex(players, state.dealerSeat);
  const bettingRound = createBettingRound(players, firstActorIndex, 0, state.config.bigBlind);
  return {
    ...state,
    street: dealt.street,
    players,
    communityCards: [...state.communityCards, ...dealt.communityCards],
    burnedCards: [...state.burnedCards, dealt.burnedCard],
    remainingDeck: dealt.remainingDeck,
    bettingRound,
  };
}

function runOutBoard(state: TexasHoldemHand): TexasHoldemHand {
  let next = state;
  while (next.street !== 'river') {
    const dealt = dealNextStreet(next.street, next.remainingDeck);
    next = {
      ...next,
      street: dealt.street,
      communityCards: [...next.communityCards, ...dealt.communityCards],
      burnedCards: [...next.burnedCards, dealt.burnedCard],
      remainingDeck: dealt.remainingDeck,
      bettingRound: null,
    };
  }
  return next;
}

function settleByFold(state: TexasHoldemHand, winnerId: string): TexasHoldemHand {
  const amount = state.players.reduce((sum, player) => sum + player.totalCommitted, 0);
  const players = state.players.map((player) => player.id === winnerId ? { ...player, stack: player.stack + amount } : player);
  return {
    ...state,
    street: 'complete',
    players,
    bettingRound: null,
    settlement: {
      reason: 'fold',
      pots: [{ amount, eligiblePlayerIds: [winnerId] }],
      payouts: { [winnerId]: amount },
      winningPlayerIds: [winnerId],
      handValues: {},
    },
  };
}

function settleShowdown(state: TexasHoldemHand): TexasHoldemHand {
  if (state.communityCards.length !== 5) throw new Error('摊牌时公共牌必须达到 5 张');
  const contributions = state.players.map(({ id, totalCommitted, folded }) => ({ playerId: id, amount: totalCommitted, folded }));
  const pots = calculatePots(contributions);
  const handValues = Object.fromEntries(
    state.players.filter(({ folded }) => !folded).map((player) => [player.id, evaluateBestHand([...player.holeCards, ...state.communityCards])]),
  ) as Record<string, HandValue>;
  const orderedSeats = orderFromSeat(state.players, nextSeat(state.players, state.dealerSeat)).map(({ id }) => id);
  const payoutsMap = distributePots(pots, new Map(Object.entries(handValues)), orderedSeats);
  const payouts = Object.fromEntries(payoutsMap);
  const players = state.players.map((player) => ({ ...player, stack: player.stack + (payouts[player.id] ?? 0) }));
  return {
    ...state,
    street: 'complete',
    players,
    bettingRound: null,
    settlement: {
      reason: 'showdown',
      pots,
      payouts,
      winningPlayerIds: orderedSeats.filter((playerId) => (payouts[playerId] ?? 0) > 0),
      handValues,
    },
  };
}

function dealHoleCards(players: readonly TablePlayer[], smallBlindSeat: number, deck: readonly Card[]): { holeCards: Map<string, Card[]>; remainingDeck: Card[] } {
  const order = orderFromSeat(players, smallBlindSeat);
  const holeCards = new Map(order.map(({ id }) => [id, [] as Card[]]));
  let cursor = 0;
  for (let round = 0; round < 2; round += 1) for (const player of order) holeCards.get(player.id)!.push(deck[cursor++]!);
  return { holeCards, remainingDeck: deck.slice(cursor) };
}

function dealNextStreet(street: Street, deck: readonly Card[]): { street: Exclude<Street, 'preflop' | 'complete'>; burnedCard: Card; communityCards: Card[]; remainingDeck: Card[] } {
  if (street === 'complete' || street === 'river') throw new Error('当前街道不能继续发公共牌');
  const count = street === 'preflop' ? 3 : 1;
  if (deck.length < count + 1) throw new Error('牌堆不足');
  return {
    street: street === 'preflop' ? 'flop' : street === 'flop' ? 'turn' : 'river',
    burnedCard: deck[0]!,
    communityCards: deck.slice(1, count + 1),
    remainingDeck: deck.slice(count + 1),
  };
}

function postBlind(players: readonly HandPlayer[], seat: number, blind: number): HandPlayer[] {
  return players.map((player) => {
    if (player.seat !== seat) return player;
    const paid = Math.min(player.stack, blind);
    const stack = player.stack - paid;
    return { ...player, stack, committed: paid, totalCommitted: paid, allIn: stack === 0 };
  });
}

function syncPlayers(players: readonly HandPlayer[], bettingPlayers: readonly BettingPlayer[]): HandPlayer[] {
  const updates = new Map(bettingPlayers.map((player) => [player.id, player]));
  return players.map((player) => ({ ...player, ...updates.get(player.id)! }));
}

function nextActionIndex(players: readonly HandPlayer[], dealerSeat: number): number {
  const ordered = orderFromSeat(players, nextSeat(players, dealerSeat));
  const actor = ordered.find((player) => !player.folded && !player.allIn);
  if (!actor) throw new Error('没有可行动玩家');
  return players.findIndex(({ id }) => id === actor.id);
}

function nextSeat(players: readonly { readonly seat: number }[], afterSeat: number): number {
  const seats = players.map(({ seat }) => seat).sort((left, right) => left - right);
  const next = seats.find((seat) => seat > afterSeat) ?? seats[0];
  if (next === undefined) throw new RangeError('没有可用座位');
  return next;
}

function orderFromSeat<T extends { readonly seat: number }>(players: readonly T[], startSeat: number): T[] {
  return [...players].sort((left, right) => {
    const leftOrder = left.seat >= startSeat ? left.seat - startSeat : Number.MAX_SAFE_INTEGER / 2 + left.seat;
    const rightOrder = right.seat >= startSeat ? right.seat - startSeat : Number.MAX_SAFE_INTEGER / 2 + right.seat;
    return leftOrder - rightOrder;
  });
}

function validateTable(players: readonly TablePlayer[], config: GameConfig): void {
  if (players.length < 2 || players.length > 20) throw new RangeError('牌桌人数必须在 2 到 20 人之间');
  if (new Set(players.map(({ id }) => id)).size !== players.length) throw new RangeError('玩家 ID 不能重复');
  if (new Set(players.map(({ seat }) => seat)).size !== players.length) throw new RangeError('座位不能重复');
  for (const player of players) {
    if (!player.id) throw new TypeError('玩家 ID 不能为空');
    if (!Number.isSafeInteger(player.seat) || player.seat < 0) throw new RangeError('座位必须是非负安全整数');
    if (!Number.isSafeInteger(player.stack) || player.stack < 0) throw new RangeError('筹码必须是非负安全整数');
  }
  if (players.filter(({ stack }) => stack > 0).length < 2) throw new RangeError('至少需要两名有筹码的玩家');
  if (!Number.isSafeInteger(config.smallBlind) || config.smallBlind <= 0) throw new RangeError('小盲必须是正安全整数');
  if (!Number.isSafeInteger(config.bigBlind) || config.bigBlind < config.smallBlind) throw new RangeError('大盲必须是不小于小盲的正安全整数');
}

function validateDeck(deck: readonly Card[]): Card[] {
  if (deck.length !== 52) throw new RangeError('牌堆必须包含 52 张牌');
  if (deck.some((card) => !isValidCard(card))) throw new TypeError('牌堆包含无效卡牌');
  if (new Set(deck.map(cardKey)).size !== 52) throw new RangeError('牌堆包含重复卡牌');
  return deck.map((card) => ({ ...card }));
}
