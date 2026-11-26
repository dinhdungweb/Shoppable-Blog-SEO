import { useEffect, useRef, useState } from "react";
import { useFetcher, useSearchParams } from "@remix-run/react";
import {
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Divider,
  Icon,
  InlineGrid,
  InlineStack,
  Select,
  Text,
} from "@shopify/polaris";
import { ChartVerticalFilledIcon } from "@shopify/polaris-icons";
import { useAppBridge } from "@shopify/app-bridge-react";

export type SearchConsoleOpportunity = {
  id: string;
  title: string;
  detail: string;
  pageUrl: string;
  query: string;
  type: string;
  previousValue: string;
  currentValue: string;
  changeValue: string;
};

export type SearchConsoleData = {
  /** Plan includes Search Console. */
  available: boolean;
  /** Server has Google OAuth credentials. */
  configured: boolean;
  connected: boolean;
  selectedSiteUrl: string;
  availableSites: Array<{ siteUrl: string; permissionLevel: string }>;
  lastSyncedAt: string | null;
  error: string;
  summary: { clicks: number; impressions: number; ctr: number; position: number };
  opportunities: SearchConsoleOpportunity[];
};

type ActionData = { success?: boolean; error?: string; googleAction?: string; authorizationUrl?: string; syncedCount?: number };

/**
 * One Search Console card for the whole app.
 * - mode "keywords": Analytics → Keywords & decay. Shows metrics and opportunities.
 * - mode "connection": Settings → Integrations. Shows connect / property / disconnect.
 */
