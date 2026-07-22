import { useEffect } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import { authenticate } from "../shopify.server";
import { scheduleCrispChatLoad } from "../utils/crisp-chat";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    shop: session.shop,
  };
};

function CrispChatLoader({ shop }: { shop?: string }) {
  useEffect(() => {
    return scheduleCrispChatLoad(shop);
  }, [shop]);

  return null;
}

export default function App() {
  const { apiKey, shop } = useLoaderData<typeof loader>();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <CrispChatLoader shop={shop} />
      <NavMenu>
        <Link to="/app" rel="home">
          Dashboard
        </Link>
        <Link to="/app/blogs">Blog Manager</Link>
        <Link to="/app/seo">SEO Optimizer</Link>
        <Link to="/app/performance">Performance</Link>
        <Link to="/app/internal-links">Internal Linking</Link>
        <Link to="/app/content-decay">Content Decay</Link>
        <Link to="/app/analytics">Analytics</Link>
        <Link to="/app/changelog">What's new</Link>
        <Link to="/app/pricing">Pricing</Link>
        <Link to="/app/settings">Settings</Link>
      </NavMenu>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs Remix to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
