import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate, getActivePlanAndLimits } from "../shopify.server";
import { loadAnalyticsReport, resolveRange } from "../analytics.server";
import { toCsv } from "../analytics-insights";

/** CSV of every post's funnel for the selected range (resource route). */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session, billing } = await authenticate.admin(request);
  const { limits } = await getActivePlanAndLimits(billing, session.shop);
  const days = resolveRange(new URL(request.url).searchParams.get("range"), limits.analyticsWindowDays);
  const report = await loadAnalyticsReport({ admin, shop: session.shop, days });
  const currency = report.currency;

  const rows: Array<Array<string | number>> = [
    [
      "Post", "Blog", "Article ID", "Linked products", "Readers", "Readers who saw products", "Product visibility %", "Product impressions", "Product clicks",
      "Product CTR %", "Add to carts", "Orders", "Units", `Revenue (${currency})`, `Estimated part (${currency})`,
      `Revenue per 1,000 readers (${currency})`, "Conversion % (orders per reader)", "Google clicks", "Google impressions", "SEO score",
    ],
    ...report.posts.map((post) => [
      post.title, post.blogTitle, post.id, post.productCount, post.metrics.views, post.metrics.seen,
      post.kpis.productVisibility, post.metrics.impressions, post.metrics.clicks, post.kpis.productCtr, post.metrics.addToCarts, post.metrics.purchases,
      post.metrics.units, post.metrics.revenue, post.metrics.estimatedRevenue, post.kpis.revenuePerThousandReaders,
      post.kpis.conversionRate, post.google?.clicks ?? "", post.google?.impressions ?? "", post.seoScore ?? "",
    ]),
  ];

  // The BOM makes Excel read UTF-8 (accented titles) correctly.
  return new Response(`﻿${toCsv(rows)}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="blog-insights-${report.range.start}-to-${report.range.end}.csv"`,
      "Cache-Control": "no-store",
    },
  });
};
