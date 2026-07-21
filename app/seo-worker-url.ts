const SEO_DATA_ROUTE = "routes/app.seo";

export function resolveSeoWorkerUrl(env: {
  SEO_WORKER_URL?: string;
  SHOPIFY_APP_URL?: string;
}) {
  const configured = env.SEO_WORKER_URL?.trim();
  const appUrl = env.SHOPIFY_APP_URL?.trim();
  const fallback = appUrl
    ? new URL("/app/seo", ensureProtocol(appUrl)).toString()
    : "http://127.0.0.1:3004/app/seo";
  const url = new URL(configured || fallback);
  url.searchParams.set("_data", SEO_DATA_ROUTE);
  return url.toString();
}

function ensureProtocol(value: string) {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}
