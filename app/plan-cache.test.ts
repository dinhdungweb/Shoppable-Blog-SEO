import { describe, expect, it } from "vitest";
import { PLAN_CACHE_TTL_MS, fallbackPlan, freshCachedPlan } from "./plan-cache";

const now = Date.parse("2026-11-21T10:00:00Z");

describe("plan cache", () => {
  it("uses a recent confirmed plan without asking Shopify", () => {
    expect(freshCachedPlan({ planKey: "growth", planCheckedAt: new Date(now - 60_000) }, now)).toBe("growth");
  });

  it("asks Shopify again when the plan is stale, unknown or invalidated", () => {
    expect(freshCachedPlan({ planKey: "growth", planCheckedAt: new Date(now - PLAN_CACHE_TTL_MS) }, now)).toBeNull();
    expect(freshCachedPlan({ planKey: "growth", planCheckedAt: null }, now)).toBeNull();
    expect(freshCachedPlan({ planKey: "", planCheckedAt: new Date(now) }, now)).toBeNull();
    expect(freshCachedPlan(null, now)).toBeNull();
  });

  it("keeps the last known plan when Shopify cannot be reached", () => {
    expect(fallbackPlan({ planKey: "pro", planCheckedAt: new Date(0) })).toBe("pro");
    expect(fallbackPlan({ planKey: "bogus", planCheckedAt: null })).toBe("free");
    expect(fallbackPlan(null)).toBe("free");
  });
});
