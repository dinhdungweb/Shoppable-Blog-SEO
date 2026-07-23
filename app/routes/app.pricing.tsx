import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import type { CSSProperties } from "react";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
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
  ProductIcon,
  StarFilledIcon,
} from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { GROWTH_PLAN, PAID_PLANS, PRO_PLAN, PLAN_LIMITS, getPlanKey } from "../pricing-plans";
import { authenticate, isBillingTestMode } from "../shopify.server";
import prisma from "../db.server";
import type { PlanKey } from "../pricing-plans";

type PricingPlan = {
  key: "free" | "pro" | "growth";
  billingPlan?: typeof PRO_PLAN | typeof GROWTH_PLAN;
  name: string;
  price: string;
  interval: string;
  description: string;
  badge?: string;
  topLabel: string;
  icon: typeof ProductIcon;
  features: string[];
};

type ActiveSubscription = {
  id?: string;
  name?: string;
  status?: string;
  test?: boolean;
  currentPeriodEnd?: string;
  trialDays?: number;
};

const PRICING_PLANS: PricingPlan[] = [
  {
    key: "free",
    name: "Free",
    price: "$0",
    interval: "forever",
    description: "Validate setup and start linking products to blog posts.",
    topLabel: "Start with essentials",
    icon: ProductIcon,
    features: [
      "Blog manager and product linking",
      "Basic storefront product widget",
      "Rule-based SEO scan",
      "Basic analytics dashboard",
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
    topLabel: "Best fit for growing stores",
    icon: ChartVerticalIcon,
    features: [
      `Up to ${PLAN_LIMITS.pro.shoppableArticles} shoppable blog posts`,
      `${PLAN_LIMITS.pro.analyticsWindowDays}-day analytics window`,
      "Carousel and grid display customization",
      "Breadcrumb integration",
      "Table of contents integration",
      "SEO optimizer with post-level actions",
      "Internal Linking Assistant",
      "AI Content Brief & Keyword Cluster",
      "Conversion tracking and attribution",
      "3-day free trial",
    ],
  },
  {
    key: "growth",
    billingPlan: GROWTH_PLAN,
    name: "Growth",
    price: "$49",
    interval: "per month",
    description: "For teams that need deeper reporting and faster workflows.",
    badge: "Scale",
    topLabel: "Built for scaling teams",
    icon: StarFilledIcon,
    features: [
      "Everything in Pro",
      "Unlimited shoppable blog posts",
      `${PLAN_LIMITS.growth.analyticsWindowDays}-day analytics window`,
      "Breadcrumb integration",
      "Table of contents integration",
      "Advanced analytics and product performance views",
      "Bulk review workflows",
      "Content Decay Monitor",
      "Custom widget CSS controls",
      "Priority support",
      "3-day free trial",
    ],
  },
];

/** Contextual upgrade reason messages shown via ?reason= query param */
const UPGRADE_REASON_MESSAGES: Record<string, string> = {
  bulk_edit:
    "Bulk Review is a Growth plan feature. Upgrade to review and edit multiple posts at once.",
  shoppable_articles_free: `Your Free plan allows up to ${PLAN_LIMITS.free.shoppableArticles} shoppable posts. Upgrade to Pro (up to 100 posts) or Growth (unlimited).`,
  shoppable_articles_pro: `Your Pro plan allows up to ${PLAN_LIMITS.pro.shoppableArticles} shoppable posts. Upgrade to Growth for unlimited shoppable posts.`,
  content_navigation: "Table of contents and breadcrumbs are Pro plan features. Upgrade to enable TOC settings and storefront content navigation.",
  internal_linking: "Internal Linking Assistant is available on Pro and Growth plans. Upgrade to analyze, review and insert relevant links across Shopify articles.",
  content_brief: "AI Content Brief is available on Pro and Growth plans. Upgrade to build keyword clusters, outlines and reviewable article drafts from your store data.",
  custom_css: "Custom widget CSS is a Growth plan feature. Upgrade to control your widget styling.",
  content_decay: "Content Decay Monitor is a Growth plan feature. Upgrade to monitor declining traffic, stale content, unavailable products and broken links.",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const reason = url.searchParams.get("reason") || "";

  let activePlan = "Free";
  let activeSubscription: ActiveSubscription | null = null;
  let billingError = "";

  try {
    const billingCheck = await billing.check({
      plans: [...PAID_PLANS],
      isTest: isBillingTestMode(),
    });

    activeSubscription = (billingCheck.appSubscriptions?.[0] || null) as ActiveSubscription | null;
    if (billingCheck.hasActivePayment && activeSubscription?.name) {
      activePlan = activeSubscription.name;
    }
  } catch (error) {
    console.error("Billing check failed:", error);
    billingError = "Could not verify the current Shopify billing subscription.";
  }
  await applyPlanRestrictions(session.shop, getPlanKey(activePlan));

  return json({
    activePlan,
    activeSubscription,
    billingError,
    isTestMode: isBillingTestMode(),
    upgradeReason: reason,
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
      await applyPlanRestrictions(session.shop, "free");

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
  const { activePlan, billingError, upgradeReason } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const activePlanKey = getPlanKey(activePlan);
  const upgradeMessage = UPGRADE_REASON_MESSAGES[upgradeReason] || "";

  return (
    <Page>
      <TitleBar title="Pricing" />
      <BlockStack gap="500">
        <InlineStack align="space-between" blockAlign="end" gap="400">
          <BlockStack gap="100">
            <Text as="h2" variant="headingLg" fontWeight="bold">
              Compare plans
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              Every paid plan includes a 3-day free trial. Upgrade or downgrade from Shopify billing at any time.
            </Text>
          </BlockStack>
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

        {billingError && <Banner tone="warning">{billingError}</Banner>}
        {actionData?.error && <Banner tone="critical">{actionData.error}</Banner>}

        <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
          {PRICING_PLANS.map((plan) => (
            <PricingPlanCard
              key={plan.key}
              plan={plan}
              isCurrent={activePlanKey === plan.key}
              isFeatured={plan.key === "pro"}
            />
          ))}
        </InlineGrid>

      </BlockStack>
    </Page>
  );
}

async function applyPlanRestrictions(shop: string, planKey: PlanKey) {
  const data =
    planKey === "free"
      ? {
          customCss: null,
          contentNavCustomCss: null,
          breadcrumbsEnabled: false,
          tocEnabled: false,
          tocAutoInsertEnabled: false,
        }
      : planKey === "pro"
        ? {
            customCss: null,
            contentNavCustomCss: null,
          }
        : null;

  if (!data) return;

  await prisma.shopConfig.updateMany({
    where: { shop },
    data,
  });
}

function PricingPlanCard({
  plan,
  isCurrent,
  isFeatured,
}: {
  plan: PricingPlan;
  isCurrent: boolean;
  isFeatured: boolean;
}) {
  return (
    <div
      id={plan.key}
      style={{
        ...planCardStyle,
        borderColor: isFeatured ? "#303030" : "#D4D4D4",
        boxShadow: isFeatured
          ? "0 12px 28px rgba(31, 33, 36, 0.12)"
          : "0 1px 0 rgba(0, 0, 0, 0.04)",
      }}
    >
      <div
        style={{
          background: isFeatured ? "#303030" : "#F7F7F7",
          borderBottom: isFeatured ? "0" : "1px solid #E3E3E3",
          color: isFeatured ? "#FFFFFF" : "#303030",
          fontSize: "12px",
          fontWeight: 650,
          lineHeight: "16px",
          padding: "8px 16px",
          textAlign: "center",
        }}
      >
        {plan.topLabel}
      </div>

      <Box padding="500">
        <BlockStack gap="400">
          <InlineStack align="space-between" blockAlign="start" gap="300">
            <InlineStack gap="300" blockAlign="center" wrap={false}>
              <span style={iconFrameStyle(isFeatured ? "#EAF4FF" : "#F1F1F1", "#303030")}>
                <Icon source={plan.icon} tone={isFeatured ? "info" : "base"} />
              </span>
              <BlockStack gap="050">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="h3" variant="headingLg" fontWeight="bold">
                    {plan.name}
                  </Text>
                  {plan.badge && <Badge tone={isFeatured ? "info" : "new"}>{plan.badge}</Badge>}
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  {plan.description}
                </Text>
              </BlockStack>
            </InlineStack>
          </InlineStack>

          <BlockStack gap="200">
            <InlineStack gap="200" blockAlign="end">
              <Text as="span" variant="heading2xl" fontWeight="bold">
                {plan.price}
              </Text>
              <Text as="span" variant="bodyMd" tone="subdued">
                {plan.interval}
              </Text>
            </InlineStack>
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

          <Divider />

          <BlockStack gap="150">
            <Text as="p" variant="headingSm" fontWeight="semibold">
              Included
            </Text>
            <BlockStack gap="200">
              {plan.features.map((feature) => (
                <FeatureRow key={feature} icon={CheckCircleIcon} tone="success" label={feature} />
              ))}
            </BlockStack>
          </BlockStack>

        </BlockStack>
      </Box>
    </div>
  );
}

function FeatureRow({
  icon,
  tone,
  label,
  subdued = false,
}: {
  icon: typeof CheckCircleIcon;
  tone: "success" | "subdued";
  label: string;
  subdued?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", minWidth: 0 }}>
      <span style={{ display: "flex", flexShrink: 0, width: "18px", height: "18px" }}>
        <Icon source={icon} tone={tone} />
      </span>
      <Text as="span" variant={subdued ? "bodySm" : "bodyMd"} tone={subdued ? "subdued" : undefined}>
        {label}
      </Text>
    </div>
  );
}

const planCardStyle = {
  height: "100%",
  backgroundColor: "#FFFFFF",
  border: "1px solid #D4D4D4",
  borderRadius: "8px",
  overflow: "hidden",
} satisfies CSSProperties;

function iconFrameStyle(backgroundColor: string, color: string) {
  return {
    alignItems: "center",
    backgroundColor,
    borderRadius: "8px",
    color,
    display: "inline-flex",
    flexShrink: 0,
    height: "40px",
    justifyContent: "center",
    width: "40px",
  } satisfies CSSProperties;
}
