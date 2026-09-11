/**
 * @Author TraeWork
 * @Date 2026-09-11
 * @Desc 基于 Prisma 的 PostgreSQL 会话与房间仓储
 */
import { Prisma, PrismaClient } from '@prisma/client';
import type { Room } from './room-service.js';
import type { PlayerSession } from './session-service.js';
import type { RoomRepository, SessionRepository } from './repositories.js';

export class PrismaSessionRepository implements SessionRepository {
  public constructor(private readonly prisma: PrismaClient) {}

  public async create(session: PlayerSession): Promise<void> {
    await this.prisma.playerSession.create({ data: session });
  }

  public async findByPlayerId(playerId: string): Promise<PlayerSession | null> {
    const session = await this.prisma.playerSession.findUnique({
      where: { playerId },
      select: { playerId: true, token: true, nickname: true },
    });
    return session;
  }
}

export class PrismaRoomRepository implements RoomRepository {
  public constructor(private readonly prisma: PrismaClient) {}

  public async create(room: Room): Promise<void> {
    await this.prisma.roomState.create({
      data: { id: room.id, state: toJson(room) },
    });
  }

  public async save(room: Room): Promise<void> {
    await this.prisma.roomState.update({
      where: { id: room.id },
      data: { state: toJson(room) },
    });
  }

  public async findById(roomId: string): Promise<Room | null> {
    const record = await this.prisma.roomState.findUnique({ where: { id: roomId } });
    return record ? fromJson(record.state) : null;
  }

  public async findAll(): Promise<readonly Room[]> {
    const records = await this.prisma.roomState.findMany({ orderBy: { createdAt: 'asc' } });
    return records.map(({ state }) => fromJson(state));
  }
}

function toJson(room: Room): Prisma.InputJsonValue {
  return room as unknown as Prisma.InputJsonValue;
}

function fromJson(value: Prisma.JsonValue): Room {
  return value as unknown as Room;
}
