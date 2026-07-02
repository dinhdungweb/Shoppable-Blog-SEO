import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import { CONTENT_NAV_DEFAULTS, normalizeContentNavConfig } from "../content-navigation";
import { getLimitsForPlan } from "../pricing-plans";
import { getUnauthenticatedActivePlanName } from "../shopify.server";

const CONTENT_NAV_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=60",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop") || request.headers.get("x-shopify-shop-domain");

  if (!shop) {
    return json({ error: "Missing shop parameter" }, { status: 400, headers: CONTENT_NAV_HEADERS });
  }

  const config = await prisma.shopConfig.findUnique({
    where: { shop },
    select: {
      appStatus: true,
      breadcrumbsEnabled: true,
      breadcrumbsStyle: true,
      breadcrumbsShowHome: true,
      breadcrumbsHomeLabel: true,
      breadcrumbsShowBlog: true,
      breadcrumbsCurrentClickable: true,
      breadcrumbsSeparator: true,
      tocEnabled: true,
      tocAutoInsertEnabled: true,
      tocAutoInsertPosition: true,
      tocTitle: true,
      tocLevels: true,
      tocStyle: true,
      tocLayout: true,
      tocNumbering: true,
      tocSmoothScroll: true,
      tocMobileCollapsed: true,
      tocStickyOffset: true,
      contentNavPrimaryColor: true,
      contentNavCustomCss: true,
    },
  });

  const normalizedConfig = normalizeContentNavConfig(config || CONTENT_NAV_DEFAULTS);
  const activePlanName = await getUnauthenticatedActivePlanName(shop);
  const limits = getLimitsForPlan(activePlanName);

  if (!limits.canContentNavigation) {
    normalizedConfig.breadcrumbsEnabled = false;
    normalizedConfig.tocEnabled = false;
    normalizedConfig.tocAutoInsertEnabled = false;
    normalizedConfig.contentNavCustomCss = "";
  } else if (!limits.canCustomCss) {
    normalizedConfig.contentNavCustomCss = "";
  }

  return json(
    {
      config: normalizedConfig,
    },
    { headers: CONTENT_NAV_HEADERS },
  );
};
