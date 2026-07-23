import { useEffect, useMemo, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData, useRevalidator } from "@remix-run/react";
import type { Prisma } from "@prisma/client";
import { Badge, Banner, BlockStack, Box, Button, Card, Divider, Icon, InlineGrid, InlineStack, Page, Text, TextField } from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { AlertTriangleIcon, AppsIcon, ChartVerticalIcon, CheckCircleIcon, ChevronDownIcon, CodeIcon, DesktopIcon, GaugeIcon, HomeIcon, ImageIcon, MobileIcon, SearchIcon } from "@shopify/polaris-icons";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import performanceStyles from "../styles/performance.css?url";
import {
  discoverPerformanceTargets,
  resolveCustomPerformanceUrl,
  runStorefrontPerformanceScan,
} from "../storefront-performance.server";
import {
  PERFORMANCE_PAGE_TYPES,
  type PerformancePageType,
  type PerformanceTarget,
  type StorefrontPerformanceReport,
} from "../storefront-performance";
import {
  INSIGHTS_WORKSPACE_TABS,
  WorkspaceTabs,
} from "../components/WorkspaceTabs";

export const links = () => [{ rel: "stylesheet", href: performanceStyles }];

type SavedScan = {
  pageType: string;
  pageTitle: string;
  pageUrl: string;
  seoScore: number;
  mobileScore: number;
  desktopScore: number;
  scannedAt: string;
  report: StorefrontPerformanceReport | null;
  status: string;
  error: string | null;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const [discovered, saved] = await Promise.all([
    discoverPerformanceTargets(admin),
    prisma.storefrontPerformanceScan.findMany({ where: { shop: session.shop }, orderBy: { scannedAt: "desc" } }),
  ]);
  const savedOther = saved.find((scan) => scan.pageType === "other");
  const targets = discovered.map((target) => target.type === "other" && savedOther
    ? { ...target, url: savedOther.pageUrl, available: true }
    : target);
  return json({
    targets,
    scans: saved.map((scan) => ({
      pageType: scan.pageType,
      pageTitle: scan.pageTitle,
      pageUrl: scan.pageUrl,
      seoScore: scan.seoScore,
      mobileScore: scan.mobileScore,
      desktopScore: scan.desktopScore,
      scannedAt: scan.scannedAt?.toISOString() || "",
      report: scan.report as unknown as StorefrontPerformanceReport,
      status: scan.status,
      error: scan.error,
    })),
    hasApiKey: Boolean(process.env.GOOGLE_PAGESPEED_API_KEY),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  if (String(formData.get("intent") || "") !== "scan") return json({ error: "Unsupported action." }, { status: 400 });
  const pageType = String(formData.get("pageType") || "") as PerformancePageType;
  if (!PERFORMANCE_PAGE_TYPES.includes(pageType)) return json({ error: "Choose a valid Shopify page type." }, { status: 400 });

  try {
    // Resolve the URL again on the server. Never trust a client-provided scan URL.
    const targets = await discoverPerformanceTargets(admin);
    const homepage = targets.find((item) => item.type === "homepage");
    const target = pageType === "other" && homepage?.url
      ? { type: "other" as const, title: "Other page", url: resolveCustomPerformanceUrl(String(formData.get("customUrl") || ""), homepage.url), available: true }
      : targets.find((item) => item.type === pageType);
    if (!target?.available) return json({ error: `No published ${labelFor(pageType).toLowerCase()} is available to scan.` }, { status: 404 });
    const existing = await prisma.storefrontPerformanceScan.findUnique({ where: { shop_pageType: { shop: session.shop, pageType } }, select: { status: true, updatedAt: true } });
    const stillRunning = existing?.status === "running" && Date.now() - existing.updatedAt.getTime() < 3 * 60 * 1000;
    if (stillRunning) return json({ success: true, queued: true, pageType }, { status: 202 });
    await prisma.storefrontPerformanceScan.upsert({
      where: { shop_pageType: { shop: session.shop, pageType } },
      update: {
        pageTitle: target.title, pageUrl: target.url, status: "running", error: null,
      },
      create: {
        shop: session.shop, pageType, pageTitle: target.title, pageUrl: target.url,
        status: "running",
      },
    });
    void completePerformanceScan(session.shop, pageType, target);
    return json({ success: true, queued: true, pageType, pageUrl: target.url }, { status: 202 });
  } catch (error) {
    console.error("Storefront performance scan failed", error instanceof Error ? error.message : String(error));
    if (error instanceof Error && /Shopify storefront domain/.test(error.message)) {
      return json({ error: error.message }, { status: 400 });
    }
    const message = error instanceof Error && /quota|api key|daily limit/i.test(error.message)
      ? "Google PageSpeed quota is unavailable. Configure GOOGLE_PAGESPEED_API_KEY or try again later."
      : "The storefront could not be scanned. Confirm it is public and try again.";
    return json({ error: message }, { status: 502 });
  }
};

async function completePerformanceScan(shop: string, pageType: PerformancePageType, target: PerformanceTarget) {
  try {
    const report = await runStorefrontPerformanceScan(target.url);
    await prisma.storefrontPerformanceScan.update({
      where: { shop_pageType: { shop, pageType } },
      data: {
        pageTitle: target.title,
        pageUrl: target.url,
        seoScore: report.seoScore,
        mobileScore: report.mobile.score,
        desktopScore: report.desktop.score,
        report: report as unknown as Prisma.InputJsonValue,
        scannedAt: new Date(),
        status: "completed",
        error: null,
      },
    });
  } catch (error) {
    console.error("Background storefront performance scan failed", error instanceof Error ? error.message : String(error));
    await prisma.storefrontPerformanceScan.update({
      where: { shop_pageType: { shop, pageType } },
      data: { status: "failed", error: performanceErrorMessage(error) },
    }).catch(() => undefined);
  }
}

function performanceErrorMessage(error: unknown) {
  return error instanceof Error && /quota|api key|daily limit/i.test(error.message)
    ? "Google PageSpeed quota is unavailable. Configure GOOGLE_PAGESPEED_API_KEY or try again later."
    : "The storefront could not be scanned. Confirm it is public and try again.";
}

export default function PerformancePage() {
  const initial = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const shopify = useAppBridge();
  const handled = useRef<unknown>(null);
  const [selected, setSelected] = useState<PerformancePageType>(() => {
    const firstSaved = initial.scans[0]?.pageType as PerformancePageType | undefined;
    return firstSaved && PERFORMANCE_PAGE_TYPES.includes(firstSaved) ? firstSaved : "homepage";
  });
  const [customUrl, setCustomUrl] = useState(() => initial.targets.find((item) => item.type === "other")?.url || "");
  const [device, setDevice] = useState<"mobile" | "desktop">("mobile");
  const response = fetcher.data as { success?: boolean; queued?: boolean; pageType?: PerformancePageType; pageUrl?: string; error?: string } | undefined;

  useEffect(() => {
    if (!response || handled.current === response) return;
    handled.current = response;
    if (response.success) {
      if (response.pageType === "other" && response.pageUrl) setCustomUrl(response.pageUrl);
      shopify.toast.show(`${labelFor(response.pageType || selected)} scan started`);
    }
    if (response.error) shopify.toast.show(response.error, { isError: true });
  }, [response, selected, shopify]);

  const savedByType = useMemo(() => new Map(initial.scans.map((scan) => [scan.pageType, scan as SavedScan])), [initial.scans]);
  const baseTarget = initial.targets.find((item) => item.type === selected) as PerformanceTarget | undefined;
  const target = selected === "other" ? { type: "other" as const, title: "Other page", url: customUrl.trim(), available: Boolean(customUrl.trim()) } : baseTarget;
  const storedScan = savedByType.get(selected);
  const saved = selected === "other" && storedScan?.pageUrl !== customUrl.trim() ? undefined : storedScan;
  const report = saved?.report || null;
  const scannedAt = saved?.scannedAt;
  const scanning = fetcher.state !== "idle" || saved?.status === "running";
  const activeDevice = report ? normalizeDeviceReport(report[device], report.seoScore) : null;
  const overall = activeDevice ? Math.round(Object.values(activeDevice.categories).reduce((sum, value) => sum + value, 0) / 4) : 0;
  const scan = () => fetcher.submit({ intent: "scan", pageType: selected, customUrl: selected === "other" ? customUrl : "" }, { method: "post" });

  useEffect(() => {
    if (!initial.scans.some((scan) => scan.status === "running")) return;
    const timer = window.setInterval(() => revalidator.revalidate(), 2500);
    return () => window.clearInterval(timer);
  }, [initial.scans, revalidator]);

  return <Page fullWidth>
    <TitleBar title="Site Speed"><button variant="primary" disabled={scanning || !target?.available} onClick={scan}>{scanning ? "Scanning..." : report ? "Recheck page" : "Run scan"}</button></TitleBar>
    <BlockStack gap="500">
      <WorkspaceTabs tabs={INSIGHTS_WORKSPACE_TABS} activeId="site-speed" />
      <div className="bp-performance-hero"><InlineStack align="space-between" blockAlign="center" gap="400"><InlineStack gap="300" blockAlign="center"><div className="bp-performance-hero-icon"><Icon source={GaugeIcon} tone="base" /></div><BlockStack gap="100"><Text as="h1" variant="headingXl" fontWeight="bold">Site Speed</Text><Text as="p" tone="subdued">Lighthouse and real-user Core Web Vitals for your Shopify storefront.</Text></BlockStack></InlineStack>
        <Button variant="primary" loading={scanning} disabled={!target?.available} onClick={scan}>{report ? "Recheck page" : "Run scan"}</Button>
      </InlineStack></div>
      {!initial.hasApiKey && <Banner tone="info" title="Using shared PageSpeed quota"><p>Add GOOGLE_PAGESPEED_API_KEY on the server for reliable recurring scans. Saved reports remain available if Google temporarily limits new requests.</p></Banner>}
      {response?.error && <Banner tone="critical"><p>{response.error}</p></Banner>}
      {saved?.status === "failed" && <Banner tone="critical" title="Performance scan failed"><p>{saved.error || "The storefront could not be scanned. Please try again."}</p></Banner>}
      {saved?.status === "running" && <Banner tone="info" title="PageSpeed scan is running"><p>Mobile and desktop Lighthouse checks continue in the background. This page will update automatically.</p></Banner>}

      <div className="bp-performance-layout">
        <Box padding="400" background="bg-surface-secondary">
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Page types</Text>
            {initial.targets.map((item) => {
              const displayTarget = item.type === "other" ? { ...item, url: customUrl.trim(), available: Boolean(customUrl.trim()) } : item;
              const itemScan = savedByType.get(item.type);
              const matchingScan = item.type === "other" && itemScan?.pageUrl !== customUrl.trim() ? undefined : itemScan;
              return <PageTypeButton key={item.type} target={displayTarget} selected={selected === item.type} scan={matchingScan} onSelect={() => setSelected(item.type)} />;
            })}
          </BlockStack>
        </Box>
        <Box padding="500">
          <BlockStack gap="500">
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="100"><Text as="h2" variant="headingLg">{target?.title || labelFor(selected)}</Text><Text as="p" variant="bodySm" tone="subdued">{target?.url || "No published page found"}</Text></BlockStack>
              {report && <Badge tone={scoreTone(overall)}>{`${overall}/100 overall`}</Badge>}
            </InlineStack>
            {selected === "other" && <Card><BlockStack gap="200"><Text as="h3" variant="headingMd">Page URL</Text><TextField label="Shopify storefront URL" labelHidden value={customUrl} onChange={setCustomUrl} placeholder="https://your-store.com/products/example" autoComplete="off" helpText="Enter any product, collection, article or Shopify page URL on this storefront." /></BlockStack></Card>}
            {!target?.available ? <Banner tone="warning" title={`${labelFor(selected)} unavailable`}><p>Publish at least one matching resource in Shopify before scanning this page type.</p></Banner> : !report || !activeDevice ? <Card><BlockStack gap="300" inlineAlign="center"><Text as="h3" variant="headingMd">No saved report yet</Text><Text as="p" tone="subdued">Run a read-only PageSpeed scan for this storefront URL.</Text><Button variant="primary" loading={scanning} onClick={scan}>Run scan</Button></BlockStack></Card> : <>
              <div className="bp-device-tabs" role="tablist" aria-label="Report device"><button type="button" className={device === "mobile" ? "is-active" : ""} onClick={() => setDevice("mobile")}><Icon source={MobileIcon} /> Mobile</button><button type="button" className={device === "desktop" ? "is-active" : ""} onClick={() => setDevice("desktop")}><Icon source={DesktopIcon} /> Desktop</button></div>
              <InlineGrid columns={{ xs: 2, md: 4 }} gap="300">
                <ScoreCard title="Performance" score={activeDevice.categories.performance} icon={GaugeIcon} />
                <ScoreCard title="Accessibility" score={activeDevice.categories.accessibility} icon={AppsIcon} />
                <ScoreCard title="Best practices" score={activeDevice.categories.bestPractices} icon={CheckCircleIcon} />
                <ScoreCard title="SEO" score={activeDevice.categories.seo} icon={SearchIcon} />
              </InlineGrid>
              <Text as="p" variant="bodySm" tone="subdued">Captured {formatDate(activeDevice.fetchTime || scannedAt)} with Lighthouse {activeDevice.lighthouseVersion || "PageSpeed"}. Lab scores can vary between runs.</Text>
              {report.warnings.length > 0 && <Banner tone="warning" title="Scan warnings"><BlockStack gap="100">{report.warnings.map((warning) => <p key={warning}>{warning}</p>)}</BlockStack></Banner>}
              <FieldDataCard fieldData={activeDevice.fieldData} />
              <LabDataCard report={activeDevice} device={device} />
              <AuditReport audits={activeDevice.opportunities} passed={activeDevice.passedAudits} />
              <InlineStack align="end"><Button url={`https://pagespeed.web.dev/analysis?url=${encodeURIComponent(report.url)}`} target="_blank">Open full PageSpeed report</Button></InlineStack>
            </>}
          </BlockStack>
        </Box>
      </div>
    </BlockStack>
  </Page>;
}

function PageTypeButton({ target, selected, scan, onSelect }: { target: PerformanceTarget; selected: boolean; scan?: SavedScan; onSelect: () => void }) {
  const PageIcon = ({ homepage: HomeIcon, other: SearchIcon } as const)[target.type];
  return <button type="button" onClick={onSelect} className={`bp-performance-page-button${selected ? " is-selected" : ""}`}>
    <InlineStack gap="200" blockAlign="center" wrap={false}><span className="bp-page-type-icon"><Icon source={PageIcon} /></span><div className="bp-page-type-copy"><BlockStack gap="100"><InlineStack align="space-between"><Text as="span" fontWeight="semibold">{labelFor(target.type)}</Text>{scan?.report && <Badge tone={scoreTone(scan.seoScore)}>{String(scan.seoScore)}</Badge>}</InlineStack><Text as="span" variant="bodySm" tone="subdued">{target.available ? scan ? target.title : "Not scanned" : "Unavailable"}</Text></BlockStack></div></InlineStack>
  </button>;
}

function ScoreCard({ title, score, icon }: { title: string; score: number; icon: React.FunctionComponent<React.SVGProps<SVGSVGElement>> }) {
  return <div className="bp-score-card"><div className="bp-score-card-heading"><Icon source={icon} /><Text as="h3" variant="bodyMd" fontWeight="semibold">{title}</Text></div><div className="bp-score-ring" style={{ background: `conic-gradient(${scoreColor(score)} ${score * 3.6}deg, var(--p-color-bg-surface-secondary) 0)` }}><div><Text as="span" variant="heading2xl" fontWeight="bold">{score}</Text></div></div><span className={`bp-score-label ${scoreClass(score)}`}>{score >= 90 ? "Good" : score >= 50 ? "Needs improvement" : "Poor"}</span></div>;
}

function FieldDataCard({ fieldData }: { fieldData: StorefrontPerformanceReport["mobile"]["fieldData"] }) {
  return <Card><BlockStack gap="400"><InlineStack align="space-between" blockAlign="center"><InlineStack gap="200" blockAlign="center"><span className="bp-section-icon is-blue"><Icon source={ChartIcon} /></span><BlockStack gap="050"><Text as="h3" variant="headingMd">Real-user experience</Text><Text as="p" variant="bodySm" tone="subdued">Chrome UX Report · latest 28-day collection period</Text></BlockStack></InlineStack>{fieldData.available && <Badge tone={fieldData.assessment === "passed" ? "success" : fieldData.assessment === "failed" ? "critical" : "info"}>{fieldData.assessment === "passed" ? "Core Web Vitals passed" : fieldData.assessment === "failed" ? "Core Web Vitals failed" : "Limited data"}</Badge>}</InlineStack>{!fieldData.available ? <Banner tone="info"><p>Chrome does not have enough real-user samples for this page or origin yet. Lighthouse lab data is still available below.</p></Banner> : <><Text as="p" variant="bodySm" tone="subdued">Showing data for {fieldData.scope === "url" ? "this URL" : "the storefront origin"}.</Text><div className="bp-field-metrics">{fieldData.metrics.map((metric) => <div className="bp-field-metric" key={metric.label}><span className={`bp-metric-dot ${metric.rating}`} /><Text as="p" fontWeight="semibold">{metric.label}</Text><Text as="p" variant="headingLg" fontWeight="bold">{metric.value}</Text><div className={`bp-metric-track ${metric.rating}`}><span /></div></div>)}</div></>}</BlockStack></Card>;
}

const ChartIcon = ChartVerticalIcon;

function LabDataCard({ report, device }: { report: ReturnType<typeof normalizeDeviceReport>; device: "mobile" | "desktop" }) {
  return <Card><BlockStack gap="400"><InlineStack align="space-between" blockAlign="center"><InlineStack gap="200" blockAlign="center"><span className="bp-section-icon is-purple"><Icon source={GaugeIcon} /></span><BlockStack gap="050"><Text as="h3" variant="headingMd">Diagnose performance issues</Text><Text as="p" variant="bodySm" tone="subdued">Emulated {device} test powered by Lighthouse</Text></BlockStack></InlineStack><Badge tone={scoreTone(report.categories.performance)}>{`${report.categories.performance}/100`}</Badge></InlineStack><div className="bp-lab-layout"><div className="bp-lab-score"><ScoreCard title="Performance" score={report.categories.performance} icon={GaugeIcon} /></div>{report.screenshot ? <div className="bp-page-screenshot"><img src={report.screenshot} alt={`Final ${device} screenshot of the tested storefront page`} /></div> : <div className="bp-page-screenshot is-empty"><Icon source={ImageIcon} /><Text as="p" tone="subdued">Screenshot unavailable</Text></div>}</div><Divider /><div className="bp-lab-metrics">{Object.entries(report.metrics).map(([label, value]) => <div className="bp-lab-metric" key={label}><span className="bp-metric-status" /><BlockStack gap="050"><Text as="p" variant="bodySm" tone="subdued">{metricName(label)}</Text><Text as="p" variant="headingLg" fontWeight="bold">{value}</Text></BlockStack></div>)}</div></BlockStack></Card>;
}

function AuditReport({ audits, passed }: { audits: StorefrontPerformanceReport["mobile"]["opportunities"]; passed: StorefrontPerformanceReport["mobile"]["passedAudits"] }) {
  const categories = ["All", ...new Set(audits.map((audit) => audit.category.split(",")[0]))];
  const [category, setCategory] = useState("All");
  const [showPassed, setShowPassed] = useState(false);
  const visible = category === "All" ? audits : audits.filter((audit) => audit.category.includes(category));
  const grouped = groupAudits(visible);
  return <Card padding="0"><Box padding="400"><BlockStack gap="300"><InlineStack align="space-between" blockAlign="center"><InlineStack gap="200" blockAlign="center"><span className="bp-section-icon is-orange"><Icon source={CodeIcon} /></span><BlockStack gap="050"><Text as="h3" variant="headingMd">Lighthouse audits</Text><Text as="p" variant="bodySm" tone="subdued">Review opportunities and diagnostics, then verify changes with a new scan.</Text></BlockStack></InlineStack><Badge tone={visible.length ? "warning" : "success"}>{`${visible.length} to review`}</Badge></InlineStack><div className="bp-audit-filters">{categories.map((item) => <button type="button" key={item} className={category === item ? "is-active" : ""} onClick={() => setCategory(item)}>{item}</button>)}</div></BlockStack></Box><Divider />{visible.length ? Object.entries(grouped).map(([group, items]) => <div className="bp-audit-group" key={group}><Box paddingBlockStart="300" paddingInlineStart="400" paddingInlineEnd="400"><Text as="h4" variant="headingSm">{group}</Text></Box>{items.map((audit) => <AuditRow key={audit.id} audit={audit} />)}</div>) : <Box padding="500"><InlineStack gap="200" align="center"><Icon source={CheckCircleIcon} tone="success" /><Text as="p" tone="success">No audits need attention in this category.</Text></InlineStack></Box>}<Divider /><Box padding="300"><button type="button" className="bp-passed-toggle" onClick={() => setShowPassed((value) => !value)}><span className="bp-passed-icon"><Icon source={CheckCircleIcon} tone="success" /></span> Passed audits ({passed.length}) <span>{showPassed ? "Hide" : "Show"}</span></button>{showPassed && <div className="bp-passed-grid">{passed.map((audit) => <div key={audit.id}><span className="bp-passed-icon"><Icon source={CheckCircleIcon} tone="success" /></span><Text as="span" variant="bodySm">{audit.title}</Text></div>)}</div>}</Box></Card>;
}

function AuditRow({ audit }: { audit: StorefrontPerformanceReport["mobile"]["opportunities"][number] }) {
  return <details className="bp-audit-row"><summary><span className="bp-audit-status"><Icon source={audit.score !== null && audit.score < 0.5 ? AlertTriangleIcon : CodeIcon} tone={audit.score !== null && audit.score < 0.5 ? "critical" : "caution"} /></span><span className="bp-audit-title">{audit.title}</span><span className="bp-audit-value">{audit.displayValue || ""}</span><span className="bp-audit-chevron"><Icon source={ChevronDownIcon} /></span></summary><div className="bp-audit-content"><Text as="p" variant="bodySm" tone="subdued">{audit.description || "Review this Lighthouse finding on the tested storefront page."}</Text>{audit.details.length > 0 && <ul>{audit.details.map((detail, index) => <li key={`${audit.id}-${index}`}>{detail}</li>)}</ul>}<Badge>{audit.category}</Badge></div></details>;
}

function groupAudits(audits: StorefrontPerformanceReport["mobile"]["opportunities"]) {
  return audits.reduce<Record<string, typeof audits>>((groups, audit) => {
    const group = !audit.group || audit.group.toLowerCase() === "hidden" ? audit.category.split(",")[0] || "Other audits" : audit.group;
    (groups[group] ||= []).push(audit);
    return groups;
  }, {});
}

function normalizeDeviceReport(report: StorefrontPerformanceReport["mobile"], fallbackSeo: number) {
  return {
    ...report,
    categories: report.categories || { performance: report.score || 0, accessibility: 0, bestPractices: 0, seo: fallbackSeo || 0 },
    opportunities: (report.opportunities || []).map(normalizeAudit),
    passedAudits: (report.passedAudits || []).map(normalizeAudit),
    fieldData: report.fieldData || { available: false, scope: "none" as const, assessment: "unknown" as const, metrics: [] },
    screenshot: report.screenshot || "",
    lighthouseVersion: report.lighthouseVersion || "",
    fetchTime: report.fetchTime || "",
  };
}

function normalizeAudit(audit: StorefrontPerformanceReport["mobile"]["opportunities"][number]) {
  return {
    ...audit,
    category: audit.category || "Performance",
    group: audit.group || "Opportunities",
    details: audit.details || [],
  };
}

function metricName(label: string) {
  return ({ FCP: "First Contentful Paint", LCP: "Largest Contentful Paint", TBT: "Total Blocking Time", CLS: "Cumulative Layout Shift", "Speed Index": "Speed Index" } as Record<string, string>)[label] || label;
}

function labelFor(type: PerformancePageType) {
  return ({ homepage: "Homepage", other: "Other page" } as const)[type];
}

function scoreTone(score: number): "success" | "warning" | "critical" {
  return score >= 90 ? "success" : score >= 50 ? "warning" : "critical";
}

function scoreColor(score: number) {
  return score >= 90 ? "#00a86b" : score >= 50 ? "#f5a623" : "#d82c0d";
}

function scoreClass(score: number) {
  return score >= 90 ? "good" : score >= 50 ? "needs-improvement" : "poor";
}

function formatDate(value?: string) {
  if (!value) return "never";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
