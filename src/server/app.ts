/**
 * @Author TraeWork
 * @Date 2026-09-11
 * @Desc Fastify 与 Socket.IO 房间服务入口及实时事件协议
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { Server } from 'socket.io';
import { z } from 'zod';
import type { PlayerAction } from '../betting-round.js';
import { RoomError, RoomService, type RoomView } from './room-service.js';
import { SessionService } from './session-service.js';

export type ServiceResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } };
type Ack<T> = (result: ServiceResult<T>) => void;

interface ClientToServerEvents {
  'room:create': (payload: unknown, ack: Ack<RoomView>) => void;
  'room:join': (payload: unknown, ack: Ack<RoomView>) => void;
  'room:ready': (payload: unknown, ack: Ack<RoomView>) => void;
  'room:sync': (payload: unknown, ack: Ack<RoomView>) => void;
  'game:start': (payload: unknown, ack: Ack<RoomView>) => void;
  'game:action': (payload: unknown, ack: Ack<RoomView>) => void;
}

interface ServerToClientEvents {
  'room:state': (room: RoomView) => void;
  'room:error': (error: { readonly code: string; readonly message: string }) => void;
}

interface InterServerEvents {}
interface SocketData { playerId: string; nickname: string; }

const createRoomSchema = z.object({
  name: z.string(), maxPlayers: z.number(), startingStack: z.number(), smallBlind: z.number(), bigBlind: z.number(),
});
const roomIdSchema = z.object({ roomId: z.string().min(1) });
const readySchema = roomIdSchema.extend({ ready: z.boolean() });
const actionSchema = roomIdSchema.extend({
  action: z.discriminatedUnion('type', [
    z.object({ type: z.literal('fold') }),
    z.object({ type: z.literal('check') }),
    z.object({ type: z.literal('call') }),
    z.object({ type: z.literal('raiseTo'), amount: z.number() }),
    z.object({ type: z.literal('allIn') }),
  ]),
});
const sessionSchema = z.object({ nickname: z.string() });

export interface GameServer {
  readonly app: FastifyInstance;
  readonly io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
  readonly sessions: SessionService;
  readonly rooms: RoomService;
}

export function buildServer(options: { readonly sessions?: SessionService; readonly rooms?: RoomService } = {}): GameServer {
  const app = Fastify({ logger: false });
  const sessions = options.sessions ?? new SessionService();
  const rooms = options.rooms ?? new RoomService();
  const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(app.server, {
    cors: { origin: false },
  });

  app.get('/health', async () => ({ ok: true }));
  app.post('/sessions', async (request, reply) => {
    const parsed = sessionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(toFailure(new RoomError('INVALID_PAYLOAD', '昵称参数无效')));
    try {
      return reply.code(201).send({ ok: true, data: await sessions.create(parsed.data.nickname) });
    } catch (error) {
      return reply.code(400).send(toFailure(error));
    }
  });

  io.use(async (socket, next) => {
    try {
      const auth = socket.handshake.auth as Record<string, unknown>;
      const playerId = typeof auth.playerId === 'string' ? auth.playerId : '';
      const token = typeof auth.token === 'string' ? auth.token : '';
      const session = await sessions.verify(playerId, token);
      if (!session) return next(new Error('UNAUTHORIZED'));
      socket.data.playerId = session.playerId;
      socket.data.nickname = session.nickname;
      next();
    } catch (error) {
      next(error instanceof Error ? error : new Error('INTERNAL_ERROR'));
    }
  });

  const broadcastRoom = async (roomId: string): Promise<void> => {
    const sockets = await io.in(channel(roomId)).fetchSockets();
    for (const socket of sockets) {
      try { socket.emit('room:state', await rooms.getRoomView(roomId, socket.data.playerId)); }
      catch (error) { socket.emit('room:error', toFailure(error).error); }
    }
  };

  io.on('connection', async (socket) => {
    await rooms.setConnected(socket.data.playerId, true);
    for (const roomId of await rooms.roomIdsForPlayer(socket.data.playerId)) {
      await socket.join(channel(roomId));
      socket.emit('room:state', await rooms.getRoomView(roomId, socket.data.playerId));
    }

    socket.on('room:create', async (payload, ack) => {
      await handle(ack, async () => {
        const input = parse(createRoomSchema, payload);
        const room = await rooms.createRoom({ playerId: socket.data.playerId, nickname: socket.data.nickname }, input);
        await socket.join(channel(room.id));
        await broadcastRoom(room.id);
        return room;
      });
    });

    socket.on('room:join', async (payload, ack) => {
      await handle(ack, async () => {
        const { roomId } = parse(roomIdSchema, payload);
        const room = await rooms.joinRoom(roomId, { playerId: socket.data.playerId, nickname: socket.data.nickname });
        await socket.join(channel(roomId));
        await broadcastRoom(roomId);
        return room;
      });
    });

    socket.on('room:ready', async (payload, ack) => {
      await handle(ack, async () => {
        const { roomId, ready } = parse(readySchema, payload);
        const room = await rooms.setReady(roomId, socket.data.playerId, ready);
        await broadcastRoom(roomId);
        return room;
      });
    });

    socket.on('room:sync', async (payload, ack) => {
      await handle(ack, async () => {
        const { roomId } = parse(roomIdSchema, payload);
        return await rooms.getRoomView(roomId, socket.data.playerId);
      });
    });

    socket.on('game:start', async (payload, ack) => {
      await handle(ack, async () => {
        const { roomId } = parse(roomIdSchema, payload);
        const room = await rooms.startGame(roomId, socket.data.playerId);
        await broadcastRoom(roomId);
        return room;
      });
    });

    socket.on('game:action', async (payload, ack) => {
      await handle(ack, async () => {
        const { roomId, action } = parse(actionSchema, payload);
        const room = await rooms.act(roomId, socket.data.playerId, action as PlayerAction);
        await broadcastRoom(roomId);
        return room;
      });
    });

    socket.on('disconnect', async () => {
      for (const roomId of await rooms.setConnected(socket.data.playerId, false)) await broadcastRoom(roomId);
    });
  });

  return { app, io, sessions, rooms };
}

async function handle<T>(ack: Ack<T>, operation: () => Promise<T>): Promise<void> {
  try { ack({ ok: true, data: await operation() }); }
  catch (error) { ack(toFailure(error)); }
}

function parse<T>(schema: z.ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new RoomError('INVALID_PAYLOAD', parsed.error.issues[0]?.message ?? '请求参数无效');
  return parsed.data;
}

function toFailure(error: unknown): { readonly ok: false; readonly error: { readonly code: string; readonly message: string } } {
  if (error instanceof RoomError) return { ok: false, error: { code: error.code, message: error.message } };
  if (error instanceof Error) return { ok: false, error: { code: 'GAME_ERROR', message: error.message } };
  return { ok: false, error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } };
}

function channel(roomId: string): string { return `room:${roomId}`; }
