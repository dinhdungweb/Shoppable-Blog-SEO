import { describe, expect, it } from "vitest";
import { PAID_PLANS, formatLimit, getLimitsForPlan, getPlanKey, isFullAccessShop } from "./pricing-plans";

describe("pricing plan enforcement", () => {
  it("fails closed for unknown plan names", () => {
    expect(getPlanKey("Unknown enterprise plan")).toBe("free");
    expect(getLimitsForPlan("").shoppableArticles).toBe(1);
    expect(getLimitsForPlan("").aiRequestsPerMonth).toBe(3);
    expect(getLimitsForPlan("").seoBlogPosts).toBe(3);
    expect(getLimitsForPlan("").canCatalogSeo).toBe(false);
    expect(getLimitsForPlan("").canContentDecay).toBe(false);
    expect(getLimitsForPlan("").canInternalLinking).toBe(false);
  });

  it("maps paid and legacy plans", () => {
    expect(getPlanKey("Plus")).toBe("plus");
    expect(getPlanKey("Shoppable Blog Plus")).toBe("plus");
    expect(PAID_PLANS).toEqual(["Plus", "Pro", "Growth"]);
    expect(getPlanKey("Pro")).toBe("pro");
    expect(getPlanKey("Shoppable Blog Growth")).toBe("growth");
    expect(getLimitsForPlan("Pro").canContentDecay).toBe(false);
    expect(getLimitsForPlan("Growth").canContentDecay).toBe(true);
    expect(getLimitsForPlan("Pro").canInternalLinking).toBe(true);
    expect(getLimitsForPlan("Growth").canInternalLinking).toBe(true);
    expect(getLimitsForPlan("Plus").aiRequestsPerMonth).toBe(25);
    expect(getLimitsForPlan("Plus").shoppableArticles).toBe(40);
    expect(getLimitsForPlan("Pro").aiRequestsPerMonth).toBe(100);
    expect(getLimitsForPlan("Growth").aiRequestsPerMonth).toBe(300);
    expect(getLimitsForPlan("Plus").canCatalogSeo).toBe(true);
    expect(getLimitsForPlan("Plus").seoBlogPosts).toBe(15);
    expect(getLimitsForPlan("Plus").canSearchConsole).toBe(false);
    expect(getLimitsForPlan("Pro").canSearchConsole).toBe(true);
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
