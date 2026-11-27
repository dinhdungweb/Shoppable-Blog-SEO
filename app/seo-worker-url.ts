const SEO_WORKER_PATH = "/api/seo-worker";

/**
 * Endpoint the background worker posts scan jobs to. Only the origin of
 * SEO_WORKER_URL / SHOPIFY_APP_URL is used, so an older value such as
 * "/app/seo?_data=routes%2Fapp.seo" still reaches the worker route.
 */
export function resolveSeoWorkerUrl(env: {
  SEO_WORKER_URL?: string;
  SHOPIFY_APP_URL?: string;
}) {
  const configured = env.SEO_WORKER_URL?.trim();
  const appUrl = env.SHOPIFY_APP_URL?.trim();
  const base = configured || (appUrl ? ensureProtocol(appUrl) : "http://127.0.0.1:3004");
  return new URL(SEO_WORKER_PATH, new URL(base).origin).toString();
}

function ensureProtocol(value: string) {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}
