/**
 * @Author TraeWork
 * @Date 2026-09-11
 * @Desc 访客会话服务，为 Socket 连接提供持久化身份校验
 */
import { randomUUID } from 'node:crypto';
import { MemorySessionRepository, type SessionRepository } from './repositories.js';

export interface PlayerSession {
  readonly playerId: string;
  readonly token: string;
  readonly nickname: string;
}

export class SessionService {
  public constructor(private readonly repository: SessionRepository = new MemorySessionRepository()) {}

  public async create(nickname: string): Promise<PlayerSession> {
    const normalized = nickname.trim();
    if (normalized.length < 1 || normalized.length > 20) throw new RangeError('昵称长度必须在 1 到 20 个字符之间');
    const session = { playerId: randomUUID(), token: randomUUID(), nickname: normalized };
    await this.repository.create(session);
    return session;
  }

  public async verify(playerId: string, token: string): Promise<PlayerSession | null> {
    const session = await this.repository.findByPlayerId(playerId);
    return session?.token === token ? session : null;
  }
}
