import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import { authenticate, getActivePlanAndLimits } from "../shopify.server";
import type { PlanLimits } from "../pricing-plans";

/** Settings a dashboard module card may switch on/off, and the plan each needs. */
const MODULE_TOGGLES: Record<string, { field: "enableConversionTracking" | "breadcrumbsEnabled" | "tocEnabled" | "seoAutoScanEnabled"; allowed: (limits: PlanLimits) => boolean }> = {
  tracking: { field: "enableConversionTracking", allowed: () => true },
  breadcrumbs: { field: "breadcrumbsEnabled", allowed: (limits) => limits.canContentNavigation },
  toc: { field: "tocEnabled", allowed: (limits) => limits.canContentNavigation },
  "auto-scan": { field: "seoAutoScanEnabled", allowed: (limits) => limits.canAutoSeoScan },
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const form = await request.formData();
  const toggle = MODULE_TOGGLES[String(form.get("module") || "")];
  if (!toggle) return json({ error: "Unknown module." }, { status: 400 });
  const { limits } = await getActivePlanAndLimits(billing, session.shop);
  if (!toggle.allowed(limits)) return json({ error: "This module needs a higher plan." }, { status: 403 });
  const enabled = form.get("enabled") === "true";
  await prisma.shopConfig.upsert({
    where: { shop: session.shop },
    update: { [toggle.field]: enabled },
    create: { shop: session.shop, [toggle.field]: enabled },
  });
  return json({ success: true, module: String(form.get("module")), enabled });
};
