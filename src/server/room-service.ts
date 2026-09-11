/**
 * @Author TraeWork
 * @Date 2026-09-11
 * @Desc 服务端权威的房间、准备、牌局动作与玩家视图管理
 */
import { randomUUID } from 'node:crypto';
import type { PlayerAction } from '../betting-round.js';
import type { Card } from '../cards.js';
import { startHand, playAction, type GameConfig, type HandPlayer, type TexasHoldemHand } from '../game-flow.js';

export interface RoomMember {
  readonly playerId: string;
  readonly nickname: string;
  readonly seat: number;
  readonly stack: number;
  readonly ready: boolean;
  readonly connected: boolean;
}

export interface Room {
  readonly id: string;
  readonly name: string;
  readonly ownerId: string;
  readonly maxPlayers: number;
  readonly startingStack: number;
  readonly config: GameConfig;
  readonly members: readonly RoomMember[];
  readonly hand: TexasHoldemHand | null;
}

export interface CreateRoomInput {
  readonly name: string;
  readonly maxPlayers: number;
  readonly startingStack: number;
  readonly smallBlind: number;
  readonly bigBlind: number;
}

export interface RoomHandView extends Omit<TexasHoldemHand, 'players' | 'remainingDeck' | 'burnedCards'> {
  readonly players: readonly HandPlayer[];
  readonly remainingDeckCount: number;
  readonly burnedCardCount: number;
}

export interface RoomView extends Omit<Room, 'hand'> {
  readonly hand: RoomHandView | null;
}

export class RoomError extends Error {
  public constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'RoomError';
  }
}

export interface RoomServiceOptions {
  readonly roomIdFactory?: () => string;
  readonly deckFactory?: () => readonly Card[];
}

export class RoomService {
  private readonly rooms = new Map<string, Room>();
  private readonly roomIdFactory: () => string;
  private readonly deckFactory: (() => readonly Card[]) | undefined;

  public constructor(options: RoomServiceOptions = {}) {
    this.roomIdFactory = options.roomIdFactory ?? (() => randomUUID().slice(0, 8));
    this.deckFactory = options.deckFactory;
  }

  public createRoom(owner: { playerId: string; nickname: string }, input: CreateRoomInput): RoomView {
    validateCreateRoomInput(input);
    const roomId = this.roomIdFactory();
    if (this.rooms.has(roomId)) throw new RoomError('ROOM_ID_CONFLICT', '房间号冲突，请重试');
    const room: Room = {
      id: roomId,
      name: input.name.trim(),
      ownerId: owner.playerId,
      maxPlayers: input.maxPlayers,
      startingStack: input.startingStack,
      config: { smallBlind: input.smallBlind, bigBlind: input.bigBlind },
      members: [{ playerId: owner.playerId, nickname: owner.nickname, seat: 0, stack: input.startingStack, ready: false, connected: true }],
      hand: null,
    };
    this.rooms.set(roomId, room);
    return this.getRoomView(roomId, owner.playerId);
  }

  public joinRoom(roomId: string, player: { playerId: string; nickname: string }): RoomView {
    const room = this.requireRoom(roomId);
    const existing = room.members.find(({ playerId }) => playerId === player.playerId);
    if (existing) {
      this.saveRoom({ ...room, members: room.members.map((member) => member.playerId === player.playerId ? { ...member, connected: true } : member) });
      return this.getRoomView(roomId, player.playerId);
    }
    if (room.members.length >= room.maxPlayers) throw new RoomError('ROOM_FULL', '房间人数已满');
    if (room.hand && room.hand.street !== 'complete') throw new RoomError('HAND_IN_PROGRESS', '牌局进行中，暂时不能加入');
    const seat = firstFreeSeat(room.members, room.maxPlayers);
    this.saveRoom({
      ...room,
      members: [...room.members, { playerId: player.playerId, nickname: player.nickname, seat, stack: room.startingStack, ready: false, connected: true }],
    });
    return this.getRoomView(roomId, player.playerId);
  }

  public setReady(roomId: string, playerId: string, ready: boolean): RoomView {
    const room = this.requireMember(roomId, playerId);
    if (room.hand && room.hand.street !== 'complete') throw new RoomError('HAND_IN_PROGRESS', '牌局进行中不能修改准备状态');
    this.saveRoom({ ...room, members: room.members.map((member) => member.playerId === playerId ? { ...member, ready } : member) });
    return this.getRoomView(roomId, playerId);
  }

  public startGame(roomId: string, ownerId: string): RoomView {
    const room = this.requireMember(roomId, ownerId);
    if (room.ownerId !== ownerId) throw new RoomError('NOT_OWNER', '只有房主可以开始牌局');
    if (room.hand && room.hand.street !== 'complete') throw new RoomError('HAND_IN_PROGRESS', '牌局已经开始');
    const participants = room.members.filter(({ ready, connected, stack }) => ready && connected && stack > 0);
    if (participants.length < 2) throw new RoomError('NOT_ENOUGH_READY', '至少需要两名已准备且在线的玩家');
    const previousDealerSeat = room.hand?.dealerSeat ?? null;
    const handNumber = (room.hand?.handNumber ?? 0) + 1;
    const deck = this.deckFactory?.();
    const hand = startHand(
      participants.map(({ playerId, seat, stack }) => ({ id: playerId, seat, stack })),
      room.config,
      { previousDealerSeat, handNumber, ...(deck ? { deck } : {}) },
    );
    this.saveRoom({ ...room, hand });
    return this.getRoomView(roomId, ownerId);
  }