export function SearchConsoleCard({ data, mode, planKey }: { data: SearchConsoleData; mode: "keywords" | "connection"; planKey?: string }) {
  const fetcher = useFetcher<ActionData>();
  const shopify = useAppBridge();
  const handled = useRef<ActionData | undefined>(undefined);
  const [showAll, setShowAll] = useState(false);
  const [searchParams] = useSearchParams();
  const callbackStatus = searchParams.get("google");
  const callbackMessage = searchParams.get("message");
  const busy = fetcher.state !== "idle";
  const submit = (values: Record<string, string>) => fetcher.submit(values, { method: "post", action: "/app/search-console" });

  useEffect(() => { setShowAll(false); }, [data.selectedSiteUrl]);

  useEffect(() => {
    const result = fetcher.data;
    if (!result || handled.current === result) return;
    handled.current = result;
    if (result.googleAction === "connect" && result.authorizationUrl) {
      window.open(result.authorizationUrl, "_top");
      return;
    }
    if (result.error) shopify.toast.show(result.error, { isError: true });
    else if (result.googleAction === "synced") shopify.toast.show(`Search Console synced: ${result.syncedCount || 0} rows`);
    else if (result.googleAction) shopify.toast.show(`Search Console ${result.googleAction}`);
  }, [fetcher.data, shopify]);

  const callbackBanner = callbackStatus === "connected"
    ? <Banner tone="success" title="Google Search Console connected"><p>Select a property and sync to load keyword data.</p></Banner>
    : callbackStatus === "error"
      ? <Banner tone="critical" title="Google connection failed"><p>{callbackMessage || "Please try again."}</p></Banner>
      : null;

  if (!data.available) {
    return (
      <Banner
        tone="info"
        title="Google Search Console is a Pro feature"
        action={{ content: "Upgrade to Pro", url: `/app/pricing?reason=search_console${planKey ? `&plan=${planKey}` : ""}` }}
      >
        <p>Unlock search queries, impressions, clicks and keyword opportunities for every post.</p>
      </Banner>
    );
  }

  if (!data.configured) {
    return (
      <Banner title="Google Search Console is not configured on the server" tone="warning">
        <p>Add GOOGLE_SEARCH_CONSOLE_CLIENT_ID, GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET and SHOPIFY_APP_URL to enable real search performance data.</p>
      </Banner>
    );
  }

  const header = (
    <InlineStack align="space-between" blockAlign="center" wrap={false} gap="200">
      <InlineStack gap="200" blockAlign="center" wrap={false}>
        <Icon source={ChartVerticalFilledIcon} tone="info" />
        <BlockStack gap="050">
          <Text as="h2" variant="headingMd">Google Search Console</Text>
          <Text as="p" variant="bodySm" tone="subdued">
            {!data.connected ? "Not connected" : data.lastSyncedAt ? `Synced ${formatDate(data.lastSyncedAt)}` : "Ready to sync"}
          </Text>
        </BlockStack>
      </InlineStack>
      {data.connected && (
        <InlineStack gap="100" blockAlign="center" wrap={false}>
          <Button size="micro" loading={busy} disabled={!data.selectedSiteUrl} onClick={() => submit({ intent: "google_sync" })}>Sync now</Button>
          {mode === "connection"
            ? <Button size="micro" tone="critical" disabled={busy} onClick={() => submit({ intent: "google_disconnect" })}>Disconnect</Button>
            : <Button size="micro" variant="plain" url="/app/settings?tab=integrations">Manage</Button>}
        </InlineStack>
      )}
    </InlineStack>
  );

  if (!data.connected) {
    return (
      <Card padding="400">
        <BlockStack gap="300">
          {callbackBanner}
          {header}
          <Text as="p" tone="subdued">
            Connect Google to see the queries each post ranks for, find pages losing clicks, and give AI briefs and refreshes real keyword evidence.
          </Text>
          <InlineStack><Button variant="primary" loading={busy} onClick={() => submit({ intent: "google_connect" })}>Connect Google</Button></InlineStack>
        </BlockStack>
      </Card>
    );
  }

  const siteOptions = [
    { label: "Select a property", value: "" },
    ...data.availableSites.map((site) => ({ label: `${site.siteUrl} (${site.permissionLevel})`, value: site.siteUrl })),
  ];
  const visibleOpportunities = data.opportunities.slice(0, showAll ? data.opportunities.length : 5);

  return (
    <Card padding="400">
      <BlockStack gap="400">
        {callbackBanner}
        {header}
        {data.error && <Banner tone="critical"><p>{data.error}</p></Banner>}
        {mode === "connection" || !data.selectedSiteUrl ? (
          <Select
            label="Search Console property"
            options={siteOptions}
            value={data.selectedSiteUrl}
            disabled={busy}
            onChange={(siteUrl) => siteUrl && submit({ intent: "google_select", siteUrl })}
          />
        ) : (
          <Text as="p" variant="bodySm" tone="subdued">Property: {data.selectedSiteUrl}</Text>
        )}

        {mode === "keywords" && data.selectedSiteUrl && (
          <>
            <InlineGrid columns={{ xs: 2, md: 4 }} gap="300">
              <Metric label="Clicks (28 days)" value={data.summary.clicks.toLocaleString()} />
              <Metric label="Impressions" value={data.summary.impressions.toLocaleString()} />
              <Metric label="CTR" value={`${(data.summary.ctr * 100).toFixed(1)}%`} />
              <Metric label="Avg. position" value={data.summary.position ? data.summary.position.toFixed(1) : "—"} />
            </InlineGrid>
            <Divider />
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">Keyword opportunities</Text>
              {!data.opportunities.length ? (
                <Text as="p" variant="bodySm" tone="subdued">No opportunities yet. Sync again after Google has collected more data.</Text>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px", textAlign: "left" }}>
                    <thead>
                      <tr style={{ color: "var(--p-color-text-secondary)" }}>
                        <th style={{ padding: "0 8px 8px 0", fontWeight: 600 }}>Query / page</th>
                        <th style={{ padding: "0 8px 8px", fontWeight: 600 }}>Opportunity</th>
                        <th style={{ padding: "0 8px 8px", fontWeight: 600, whiteSpace: "nowrap" }}>Previous</th>
                        <th style={{ padding: "0 8px 8px", fontWeight: 600, whiteSpace: "nowrap" }}>Current</th>
                        <th style={{ padding: "0 8px 8px", fontWeight: 600 }}>Change</th>
                        <th aria-label="Action" />
                      </tr>
                    </thead>
                    <tbody>
                      {visibleOpportunities.map((item) => (
                        <tr key={item.id} style={{ borderTop: "1px solid var(--p-color-border-secondary)" }}>
                          <td style={{ padding: "10px 8px 10px 0", minWidth: 160 }}>
                            <Text as="span" variant="bodySm" fontWeight="semibold">{item.query || "Page total"}</Text><br />
                            <Text as="span" variant="bodySm" tone="subdued">{item.title}</Text>
                          </td>
                          <td style={{ padding: "10px 8px", minWidth: 180 }}><Text as="span" variant="bodySm">{item.detail}</Text></td>
                          <td style={{ padding: "10px 8px", whiteSpace: "nowrap" }}>{item.previousValue}</td>
                          <td style={{ padding: "10px 8px", whiteSpace: "nowrap", fontWeight: 600 }}>{item.currentValue}</td>
                          <td style={{ padding: "10px 8px", whiteSpace: "nowrap", color: item.type === "decay" ? "var(--p-color-text-critical)" : undefined }}>{item.changeValue}</td>
                          <td style={{ padding: "10px 0 10px 8px" }}><Button size="micro" url={item.pageUrl} target="_blank">Open</Button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {data.opportunities.length > 5 && (
                <InlineStack>
                  <Button variant="plain" onClick={() => setShowAll((current) => !current)}>
                    {showAll ? "Show less" : `View all opportunities (${data.opportunities.length})`}
                  </Button>
                </InlineStack>
              )}
            </BlockStack>
          </>
        )}

        {mode === "connection" && data.selectedSiteUrl && (
          <InlineStack><Button variant="plain" url="/app/content-decay">View keyword opportunities in Analytics</Button></InlineStack>
        )}
      </BlockStack>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Box background="bg-surface-secondary" padding="300" borderRadius="300">
      <BlockStack gap="050">
        <Text as="span" variant="bodySm" tone="subdued">{label}</Text>
        <Text as="span" variant="headingLg" fontWeight="bold">{value}</Text>
      </BlockStack>
    </Box>
  );
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
