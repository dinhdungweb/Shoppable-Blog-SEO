import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const requestedDays = Number(process.env.RAW_EVENT_RETENTION_DAYS || "90");
const retentionDays = Number.isFinite(requestedDays) ? Math.min(365, Math.max(30, Math.floor(requestedDays))) : 90;
const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

try {
  const [events, sessions] = await prisma.$transaction([
    prisma.widgetEvent.deleteMany({ where: { createdAt: { lt: cutoff } } }),
    prisma.analyticsDailySession.deleteMany({ where: { date: { lt: cutoff } } }),
  ]);
  console.log(JSON.stringify({ retentionDays, cutoff: cutoff.toISOString(), deletedRawEvents: events.count, deletedSessionKeys: sessions.count }));
} finally {
  await prisma.$disconnect();
}