  public act(roomId: string, playerId: string, action: PlayerAction): RoomView {
    const room = this.requireMember(roomId, playerId);
    if (!room.hand || room.hand.street === 'complete') throw new RoomError('NO_ACTIVE_HAND', '当前没有进行中的牌局');
    if (!room.hand.players.some(({ id }) => id === playerId)) throw new RoomError('NOT_IN_HAND', '当前玩家未参与本手牌');
    const hand = playAction(room.hand, playerId, action);
    const members = hand.street === 'complete'
      ? room.members.map((member) => {
          const handPlayer = hand.players.find(({ id }) => id === member.playerId);
          return { ...member, stack: handPlayer?.stack ?? member.stack, ready: false };
        })
      : room.members;
    this.saveRoom({ ...room, hand, members });
    return this.getRoomView(roomId, playerId);
  }

  public setConnected(playerId: string, connected: boolean): string[] {
    const changedRoomIds: string[] = [];
    for (const room of this.rooms.values()) {
      if (!room.members.some((member) => member.playerId === playerId)) continue;
      this.saveRoom({ ...room, members: room.members.map((member) => member.playerId === playerId ? { ...member, connected } : member) });
      changedRoomIds.push(room.id);
    }
    return changedRoomIds;
  }

  public getRoomView(roomId: string, viewerId: string): RoomView {
    const room = this.requireMember(roomId, viewerId);
    return {
      ...room,
      members: room.members.map((member) => ({ ...member })),
      config: { ...room.config },
      hand: room.hand ? sanitizeHand(room.hand, viewerId) : null,
    };
  }

  public roomIdsForPlayer(playerId: string): string[] {
    return [...this.rooms.values()].filter((room) => room.members.some((member) => member.playerId === playerId)).map(({ id }) => id);
  }

  private requireRoom(roomId: string): Room {
    const room = this.rooms.get(roomId);
    if (!room) throw new RoomError('ROOM_NOT_FOUND', '房间不存在');
    return room;
  }

  private requireMember(roomId: string, playerId: string): Room {
    const room = this.requireRoom(roomId);
    if (!room.members.some((member) => member.playerId === playerId)) throw new RoomError('NOT_ROOM_MEMBER', '玩家不在该房间');
    return room;
  }

  private saveRoom(room: Room): void {
    this.rooms.set(room.id, room);
  }
}

function sanitizeHand(hand: TexasHoldemHand, viewerId: string): RoomHandView {
  const revealShowdown = hand.street === 'complete' && hand.settlement?.reason === 'showdown';
  const players = hand.players.map((player) => ({
    ...player,
    holeCards: player.id === viewerId || (revealShowdown && !player.folded) ? player.holeCards.map((card) => ({ ...card })) : [],
  }));
  const { remainingDeck: _remainingDeck, burnedCards: _burnedCards, ...publicHand } = hand;
  return { ...publicHand, players, remainingDeckCount: hand.remainingDeck.length, burnedCardCount: hand.burnedCards.length };
}

function firstFreeSeat(members: readonly RoomMember[], maxPlayers: number): number {
  const occupied = new Set(members.map(({ seat }) => seat));
  for (let seat = 0; seat < maxPlayers; seat += 1) if (!occupied.has(seat)) return seat;
  throw new RoomError('ROOM_FULL', '房间人数已满');
}

function validateCreateRoomInput(input: CreateRoomInput): void {
  const name = input.name.trim();
  if (name.length < 1 || name.length > 30) throw new RoomError('INVALID_ROOM_NAME', '房间名称长度必须在 1 到 30 个字符之间');
  if (!Number.isInteger(input.maxPlayers) || input.maxPlayers < 2 || input.maxPlayers > 20) throw new RoomError('INVALID_MAX_PLAYERS', '房间人数必须在 2 到 20 人之间');
  if (!Number.isSafeInteger(input.startingStack) || input.startingStack <= 0) throw new RoomError('INVALID_STACK', '初始筹码必须是正安全整数');
  if (!Number.isSafeInteger(input.smallBlind) || input.smallBlind <= 0) throw new RoomError('INVALID_SMALL_BLIND', '小盲必须是正安全整数');
  if (!Number.isSafeInteger(input.bigBlind) || input.bigBlind < input.smallBlind) throw new RoomError('INVALID_BIG_BLIND', '大盲必须是不小于小盲的正安全整数');
  if (input.startingStack < input.bigBlind) throw new RoomError('STACK_TOO_SMALL', '初始筹码不能小于大盲');
}
