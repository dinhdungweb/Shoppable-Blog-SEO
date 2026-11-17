import { PrismaClient } from "@prisma/client";

// Raw widget events are only needed for debugging and de-duplication; daily
// aggregates (AnalyticsDaily) are kept. Session keys are random pseudonymous ids
// used to count sessions and traffic sources, so they are kept for the longest
// analytics range (365 days) plus a margin.
const prisma = new PrismaClient();
const clampDays = (value, fallback, min, max) => {
  const days = Number(value || fallback);
  return Number.isFinite(days) ? Math.min(max, Math.max(min, Math.floor(days))) : fallback;
};
const rawRetentionDays = clampDays(process.env.RAW_EVENT_RETENTION_DAYS, 90, 30, 365);
const sessionRetentionDays = clampDays(process.env.SESSION_KEY_RETENTION_DAYS, 400, 370, 800);
const rawCutoff = new Date(Date.now() - rawRetentionDays * 86_400_000);
const sessionCutoff = new Date(Date.now() - sessionRetentionDays * 86_400_000);

try {
  const [events, sessions] = await prisma.$transaction([
    prisma.widgetEvent.deleteMany({ where: { createdAt: { lt: rawCutoff } } }),
    prisma.analyticsDailySession.deleteMany({ where: { date: { lt: sessionCutoff } } }),
  ]);
  console.log(JSON.stringify({
    rawRetentionDays,
    sessionRetentionDays,
    deletedRawEvents: events.count,
    deletedSessionKeys: sessions.count,
  }));
} finally {
  await prisma.$disconnect();
}
