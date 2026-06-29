import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Divider,
  Icon,
  InlineGrid,
  InlineStack,
  Page,
  Text,
} from "@shopify/polaris";
import {
  ChartVerticalIcon,
  CheckCircleIcon,
  LockIcon,
  MagicIcon,
  ProductIcon,
  StarFilledIcon,
} from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { GROWTH_PLAN, PAID_PLANS, PRO_PLAN, PLAN_LIMITS } from "../pricing-plans";
import { authenticate, isBillingTestMode } from "../shopify.server";

type PricingPlan = {
  key: "free" | "pro" | "growth";
  billingPlan?: typeof PRO_PLAN | typeof GROWTH_PLAN;
  name: string;
  price: string;
  interval: string;
  description: string;
  badge?: string;
  icon: typeof ProductIcon;
  features: string[];
  limits: string[];
};

const PRICING_PLANS: PricingPlan[] = [
  {
    key: "free",
    name: "Free",
    price: "$0",
    interval: "forever",
    description: "Validate setup and start linking products to blog posts.",
    icon: ProductIcon,
    features: [
      "Blog manager and product linking",
      "Basic storefront product widget",
      "Rule-based SEO scan",
      "Basic analytics dashboard",
    ],
    limits: [
      `Up to ${PLAN_LIMITS.free.shoppableArticles} shoppable posts`,
      `${PLAN_LIMITS.free.analyticsWindowDays}-day analytics window`,
      "No bulk review workflow",
      "No custom widget CSS",
      "No priority support",
    ],
  },
  {
    key: "pro",
    billingPlan: PRO_PLAN,
    name: "Pro",
    price: "$19",
    interval: "per month",
    description: "For stores actively turning blog traffic into product visits.",
    badge: "Recommended",
    icon: ChartVerticalIcon,
    features: [
      `Up to ${PLAN_LIMITS.pro.shoppableArticles} shoppable blog posts`,
      `${PLAN_LIMITS.pro.analyticsWindowDays}-day analytics window`,
      "Carousel and grid display customization",
      "SEO optimizer with post-level actions",
      "Conversion tracking and attribution",
      "7-day free trial",
    ],
    limits: ["No bulk review workflow", "No custom widget CSS"],
  },
  {
    key: "growth",
    billingPlan: GROWTH_PLAN,
    name: "Growth",
    price: "$49",
    interval: "per month",
    description: "For teams that need deeper reporting and faster workflows.",
    badge: "Scale",
    icon: StarFilledIcon,
    features: [
      "Everything in Pro",
      `${PLAN_LIMITS.growth.analyticsWindowDays}-day analytics window`,
      "Advanced analytics and product performance views",
      "Bulk review workflows",
      "Custom widget CSS controls",
      "Priority support",
      "7-day free trial",
    ],
    limits: [],
  },
];

