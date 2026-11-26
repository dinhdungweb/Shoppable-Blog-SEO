import type { ReactNode } from "react";
import { Badge, Banner, BlockStack, Page } from "@shopify/polaris";
import type { BadgeProps, PageProps } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { WorkspaceTabs, type WorkspaceTab } from "./WorkspaceTabs";
import { Chips, type ChipItem } from "./rm";

/**
 * The one page frame used by every screen:
 * - Shopify's title bar always shows the page's own title.
 * - Title, subtitle, primary/secondary actions and back link live in the
 *   Polaris page header, never in hand-drawn headings.
 * - An area's tabs (if any) sit directly under the header.
 *
 * Width rule: lists and dashboards use `fullWidth`; detail and settings pages
 * use the default width.
 */
export function AppPage({
  title,
  subtitle,
  titleMetadata,
  primaryAction,
  secondaryActions,
  backAction,
  fullWidth,
  tabs,
  subnav,
  children,
}: {
  title: string;
  subtitle?: string;
  titleMetadata?: ReactNode;
  primaryAction?: PageProps["primaryAction"];
  secondaryActions?: PageProps["secondaryActions"];
  backAction?: { content: string; url: string };
  fullWidth?: boolean;
  tabs?: { items: WorkspaceTab[]; activeId: string };
  /** A chip row under the tabs for tools inside one tab (e.g. SEO Analyzer › Bulk fixes). */
  subnav?: { items: ChipItem[]; active: string; label: string };
  children: ReactNode;
}) {
  return (
    <Page
      title={title}
      subtitle={subtitle}
      titleMetadata={titleMetadata}
      primaryAction={primaryAction}
      secondaryActions={secondaryActions}
      backAction={backAction}
      fullWidth={fullWidth}
    >
      <TitleBar title={title} />
      <BlockStack gap="500">
        {tabs && <WorkspaceTabs tabs={tabs.items} activeId={tabs.activeId} />}
        {subnav && <Chips items={subnav.items} active={subnav.active} label={subnav.label} />}
        {children}
      </BlockStack>
    </Page>
  );
}

const PLAN_LABELS: Record<string, string> = { plus: "Plus", pro: "Pro", growth: "Growth" };

/** The single upgrade message used wherever a feature needs a higher plan. */
export function PlanUpgradeBanner({
  feature,
  requiredPlan,
  reason,
  planKey,
  children,
}: {
  feature: string;
  requiredPlan: "plus" | "pro" | "growth";
  reason: string;
  planKey?: string;
  children?: ReactNode;
}) {
  const plan = PLAN_LABELS[requiredPlan];
  return (
    <Banner
      tone="info"
      title={`${feature} is available on the ${plan}${requiredPlan === "growth" ? "" : " and higher"} plan${requiredPlan === "growth" ? "" : "s"}`}
      action={{ content: "See plans", url: `/app/pricing?reason=${encodeURIComponent(reason)}${planKey ? `&plan=${planKey}` : ""}` }}
    >
      {children}
    </Banner>
  );
}

/** SEO score shown the same way everywhere: green 80+, yellow 50–79, red below 50. */
export function ScoreBadge({ score, size }: { score: number | null | undefined; size?: BadgeProps["size"] }) {
  if (score === null || score === undefined) return <Badge size={size}>Not scanned</Badge>;
  const tone: BadgeProps["tone"] = score >= 80 ? "success" : score >= 50 ? "warning" : "critical";
  return <Badge tone={tone} size={size}>{`${score}/100`}</Badge>;
}

export function scoreTone(score: number | null | undefined): "success" | "caution" | "critical" | "subdued" {
  if (score === null || score === undefined) return "subdued";
  return score >= 80 ? "success" : score >= 50 ? "caution" : "critical";
}
