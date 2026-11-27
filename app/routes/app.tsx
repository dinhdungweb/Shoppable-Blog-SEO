import { useEffect } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, Outlet, useLoaderData, useNavigation, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { NavMenu, useAppBridge } from "@shopify/app-bridge-react";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import polarisTranslations from "@shopify/polaris/locales/en.json";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import rmStyles from "../styles/rm.css?url";

import { authenticate } from "../shopify.server";
import { scheduleCrispChatLoad } from "../utils/crisp-chat";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }, { rel: "stylesheet", href: rmStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    shop: session.shop,
  };
};

/** Shopify admin's own loading bar while the next page loads. */
function NavigationLoading() {
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const loading = navigation.state === "loading";
  useEffect(() => {
    shopify.loading(loading);
  }, [loading, shopify]);
  return null;
}

function CrispChatLoader({ shop }: { shop?: string }) {
  useEffect(() => {
    return scheduleCrispChatLoad(shop);
  }, [shop]);

  return null;
}

export default function App() {
  const { apiKey, shop } = useLoaderData<typeof loader>();

  return (
    <AppProvider apiKey={apiKey}>
      {/* Polaris React stays until every screen uses Polaris web components. */}
      <PolarisAppProvider i18n={polarisTranslations}>
      <CrispChatLoader shop={shop} />
      <NavigationLoading />
      <NavMenu>
        {/* Keep in sync with the tab sets in components/WorkspaceTabs.tsx. */}
        <Link to="/app" rel="home">
          Dashboard
        </Link>
        <Link to="/app/blogs">Posts</Link>
        <Link to="/app/catalog-seo?view=manager&type=product">Products & collections</Link>
        <Link to="/app/seo">SEO Analyzer</Link>
        <Link to="/app/analytics">Analytics</Link>
        <Link to="/app/settings">Settings</Link>
      </NavMenu>
      <Outlet />
      </PolarisAppProvider>
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
