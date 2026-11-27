import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useState } from "react";
import { data as json , Form, useActionData, useLoaderData, useNavigation, useSubmit } from "react-router";
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
  Text,
  Modal,
} from "@shopify/polaris";
import {
  ChartVerticalIcon,
  CheckCircleIcon,
  ProductIcon,
  StarFilledIcon,
} from "@shopify/polaris-icons";
import { GROWTH_PLAN, PAID_PLANS, PLUS_PLAN, PRO_PLAN, PLAN_LIMITS, getPlanKey } from "../pricing-plans";
import { authenticate, isBillingTestMode } from "../shopify.server";
import { writeCachedPlan } from "../plan-cache.server";
import type { PlanKey } from "../pricing-plans";
import { AppPage } from "../components/AppPage";

type PricingPlan = {
  key: PlanKey;
  billingPlan?: (typeof PAID_PLANS)[number];
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
      `1 active shoppable blog post`,
      "Basic storefront product widget",
      `${PLAN_LIMITS.free.seoBlogPosts} recent blog SEO score previews`,
      `${PLAN_LIMITS.free.aiRequestsPerMonth} AI generations per month`,
      `${PLAN_LIMITS.free.analyticsWindowDays}-day click analytics`,
    ],
  },
  {
    key: "plus",
    billingPlan: PLUS_PLAN,
    name: "Plus",
    price: "$9",
    interval: "per month",
    description: "For small stores running a focused shoppable blog.",
    topLabel: "Best for small stores",
    icon: ProductIcon,
    features: [
      `Up to ${PLAN_LIMITS.plus.shoppableArticles} shoppable blog posts`,
      `${PLAN_LIMITS.plus.analyticsWindowDays}-day click and add-to-cart analytics`,
      "Blog SEO editor and issue guidance",
      `Product and collection SEO (up to ${PLAN_LIMITS.plus.seoCatalogResources} products per scan)`,
      "Carousel and grid display customization",
      `${PLAN_LIMITS.plus.aiRequestsPerMonth} AI generations per month`,
      "7-day free trial",
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
      `Product SEO scans of up to ${PLAN_LIMITS.pro.seoCatalogResources.toLocaleString("en-US")} products`,
      "Internal Linking Assistant",
      "AI Content Brief & Keyword Cluster",
      `${PLAN_LIMITS.pro.aiRequestsPerMonth} AI generations per month`,
      "Conversion tracking and attribution",
      "Google Search Console insights and scheduled SEO scans",
      "7-day free trial",
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
      "Bulk review workflows for posts, products and collections",
      "Unlimited product SEO scans",
      "AI Image SEO for featured and inline images",
      "Content Decay Monitor",
      "Custom widget CSS controls",
      "Priority support",
      `${PLAN_LIMITS.growth.aiRequestsPerMonth} AI generations per month`,
      "7-day free trial",
    ],
  },
];

