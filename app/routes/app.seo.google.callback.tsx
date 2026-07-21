import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { consumeOAuthState, exchangeAuthorizationCode } from "../search-console.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  const state = url.searchParams.get("state") || "";
  try {
    const shop = await consumeOAuthState(state);
    if (error) return redirect(embeddedSeoUrl(shop, { google: "error", message: error }));
    const code = url.searchParams.get("code");
    if (!code) throw new Error("Google did not provide an authorization code.");
    await exchangeAuthorizationCode(shop, code);
    return redirect(embeddedSeoUrl(shop, { google: "connected" }));
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Google connection failed.";
    return redirect(`/app/seo?google=error&message=${encodeURIComponent(message)}`);
  }
};

function embeddedSeoUrl(shop: string, params: Record<string, string>) {
  const apiKey = process.env.SHOPIFY_API_KEY;
  if (!apiKey) {
    const fallback = new URL("/app/seo", process.env.SHOPIFY_APP_URL);
    fallback.searchParams.set("shop", shop);
    Object.entries(params).forEach(([key, value]) => fallback.searchParams.set(key, value));
    return fallback.toString();
  }

  const shopAdminSlug = shop.replace(/\.myshopify\.com$/i, "");
  const destination = new URL(
    `https://admin.shopify.com/store/${encodeURIComponent(shopAdminSlug)}/apps/${encodeURIComponent(apiKey)}/app/seo`,
  );
  Object.entries(params).forEach(([key, value]) => destination.searchParams.set(key, value));
  return destination.toString();
}
