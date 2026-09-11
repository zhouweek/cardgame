/**
 * @Author TraeWork
 * @Date 2026-09-11
 * @Desc 内存访客会话服务，为 Socket 连接提供最小身份校验
 */
import { randomUUID } from 'node:crypto';

export interface PlayerSession {
  readonly playerId: string;
  readonly token: string;
  readonly nickname: string;
}

export class SessionService {
  private readonly sessions = new Map<string, PlayerSession>();

  public create(nickname: string): PlayerSession {
    const normalized = nickname.trim();
    if (normalized.length < 1 || normalized.length > 20) throw new RangeError('昵称长度必须在 1 到 20 个字符之间');
    const session = { playerId: randomUUID(), token: randomUUID(), nickname: normalized };
    this.sessions.set(session.playerId, session);
    return session;
  }

  public verify(playerId: string, token: string): PlayerSession | null {
    const session = this.sessions.get(playerId);
    return session?.token === token ? session : null;
  }
}
