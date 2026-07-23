import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AiQuotaExceededError,
  getAiUsagePeriod,
  getAiUsageStatus,
  runWithAiUsage,
} from "./ai-usage.server";

const { aiUsage } = vi.hoisted(() => ({
  aiUsage: {
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    updateMany: vi.fn(),
    upsert: vi.fn(),
  },
}));

vi.mock("./db.server", () => ({ default: { aiUsage } }));

describe("AI usage quota", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    aiUsage.upsert.mockResolvedValue({});
    aiUsage.updateMany.mockResolvedValue({ count: 1 });
    aiUsage.findUniqueOrThrow.mockResolvedValue({ requests: 3 });
  });

  it("uses UTC calendar months", () => {
    const period = getAiUsagePeriod(new Date("2026-07-31T23:59:59.000Z"));
    expect(period.periodStart.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(period.resetsAt.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("reports finite usage and unlimited paid access", async () => {
    aiUsage.findUnique.mockResolvedValueOnce({ requests: 4 });
    await expect(getAiUsageStatus("shop.myshopify.com", 10, new Date("2026-07-23T00:00:00Z")))
      .resolves.toMatchObject({ limited: true, limit: 10, used: 4, remaining: 6 });

    await expect(getAiUsageStatus("shop.myshopify.com", Infinity))
      .resolves.toMatchObject({ limited: false, limit: null, used: 0, remaining: null });
  });

  it("atomically reserves one generation and returns remaining usage", async () => {
    const generated = vi.fn().mockResolvedValue("ok");
    const result = await runWithAiUsage(
      { shop: "shop.myshopify.com", limit: 10, now: new Date("2026-07-23T00:00:00Z") },
      generated,
    );

    expect(generated).toHaveBeenCalledOnce();
    expect(result.result).toBe("ok");
    expect(result.aiUsage).toMatchObject({ used: 3, remaining: 7 });
    expect(aiUsage.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ requests: { lt: 10 } }),
      data: { requests: { increment: 1 } },
    }));
  });

  it("rejects before calling AI when the monthly limit is exhausted", async () => {
    aiUsage.updateMany.mockResolvedValueOnce({ count: 0 });
    aiUsage.findUnique.mockResolvedValueOnce({ requests: 10 });
    const generated = vi.fn();

    await expect(runWithAiUsage(
      { shop: "shop.myshopify.com", limit: 10 },
      generated,
    )).rejects.toBeInstanceOf(AiQuotaExceededError);
    expect(generated).not.toHaveBeenCalled();
  });

  it("refunds a reservation when generation fails", async () => {
    const error = new Error("provider failed");
    await expect(runWithAiUsage(
      { shop: "shop.myshopify.com", limit: 10 },
      async () => { throw error; },
    )).rejects.toBe(error);

    expect(aiUsage.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ requests: { gt: 0 } }),
      data: { requests: { decrement: 1 } },
    }));
  });
});
