import { describe, expect, it } from "vitest";
import { formatLimit, getLimitsForPlan, getPlanKey } from "./pricing-plans";

describe("pricing plan enforcement", () => {
  it("fails closed for unknown plan names", () => {
    expect(getPlanKey("Unknown enterprise plan")).toBe("free");
    expect(getLimitsForPlan("").shoppableArticles).toBe(3);
    expect(getLimitsForPlan("").canContentDecay).toBe(false);
  });

  it("maps paid and legacy plans", () => {
    expect(getPlanKey("Pro")).toBe("pro");
    expect(getPlanKey("Shoppable Blog Growth")).toBe("growth");
    expect(getLimitsForPlan("Pro").canContentDecay).toBe(false);
    expect(getLimitsForPlan("Growth").canContentDecay).toBe(true);
    expect(formatLimit(Infinity)).toBe("Unlimited");
  });
});