/** Contextual upgrade reason messages shown via ?reason= query param */
const UPGRADE_REASON_MESSAGES: Record<string, string> = {
  bulk_edit:
    "Bulk Review is a Growth plan feature. Upgrade to review and edit multiple posts at once.",
  shoppable_articles_free: `Your Free plan allows ${PLAN_LIMITS.free.shoppableArticles} shoppable post. Upgrade to Plus for up to ${PLAN_LIMITS.plus.shoppableArticles} posts.`,
  shoppable_articles_plus: `Your Plus plan allows up to ${PLAN_LIMITS.plus.shoppableArticles} shoppable posts. Upgrade to Pro for up to ${PLAN_LIMITS.pro.shoppableArticles} posts.`,
  shoppable_articles_pro: `Your Pro plan allows up to ${PLAN_LIMITS.pro.shoppableArticles} shoppable posts. Upgrade to Growth for unlimited shoppable posts.`,
  content_navigation: "Table of contents and breadcrumbs are Pro plan features. Upgrade to enable TOC settings and storefront content navigation.",
  internal_linking: "Internal Linking Assistant is available on Pro and Growth plans. Upgrade to analyze, review and insert relevant links across Shopify articles.",
  content_brief: "AI Content Brief is available on Pro and Growth plans. Upgrade to build keyword clusters, outlines and reviewable article drafts from your store data.",
  image_seo: "AI Image SEO is a Growth plan feature. Upgrade to review featured and inline image alt text across multiple Shopify articles with batch Apply and Undo.",
  custom_css: "Custom widget CSS is a Growth plan feature. Upgrade to control your widget styling.",
  content_decay: "Content Decay Monitor is a Growth plan feature. Upgrade to monitor declining traffic, stale content, unavailable products and broken links.",
  catalog_seo: "Product and Collection SEO are available on Plus, Pro and Growth plans.",
  blog_seo_tools: "Free includes SEO score previews for 3 recent blog posts. Upgrade to Plus to edit and apply SEO improvements.",
  search_console: "Google Search Console insights are available on Pro and Growth plans.",
  auto_seo_scan: "Scheduled SEO scans are available on Pro and Growth plans.",
  ai_limit: "Your plan has reached its monthly AI generation limit. Upgrade for a higher allowance.",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const reason = url.searchParams.get("reason") || "";
  const billingReturn = url.searchParams.get("billing") === "approved";

  let activePlan = "Free";
  let activeSubscription: ActiveSubscription | null = null;
  let billingError = "";

  try {
    const billingCheck = await billing.check({
      plans: [...PAID_PLANS],
    });

    activeSubscription = (
      billingCheck.appSubscriptions?.find(
        (subscription) => getPlanKey(String(subscription?.name || "")) !== "free",
      ) || null
    ) as ActiveSubscription | null;
    if (billingCheck.hasActivePayment && activeSubscription?.name) {
      activePlan = activeSubscription.name;
    }
    // This page is where merchants land after approving a charge, so refresh the cached plan.
    await writeCachedPlan(session.shop, getPlanKey(activePlan));
  } catch (error) {
    console.error("Billing check failed:", error);
    billingError = "Could not verify the current Shopify billing subscription.";
  }

  return json({
    activePlan,
    activeSubscription,
    billingError,
    isTestMode: isBillingTestMode(),
    billingReturn,
    upgradeReason: reason,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing, session, redirect } = await authenticate.admin(request);
  const formData = await request.formData();
  const selectedPlan = String(formData.get("plan") || "");

  if (selectedPlan === "free") {
    try {
      const billingCheck = await billing.check({
        plans: [...PAID_PLANS],
      });

      const activeSubscription = billingCheck.appSubscriptions?.find(
        (subscription) => getPlanKey(String(subscription?.name || "")) !== "free",
      );

      if (billingCheck.hasActivePayment && activeSubscription?.id) {
        await billing.cancel({
          subscriptionId: activeSubscription.id,
          isTest: activeSubscription.test ?? isBillingTestMode(),
          prorate: true,
        });
      }
      // Settings for paid features are kept (not deleted): they stop applying on Free and return on upgrade.
      await writeCachedPlan(session.shop, "free");

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
    plan: selectedPlan as (typeof PAID_PLANS)[number],
    isTest: isBillingTestMode(),
    returnUrl: getBillingReturnUrl(request, url, session.shop),
  });
};

function getBillingReturnUrl(request: Request, url: URL, shop: string) {
  const host = getSearchParam(url, request, "host");
  const apiKey = process.env.SHOPIFY_API_KEY;

  if (apiKey) {
    const shopAdminSlug = shop.replace(/\.myshopify\.com$/i, "");
    return `https://admin.shopify.com/store/${encodeURIComponent(shopAdminSlug)}/apps/${encodeURIComponent(apiKey)}/app/pricing?billing=approved`;
  }

  const fallbackUrl = new URL("/app/pricing", url.origin);
  fallbackUrl.searchParams.set("shop", shop);
  fallbackUrl.searchParams.set("billing", "approved");
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
  const {
    activePlan,
    activeSubscription,
    billingError,
    billingReturn,
    upgradeReason,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const activePlanKey = getPlanKey(activePlan);
  const upgradeMessage = UPGRADE_REASON_MESSAGES[upgradeReason] || "";

  return (
    <AppPage
      title="Plan & billing"
      subtitle="Every paid plan includes a 7-day free trial. Upgrade or downgrade from Shopify billing at any time."
      fullWidth
      backAction={{ content: "Settings", url: "/app/settings" }}
    >
      <div style={{ width: "100%", maxWidth: "1280px", margin: "0 auto" }}>
        <BlockStack gap="500">

        {/* Contextual upgrade banner — shown when redirected from a gated feature */}
        {upgradeMessage && (
          <Banner
            tone="warning"
            title="Upgrade required"
            action={{ content: "Compare paid plans", url: "#plus" }}
          >
            <p>{upgradeMessage}</p>
          </Banner>
        )}

        {billingError && <Banner tone="warning">{billingError}</Banner>}
        {actionData?.error && <Banner tone="critical">{actionData.error}</Banner>}
        {!billingError && activePlanKey !== "free" && (
          <Banner
            tone="success"
            title={billingReturn ? `${activePlan} plan approved` : `Current plan: ${activePlan}`}
          >
            <p>
              Shopify billing is active
              {activeSubscription?.test ? " in test mode" : ""}
              {activeSubscription?.status ? ` (${activeSubscription.status.toLowerCase()})` : ""}.
              Paid features are available now.
            </p>
          </Banner>
        )}
        {!billingError && billingReturn && activePlanKey === "free" && (
          <Banner tone="warning" title="Shopify is still confirming the subscription">
            <p>
              Refresh this page in a moment. If the plan remains Free, choose the paid plan again
              to reopen Shopify&apos;s approval screen.
            </p>
          </Banner>
        )}

        <InlineGrid columns={{ xs: 1, sm: 2, lg: 4 }} gap="400">
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
      </div>
    </AppPage>
  );
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
  const submit = useSubmit();
  const navigation = useNavigation();
  const [confirmFree, setConfirmFree] = useState(false);
  const isFree = !plan.billingPlan;
  const submitting = navigation.state === "submitting" && navigation.formData?.get("plan") === (plan.billingPlan || plan.key);

  return (
    <div className={isFeatured ? "rm-plan rm-plan--featured" : "rm-plan"}>
    <s-section padding="none">
      <div id={plan.key}>
        <Box padding="200" background={isFeatured ? "bg-fill-brand" : "bg-surface-secondary"}>
          <Text as="p" variant="bodySm" fontWeight="semibold" alignment="center" tone={isFeatured ? "text-inverse" : undefined}>
            {plan.topLabel}
          </Text>
        </Box>
        <Box padding="500">
          <BlockStack gap="400">
            <InlineStack gap="300" blockAlign="center" wrap={false}>
              <Box padding="200" borderRadius="200" background={isFeatured ? "bg-fill-info-secondary" : "bg-surface-secondary"}>
                <Icon source={plan.icon} tone={isFeatured ? "info" : "base"} />
              </Box>
              <BlockStack gap="050">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="h3" variant="headingLg" fontWeight="bold">{plan.name}</Text>
                  {plan.badge && <Badge tone={isFeatured ? "info" : "new"}>{plan.badge}</Badge>}
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">{plan.description}</Text>
              </BlockStack>
            </InlineStack>

            <BlockStack gap="200">
              <InlineStack gap="200" blockAlign="end">
                <Text as="span" variant="heading2xl" fontWeight="bold">{plan.price}</Text>
                <Text as="span" variant="bodyMd" tone="subdued">{plan.interval}</Text>
              </InlineStack>
              {isFree ? (
                <Button fullWidth disabled={isCurrent} loading={submitting} onClick={() => setConfirmFree(true)}>
                  {isCurrent ? "Current plan" : "Switch to Free"}
                </Button>
              ) : (
                <Form method="post">
                  <input type="hidden" name="plan" value={plan.billingPlan} />
                  <Button submit fullWidth variant={isFeatured ? "primary" : "secondary"} disabled={isCurrent} loading={submitting}>
                    {isCurrent ? "Current plan" : "Choose plan"}
                  </Button>
                </Form>
              )}
            </BlockStack>

            <Divider />

            <BlockStack gap="150">
              <Text as="p" variant="headingSm" fontWeight="semibold">Included</Text>
              <BlockStack gap="200">
                {plan.features.map((feature) => (
                  <FeatureRow key={feature} icon={CheckCircleIcon} tone="success" label={feature} />
                ))}
              </BlockStack>
            </BlockStack>
          </BlockStack>
        </Box>
      </div>
      {isFree && (
        <Modal
          open={confirmFree}
          onClose={() => setConfirmFree(false)}
          title="Switch to the Free plan?"
          primaryAction={{ content: "Cancel subscription and switch", destructive: true, loading: submitting, onAction: () => { setConfirmFree(false); submit({ plan: "free" }, { method: "post" }); } }}
          secondaryActions={[{ content: "Keep my plan", onAction: () => setConfirmFree(false) }]}
        >
          <Modal.Section>
            <BlockStack gap="200">
              <Text as="p">Your paid subscription is cancelled in Shopify right away, with a prorated refund handled by Shopify.</Text>
              <Text as="p" tone="subdued">Your settings are kept. Features outside the Free plan stop working until you upgrade again.</Text>
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}
    </s-section>
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
    <InlineStack gap="200" blockAlign="start" wrap={false}>
      <div style={{ flexShrink: 0 }}><Icon source={icon} tone={tone} /></div>
      <Text as="span" variant={subdued ? "bodySm" : "bodyMd"} tone={subdued ? "subdued" : undefined}>{label}</Text>
    </InlineStack>
  );
}
