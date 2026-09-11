/**
 * @Author TraeWork
 * @Date 2026-09-11
 * @Desc 会话与房间聚合的持久化仓储定义及内存实现
 */
import type { Room } from './room-service.js';
import type { PlayerSession } from './session-service.js';

export interface SessionRepository {
  create(session: PlayerSession): Promise<void>;
  findByPlayerId(playerId: string): Promise<PlayerSession | null>;
}

export interface RoomRepository {
  create(room: Room): Promise<void>;
  save(room: Room): Promise<void>;
  findById(roomId: string): Promise<Room | null>;
  findAll(): Promise<readonly Room[]>;
}

export class MemorySessionRepository implements SessionRepository {
  private readonly sessions = new Map<string, PlayerSession>();

  public async create(session: PlayerSession): Promise<void> {
    this.sessions.set(session.playerId, clone(session));
  }

  public async findByPlayerId(playerId: string): Promise<PlayerSession | null> {
    const session = this.sessions.get(playerId);
    return session ? clone(session) : null;
  }
}

export class MemoryRoomRepository implements RoomRepository {
  private readonly rooms = new Map<string, Room>();

  public async create(room: Room): Promise<void> {
    if (this.rooms.has(room.id)) throw new Error('ROOM_ID_CONFLICT');
    this.rooms.set(room.id, clone(room));
  }

  public async save(room: Room): Promise<void> {
    this.rooms.set(room.id, clone(room));
  }

  public async findById(roomId: string): Promise<Room | null> {
    const room = this.rooms.get(roomId);
    return room ? clone(room) : null;
  }

  public async findAll(): Promise<readonly Room[]> {
    return [...this.rooms.values()].map(clone);
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
