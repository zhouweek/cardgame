import { describe, expect, it } from 'vitest';
import { createDeck } from '../src/cards.js';
import { RoomError, RoomService } from '../src/server/room-service.js';

const roomInput = { name: '测试牌桌', maxPlayers: 3, startingStack: 1000, smallBlind: 5, bigBlind: 10 } as const;
const owner = { playerId: 'owner', nickname: '房主' };
const guest = { playerId: 'guest', nickname: '玩家二' };
const createService = (maxPlayers = 3): RoomService => new RoomService({
  roomIdFactory: () => 'ROOM0001',
  deckFactory: () => createDeck(),
});

describe('RoomService', () => {
  it('创建房间并按最小空闲座位加入玩家', () => {
    const service = createService();
    const created = service.createRoom(owner, roomInput);
    const joined = service.joinRoom(created.id, guest);
    expect(created.ownerId).toBe(owner.playerId);
    expect(joined.members.map(({ playerId, seat }) => ({ playerId, seat }))).toEqual([
      { playerId: 'owner', seat: 0 },
      { playerId: 'guest', seat: 1 },
    ]);
  });

  it('执行准备和开局，并隐藏其他玩家底牌与服务端牌堆', () => {
    const service = createService();
    const room = service.createRoom(owner, roomInput);
    service.joinRoom(room.id, guest);
    service.setReady(room.id, owner.playerId, true);
    service.setReady(room.id, guest.playerId, true);
    const ownerView = service.startGame(room.id, owner.playerId);
    const guestView = service.getRoomView(room.id, guest.playerId);
    expect(ownerView.hand?.players.find(({ id }) => id === owner.playerId)?.holeCards).toHaveLength(2);
    expect(ownerView.hand?.players.find(({ id }) => id === guest.playerId)?.holeCards).toHaveLength(0);
    expect(guestView.hand?.players.find(({ id }) => id === guest.playerId)?.holeCards).toHaveLength(2);
    expect(guestView.hand?.players.find(({ id }) => id === owner.playerId)?.holeCards).toHaveLength(0);
    expect(ownerView.hand).not.toHaveProperty('remainingDeck');
    expect(ownerView.hand).not.toHaveProperty('burnedCards');
    expect(ownerView.hand?.remainingDeckCount).toBe(48);
  });

  it('由服务端校验当前行动人并在弃牌结算后同步成员筹码', () => {
    const service = createService();
    const room = service.createRoom(owner, roomInput);
    service.joinRoom(room.id, guest);
    service.setReady(room.id, owner.playerId, true);
    service.setReady(room.id, guest.playerId, true);
    service.startGame(room.id, owner.playerId);
    expect(() => service.act(room.id, guest.playerId, { type: 'check' })).toThrow('未轮到');
    const completed = service.act(room.id, owner.playerId, { type: 'fold' });
    expect(completed.hand?.street).toBe('complete');
    expect(completed.hand?.settlement?.payouts).toEqual({ guest: 15 });
    expect(completed.members.find(({ playerId }) => playerId === 'guest')?.stack).toBe(1005);
    expect(completed.members.every(({ ready }) => !ready)).toBe(true);
  });

  it('拒绝非房主开局、未准备开局和超出人数上限', () => {
    const service = new RoomService({ roomIdFactory: () => 'ROOM0001', deckFactory: () => createDeck() });
    const room = service.createRoom(owner, { ...roomInput, maxPlayers: 2 });
    service.joinRoom(room.id, guest);
    expect(() => service.startGame(room.id, guest.playerId)).toThrowError(RoomError);
    expect(() => service.startGame(room.id, owner.playerId)).toThrow('至少需要两名');
    expect(() => service.joinRoom(room.id, { playerId: 'third', nickname: '玩家三' })).toThrow('人数已满');
  });

  it('断线只更新连接状态，重连后恢复同一座位', () => {
    const service = createService();
    const room = service.createRoom(owner, roomInput);
    service.joinRoom(room.id, guest);
    expect(service.setConnected(guest.playerId, false)).toEqual([room.id]);
    expect(service.getRoomView(room.id, owner.playerId).members.find(({ playerId }) => playerId === guest.playerId)?.connected).toBe(false);
    const reconnected = service.joinRoom(room.id, guest);
    expect(reconnected.members.find(({ playerId }) => playerId === guest.playerId)).toMatchObject({ seat: 1, connected: true });
  });
});
