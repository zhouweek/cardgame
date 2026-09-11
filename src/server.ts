/**
 * @Author TraeWork
 * @Date 2026-09-11
 * @Desc 德州扑克房间服务启动入口
 */
import { buildServer } from './server/app.js';

const host = process.env.HOST ?? '0.0.0.0';
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RangeError('PORT 必须是 1 到 65535 之间的整数');

const { app } = buildServer();
await app.listen({ host, port });

const shutdown = async (): Promise<void> => {
  await app.close();
  process.exit(0);
};
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
