import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { consumeOAuthState, exchangeAuthorizationCode } from "../search-console.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  const state = url.searchParams.get("state") || "";
  if (error) return redirect(`/app/seo?google=error&message=${encodeURIComponent(error)}`);
  try {
    const shop = await consumeOAuthState(state);
    const code = url.searchParams.get("code");
    if (!code) throw new Error("Google did not provide an authorization code.");
    await exchangeAuthorizationCode(shop, code);
    return redirect(`/app/seo?shop=${encodeURIComponent(shop)}&google=connected`);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Google connection failed.";
    return redirect(`/app/seo?google=error&message=${encodeURIComponent(message)}`);
  }
};
