import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
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
  MagicIcon,
  ProductIcon,
  StarFilledIcon,
} from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { GROWTH_PLAN, PAID_PLANS, PRO_PLAN } from "../pricing-plans";
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
    limits: ["Manual workflows", "No priority support"],
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
      "Unlimited shoppable blog posts",
      "Carousel and grid display customization",
      "SEO optimizer with post-level actions",
      "Conversion tracking and attribution",
      "7-day free trial",
    ],
    limits: ["Best for single-store teams"],
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
      "Advanced analytics and product performance views",
      "Bulk review workflows",
      "Custom widget CSS controls",
      "Priority support",
      "7-day free trial",
    ],
    limits: ["AI content tools will remain marked coming soon until connected"],
  },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing } = await authenticate.admin(request);

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
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing } = await authenticate.admin(request);
  const formData = await request.formData();
  const selectedPlan = String(formData.get("plan") || "");

  if (selectedPlan === "free") {
    return redirect("/app/pricing");
  }

  if (!PAID_PLANS.includes(selectedPlan as (typeof PAID_PLANS)[number])) {
    return json({ error: "Unknown pricing plan." }, { status: 400 });
  }

  const url = new URL(request.url);
  return billing.request({
    plan: selectedPlan as typeof PRO_PLAN | typeof GROWTH_PLAN,
    isTest: isBillingTestMode(),
    returnUrl: `${url.origin}/app/pricing`,
  });
};

export default function PricingPage() {
  const { activePlan, activeSubscription, billingError, isTestMode } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const activePlanKey = getActivePlanKey(activePlan);

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
              Choose the plan that matches how aggressively you want to turn blog content into product discovery and measurable revenue.
            </Text>
          </BlockStack>
          <InlineStack gap="200" blockAlign="center">
            <Badge tone={activePlanKey === "free" ? "attention" : "success"}>
              Current plan: {activePlanKey === "free" ? "Free" : activePlan}
            </Badge>
          </InlineStack>
        </InlineStack>

        {isTestMode && (
          <Banner tone="info">
            Billing is running in test mode. Set <code>SHOPIFY_BILLING_TEST=false</code> before charging production stores.
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
                        {plan.badge && <Badge tone={isFeatured ? "magic" : "info"}>{plan.badge}</Badge>}
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
                            <span style={{ display: "flex", flexShrink: 0, width: "16px", height: "16px" }}>
                              <Icon source={CheckCircleIcon} tone="success" />
                            </span>
                            <Text as="span" variant="bodyMd">
                              {feature}
                            </Text>
                          </div>
                        ))}
                      </BlockStack>

                      {!!plan.limits.length && (
                        <BlockStack gap="150">
                          {plan.limits.map((limit) => (
                            <Text key={limit} as="p" variant="bodySm" tone="subdued">
                              {limit}
                            </Text>
                          ))}
                        </BlockStack>
                      )}

                      <Form method="post">
                        <input type="hidden" name="plan" value={plan.billingPlan || plan.key} />
                        <Button submit fullWidth variant={isFeatured ? "primary" : "secondary"} disabled={isCurrent}>
                          {isCurrent ? "Current plan" : plan.billingPlan ? "Choose plan" : "Stay on Free"}
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
                  AI generation and AI writing rules remain marked coming soon until an AI provider and usage-cost model are connected.
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
