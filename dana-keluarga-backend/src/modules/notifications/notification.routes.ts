import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/prisma';
import { env } from '../../config/env';
import { requireAuth, type AuthRequest } from '../../middleware/auth';

export const notificationRouter = Router();
notificationRouter.use(requireAuth);
const inboxQuery = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  unread: z.enum(['true', 'false']).default('false'),
});

notificationRouter.get('/inbox', async (req: AuthRequest, res) => {
  const input = inboxQuery.safeParse(req.query);
  if (!input.success)
    return res
      .status(400)
      .json({
        error: { message: 'Filter atau halaman notifikasi tidak valid' },
      });
  const own = { userId: req.auth!.sub };
  const where = {
    ...own,
    ...(input.data.unread === 'true' ? { isRead: false } : {}),
  };
  const [items, total, unreadCount] = await prisma.$transaction([
    prisma.notification.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (input.data.page - 1) * 20,
      take: 20,
      select: {
        id: true,
        type: true,
        title: true,
        message: true,
        isRead: true,
        createdAt: true,
        metadata: true,
        family: { select: { name: true } },
      },
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { ...own, isRead: false } }),
  ]);
  res.json({
    success: true,
    data: { items, total, unreadCount, page: input.data.page },
  });
});

notificationRouter.get('/inbox/unread-count', async (req: AuthRequest, res) => {
  const unreadCount = await prisma.notification.count({
    where: { userId: req.auth!.sub, isRead: false },
  });
  res.json({ success: true, data: { unreadCount } });
});

notificationRouter.patch('/inbox/read-all', async (req: AuthRequest, res) => {
  const result = await prisma.notification.updateMany({
    where: { userId: req.auth!.sub, isRead: false },
    data: { isRead: true, readAt: new Date() },
  });
  res.json({ success: true, data: { updated: result.count } });
});

notificationRouter.patch('/inbox/:id/read', async (req: AuthRequest, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success)
    return res
      .status(400)
      .json({ error: { message: 'ID notifikasi tidak valid' } });
  const result = await prisma.notification.updateMany({
    where: { id: id.data, userId: req.auth!.sub },
    data: { isRead: true, readAt: new Date() },
  });
  if (!result.count)
    return res
      .status(404)
      .json({ error: { message: 'Notifikasi tidak ditemukan' } });
  res.json({ success: true });
});

notificationRouter.get('/preferences', async (req: AuthRequest, res) => {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: req.auth!.sub },
    select: { phone: true, whatsappOptInAt: true },
  });
  res.json({ success: true, data: { ...user, mode: env.WHATSAPP_MODE } });
});
notificationRouter.patch('/preferences', async (req: AuthRequest, res) => {
  const input = z.object({ enabled: z.boolean() }).safeParse(req.body);
  if (!input.success)
    return res
      .status(400)
      .json({ error: { message: 'Pilihan notifikasi tidak valid' } });
  const user = await prisma.$transaction(async (tx) => {
    const result = await tx.user.update({
      where: { id: req.auth!.sub },
      data: { whatsappOptInAt: input.data.enabled ? new Date() : null },
      select: { phone: true, whatsappOptInAt: true },
    });
    if (!input.data.enabled)
      await tx.whatsAppMessage.updateMany({
        where: {
          userId: req.auth!.sub,
          status: { in: ['QUEUED', 'PROCESSING'] },
        },
        data: {
          status: 'CANCELLED',
          lockedAt: null,
          completedAt: new Date(),
          lastError: 'Penerima menonaktifkan notifikasi',
        },
      });
    return result;
  });
  res.json({ success: true, data: { ...user, mode: env.WHATSAPP_MODE } });
});
notificationRouter.get('/', async (req: AuthRequest, res) => {
  const admin =
    req.auth!.systemRole === 'SUPER_ADMIN' ||
    ['ADMIN', 'TREASURER'].includes(req.auth!.familyRole ?? '');
  const global = req.auth!.systemRole === 'SUPER_ADMIN';
  const where = global
    ? {}
    : admin && req.auth!.familyId
      ? { familyId: req.auth!.familyId }
      : { userId: req.auth!.sub };
  const page = Math.max(1, Math.min(100000, Number(req.query.page) || 1));
  const [messages, total] = await prisma.$transaction([
    prisma.whatsAppMessage.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 50,
      skip: (Math.floor(page) - 1) * 50,
      select: {
        id: true,
        kind: true,
        body: true,
        status: true,
        attempts: true,
        lastError: true,
        createdAt: true,
        completedAt: true,
        user: { select: { name: true } },
        family: { select: { name: true } },
      },
    }),
    prisma.whatsAppMessage.count({ where }),
  ]);
  res.json({
    success: true,
    data: { messages, total, page: Math.floor(page), mode: env.WHATSAPP_MODE },
  });
});
