import prisma from "./db.server";
import { fallbackPlan, freshCachedPlan, type CachedPlan } from "./plan-cache";
import type { PlanKey } from "./pricing-plans";

async function readCachedPlan(shop: string): Promise<CachedPlan> {
  try {
    return await prisma.shopConfig.findUnique({ where: { shop }, select: { planKey: true, planCheckedAt: true } });
  } catch (error) {
    // Missing migration or database hiccup: fall back to asking Shopify.
    console.error("[billing] plan cache read failed", error);
    return null;
  }
}

export async function writeCachedPlan(shop: string, planKey: PlanKey) {
  try {
    await prisma.shopConfig.upsert({
      where: { shop },
      update: { planKey, planCheckedAt: new Date() },
      create: { shop, planKey, planCheckedAt: new Date() },
    });
  } catch (error) {
    console.error("[billing] plan cache write failed", error);
  }
}

/** Forces the next plan lookup to ask Shopify (subscription webhooks, reinstall). */
export async function invalidateCachedPlan(shop: string) {
  await prisma.shopConfig.updateMany({ where: { shop }, data: { planCheckedAt: null } });
}

/**
 * Resolves the shop's plan: a fresh cached plan is used as is; otherwise
 * Shopify is asked (`fetchPlan` must throw on failure) and the answer cached.
 * If Shopify fails, the last confirmed plan is used instead of Free.
 */
export async function resolvePlanKey(shop: string, fetchPlan: () => Promise<PlanKey>, options: { force?: boolean } = {}): Promise<PlanKey> {
  const cached = await readCachedPlan(shop);
  if (!options.force) {
    const fresh = freshCachedPlan(cached);
    if (fresh) return fresh;
  }
  try {
    const planKey = await fetchPlan();
    await writeCachedPlan(shop, planKey);
    return planKey;
  } catch (error) {
    const fallback = fallbackPlan(cached);
    console.error(`[billing] plan check failed for ${shop}; using last known plan "${fallback}"`, error);
    return fallback;
  }
}
