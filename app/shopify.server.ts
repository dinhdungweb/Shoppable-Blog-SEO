import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  BillingInterval,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { GROWTH_PLAN, PAID_PLANS, PLUS_PLAN, PRO_PLAN, getPlanKey, getLimitsForPlan, isFullAccessShop } from "./pricing-plans";
import type { PlanKey, PlanLimits } from "./pricing-plans";
import { resolvePlanKey } from "./plan-cache.server";

export function isBillingTestMode() {
  const billingTestMode = process.env.SHOPIFY_BILLING_TEST?.trim().toLowerCase();

  if (billingTestMode === "true") return true;
  if (billingTestMode === "false") return false;

  return process.env.NODE_ENV !== "production";
}

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.April26,
  // Keep the fallback identical to [access_scopes] in shopify.app.toml.
  scopes: process.env.SCOPES?.split(",").map((scope) => scope.trim()).filter(Boolean) || [
    "read_content",
    "read_files",
    "read_inventory",
    "read_products",
    "read_themes",
    "write_app_proxy",
    "write_content",
    "write_files",
    "write_pixels",
    "write_products",
    "read_customer_events",
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
    [PLUS_PLAN]: {
      trialDays: 7,
      lineItems: [
        {
          amount: 9,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        },
      ],
    },
    [PRO_PLAN]: {
      trialDays: 7,
      lineItems: [
        {
          amount: 19,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        },
      ],
    },
    [GROWTH_PLAN]: {
      trialDays: 7,
      lineItems: [
        {
          amount: 49,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        },
      ],
    },
  },
  hooks: {
    // Runs on install and reinstall: data kept since an uninstall becomes active again,
    // and the plan is re-checked because subscriptions end when an app is removed.
    afterAuth: async ({ session }) => {
      await prisma.shopConfig.updateMany({
        where: { shop: session.shop },
        data: { uninstalledAt: null, planCheckedAt: null },
      }).catch((error) => console.error("[auth] could not reactivate shop data", error));
    },
  },
  future: {
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.April26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;

type AdminBilling = Awaited<ReturnType<typeof authenticate.admin>>["billing"];

const PLAN_NAMES: Record<PlanKey, string> = { free: "free", plus: PLUS_PLAN, pro: PRO_PLAN, growth: GROWTH_PLAN };

/**
 * Asks Shopify for the active paid plan. Throws when Shopify cannot answer, so
 * callers can keep the last known plan instead of treating the shop as Free.
 *
 * IMPORTANT: Per Shopify docs, billing.check() must NOT be used inside the root
 * layout to avoid redirect loops.
 */
export async function checkBillingPlanKey(billing: AdminBilling): Promise<PlanKey> {
  // Omit isTest so Shopify's billing helper returns every active subscription.
  // Passing false hides test subscriptions, which prevents app-review and
  // development stores from seeing the plan they just approved.
  const billingCheck = await billing.check({ plans: [...PAID_PLANS] });
  const activeSubscription = billingCheck.appSubscriptions?.find(
    (subscription) => getPlanKey(String(subscription?.name || "")) !== "free",
  );
  return billingCheck.hasActivePayment && activeSubscription?.name ? getPlanKey(activeSubscription.name) : "free";
}

/**
 * The shop's plan and limits. Uses the cached plan (refreshed every few
 * minutes and on subscription webhooks), so most requests make no billing call.
 */
export async function getActivePlanAndLimits(
  billing: AdminBilling,
  shop?: string,
): Promise<{ planKey: PlanKey; planName: string; limits: PlanLimits }> {
  if (shop && hasFullAccessOverride(shop)) {
    return { planKey: "growth", planName: GROWTH_PLAN, limits: getLimitsForPlan(GROWTH_PLAN) };
  }
  const planKey = shop
    ? await resolvePlanKey(shop, () => checkBillingPlanKey(billing))
    : await checkBillingPlanKey(billing).catch((error) => {
        console.error("[billing] plan check failed:", error);
        return "free" as const;
      });
  const planName = PLAN_NAMES[planKey];
  return { planKey, planName, limits: getLimitsForPlan(planName) };
}

async function fetchUnauthenticatedPlanKey(shop: string): Promise<PlanKey> {
  const { admin } = await unauthenticated.admin(shop);
  const response = await admin.graphql(
    `#graphql
    query ActiveAppSubscriptions {
      currentAppInstallation {
        activeSubscriptions {
          name
          status
          test
        }
      }
    }`,
  );
  const payload: any = await response.json();
  if (payload.errors?.length) throw new Error(payload.errors.map((error: any) => error.message).join("; "));
  const subscriptions = payload.data?.currentAppInstallation?.activeSubscriptions || [];
  const activeSubscription = subscriptions.find((subscription: any) =>
    getPlanKey(String(subscription?.name || "")) !== "free" &&
    String(subscription?.status || "").toUpperCase() === "ACTIVE",
  );
  return activeSubscription?.name ? getPlanKey(activeSubscription.name) : "free";
}

/**
 * Plan name for storefront, worker and OAuth-callback requests where
 * authenticate.admin() is not available. Cached like getActivePlanAndLimits.
 */
export async function getUnauthenticatedActivePlanName(shop: string): Promise<string> {
  if (hasFullAccessOverride(shop)) return GROWTH_PLAN;
  return PLAN_NAMES[await resolvePlanKey(shop, () => fetchUnauthenticatedPlanKey(shop))];
}

export function hasFullAccessOverride(shop: string) {
  return isFullAccessShop(shop, process.env.FULL_ACCESS_SHOPS || "");
}
