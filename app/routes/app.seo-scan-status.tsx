import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const job = await prisma.seoScanJob.findFirst({ where: { shop: session.shop }, orderBy: { requestedAt: "desc" } });
  return json({
    job: job ? {
      id: job.id, status: job.status, phase: job.phase, progress: job.progress,
      totalPosts: job.totalPosts, processedPosts: job.processedPosts, analyzedPosts: job.analyzedPosts,
      averageScore: job.averageScore, error: job.error,
      requestedAt: job.requestedAt.toISOString(), completedAt: job.completedAt?.toISOString() || null,
    } : null,
  });
};
