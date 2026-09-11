import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { io as createClient, type Socket } from 'socket.io-client';
import { buildServer, type ServiceResult } from '../src/server/app.js';
import { RoomService, type RoomView } from '../src/server/room-service.js';
import { createDeck } from '../src/cards.js';

let client: Socket | null = null;
let closeServer: (() => Promise<void>) | null = null;

afterEach(async () => {
  client?.close();
  client = null;
  await closeServer?.();
  closeServer = null;
});

describe('game server', () => {
  it('提供健康检查和访客会话接口', async () => {
    const server = buildServer();
    const health = await server.app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ ok: true });
    const invalid = await server.app.inject({ method: 'POST', url: '/sessions', payload: { nickname: '   ' } });
    expect(invalid.statusCode).toBe(400);
    await server.app.close();
  });

  it('通过 Socket 鉴权创建房间并接收玩家专属房间状态', async () => {
    const rooms = new RoomService({ roomIdFactory: () => 'SOCKET01', deckFactory: () => createDeck() });
    const server = buildServer({ rooms });
    await server.app.listen({ host: '127.0.0.1', port: 0 });
    closeServer = async () => { if (server.app.server.listening) await server.app.close(); };
    const sessionResponse = await server.app.inject({ method: 'POST', url: '/sessions', payload: { nickname: '测试玩家' } });
    const session = sessionResponse.json().data as { playerId: string; token: string };
    const address = server.app.server.address() as AddressInfo;
    client = createClient(`http://127.0.0.1:${address.port}`, { transports: ['websocket'], auth: session });
    await new Promise<void>((resolve, reject) => {
      client!.once('connect', resolve);
      client!.once('connect_error', reject);
    });
    const result = await new Promise<ServiceResult<RoomView>>((resolve) => {
      client!.emit('room:create', { name: 'Socket 房间', maxPlayers: 2, startingStack: 1000, smallBlind: 5, bigBlind: 10 }, resolve);
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.id).toBe('SOCKET01');
      expect(result.data.members[0]).toMatchObject({ nickname: '测试玩家', connected: true });
    }
  });
});
