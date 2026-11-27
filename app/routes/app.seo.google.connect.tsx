import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { authenticate, getActivePlanAndLimits } from "../shopify.server";
import { createAuthorizationUrl } from "../search-console.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);
  const { limits } = await getActivePlanAndLimits(billing, session.shop);
  if (!limits.canSearchConsole) {
    return redirect("/app/pricing?reason=search_console");
  }
  return redirect(await createAuthorizationUrl(session.shop));
};
