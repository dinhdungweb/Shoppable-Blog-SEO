import { auditLivePage, parseLivePage, type LivePageIssue, type LivePageSnapshot } from "./live-page-audit";
import { safePublicFetch } from "./safe-fetch.server";

/** Live checks per scan; the rest rotate in on later scans (oldest check first). */
export const LIVE_PAGE_LIMIT = 25;
const CONCURRENCY = 4;
const TIMEOUT_MS = 10_000;
const MAX_HTML_BYTES = 2_000_000;

export type LiveCheckTarget = { key: string; url: string; expectArticleSchema: boolean };
export type LiveCheckResult = { issues: LivePageIssue[]; snapshot: LivePageSnapshot | null };

export async function fetchPrimaryOrigin(admin: any): Promise<string> {
  try {
    const response = await admin.graphql(`#graphql
      query LiveCheckPrimaryDomain { shop { primaryDomain { url } } }`);
    const payload: any = await response.json();
    const url = new URL(String(payload.data?.shop?.primaryDomain?.url || ""));
    return url.protocol === "https:" ? url.origin : "";
  } catch (error) {
    console.warn("Live page checks skipped: primary domain unavailable", error);
    return "";
  }
}

/**
 * Fetches each target from the shop's own storefront and audits the HTML.
 * Stops early when the storefront is password protected, because every page
 * would return the password page instead of real content.
 */
export async function runLiveChecks(targets: LiveCheckTarget[], origin: string, onProgress?: (done: number) => Promise<void>) {
  const results = new Map<string, LiveCheckResult>();
  const allowedHost = safeHost(origin);
  let passwordProtected = false;
  let done = 0;
  const queue = targets.filter((target) => allowedHost && safeHost(target.url) === allowedHost);

  const worker = async () => {
    while (queue.length && !passwordProtected) {
      const target = queue.shift()!;
      const result = await checkPage(target);
      if (result === "password") {
        passwordProtected = true;
        break;
      }
      if (result) results.set(target.key, result);
      done += 1;
      if (onProgress) await onProgress(done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  return { results: passwordProtected ? new Map<string, LiveCheckResult>() : results, passwordProtected };
}

async function checkPage(target: LiveCheckTarget): Promise<LiveCheckResult | "password" | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await safePublicFetch(target.url, {
      method: "GET",
      signal: controller.signal,
      headers: { accept: "text/html", "user-agent": "Mozilla/5.0 (compatible; ShoppableBlogSEO/1.0; +live-page-check)" },
    });
    if (response.status === 401 || /\/password(?:$|[?#])/.test(response.headers.get("location") || "")) return "password";
    if (response.status >= 400) {
      return {
        snapshot: null,
        issues: [{
          type: "live_http_error",
          label: `Page returns HTTP ${response.status}`,
          message: `The storefront returned HTTP ${response.status} for ${target.url}, so search engines cannot index it.`,
          severity: "critical",
          impact: "High",
          effort: "Medium",
          fix: "Check that the page is published and its URL handle has not changed; add a URL redirect for old links.",
          points: 25,
          category: "on_page",
        }],
      };
    }
    if (response.status >= 300) return null; // Redirect chain exhausted; not a reliable signal.
    const html = (await response.text()).slice(0, MAX_HTML_BYTES);
    const snapshot = parseLivePage(html);
    if (snapshot.isPasswordPage) return "password";
    return { snapshot, issues: auditLivePage(snapshot, { pageUrl: target.url, expectArticleSchema: target.expectArticleSchema }) };
  } catch (error) {
    // Network failures are not page problems; keep the previous result.
    console.warn("Live page check failed", { url: target.url, error: error instanceof Error ? error.message : String(error) });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function safeHost(url: string) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}
