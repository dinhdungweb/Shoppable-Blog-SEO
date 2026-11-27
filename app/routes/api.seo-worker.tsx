import type { ActionFunctionArgs } from "react-router";
import { json } from "../http";
import prisma from "../db.server";
import { getUnauthenticatedActivePlanName, unauthenticated } from "../shopify.server";
import { getLimitsForPlan } from "../pricing-plans";
import { runSeoScan, safeTokenEqual } from "../seo-scan.server";

/**
 * Runs one queued SEO scan for the background worker (scripts/seo-scan-worker.ts).
 * Authenticated with SEO_WORKER_SECRET; always answers plain JSON.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const suppliedToken = request.headers.get("x-seo-worker-token") || "";
  const expectedToken = process.env.SEO_WORKER_SECRET || process.env.SHOPIFY_API_SECRET || "";
  if (!expectedToken || !safeTokenEqual(suppliedToken, expectedToken)) return json({ error: "Unauthorized worker request" }, { status: 401 });
  const payload = await request.json() as { jobId?: string; shop?: string };
  const job = payload.jobId && payload.shop
    ? await prisma.seoScanJob.findFirst({ where: { id: payload.jobId, shop: payload.shop, status: "running" } })
    : null;
  if (!job) return json({ error: "Active SEO scan job not found" }, { status: 404 });
  const [{ admin }, planName] = await Promise.all([
    unauthenticated.admin(job.shop),
    getUnauthenticatedActivePlanName(job.shop),
  ]);
  const limits = getLimitsForPlan(planName);
  if (job.trigger === "schedule" && !limits.canAutoSeoScan) {
    // The merchant's choice is kept; scheduled scans resume if they upgrade again.
    return json({ scannedCount: 0, analyzedCount: 0, averageScore: 0, skipped: true });
  }
  const result = await runSeoScan({
    admin, shop: job.shop, limits,
    onProgress: async (update) => {
      const updated = await prisma.seoScanJob.updateMany({ where: { id: job.id, status: "running" }, data: { ...update, heartbeatAt: new Date() } });
      if (!updated.count) throw new Error("SEO_SCAN_CANCELLED");
    },
  });
  return json(result);
};