/** Contextual upgrade reason messages shown via ?reason= query param */
const UPGRADE_REASON_MESSAGES: Record<string, string> = {
  bulk_edit:
    "Bulk Review is a Growth plan feature. Upgrade to review and edit multiple posts at once.",
  shoppable_articles_free: `Your Free plan allows up to ${PLAN_LIMITS.free.shoppableArticles} shoppable posts. Upgrade to Pro (up to 100 posts) or Growth (unlimited).`,
  shoppable_articles_pro: `Your Pro plan allows up to ${PLAN_LIMITS.pro.shoppableArticles} shoppable posts. Upgrade to Growth for unlimited shoppable posts.`,
  custom_css: "Custom widget CSS is a Growth plan feature. Upgrade to control your widget styling.",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing } = await authenticate.admin(request);
  const url = new URL(request.url);
  const reason = url.searchParams.get("reason") || "";
  const fromPlan = url.searchParams.get("plan") || "";

  let activePlan = "Free";
  let activeSubscription: {
    id?: string;
    name?: string;
    status?: string;
    test?: boolean;
    currentPeriodEnd?: string;
    trialDays?: number;
  } | null = null;
  let billingError = "";

  try {
    const billingCheck = await billing.check({
      plans: [...PAID_PLANS],
      isTest: isBillingTestMode(),
    });

    activeSubscription = (billingCheck.appSubscriptions?.[0] || null) as typeof activeSubscription;
    if (billingCheck.hasActivePayment && activeSubscription?.name) {
      activePlan = activeSubscription.name;
    }
  } catch (error) {
    console.error("Billing check failed:", error);
    billingError = "Could not verify the current Shopify billing subscription.";
  }

  return json({
    activePlan,
    activeSubscription,
    billingError,
    isTestMode: isBillingTestMode(),
    upgradeReason: reason,
    fromPlan,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing, session, redirect } = await authenticate.admin(request);
  const formData = await request.formData();
  const selectedPlan = String(formData.get("plan") || "");

  if (selectedPlan === "free") {
    try {
      let billingCheck = await billing.check({
        plans: [...PAID_PLANS],
        isTest: isBillingTestMode(),
      });

      if (!billingCheck.hasActivePayment) {
        billingCheck = await billing.check({
          plans: [...PAID_PLANS],
        });
      }

      const activeSubscription = billingCheck.appSubscriptions?.[0];

      if (billingCheck.hasActivePayment && activeSubscription?.id) {
        await billing.cancel({
          subscriptionId: activeSubscription.id,
          isTest: activeSubscription.test ?? isBillingTestMode(),
          prorate: true,
        });
      }

      return redirect("/app/pricing");
    } catch (error) {
      console.error("Billing cancel failed:", error);
      return json({ error: "Could not switch to the Free plan. Please try again." }, { status: 500 });
    }
  }

  if (!PAID_PLANS.includes(selectedPlan as (typeof PAID_PLANS)[number])) {
    return json({ error: "Unknown pricing plan." }, { status: 400 });
  }

  const url = new URL(request.url);
  return billing.request({
    plan: selectedPlan as typeof PRO_PLAN | typeof GROWTH_PLAN,
    isTest: isBillingTestMode(),
    returnUrl: getBillingReturnUrl(request, url, session.shop),
  });
};

function getBillingReturnUrl(request: Request, url: URL, shop: string) {
  const host = getSearchParam(url, request, "host");
  const apiKey = process.env.SHOPIFY_API_KEY;

  if (apiKey) {
    const shopAdminSlug = shop.replace(/\.myshopify\.com$/i, "");
    return `https://admin.shopify.com/store/${encodeURIComponent(shopAdminSlug)}/apps/${encodeURIComponent(apiKey)}/app/pricing`;
  }

  const fallbackUrl = new URL("/app/pricing", url.origin);
  fallbackUrl.searchParams.set("shop", shop);
  if (host) {
    fallbackUrl.searchParams.set("host", host);
  }

  return fallbackUrl.toString();
}

function getSearchParam(url: URL, request: Request, param: string) {
  const currentValue = url.searchParams.get(param);
  if (currentValue) return currentValue;

  const referer = request.headers.get("referer");
  if (!referer) return null;

  try {
    return new URL(referer).searchParams.get(param);
  } catch {
    return null;
  }
}

