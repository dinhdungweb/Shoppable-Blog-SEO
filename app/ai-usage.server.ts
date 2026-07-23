import prisma from "./db.server";

export type AiUsageStatus = {
  limited: boolean;
  limit: number | null;
  used: number;
  remaining: number | null;
  periodStart: string;
  resetsAt: string;
};

export class AiQuotaExceededError extends Error {
  readonly status: AiUsageStatus;

  constructor(status: AiUsageStatus) {
    super(`The Free plan AI limit of ${status.limit} generations per month has been reached.`);
    this.name = "AiQuotaExceededError";
    this.status = status;
  }
}

export function getAiUsagePeriod(now = new Date()) {
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const resetsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { periodStart, resetsAt };
}

export async function getAiUsageStatus(
  shop: string,
  limit: number,
  now = new Date(),
): Promise<AiUsageStatus> {
  const { periodStart, resetsAt } = getAiUsagePeriod(now);
  if (!Number.isFinite(limit)) {
    return serializeStatus(0, limit, periodStart, resetsAt);
  }

  const usage = await prisma.aiUsage.findUnique({
    where: { shop_periodStart: { shop, periodStart } },
    select: { requests: true },
  });
  return serializeStatus(usage?.requests || 0, limit, periodStart, resetsAt);
}

export async function runWithAiUsage<T>(
  {
    shop,
    limit,
    now = new Date(),
  }: {
    shop: string;
    limit: number;
    now?: Date;
  },
  generate: () => Promise<T>,
): Promise<{ result: T; aiUsage: AiUsageStatus }> {
  if (!Number.isFinite(limit)) {
    return {
      result: await generate(),
      aiUsage: await getAiUsageStatus(shop, limit, now),
    };
  }

  const reservation = await reserveAiUsage(shop, limit, now);
  try {
    return {
      result: await generate(),
      aiUsage: reservation,
    };
  } catch (error) {
    await releaseAiUsage(shop, now).catch((releaseError) => {
      console.error("Could not release failed AI usage reservation", releaseError);
    });
    throw error;
  }
}

export function isAiQuotaExceededError(error: unknown): error is AiQuotaExceededError {
  return error instanceof AiQuotaExceededError;
}

async function reserveAiUsage(shop: string, limit: number, now: Date) {
  const { periodStart, resetsAt } = getAiUsagePeriod(now);
  const normalizedLimit = Math.max(0, Math.floor(limit));

  await prisma.aiUsage.upsert({
    where: { shop_periodStart: { shop, periodStart } },
    update: {},
    create: { shop, periodStart },
  });

  const reserved = await prisma.aiUsage.updateMany({
    where: {
      shop,
      periodStart,
      requests: { lt: normalizedLimit },
    },
    data: { requests: { increment: 1 } },
  });

  if (!reserved.count) {
    const current = await prisma.aiUsage.findUnique({
      where: { shop_periodStart: { shop, periodStart } },
      select: { requests: true },
    });
    throw new AiQuotaExceededError(
      serializeStatus(current?.requests || normalizedLimit, normalizedLimit, periodStart, resetsAt),
    );
  }

  const current = await prisma.aiUsage.findUniqueOrThrow({
    where: { shop_periodStart: { shop, periodStart } },
    select: { requests: true },
  });
  return serializeStatus(current.requests, normalizedLimit, periodStart, resetsAt);
}

async function releaseAiUsage(shop: string, now: Date) {
  const { periodStart } = getAiUsagePeriod(now);
  await prisma.aiUsage.updateMany({
    where: { shop, periodStart, requests: { gt: 0 } },
    data: { requests: { decrement: 1 } },
  });
}

function serializeStatus(
  used: number,
  limit: number,
  periodStart: Date,
  resetsAt: Date,
): AiUsageStatus {
  const limited = Number.isFinite(limit);
  const normalizedLimit = limited ? Math.max(0, Math.floor(limit)) : null;
  return {
    limited,
    limit: normalizedLimit,
    used,
    remaining: normalizedLimit === null ? null : Math.max(0, normalizedLimit - used),
    periodStart: periodStart.toISOString(),
    resetsAt: resetsAt.toISOString(),
  };
}
