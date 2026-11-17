import type { PlanKey } from "./pricing-plans";

/** How long a confirmed billing plan is trusted before Shopify is asked again. */
export const PLAN_CACHE_TTL_MS = 10 * 60 * 1000;

const PLAN_KEYS = new Set<PlanKey>(["free", "plus", "pro", "growth"]);

export function parsePlanKey(value: unknown): PlanKey | null {
  return typeof value === "string" && PLAN_KEYS.has(value as PlanKey) ? (value as PlanKey) : null;
}

export type CachedPlan = { planKey: string; planCheckedAt: Date | null } | null;

/** The cached plan when it is recent enough to use without asking Shopify. */
export function freshCachedPlan(cached: CachedPlan, now = Date.now(), ttl = PLAN_CACHE_TTL_MS): PlanKey | null {
  const planKey = parsePlanKey(cached?.planKey);
  if (!planKey || !cached?.planCheckedAt) return null;
  const age = now - cached.planCheckedAt.getTime();
  return age >= 0 && age < ttl ? planKey : null;
}

/**
 * The plan to use when Shopify cannot be reached: the last confirmed plan.
 * A temporary billing API error must never downgrade a paying merchant.
 */
export function fallbackPlan(cached: CachedPlan): PlanKey {
  return parsePlanKey(cached?.planKey) || "free";
}
