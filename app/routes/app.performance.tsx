import { useEffect, useMemo, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData, useRevalidator } from "@remix-run/react";
import type { Prisma } from "@prisma/client";
import { Badge, Banner, BlockStack, Box, Button, Card, Divider, InlineGrid, InlineStack, Page, ProgressBar, Text } from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import performanceStyles from "../styles/performance.css?url";
import {
  discoverPerformanceTargets,
  runStorefrontPerformanceScan,
} from "../storefront-performance.server";
import {
  PERFORMANCE_PAGE_TYPES,
  type PerformancePageType,
  type PerformanceTarget,
  type StorefrontPerformanceReport,
} from "../storefront-performance";

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
  const [targets, saved] = await Promise.all([
    discoverPerformanceTargets(admin),
    prisma.storefrontPerformanceScan.findMany({ where: { shop: session.shop }, orderBy: { scannedAt: "desc" } }),
  ]);
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
    const target = targets.find((item) => item.type === pageType);
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
    return json({ success: true, queued: true, pageType }, { status: 202 });
  } catch (error) {
    console.error("Storefront performance scan failed", error instanceof Error ? error.message : String(error));
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
  const response = fetcher.data as { success?: boolean; queued?: boolean; pageType?: PerformancePageType; error?: string } | undefined;

  useEffect(() => {
    if (!response || handled.current === response) return;
    handled.current = response;
    if (response.success) shopify.toast.show(`${labelFor(response.pageType || selected)} scan started`);
    if (response.error) shopify.toast.show(response.error, { isError: true });
  }, [response, selected, shopify]);

  const savedByType = useMemo(() => new Map(initial.scans.map((scan) => [scan.pageType, scan as SavedScan])), [initial.scans]);
  const target = initial.targets.find((item) => item.type === selected) as PerformanceTarget | undefined;
  const saved = savedByType.get(selected);
  const report = saved?.report || null;
  const scannedAt = saved?.scannedAt;
  const scanning = fetcher.state !== "idle" || saved?.status === "running";
  const overall = report ? Math.round((report.seoScore + report.mobile.score + report.desktop.score) / 3) : 0;
  const scan = () => fetcher.submit({ intent: "scan", pageType: selected }, { method: "post" });

  useEffect(() => {
    if (!initial.scans.some((scan) => scan.status === "running")) return;
    const timer = window.setInterval(() => revalidator.revalidate(), 2500);
    return () => window.clearInterval(timer);
  }, [initial.scans, revalidator]);

  return <Page fullWidth>
    <TitleBar title="Storefront Performance"><button variant="primary" disabled={scanning || !target?.available} onClick={scan}>{scanning ? "Scanning..." : report ? "Recheck page" : "Run scan"}</button></TitleBar>
    <BlockStack gap="500">
      <InlineStack align="space-between" blockAlign="end">
        <BlockStack gap="100"><Text as="h1" variant="headingXl" fontWeight="bold">Storefront Performance</Text><Text as="p" tone="subdued">Compare Lighthouse SEO and speed for representative Shopify storefront pages.</Text></BlockStack>
        <Button variant="primary" loading={scanning} disabled={!target?.available} onClick={scan}>{report ? "Recheck page" : "Run scan"}</Button>
      </InlineStack>
      {!initial.hasApiKey && <Banner tone="info" title="Using shared PageSpeed quota"><p>Add GOOGLE_PAGESPEED_API_KEY on the server for reliable recurring scans. Saved reports remain available if Google temporarily limits new requests.</p></Banner>}
      {response?.error && <Banner tone="critical"><p>{response.error}</p></Banner>}
      {saved?.status === "failed" && <Banner tone="critical" title="Performance scan failed"><p>{saved.error || "The storefront could not be scanned. Please try again."}</p></Banner>}
      {saved?.status === "running" && <Banner tone="info" title="PageSpeed scan is running"><p>Mobile and desktop Lighthouse checks continue in the background. This page will update automatically.</p></Banner>}

      <div className="bp-performance-layout">
        <Box padding="400" background="bg-surface-secondary">
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Page types</Text>
            {initial.targets.map((item) => <PageTypeButton key={item.type} target={item} selected={selected === item.type} scan={savedByType.get(item.type)} onSelect={() => setSelected(item.type)} />)}
          </BlockStack>
        </Box>
        <Box padding="500">
          <BlockStack gap="500">
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="100"><Text as="h2" variant="headingLg">{target?.title || labelFor(selected)}</Text><Text as="p" variant="bodySm" tone="subdued">{target?.url || "No published page found"}</Text></BlockStack>
              {report && <Badge tone={scoreTone(overall)}>{`${overall}/100 overall`}</Badge>}
            </InlineStack>
            {!target?.available ? <Banner tone="warning" title={`${labelFor(selected)} unavailable`}><p>Publish at least one matching resource in Shopify before scanning this page type.</p></Banner> : !report ? <Card><BlockStack gap="300" inlineAlign="center"><Text as="h3" variant="headingMd">No saved report yet</Text><Text as="p" tone="subdued">Run a read-only PageSpeed scan for this storefront URL.</Text><Button variant="primary" loading={scanning} onClick={scan}>Run scan</Button></BlockStack></Card> : <>
              <ProgressBar progress={overall} tone={overall >= 90 ? "success" : overall >= 50 ? "highlight" : "critical"} size="small" />
              <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
                <ScoreCard title="SEO health" score={report.seoScore} subtitle="Lighthouse SEO" />
                <ScoreCard title="Mobile speed" score={report.mobile.score} subtitle="Simulated mobile" />
                <ScoreCard title="Desktop speed" score={report.desktop.score} subtitle="Simulated desktop" />
              </InlineGrid>
              <Text as="p" variant="bodySm" tone="subdued">Last scanned {formatDate(scannedAt)}. Scores can vary slightly between runs because Lighthouse uses a simulated test environment.</Text>
              {report.warnings.length > 0 && <Banner tone="warning" title="Scan warnings"><BlockStack gap="100">{report.warnings.map((warning) => <p key={warning}>{warning}</p>)}</BlockStack></Banner>}
              <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
                <DeviceDetails title="Mobile report" report={report.mobile} />
                <DeviceDetails title="Desktop report" report={report.desktop} />
              </InlineGrid>
              <InlineStack align="end"><Button url={`https://pagespeed.web.dev/analysis?url=${encodeURIComponent(report.url)}`} target="_blank">Open full PageSpeed report</Button></InlineStack>
            </>}
          </BlockStack>
        </Box>
      </div>
    </BlockStack>
  </Page>;
}

