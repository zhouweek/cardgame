import { describe, expect, it } from 'vitest';
import { createDeck } from '../src/cards.js';
import { RoomError, RoomService } from '../src/server/room-service.js';
import { MemoryRoomRepository } from '../src/server/repositories.js';

const roomInput = { name: '测试牌桌', maxPlayers: 3, startingStack: 1000, smallBlind: 5, bigBlind: 10 } as const;
const owner = { playerId: 'owner', nickname: '房主' };
const guest = { playerId: 'guest', nickname: '玩家二' };
const createService = (maxPlayers = 3): RoomService => new RoomService({
  roomIdFactory: () => 'ROOM0001',
  deckFactory: () => createDeck(),
});

describe('RoomService', () => {
  it('创建房间并按最小空闲座位加入玩家', async () => {
    const service = createService();
    const created = await service.createRoom(owner, roomInput);
    const joined = await service.joinRoom(created.id, guest);
    expect(created.ownerId).toBe(owner.playerId);
    expect(joined.members.map(({ playerId, seat }) => ({ playerId, seat }))).toEqual([
      { playerId: 'owner', seat: 0 },
      { playerId: 'guest', seat: 1 },
    ]);
  });

  it('执行准备和开局，并隐藏其他玩家底牌与服务端牌堆', async () => {
    const service = createService();
    const room = await service.createRoom(owner, roomInput);
    await service.joinRoom(room.id, guest);
    await service.setReady(room.id, owner.playerId, true);
    await service.setReady(room.id, guest.playerId, true);
    const ownerView = await service.startGame(room.id, owner.playerId);
    const guestView = await service.getRoomView(room.id, guest.playerId);
    expect(ownerView.hand?.players.find(({ id }) => id === owner.playerId)?.holeCards).toHaveLength(2);
    expect(ownerView.hand?.players.find(({ id }) => id === guest.playerId)?.holeCards).toHaveLength(0);
    expect(guestView.hand?.players.find(({ id }) => id === guest.playerId)?.holeCards).toHaveLength(2);
    expect(guestView.hand?.players.find(({ id }) => id === owner.playerId)?.holeCards).toHaveLength(0);
    expect(ownerView.hand).not.toHaveProperty('remainingDeck');
    expect(ownerView.hand).not.toHaveProperty('burnedCards');
    expect(ownerView.hand?.remainingDeckCount).toBe(48);
  });

  it('由服务端校验当前行动人并在弃牌结算后同步成员筹码', async () => {
    const service = createService();
    const room = await service.createRoom(owner, roomInput);
    await service.joinRoom(room.id, guest);
    await service.setReady(room.id, owner.playerId, true);
    await service.setReady(room.id, guest.playerId, true);
    await service.startGame(room.id, owner.playerId);
    await expect(service.act(room.id, guest.playerId, { type: 'check' })).rejects.toThrow('未轮到');
    const completed = await service.act(room.id, owner.playerId, { type: 'fold' });
    expect(completed.hand?.street).toBe('complete');
    expect(completed.hand?.settlement?.payouts).toEqual({ guest: 15 });
    expect(completed.members.find(({ playerId }) => playerId === 'guest')?.stack).toBe(1005);
    expect(completed.members.every(({ ready }) => !ready)).toBe(true);
  });

  it('拒绝非房主开局、未准备开局和超出人数上限', async () => {
    const service = new RoomService({ roomIdFactory: () => 'ROOM0001', deckFactory: () => createDeck() });
    const room = await service.createRoom(owner, { ...roomInput, maxPlayers: 2 });
    await service.joinRoom(room.id, guest);
    await expect(service.startGame(room.id, guest.playerId)).rejects.toThrowError(RoomError);
    await expect(service.startGame(room.id, owner.playerId)).rejects.toThrow('至少需要两名');
    await expect(service.joinRoom(room.id, { playerId: 'third', nickname: '玩家三' })).rejects.toThrow('人数已满');
  });

  it('断线只更新连接状态，重连后恢复同一座位', async () => {
    const service = createService();
    const room = await service.createRoom(owner, roomInput);
    await service.joinRoom(room.id, guest);
    expect(await service.setConnected(guest.playerId, false)).toEqual([room.id]);
    expect((await service.getRoomView(room.id, owner.playerId)).members.find(({ playerId }) => playerId === guest.playerId)?.connected).toBe(false);
    const reconnected = await service.joinRoom(room.id, guest);
    expect(reconnected.members.find(({ playerId }) => playerId === guest.playerId)).toMatchObject({ seat: 1, connected: true });
  });

  it('通过共享仓储在新服务实例中恢复房间状态', async () => {
    const repository = new MemoryRoomRepository();
    const first = new RoomService({ repository, roomIdFactory: () => 'ROOM0001' });
    await first.createRoom(owner, roomInput);
    await first.joinRoom('ROOM0001', guest);

    const restarted = new RoomService({ repository });
    const restored = await restarted.getRoomView('ROOM0001', owner.playerId);
    expect(restored.members.map(({ playerId }) => playerId)).toEqual(['owner', 'guest']);
  });

  it('串行处理同一房间的并发写入', async () => {
    const service = createService();
    await service.createRoom(owner, roomInput);
    await Promise.all([
      service.joinRoom('ROOM0001', guest),
      service.joinRoom('ROOM0001', { playerId: 'third', nickname: '玩家三' }),
    ]);

    const room = await service.getRoomView('ROOM0001', owner.playerId);
    expect(room.members.map(({ playerId }) => playerId)).toEqual(['owner', 'guest', 'third']);
  });
});
