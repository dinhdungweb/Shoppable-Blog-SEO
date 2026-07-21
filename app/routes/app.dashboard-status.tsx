import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const startedAt = Date.now();
  const { admin, session } = await authenticate.admin(request);
  let appEmbedEnabled = false;
  let appEmbedError = "";
  let webPixelEnabled = false;
  let webPixelError = "";
  try {
    const themesResponse = await fetch(`https://${session.shop}/admin/api/2026-04/themes.json`, { headers: { "X-Shopify-Access-Token": session.accessToken || "" } });
    if (!themesResponse.ok) throw new Error(`Theme check failed (${themesResponse.status})`);
    const themesResult = await themesResponse.json();
    const mainTheme = themesResult.themes?.find((theme: any) => theme.role === "main");
    if (mainTheme) {
      const assetResponse = await fetch(`https://${session.shop}/admin/api/2026-04/themes/${mainTheme.id}/assets.json?asset[key]=config/settings_data.json`, { headers: { "X-Shopify-Access-Token": session.accessToken || "" } });
      if (!assetResponse.ok) throw new Error(`Theme settings check failed (${assetResponse.status})`);
      const assetResult = await assetResponse.json();
      const settings = assetResult.asset?.value ? JSON.parse(assetResult.asset.value) : null;
      appEmbedEnabled = Object.values(settings?.current?.blocks || {}).some((block: any) => block?.type?.includes("sbs-article-embed") && String(block.disabled) !== "true");
    }
  } catch (error) {
    console.error("Deferred app embed check failed:", error);
    appEmbedError = "Could not check theme status";
  }
  try {
    const response = await admin.graphql(`#graphql query DashboardPixelStatus { webPixel { id } }`);
    const result: any = await response.json();
    webPixelEnabled = Boolean(result.data?.webPixel?.id);
    if (result.errors?.length && !webPixelEnabled) webPixelError = "Web Pixel is not active";
  } catch (error) {
    console.error("Deferred web pixel check failed:", error);
    webPixelError = "Could not check Web Pixel status";
  }
  console.info("Dashboard deferred setup timing", { shop: session.shop, durationMs: Date.now() - startedAt });
  return json({ appEmbedEnabled, appEmbedError, webPixelEnabled, webPixelError });
};
