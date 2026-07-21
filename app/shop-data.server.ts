import prisma from "./db.server";

export async function purgeShopData(shop: string) {
  await prisma.$transaction([
    prisma.seoScanJob.deleteMany({ where: { shop } }),
    prisma.analyticsDailySession.deleteMany({ where: { shop } }),
    prisma.analyticsDaily.deleteMany({ where: { shop } }),
    prisma.widgetEvent.deleteMany({ where: { shop } }),
    prisma.searchConsoleMetric.deleteMany({ where: { shop } }),
    prisma.searchConsoleOAuthState.deleteMany({ where: { shop } }),
    prisma.searchConsoleConnection.deleteMany({ where: { shop } }),
    prisma.seoBulkChange.deleteMany({ where: { shop } }),
    prisma.articleProduct.deleteMany({ where: { shop } }),
    prisma.articleSEO.deleteMany({ where: { shop } }),
    prisma.shopConfig.deleteMany({ where: { shop } }),
    prisma.session.deleteMany({ where: { shop } }),
  ]);
}
