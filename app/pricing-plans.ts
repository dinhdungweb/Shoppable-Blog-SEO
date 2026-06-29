export const PRO_PLAN = "Shoppable Blog Pro";
export const GROWTH_PLAN = "Shoppable Blog Growth";
export const PAID_PLANS = [PRO_PLAN, GROWTH_PLAN] as const;

export type PlanKey = "free" | "pro" | "growth";

/**
 * Usage limits per plan.
 * - shoppableArticles: max number of blog posts that can have linked products.
 *   Infinity = unlimited.
 * - analyticsWindowDays: how many past days are shown in analytics / dashboard.
 * - canBulkReview: access to Bulk Review workflow (Growth only).
 * - canCustomCss: access to Custom CSS field in widget settings (Growth only).
 */
export const PLAN_LIMITS = {
  free: {
    shoppableArticles: 3,
    analyticsWindowDays: 7,
    canBulkReview: false,
    canCustomCss: false,
  },
  pro: {
    shoppableArticles: 100,
    analyticsWindowDays: 30,
    canBulkReview: false,
    canCustomCss: false,
  },
  growth: {
    shoppableArticles: Infinity,
    analyticsWindowDays: 90,
    canBulkReview: true,
    canCustomCss: true,
  },
} as const satisfies Record<PlanKey, {
  shoppableArticles: number;
  analyticsWindowDays: number;
  canBulkReview: boolean;
  canCustomCss: boolean;
}>;

export type PlanLimits = typeof PLAN_LIMITS[PlanKey];

/**
 * Convert a Shopify billing plan name to a local plan key.
 * Returns "free" for any unrecognised / absent plan name.
 */
export function getPlanKey(activePlanName: string): PlanKey {
  if (activePlanName === PRO_PLAN) return "pro";
  if (activePlanName === GROWTH_PLAN) return "growth";
  return "free";
}

/**
 * Return the limits object for the given plan name.
 */
export function getLimitsForPlan(activePlanName: string): PlanLimits {
  return PLAN_LIMITS[getPlanKey(activePlanName)];
}

/**
 * Human-readable label for a limit value (Infinity → "Unlimited").
 */
export function formatLimit(value: number): string {
  return value === Infinity ? "Unlimited" : String(value);
}
