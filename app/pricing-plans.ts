export const PRO_PLAN = "Pro";
export const GROWTH_PLAN = "Growth";
export const LEGACY_PRO_PLAN = "Shoppable Blog Pro";
export const LEGACY_GROWTH_PLAN = "Shoppable Blog Growth";
export const PAID_PLANS = [PRO_PLAN, GROWTH_PLAN] as const;
export const FREE_AI_REQUESTS_PER_MONTH = 10;

export type PlanKey = "free" | "pro" | "growth";

/**
 * Usage limits per plan.
 * - shoppableArticles: max number of blog posts that can have linked products.
 *   Infinity = unlimited.
 * - analyticsWindowDays: how many past days are shown in analytics / dashboard.
 * - canContentNavigation: access to breadcrumbs and table of contents settings (Pro+).
 * - canInternalLinking: access to Internal Linking Assistant (Pro+).
 * - canBulkReview: access to Bulk Review workflow (Growth only).
 * - canCustomCss: access to Custom CSS field in widget settings (Growth only).
 * - canContentDecay: access to Content Decay Monitor (Growth only).
 * - aiRequestsPerMonth: reviewable AI generations allowed in one UTC calendar month.
 */
export const PLAN_LIMITS = {
  free: {
    shoppableArticles: 3,
    analyticsWindowDays: 7,
    aiRequestsPerMonth: FREE_AI_REQUESTS_PER_MONTH,
    canContentNavigation: false,
    canInternalLinking: false,
    canBulkReview: false,
    canCustomCss: false,
    canContentDecay: false,
  },
  pro: {
    shoppableArticles: 100,
    analyticsWindowDays: 30,
    aiRequestsPerMonth: Infinity,
    canContentNavigation: true,
    canInternalLinking: true,
    canBulkReview: false,
    canCustomCss: false,
    canContentDecay: false,
  },
  growth: {
    shoppableArticles: Infinity,
    analyticsWindowDays: 90,
    aiRequestsPerMonth: Infinity,
    canContentNavigation: true,
    canInternalLinking: true,
    canBulkReview: true,
    canCustomCss: true,
    canContentDecay: true,
  },
} as const satisfies Record<PlanKey, {
  shoppableArticles: number;
  analyticsWindowDays: number;
  aiRequestsPerMonth: number;
  canContentNavigation: boolean;
  canInternalLinking: boolean;
  canBulkReview: boolean;
  canCustomCss: boolean;
  canContentDecay: boolean;
}>;

export type PlanLimits = typeof PLAN_LIMITS[PlanKey];

/**
 * Convert a Shopify billing plan name to a local plan key.
 * Returns "free" for any unrecognised / absent plan name.
 */
export function getPlanKey(activePlanName: string): PlanKey {
  if (activePlanName === PRO_PLAN || activePlanName === LEGACY_PRO_PLAN) return "pro";
  if (activePlanName === GROWTH_PLAN || activePlanName === LEGACY_GROWTH_PLAN) return "growth";
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

export function isFullAccessShop(shop: string, configuredShops: string) {
  const normalizedShop = shop.trim().toLowerCase();
  if (!normalizedShop.endsWith(".myshopify.com")) return false;
  return configuredShops
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .includes(normalizedShop);
}
