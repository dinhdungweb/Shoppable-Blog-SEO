import prisma from "./db.server";

export async function purgeShopData(shop: string) {
  await prisma.$transaction([
    prisma.aiUsage.deleteMany({ where: { shop } }),
    prisma.imageSeoChange.deleteMany({ where: { shop } }),
    prisma.contentBrief.deleteMany({ where: { shop } }),
    prisma.internalLinkChange.deleteMany({ where: { shop } }),
    prisma.internalLinkAnalysis.deleteMany({ where: { shop } }),
    prisma.contentDecayAnalysis.deleteMany({ where: { shop } }),
    prisma.storefrontPerformanceScan.deleteMany({ where: { shop } }),
    prisma.seoScanJob.deleteMany({ where: { shop } }),
    prisma.analyticsDailySession.deleteMany({ where: { shop } }),
    prisma.analyticsDaily.deleteMany({ where: { shop } }),
    prisma.widgetEvent.deleteMany({ where: { shop } }),
    prisma.searchConsoleMetric.deleteMany({ where: { shop } }),
    prisma.searchConsoleOAuthState.deleteMany({ where: { shop } }),
    prisma.searchConsoleConnection.deleteMany({ where: { shop } }),
    prisma.seoBulkChange.deleteMany({ where: { shop } }),
    prisma.catalogBulkChange.deleteMany({ where: { shop } }),
    prisma.articleProduct.deleteMany({ where: { shop } }),
    prisma.resourceSEO.deleteMany({ where: { shop } }),
    prisma.articleSEO.deleteMany({ where: { shop } }),
    prisma.shopConfig.deleteMany({ where: { shop } }),
    prisma.session.deleteMany({ where: { shop } }),
  ]);
}

/**
 * On uninstall: revoke access (sessions), stop background work and mark the
 * shop as uninstalled. Settings, analytics and history are kept so a reinstall
 * restores them; everything is erased by purgeShopData on shop/redact, which
 * Shopify sends 48 hours after uninstall.
 */
export async function deactivateShop(shop: string) {
  await prisma.$transaction([
    prisma.session.deleteMany({ where: { shop } }),
    prisma.seoScanJob.updateMany({ where: { shop, status: { in: ["queued", "running"] } }, data: { status: "cancelled", phase: "App uninstalled", completedAt: new Date() } }),
    prisma.shopConfig.updateMany({ where: { shop }, data: { uninstalledAt: new Date(), planKey: "free", planCheckedAt: null } }),
  ]);
}
