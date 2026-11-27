import fs from "node:fs";
import type { Config } from "@react-router/dev/config";

/**
 * Hosts allowed to submit actions (forms and fetchers).
 *
 * In production the app sits behind a reverse proxy that ends HTTPS, so the
 * request URL the server sees is http:// while the browser's Origin header is
 * https://. React Router treats that mismatch as a possible CSRF attack unless
 * the host is listed here. Hosts come from SHOPIFY_APP_URL (when set at build
 * time) and every application_url in the shopify.app*.toml files.
 */
function appHosts(): string[] {
  const urls: Array<string | undefined> = [process.env.SHOPIFY_APP_URL];
  for (const file of fs.readdirSync(".")) {
    if (!/^shopify\.app.*\.toml$/.test(file)) continue;
    const match = fs.readFileSync(file, "utf8").match(/^application_url\s*=\s*"([^"]+)"/m);
    urls.push(match?.[1]);
  }
  const hosts = new Set<string>();
  for (const url of urls) {
    if (!url?.trim()) continue;
    try {
      hosts.add(new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).host);
    } catch {
      // Ignore malformed values; React Router then only allows same-origin actions.
    }
  }
  return [...hosts];
}

export default {
  ssr: true,
  allowedActionOrigins: appHosts(),
} satisfies Config;
