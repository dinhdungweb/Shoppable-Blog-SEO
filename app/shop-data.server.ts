import prisma from "./db.server";

export async function purgeShopData(shop: string) {
  await prisma.$transaction([
    prisma.widgetEvent.deleteMany({ where: { shop } }),
    prisma.articleProduct.deleteMany({ where: { shop } }),
    prisma.articleSEO.deleteMany({ where: { shop } }),
    prisma.shopConfig.deleteMany({ where: { shop } }),
    prisma.session.deleteMany({ where: { shop } }),
  ]);
}
