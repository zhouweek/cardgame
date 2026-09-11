/**
 * @Author TraeWork
 * @Date 2026-09-11
 * @Desc 德州扑克房间服务启动入口
 */
import { PrismaClient } from '@prisma/client';
import { buildServer } from './server/app.js';
import { PrismaRoomRepository, PrismaSessionRepository } from './server/prisma-repositories.js';
import { RoomService } from './server/room-service.js';
import { SessionService } from './server/session-service.js';

const host = process.env.HOST ?? '0.0.0.0';
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RangeError('PORT 必须是 1 到 65535 之间的整数');

if (!process.env.DATABASE_URL) throw new Error('缺少 DATABASE_URL，无法连接 PostgreSQL');

const prisma = new PrismaClient();
const sessions = new SessionService(new PrismaSessionRepository(prisma));
const rooms = new RoomService({ repository: new PrismaRoomRepository(prisma) });
const { app } = buildServer({ sessions, rooms });
app.addHook('onClose', async () => { await prisma.$disconnect(); });
await app.listen({ host, port });

const shutdown = async (): Promise<void> => {
  await app.close();
  process.exit(0);
};
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