export default function PricingPage() {
  const { activePlan, activeSubscription, billingError, isTestMode, upgradeReason, fromPlan } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const activePlanKey = getActivePlanKey(activePlan);
  const upgradeMessage = UPGRADE_REASON_MESSAGES[upgradeReason] || "";

  return (
    <Page>
      <TitleBar title="Pricing" />
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="start" gap="400">
          <BlockStack gap="150">
            <InlineStack gap="200" blockAlign="center">
              <Text as="h1" variant="headingLg" fontWeight="bold">
                Pricing
              </Text>
              {activeSubscription?.status && <Badge tone="success">{activeSubscription.status}</Badge>}
            </InlineStack>
            <Text as="p" variant="bodyMd" tone="subdued">
              Choose the plan that matches how aggressively you want to turn blog content into
              product discovery and measurable revenue.
            </Text>
          </BlockStack>
          <InlineStack gap="200" blockAlign="center">
            <Badge tone={activePlanKey === "free" ? "attention" : "success"}>
              Current plan: {activePlanKey === "free" ? "Free" : activePlan}
            </Badge>
          </InlineStack>
        </InlineStack>

        {/* Contextual upgrade banner — shown when redirected from a gated feature */}
        {upgradeMessage && (
          <Banner
            tone="warning"
            title="Upgrade required"
            action={{ content: "View Growth plan", url: "#growth" }}
          >
            <p>{upgradeMessage}</p>
          </Banner>
        )}

        {isTestMode && (
          <Banner tone="info">
            Billing is running in test mode. Set <code>SHOPIFY_BILLING_TEST=false</code> before
            charging production stores.
          </Banner>
        )}

        {billingError && <Banner tone="warning">{billingError}</Banner>}
        {actionData?.error && <Banner tone="critical">{actionData.error}</Banner>}

        <InlineGrid columns={{ xs: 1, md: 3 }} gap="300">
          {PRICING_PLANS.map((plan) => {
            const isCurrent = activePlanKey === plan.key;
            const isFeatured = plan.key === "pro";

            return (
              <div
                key={plan.key}
                id={plan.key}
                style={{
                  height: "100%",
                  backgroundColor: "#fff",
                  border: isFeatured ? "2px solid #6366f1" : "1px solid #D4D4D4",
                  borderRadius: "8px",
                  boxShadow: "0 1px 0 rgba(0, 0, 0, 0.05)",
                  overflow: "hidden",
                }}
              >
                <Box padding="400">
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center" gap="300">
                      <InlineStack gap="200" blockAlign="center">
                        <Icon source={plan.icon} tone={isFeatured ? "magic" : "base"} />
                        <Text as="h2" variant="headingMd" fontWeight="bold">
                          {plan.name}
                        </Text>
                      </InlineStack>
                      {plan.badge && (
                        <Badge tone={isFeatured ? "magic" : "info"}>{plan.badge}</Badge>
                      )}
                    </InlineStack>

                    <BlockStack gap="100">
                      <InlineStack gap="150" blockAlign="end">
                        <Text as="span" variant="headingXl" fontWeight="bold">
                          {plan.price}
                        </Text>
                        <Text as="span" variant="bodyMd" tone="subdued">
                          {plan.interval}
                        </Text>
                      </InlineStack>
                      <Text as="p" variant="bodyMd" tone="subdued">
                        {plan.description}
                      </Text>
                    </BlockStack>

                    <Divider />

                    {/* Features (included) */}
                    <BlockStack gap="200">
                      {plan.features.map((feature) => (
                        <div
                          key={feature}
                          style={{
                            display: "flex",
                            alignItems: "flex-start",
                            gap: "8px",
                            minWidth: 0,
                          }}
                        >
                          <span
                            style={{ display: "flex", flexShrink: 0, width: "16px", height: "16px" }}
                          >
                            <Icon source={CheckCircleIcon} tone="success" />
                          </span>
                          <Text as="span" variant="bodyMd">
                            {feature}
                          </Text>
                        </div>
                      ))}
                    </BlockStack>

                    {/* Limits (not included) */}
                    {!!plan.limits.length && (
                      <BlockStack gap="150">
                        {plan.limits.map((limit) => (
                          <div
                            key={limit}
                            style={{
                              display: "flex",
                              alignItems: "flex-start",
                              gap: "8px",
                              minWidth: 0,
                            }}
                          >
                            <span
                              style={{
                                display: "flex",
                                flexShrink: 0,
                                width: "16px",
                                height: "16px",
                              }}
                            >
                              <Icon source={LockIcon} tone="subdued" />
                            </span>
                            <Text as="p" variant="bodySm" tone="subdued">
                              {limit}
                            </Text>
                          </div>
                        ))}
                      </BlockStack>
                    )}

                    <Form method="post">
                      <input type="hidden" name="plan" value={plan.billingPlan || plan.key} />
                      <Button
                        submit
                        fullWidth
                        variant={isFeatured ? "primary" : "secondary"}
                        disabled={isCurrent}
                      >
                        {isCurrent ? "Current plan" : plan.billingPlan ? "Choose plan" : "Switch to Free"}
                      </Button>
                    </Form>
                  </BlockStack>
                </Box>
              </div>
            );
          })}
        </InlineGrid>

        <Card padding="400">
          <InlineStack align="space-between" blockAlign="center" gap="400">
            <InlineStack gap="300" blockAlign="center">
              <Icon source={MagicIcon} tone="attention" />
              <BlockStack gap="050">
                <Text as="h2" variant="headingMd" fontWeight="bold">
                  AI features are not billed yet
                </Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  AI generation and AI writing rules remain marked coming soon until an AI provider
                  and usage-cost model are connected.
                </Text>
              </BlockStack>
            </InlineStack>
            <Badge tone="attention">Coming soon</Badge>
          </InlineStack>
        </Card>
      </BlockStack>
    </Page>
  );
}

function getActivePlanKey(activePlan: string) {
  if (activePlan === PRO_PLAN) return "pro";
  if (activePlan === GROWTH_PLAN) return "growth";
  return "free";
}
