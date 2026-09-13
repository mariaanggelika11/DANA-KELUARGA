import { app } from './app';
import { env } from './config/env';
import { prisma } from './config/prisma';
import { startNotificationWorker } from './modules/notifications/notification.worker';

const server = app.listen(env.PORT, () => console.log(`Dana Keluarga API berjalan di port ${env.PORT}`));
const stopWorker = startNotificationWorker();
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  server.close(async () => { await stopWorker(); await prisma.$disconnect(); });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
