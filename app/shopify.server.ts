import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  BillingInterval,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { GROWTH_PLAN, PAID_PLANS, PRO_PLAN, getPlanKey, getLimitsForPlan } from "./pricing-plans";
import type { PlanKey, PlanLimits } from "./pricing-plans";

export function isBillingTestMode() {
  return process.env.SHOPIFY_BILLING_TEST !== "false";
}

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.January25,
  scopes: process.env.SCOPES?.split(",") || [
    "read_content",
    "write_content",
    "read_products",
    "read_themes",
    "read_files",
    "write_files",
  ],
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  billing: {
    /**
     * Shopify Billing API: chỉ define paid plans ở đây.
     * Free plan được enforce hoàn toàn trong app code (không dùng Billing API cho $0).
     * Ref: https://shopify.dev/docs/apps/build/billing
     */
    [PRO_PLAN]: {
      trialDays: 3,
      lineItems: [
        {
          amount: 19,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        },
      ],
    },
    [GROWTH_PLAN]: {
      trialDays: 3,
      lineItems: [
        {
          amount: 49,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        },
      ],
    },
  },
  future: {
    unstable_newEmbeddedAuthStrategy: true,
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.January25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;

/**
 * Resolve the currently active billing plan name for the authenticated merchant.
 *
 * IMPORTANT: Per Shopify docs, billing.check() must NOT be used inside the root
 * layout to avoid redirect loops. Call this only in individual route loaders/actions
 * where plan enforcement is needed.
 *
 * Returns the Shopify plan name string (e.g. "Pro") or "free".
 */
export async function getActivePlanName(
  billing: Awaited<ReturnType<typeof authenticate.admin>>["billing"],
): Promise<string> {
  try {
    const billingCheck = await billing.check({
      plans: [...PAID_PLANS],
      isTest: isBillingTestMode(),
    });

    if (billingCheck.hasActivePayment && billingCheck.appSubscriptions?.[0]?.name) {
      return billingCheck.appSubscriptions[0].name;
    }
  } catch (err) {
    console.error("[billing] getActivePlanName check failed:", err);
  }
  return "free";
}

/**
 * Convenience: returns the local plan key and limits in one call.
 */
export async function getActivePlanAndLimits(
  billing: Awaited<ReturnType<typeof authenticate.admin>>["billing"],
): Promise<{ planKey: PlanKey; planName: string; limits: PlanLimits }> {
  const planName = await getActivePlanName(billing);
  const planKey = getPlanKey(planName);
  const limits = getLimitsForPlan(planName);
  return { planKey, planName, limits };
}