function PageTypeButton({ target, selected, scan, onSelect }: { target: PerformanceTarget; selected: boolean; scan?: SavedScan; onSelect: () => void }) {
  return <button type="button" onClick={onSelect} className={`bp-performance-page-button${selected ? " is-selected" : ""}`}>
    <BlockStack gap="100"><InlineStack align="space-between"><Text as="span" fontWeight="semibold">{labelFor(target.type)}</Text>{scan && <Badge tone={scoreTone(scan.seoScore)}>{String(scan.seoScore)}</Badge>}</InlineStack><Text as="span" variant="bodySm" tone="subdued">{target.available ? scan ? target.title : "Not scanned" : "Unavailable"}</Text></BlockStack>
  </button>;
}

function ScoreCard({ title, score, subtitle }: { title: string; score: number; subtitle: string }) {
  return <Card><BlockStack gap="200" inlineAlign="center"><Text as="h3" variant="headingMd">{title}</Text><div style={{ width: 112, height: 112, borderRadius: "50%", display: "grid", placeItems: "center", background: `conic-gradient(${scoreColor(score)} ${score * 3.6}deg, var(--p-color-bg-surface-secondary) 0)`, padding: 9 }}><div style={{ width: "100%", height: "100%", borderRadius: "50%", background: "var(--p-color-bg-surface)", display: "grid", placeItems: "center" }}><Text as="span" variant="heading2xl" fontWeight="bold">{score}</Text></div></div><Text as="p" variant="bodySm" tone="subdued">{subtitle}</Text></BlockStack></Card>;
}

function DeviceDetails({ title, report }: { title: string; report: StorefrontPerformanceReport["mobile"] }) {
  return <Card><BlockStack gap="300"><InlineStack align="space-between"><Text as="h3" variant="headingMd">{title}</Text><Badge tone={scoreTone(report.score)}>{`${report.score}/100`}</Badge></InlineStack><Divider /><InlineGrid columns={2} gap="200">{Object.entries(report.metrics).map(([label, value]) => <Box key={label} padding="200" background="bg-surface-secondary" borderRadius="200"><Text as="p" variant="bodySm" tone="subdued">{label}</Text><Text as="p" fontWeight="semibold">{value}</Text></Box>)}</InlineGrid><Divider /><Text as="h4" variant="headingSm">Top opportunities</Text>{report.opportunities.length ? <BlockStack gap="200">{report.opportunities.slice(0, 5).map((item) => <div key={item.id}><InlineStack align="space-between" gap="200" wrap={false}><Text as="p" variant="bodySm" fontWeight="semibold">{item.title}</Text>{item.displayValue && <Badge>{item.displayValue}</Badge>}</InlineStack>{item.description && <Text as="p" variant="bodySm" tone="subdued">{item.description}</Text>}</div>)}</BlockStack> : <Text as="p" variant="bodySm" tone="success">No major Lighthouse opportunities found.</Text>}</BlockStack></Card>;
}

function labelFor(type: PerformancePageType) {
  return ({ homepage: "Homepage", product: "Product page", collection: "Collection page", blog: "Blog page" } as const)[type];
}

function scoreTone(score: number): "success" | "warning" | "critical" {
  return score >= 90 ? "success" : score >= 50 ? "warning" : "critical";
}

function scoreColor(score: number) {
  return score >= 90 ? "#00a86b" : score >= 50 ? "#f5a623" : "#d82c0d";
}

function formatDate(value?: string) {
  if (!value) return "never";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
