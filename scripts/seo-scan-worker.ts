import "dotenv/config";
import prisma from "../app/db.server";
import { resolveSeoWorkerUrl } from "../app/seo-worker-url";

const POLL_INTERVAL_MS = 2_000;
const STALE_AFTER_MS = 15 * 60 * 1_000;
const SCHEDULE_CHECK_MS = 60 * 60 * 1_000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1_000;
const APP_READY_RETRY_DELAYS_MS = [2_000, 4_000, 8_000, 15_000, 30_000];
const LOOP_ERROR_DELAY_MS = 5_000;
let stopping = false;
let lastScheduleCheck = 0;

process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

async function recoverStaleJobs(recoverAllRunning = false) {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS);
  await prisma.seoScanJob.updateMany({
    where: recoverAllRunning
      ? { status: "running" }
      : { status: "running", OR: [{ heartbeatAt: { lt: cutoff } }, { heartbeatAt: null, startedAt: { lt: cutoff } }] },
    data: { status: "queued", phase: "Recovered after worker restart", progress: 0, startedAt: null, heartbeatAt: null },
  });
}

async function claimNextJob() {
  return prisma.$transaction(async (tx) => {
    const queued = await tx.seoScanJob.findFirst({ where: { status: "queued" }, orderBy: { requestedAt: "asc" } });
    if (!queued) return null;
    const claimed = await tx.seoScanJob.updateMany({
      where: { id: queued.id, status: "queued" },
      data: { status: "running", phase: "Starting scan", progress: 1, startedAt: new Date(), heartbeatAt: new Date(), error: null },
    });
    return claimed.count === 1 ? queued : null;
  });
}

async function enqueueScheduledJobs() {
  const configs = await prisma.shopConfig.findMany({ where: { seoAutoScanEnabled: true }, select: { shop: true } });
  const cutoff = new Date(Date.now() - WEEK_MS);
  for (const config of configs) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${config.shop}))`;
      const recent = await tx.seoScanJob.findFirst({
        where: { shop: config.shop, OR: [{ status: { in: ["queued", "running"] } }, { requestedAt: { gte: cutoff } }] },
      });
      if (!recent) await tx.seoScanJob.create({ data: { shop: config.shop, trigger: "schedule", phase: "Weekly scan queued" } });
    });
  }
}

async function processJob(job: { id: string; shop: string }) {
  try {
    const workerUrl = resolveSeoWorkerUrl(process.env);
    const payload = await requestScanWhenAppIsReady(workerUrl, job);
    await prisma.seoScanJob.update({
      where: { id: job.id },
      data: {
        status: "completed", phase: "Scan complete", progress: 100,
        totalPosts: payload.scannedCount || 0, processedPosts: payload.scannedCount || 0,
        analyzedPosts: payload.analyzedCount || 0, averageScore: payload.averageScore || 0,
        completedAt: new Date(), heartbeatAt: new Date(), error: null,
      },
    });
  } catch (error) {
    const current = await prisma.seoScanJob.findUnique({ where: { id: job.id }, select: { status: true } });
    if (!current || current.status === "cancelled") return;
    const message = error instanceof Error ? error.message : "SEO scan failed";
    console.error("SEO scan worker failed", { jobId: job.id, shop: job.shop, error });
    await prisma.seoScanJob.update({
      where: { id: job.id },
      data: { status: "failed", phase: "Scan failed", error: message.slice(0, 2000), completedAt: new Date(), heartbeatAt: new Date() },
    });
  }
}

type ScanPayload = { scannedCount?: number; analyzedCount?: number; averageScore?: number; error?: string };

async function requestScanWhenAppIsReady(workerUrl: string, job: { id: string; shop: string }): Promise<ScanPayload> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetch(workerUrl, {
        method: "POST",
        headers: { "content-type": "application/json", "x-seo-worker-token": process.env.SEO_WORKER_SECRET || process.env.SHOPIFY_API_SECRET || "" },
        body: JSON.stringify({ jobId: job.id, shop: job.shop }),
      });
      const responseBody = await response.text();
      let payload: ScanPayload;
      try {
        payload = JSON.parse(responseBody) as ScanPayload;
      } catch {
        if (attempt < APP_READY_RETRY_DELAYS_MS.length) {
          await waitForApp(job.id, attempt);
          continue;
        }
        throw new Error(`SEO worker endpoint ${workerUrl} returned ${response.status} ${response.headers.get("content-type") || "unknown content type"} instead of JSON`);
      }
      if (response.ok) return payload;
      if (isTemporaryAppResponse(response.status) && attempt < APP_READY_RETRY_DELAYS_MS.length) {
        await waitForApp(job.id, attempt);
        continue;
      }
      throw new Error(payload.error || `SEO worker endpoint returned ${response.status}`);
    } catch (error) {
      if (!isTemporaryConnectionError(error) || attempt >= APP_READY_RETRY_DELAYS_MS.length) throw error;
      await waitForApp(job.id, attempt);
    }
  }
}

async function waitForApp(jobId: string, attempt: number) {
  const delay = APP_READY_RETRY_DELAYS_MS[attempt];
  const updated = await prisma.seoScanJob.updateMany({
    where: { id: jobId, status: "running" },
    data: { phase: "Waiting for app to become ready", heartbeatAt: new Date() },
  });
  if (!updated.count) throw new Error("SEO_SCAN_CANCELLED");
  await sleep(delay);
}

function isTemporaryAppResponse(status: number) {
  return [408, 425, 429, 502, 503, 504].includes(status);
}

function isTemporaryConnectionError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return error instanceof TypeError || /fetch failed|ECONNREFUSED|ECONNRESET|socket|network/i.test(error.message);
}

async function main() {
  await recoverStaleJobs(true);
  console.info("SEO scan worker started");
  while (!stopping) {
    try {
      if (Date.now() - lastScheduleCheck >= SCHEDULE_CHECK_MS) {
        await enqueueScheduledJobs();
        lastScheduleCheck = Date.now();
      }
      const job = await claimNextJob();
      if (job) await processJob(job);
      else await sleep(POLL_INTERVAL_MS);
    } catch (error) {
      console.error("SEO scan worker loop failed; retrying", error);
      await sleep(LOOP_ERROR_DELAY_MS);
    }
  }
}

function sleep(delayMs: number) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
