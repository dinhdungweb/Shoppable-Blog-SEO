import { describe, expect, it } from "vitest";
import { formatLimit, getLimitsForPlan, getPlanKey, isFullAccessShop } from "./pricing-plans";

describe("pricing plan enforcement", () => {
  it("fails closed for unknown plan names", () => {
    expect(getPlanKey("Unknown enterprise plan")).toBe("free");
    expect(getLimitsForPlan("").shoppableArticles).toBe(3);
    expect(getLimitsForPlan("").aiRequestsPerMonth).toBe(10);
    expect(getLimitsForPlan("").canContentDecay).toBe(false);
    expect(getLimitsForPlan("").canInternalLinking).toBe(false);
  });

  it("maps paid and legacy plans", () => {
    expect(getPlanKey("Pro")).toBe("pro");
    expect(getPlanKey("Shoppable Blog Growth")).toBe("growth");
    expect(getLimitsForPlan("Pro").canContentDecay).toBe(false);
    expect(getLimitsForPlan("Growth").canContentDecay).toBe(true);
    expect(getLimitsForPlan("Pro").canInternalLinking).toBe(true);
    expect(getLimitsForPlan("Growth").canInternalLinking).toBe(true);
    expect(getLimitsForPlan("Pro").aiRequestsPerMonth).toBe(Infinity);
    expect(getLimitsForPlan("Growth").aiRequestsPerMonth).toBe(Infinity);
    expect(formatLimit(Infinity)).toBe("Unlimited");
  });

  it("matches only exact configured myshopify domains for full access", () => {
    const configured = "store-a.myshopify.com, HELIOSJEWELS-VN.MYSHOPIFY.COM ";
    expect(isFullAccessShop("heliosjewels-vn.myshopify.com", configured)).toBe(true);
    expect(isFullAccessShop("store-a.myshopify.com", configured)).toBe(true);
    expect(isFullAccessShop("evil-heliosjewels-vn.myshopify.com", configured)).toBe(false);
    expect(isFullAccessShop("heliosjewels-vn.example.com", configured)).toBe(false);
  });
});
