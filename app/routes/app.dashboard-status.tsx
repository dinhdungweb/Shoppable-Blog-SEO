import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { checkThemeSetup, checkWebPixel } from "../setup-status.server";

function pixelSettings(shop: string) {
  const appUrl = String(process.env.SHOPIFY_APP_URL || "").replace(/\/+$/, "");
  return { accountID: shop, ...(appUrl.startsWith("https://") ? { trackUrl: `${appUrl}/api/track` } : {}) };
}

function graphqlErrors(result: any, key: string): string[] {
  return [
    ...(result.errors || []).map((error: any) => error.message),
    ...(result.data?.[key]?.userErrors || []).map((error: any) => error.message),
  ].filter(Boolean);
}

/** Connects the checkout pixel, or points an existing one at this app's tracking endpoint. */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  if (formData.get("intent") !== "activate_pixel") return json({ error: "Unsupported action" }, { status: 400 });
  const settings = pixelSettings(session.shop);

  let existing: { id: string; settings: unknown } | null = null;
  try {
    const checkResponse = await admin.graphql(`#graphql
      query DashboardPixelStatus { webPixel { id settings } }
    `);
    const checkResult: any = await checkResponse.json();
    existing = checkResult.data?.webPixel?.id ? checkResult.data.webPixel : null;
  } catch (error) {
    if (!isMissingWebPixelError(error)) throw error;
  }

  if (existing) {
    const current = typeof existing.settings === "string" ? safeJson(existing.settings) : existing.settings;
    if (JSON.stringify(current) === JSON.stringify(settings)) return json({ success: true, webPixelEnabled: true });
    const updateResponse = await admin.graphql(`#graphql
      mutation DashboardWebPixelUpdate($id: ID!, $webPixel: WebPixelInput!) {
        webPixelUpdate(id: $id, webPixel: $webPixel) { webPixel { id } userErrors { field message } }
      }`, { variables: { id: existing.id, webPixel: { settings: JSON.stringify(settings) } } });
    const errors = graphqlErrors(await updateResponse.json(), "webPixelUpdate");
    // The pixel already works with its previous settings, so an update failure is not fatal.
    if (errors.length) console.warn("Web pixel settings update failed", errors);
    return json({ success: true, webPixelEnabled: true });
  }

  const createResponse = await admin.graphql(
    `#graphql
    mutation DashboardWebPixelCreate($webPixel: WebPixelInput!) {
      webPixelCreate(webPixel: $webPixel) { webPixel { id } userErrors { field message } }
    }`,
    { variables: { webPixel: { settings: JSON.stringify(settings) } } },
  );
  const createResult: any = await createResponse.json();
  const errors = graphqlErrors(createResult, "webPixelCreate");
  if (errors.length || !createResult.data?.webPixelCreate?.webPixel?.id) {
    return json({ error: errors.join(", ") || "Shopify did not activate the Web Pixel." }, { status: 400 });
  }
  return json({ success: true, webPixelEnabled: true });
};

function safeJson(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const startedAt = Date.now();
  const { admin, session } = await authenticate.admin(request);
  const [theme, pixel] = await Promise.all([checkThemeSetup(admin), checkWebPixel(admin)]);
  console.info("Dashboard deferred setup timing", { shop: session.shop, durationMs: Date.now() - startedAt });
  return json({
    appEmbedEnabled: "blocks" in theme ? theme.blocks.appEmbed : false,
    appEmbedError: "error" in theme ? "Could not check theme status" : "",
    webPixelEnabled: pixel === true,
    webPixelError: pixel === null ? "Could not check Web Pixel status" : "",
    themeBlocks: "blocks" in theme ? theme.blocks : null,
  });
};

function isMissingWebPixelError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /no web pixel was found for this app/i.test(message);
}
