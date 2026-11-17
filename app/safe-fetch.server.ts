import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Fetching URLs that come from merchant content or AI output must never reach
 * the app's own network (SSRF). Every hop is checked after DNS resolution, so a
 * public-looking hostname that resolves to a private address is rejected too.
 */

export function isPrivateAddress(address: string): boolean {
  const ip = address.toLowerCase().replace(/^\[|\]$/g, "");
  const version = isIP(ip);
  if (version === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (version === 6) {
    if (ip === "::" || ip === "::1") return true;
    const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(ip);
  }
  return true;
}

export function isPublicHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return false;
  return isIP(host) ? !isPrivateAddress(host) : true;
}

async function assertPublicUrl(url: URL) {
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only HTTP(S) URLs can be checked");
  if (url.username || url.password) throw new Error("URLs with credentials are not allowed");
  if (!isPublicHostname(url.hostname)) throw new Error("Private network address");
  if (!isIP(url.hostname.replace(/^\[|\]$/g, ""))) {
    const addresses = await lookup(url.hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) throw new Error("Private network address");
  }
}

/** fetch() that re-validates every redirect hop against private networks. */
export async function safePublicFetch(initialUrl: string, init: { method: "HEAD" | "GET"; signal?: AbortSignal; headers?: Record<string, string> }) {
  let current = new URL(initialUrl);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    await assertPublicUrl(current);
    const response = await fetch(current, {
      method: init.method,
      redirect: "manual",
      signal: init.signal,
      headers: { "user-agent": "ShoppableBlogSEO/1.0 (+link check)", ...(init.headers || {}) },
    });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get("location");
    if (!location) return response;
    current = new URL(location, current);
  }
  throw new Error("Too many redirects");
}

/**
 * True when the URL answers like a live page. 401/403/429 count as reachable:
 * many sites block bots without the page being broken.
 */
export async function isPublicUrlReachable(url: string, timeoutMs = 4000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response = await safePublicFetch(url, { method: "HEAD", signal: controller.signal });
    if (response.status === 405 || response.status === 403 || response.status === 501) {
      response = await safePublicFetch(url, { method: "GET", signal: controller.signal, headers: { range: "bytes=0-0" } });
    }
    return response.status < 400 || [401, 403, 429].includes(response.status);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
