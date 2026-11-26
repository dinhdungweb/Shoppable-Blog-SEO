import { BlockStack, Box, Card, Icon, InlineStack, Text, Tooltip } from "@shopify/polaris";
import { ArrowDownIcon, ArrowUpIcon, ImageIcon, InfoIcon } from "@shopify/polaris-icons";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from "recharts";
import { formatMoney } from "../analytics-core";

/** Display helpers shared by Insights and the per-article analytics page. */

export function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(Math.round(value || 0));
}

export function formatPercent(value: number) {
  return `${(value || 0).toFixed(1)}%`;
}

export function formatCompact(value: number) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value || 0);
}

export function formatShortDate(isoDay: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${isoDay}T00:00:00Z`));
}

export type Trend = { label: string; direction: "up" | "down" | "flat" };

export function trend(current: number, previous: number, mode: "percent" | "pp" = "percent"): Trend {
  const diff = current - previous;
  if (Math.abs(diff) < 1e-9) return { label: mode === "pp" ? "0 pp" : "0%", direction: "flat" };
  const direction = diff > 0 ? "up" : "down";
  if (mode === "pp") return { label: `${diff > 0 ? "+" : ""}${diff.toFixed(1)} pp`, direction };
  if (!previous) return { label: "New", direction };
  return { label: `${diff > 0 ? "+" : ""}${((diff / previous) * 100).toFixed(0)}%`, direction };
}

export function TrendLabel({ value }: { value: Trend }) {
  if (value.direction === "flat") return <Text as="span" variant="bodySm" tone="subdued">{value.label}</Text>;
  const tone = value.direction === "up" ? "success" : "critical";
  return (
    <InlineStack gap="025" blockAlign="center" wrap={false}>
      <Icon source={value.direction === "up" ? ArrowUpIcon : ArrowDownIcon} tone={tone} />
      <Text as="span" variant="bodySm" tone={tone}>{value.label}</Text>
    </InlineStack>
  );
}

export function KpiCard({ title, value, change, hint, spark, color = "#4B48E8" }: { title: string; value: string; change: Trend; hint?: string; spark?: number[]; color?: string }) {
  return (
    <Card padding="400">
      <BlockStack gap="100">
        <InlineStack gap="100" blockAlign="center" wrap={false}>
          <Text as="p" variant="bodySm" tone="subdued">{title}</Text>
          {hint && <Tooltip content={hint}><span style={{ display: "inline-flex" }}><Icon source={InfoIcon} tone="subdued" /></span></Tooltip>}
        </InlineStack>
        <InlineStack gap="200" blockAlign="baseline" wrap={false}>
          <Text as="p" variant="headingLg" fontWeight="bold">{value}</Text>
          <TrendLabel value={change} />
        </InlineStack>
        {spark && spark.length > 1 && (
          <div style={{ height: 36, width: "100%", marginTop: 6 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={spark.map((point) => ({ value: point }))}>
                <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </BlockStack>
    </Card>
  );
}

export type FunnelStepData = { label: string; value: number; hint?: string };

/** Each bar shows the step's share of the first step; the label shows step-to-step conversion. */
export function Funnel({ steps }: { steps: FunnelStepData[] }) {
  const top = steps.find((step) => step.value > 0)?.value || 0;
  return (
    <BlockStack gap="300">
      {steps.map((step, index) => {
        const previous = index > 0 ? steps[index - 1].value : 0;
        const width = top ? Math.max(4, Math.min(100, (step.value / top) * 100)) : 4;
        const stepRate = index > 0 && previous > 0 ? `${((step.value / previous) * 100).toFixed(1)}% of previous` : "";
        return (
          <BlockStack key={step.label} gap="050">
            <InlineStack align="space-between" blockAlign="baseline" wrap={false}>
              <InlineStack gap="100" blockAlign="center" wrap={false}>
                <Text as="span" variant="bodySm">{step.label}</Text>
                {step.hint && <Tooltip content={step.hint}><span style={{ display: "inline-flex" }}><Icon source={InfoIcon} tone="subdued" /></span></Tooltip>}
              </InlineStack>
              <InlineStack gap="200" blockAlign="baseline" wrap={false}>
                {stepRate && <Text as="span" variant="bodySm" tone="subdued">{stepRate}</Text>}
                <Text as="span" variant="bodyMd" fontWeight="bold">{formatNumber(step.value)}</Text>
              </InlineStack>
            </InlineStack>
            <div style={{ height: 22, borderRadius: 6, background: "#f4f4fb" }}>
              <div style={{ width: `${width}%`, height: 22, borderRadius: 6, background: index === steps.length - 1 ? "var(--rm-good)" : `rgba(75, 72, 232, ${Math.max(0.3, 1 - index * 0.13)})` }} />
            </div>
          </BlockStack>
        );
      })}
    </BlockStack>
  );
}

type ChartPoint = { date: string; views: number; clicks: number; addToCarts: number; purchases: number };

export function EngagementChart({ data }: { data: ChartPoint[] }) {
  const points = data.map((point) => ({ ...point, label: formatShortDate(point.date) }));
  return (
    <div style={{ height: 280 }}>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={points} margin={{ top: 5, right: 8, left: -20, bottom: 6 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#6D7175" }} dy={10} minTickGap={16} />
          <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#6D7175" }} tickFormatter={(value) => formatCompact(Number(value))} />
          <RechartsTooltip />
          <Legend verticalAlign="bottom" height={42} iconType="plainline" wrapperStyle={{ paddingTop: 8 }} />
          <Line type="monotone" dataKey="views" name="Readers" stroke="#2C6ECB" strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="clicks" name="Product clicks" stroke="#8D51D5" strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="addToCarts" name="Add to carts" stroke="#00A0AC" strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="purchases" name="Orders" stroke="#50B83C" strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Thumbnail({ source, alt }: { source?: string | null; alt: string }) {
  return (
    <span className="bp-analytics-thumbnail">
      {source ? <img src={source} alt={alt} loading="lazy" decoding="async" /> : <Icon source={ImageIcon} tone="subdued" />}
    </span>
  );
}

export function RevenueNote({ estimated, otherCurrencies, currency }: { estimated: number; otherCurrencies: Record<string, number>; currency: string }) {
  const others = Object.entries(otherCurrencies).filter(([, value]) => value > 0);
  if (!estimated && !others.length) return null;
  return (
    <Box paddingBlockStart="100">
      <BlockStack gap="050">
        {estimated > 0 && <Text as="p" variant="bodySm" tone="subdued">Includes {formatMoney(estimated, currency)} estimated from product prices for orders tracked before real order amounts were recorded.</Text>}
        {others.length > 0 && <Text as="p" variant="bodySm" tone="subdued">Also paid in other currencies (not converted): {others.map(([code, value]) => formatMoney(value, code)).join(", ")}.</Text>}
      </BlockStack>
    </Box>
  );
}

export const ANALYTICS_CSS = `
  .bp-analytics-table-scroll { max-width: 100%; overflow-x: auto; overflow-y: hidden; }
  .bp-analytics-table-scroll table { min-width: 960px; }
  .bp-analytics-post-cell { display: flex; align-items: center; gap: 12px; min-width: 240px; max-width: 320px; }
  .bp-analytics-thumbnail { width: 40px; height: 40px; flex: 0 0 40px; display: inline-flex; align-items: center; justify-content: center; overflow: hidden; border: 1px solid var(--p-color-border); border-radius: 6px; background: var(--p-color-bg-surface-secondary); }
  .bp-analytics-thumbnail img { width: 100%; height: 100%; display: block; object-fit: cover; }
  .bp-analytics-post-text { min-width: 0; display: grid; gap: 2px; }
  .bp-analytics-product-list { display: grid; gap: 12px; max-height: 360px; overflow-y: auto; padding-right: 4px; }
  .bp-analytics-product-main { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .bp-analytics-product-text { min-width: 0; display: grid; gap: 2px; }
`;
