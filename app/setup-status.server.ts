import prisma from "./db.server";
import { summarizeThemeBlocks, type ThemeBlockStatus, type ThemeFile } from "./theme-status";

export type ThemeSetupStatus = { themeName: string; blocks: ThemeBlockStatus } | { error: string };

const THEME_FILES_QUERY = `#graphql
  query SetupThemeFiles {
    themes(first: 1, roles: [MAIN]) {
      nodes {
        name
        files(filenames: ["config/settings_data.json", "templates/article.json", "templates/article.*.json"], first: 25) {
          nodes { filename body { ... on OnlineStoreThemeFileBodyText { content } } }
        }
      }
    }
  }
`;

/** Which app blocks are installed on the published theme. */
export async function checkThemeSetup(admin: any): Promise<ThemeSetupStatus> {
  try {
    const response = await admin.graphql(THEME_FILES_QUERY);
    const payload: any = await response.json();
    if (payload.errors?.length) throw new Error(payload.errors.map((error: any) => error.message).join("; "));
    const theme = payload.data?.themes?.nodes?.[0];
    if (!theme) return { error: "No published theme found." };
    const files: ThemeFile[] = (theme.files?.nodes || [])
      .filter((file: any) => typeof file?.body?.content === "string")
      .map((file: any) => ({ filename: String(file.filename), content: file.body.content }));
    return { themeName: String(theme.name || "Published theme"), blocks: summarizeThemeBlocks(files) };
  } catch (error) {
    console.error("Theme setup check failed", error);
    return { error: "Could not read the published theme." };
  }
}

function isMissingWebPixelError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /no web pixel was found for this app/i.test(message);
}

/** true/false when known, null when Shopify could not be asked. */
export async function checkWebPixel(admin: any): Promise<boolean | null> {
  try {
    const response = await admin.graphql(`#graphql
      query SetupPixelStatus { webPixel { id } }
    `);
    const result: any = await response.json();
    return Boolean(result.data?.webPixel?.id);
  } catch (error) {
    if (isMissingWebPixelError(error)) return false;
    console.error("Web pixel check failed", error);
    return null;
  }
}

/** Latest tracking events received, to show that tracking really works. */
export async function loadTrackingActivity(shop: string) {
  const [lastEvent, lastPurchase] = await Promise.all([
    prisma.widgetEvent.findFirst({ where: { shop }, orderBy: { createdAt: "desc" }, select: { createdAt: true, eventType: true } }),
    prisma.widgetEvent.findFirst({ where: { shop, eventType: "purchase" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);
  return {
    lastEventAt: lastEvent?.createdAt.toISOString() || null,
    lastEventType: lastEvent?.eventType || null,
    lastPurchaseAt: lastPurchase?.createdAt.toISOString() || null,
  };
}
