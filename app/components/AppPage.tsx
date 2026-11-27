import { useId, type JSX, type ReactNode } from "react";
import { Badge, Banner } from "@shopify/polaris";
import type { BadgeProps } from "@shopify/polaris";
import { WorkspaceTabs, type WorkspaceTab } from "./WorkspaceTabs";
import { Chips, type ChipItem } from "./rm";

export type IconName = NonNullable<JSX.IntrinsicElements["s-button"]["icon"]>;

/** A page header action. Rendered as an s-button in the page header (Shopify admin title bar). */
export type PageAction = {
  content: string;
  onAction?: () => void;
  url?: string;
  external?: boolean;
  loading?: boolean;
  disabled?: boolean;
  destructive?: boolean;
  icon?: IconName;
};

/** A header button that opens a menu of related actions. */
export type PageActionGroup = { title: string; icon?: IconName; actions: PageAction[] };

function ActionGroupMenu({ group }: { group: PageActionGroup }) {
  const menuId = `page-actions-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <>
      <s-button slot="secondary-actions" icon={group.icon} commandFor={menuId}>
        {group.title}
      </s-button>
      <s-menu id={menuId} accessibilityLabel={group.title}>
        {group.actions.map((action) => (
          <s-button
            key={action.content}
            tone={action.destructive ? "critical" : undefined}
            icon={action.icon}
            href={action.url}
            disabled={action.disabled || undefined}
            onClick={action.onAction ? () => action.onAction?.() : undefined}
          >
            {action.content}
          </s-button>
        ))}
      </s-menu>
    </>
  );
}

function ActionButton({ action, slot, primary }: { action: PageAction; slot: "primary-action" | "secondary-actions"; primary?: boolean }) {
  return (
    <s-button
      slot={slot}
      variant={primary ? "primary" : "secondary"}
      tone={action.destructive ? "critical" : undefined}
      icon={action.icon}
      href={action.url}
      target={action.external ? "_blank" : undefined}
      loading={action.loading || undefined}
      disabled={action.disabled || undefined}
      onClick={action.onAction ? () => action.onAction?.() : undefined}
    >
      {action.content}
    </s-button>
  );
}

/**
 * The one page frame used by every screen, built on Polaris web components:
 * - s-page carries the title, primary/secondary actions and back link, which
 *   Shopify admin shows in its own title bar.
 * - Subtitle and status badges sit in a short line at the top of the page.
 * - An area's tabs (if any) sit directly under that line.
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
  actionGroups,
  backAction,
  fullWidth,
  narrow,
  tabs,
  subnav,
  aside,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  titleMetadata?: ReactNode;
  primaryAction?: PageAction;
  secondaryActions?: PageAction[];
  actionGroups?: PageActionGroup[];
  backAction?: { content: string; url: string };
  fullWidth?: boolean;
  narrow?: boolean;
  tabs?: { items: WorkspaceTab[]; activeId: string };
  /** A chip row under the tabs for tools inside one tab (e.g. SEO Analyzer › Bulk fixes). */
  subnav?: { items: ChipItem[]; active: string; label: string };
  /** Sidebar content (only shown at the default width). */
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <s-page heading={title} inlineSize={fullWidth ? "large" : narrow ? "small" : "base"}>
      {backAction && (
        <s-link slot="breadcrumb-actions" href={backAction.url}>
          {backAction.content}
        </s-link>
      )}
      {primaryAction && <ActionButton action={primaryAction} slot="primary-action" primary />}
      {secondaryActions?.map((action) => (
        <ActionButton key={action.content} action={action} slot="secondary-actions" />
      ))}
      {actionGroups?.map((group) => <ActionGroupMenu key={group.title} group={group} />)}
      {aside && <div slot="aside">{aside}</div>}
      <s-stack gap="large">
        {(subtitle || titleMetadata) && (
          <s-stack direction="inline" gap="small-200" alignItems="center">
            {titleMetadata}
            {subtitle && <s-text color="subdued">{subtitle}</s-text>}
          </s-stack>
        )}
        {tabs && <WorkspaceTabs tabs={tabs.items} activeId={tabs.activeId} />}
        {subnav && <Chips items={subnav.items} active={subnav.active} label={subnav.label} />}
        {children}
      </s-stack>
    </s-page>
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
