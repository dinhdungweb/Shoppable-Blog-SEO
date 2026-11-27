import type { ActionFunctionArgs } from "react-router";
import { json } from "../http";
import { authenticate, getActivePlanAndLimits } from "../shopify.server";
import {
  createAuthorizationUrl,
  disconnectSearchConsole,
  selectSearchConsoleSite,
  syncSearchConsole,
} from "../search-console.server";

/**
 * Resource route for every Google Search Console action. The shared
 * SearchConsoleCard posts here from SEO Audit → Keywords and Settings → Integrations.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const shop = session.shop;
  const { limits } = await getActivePlanAndLimits(billing, shop);
  if (!limits.canSearchConsole) {
    return json({ error: "Google Search Console is available on Pro and Growth plans." }, { status: 403 });
  }

  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");
  try {
    if (intent === "google_connect") {
      return json({ success: true, googleAction: "connect", authorizationUrl: await createAuthorizationUrl(shop) });
    }
    if (intent === "google_select") {
      await selectSearchConsoleSite(shop, String(formData.get("siteUrl") || ""));
      return json({ success: true, googleAction: "selected" });
    }
    if (intent === "google_sync") {
      const syncedCount = await syncSearchConsole(shop);
      return json({ success: true, googleAction: "synced", syncedCount });
    }
    if (intent === "google_disconnect") {
      await disconnectSearchConsole(shop);
      return json({ success: true, googleAction: "disconnected" });
    }
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Search Console request failed." }, { status: 400 });
  }
  return json({ error: "Unsupported Search Console action." }, { status: 400 });
};
