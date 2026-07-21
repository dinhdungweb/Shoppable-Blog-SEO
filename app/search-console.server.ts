import crypto from "node:crypto";
import prisma from "./db.server";

const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_URL = "https://www.googleapis.com/webmasters/v3";
export const SEARCH_CONSOLE_TOTAL_PAGE = "__bp_search_console_total__";

type Site = { siteUrl: string; permissionLevel: string };
type MetricRow = { keys?: string[]; clicks?: number; impressions?: number; ctr?: number; position?: number };

export function isSearchConsoleConfigured() {
  return Boolean(process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_ID && process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET && process.env.SHOPIFY_APP_URL);
}

function encryptionKey() {
  const secret = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY || process.env.SHOPIFY_API_SECRET;
  if (!secret) throw new Error("Set GOOGLE_TOKEN_ENCRYPTION_KEY (or SHOPIFY_API_SECRET) before connecting Search Console.");
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptToken(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}

export function decryptToken(value: string) {
  const [iv, tag, encrypted] = value.split(".").map((part) => Buffer.from(part, "base64url"));
  if (!iv || !tag || !encrypted) throw new Error("Invalid encrypted token.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

function redirectUri() {
  return process.env.GOOGLE_SEARCH_CONSOLE_REDIRECT_URI || `${process.env.SHOPIFY_APP_URL}/app/seo/google/callback`;
}

export async function createAuthorizationUrl(shop: string) {
  if (!isSearchConsoleConfigured()) throw new Error("Google Search Console credentials are not configured.");
  const state = crypto.randomBytes(32).toString("base64url");
  await prisma.searchConsoleOAuthState.upsert({
    where: { shop },
    update: { stateHash: hash(state), expiresAt: new Date(Date.now() + 10 * 60_000) },
    create: { shop, stateHash: hash(state), expiresAt: new Date(Date.now() + 10 * 60_000) },
  });
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_ID!, redirect_uri: redirectUri(), response_type: "code",
    scope: SCOPE, access_type: "offline", include_granted_scopes: "true", prompt: "consent", state: `${shop}:${state}`,
  });
  return `${AUTH_URL}?${params}`;
}

export async function consumeOAuthState(state: string) {
  const separator = state.indexOf(":");
  const shop = separator > 0 ? state.slice(0, separator) : "";
  const secret = separator > 0 ? state.slice(separator + 1) : "";
  const stored = shop ? await prisma.searchConsoleOAuthState.findUnique({ where: { shop } }) : null;
  const valid = stored && stored.expiresAt > new Date() && safeEqual(stored.stateHash, hash(secret));
  if (!valid) throw new Error("The Google authorization request expired or is invalid.");
  await prisma.searchConsoleOAuthState.delete({ where: { shop } });
  return shop;
}

export async function exchangeAuthorizationCode(shop: string, code: string) {
  const response = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({
    code, client_id: process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_ID!, client_secret: process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET!, redirect_uri: redirectUri(), grant_type: "authorization_code",
  }) });
  const token = await readGoogleResponse(response) as { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };
  const existing = await prisma.searchConsoleConnection.findUnique({ where: { shop } });
  const refreshTokenEncrypted = token.refresh_token ? encryptToken(token.refresh_token) : existing?.refreshTokenEncrypted;
  if (!refreshTokenEncrypted) throw new Error("Google did not return a refresh token. Revoke the app in your Google account and connect again.");
  const connection = await prisma.searchConsoleConnection.upsert({ where: { shop }, update: {
    accessTokenEncrypted: encryptToken(token.access_token), refreshTokenEncrypted, tokenExpiresAt: expiresAt(token.expires_in), scope: token.scope, lastSyncError: null,
  }, create: { shop, accessTokenEncrypted: encryptToken(token.access_token), refreshTokenEncrypted, tokenExpiresAt: expiresAt(token.expires_in), scope: token.scope } });
  const sites = await listSitesWithToken(token.access_token);
  const selected = sites.length === 1 ? sites[0] : sites.find((site) => site.siteUrl.includes(shop.replace(".myshopify.com", "")));
  await prisma.searchConsoleConnection.update({ where: { shop }, data: {
    availableSites: sites, selectedSiteUrl: selected?.siteUrl || connection.selectedSiteUrl, selectedPermissionLevel: selected?.permissionLevel || connection.selectedPermissionLevel,
  } });
}

async function accessToken(shop: string) {
  const connection = await prisma.searchConsoleConnection.findUnique({ where: { shop } });
  if (!connection) throw new Error("Search Console is not connected.");
  if (!connection.tokenExpiresAt || connection.tokenExpiresAt.getTime() > Date.now() + 60_000) return decryptToken(connection.accessTokenEncrypted);
  if (!connection.refreshTokenEncrypted) throw new Error("Search Console access expired. Connect again.");
  const response = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({
    refresh_token: decryptToken(connection.refreshTokenEncrypted), client_id: process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_ID!, client_secret: process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET!, grant_type: "refresh_token",
  }) });
  const token = await readGoogleResponse(response) as { access_token: string; expires_in?: number; scope?: string };
  await prisma.searchConsoleConnection.update({ where: { shop }, data: { accessTokenEncrypted: encryptToken(token.access_token), tokenExpiresAt: expiresAt(token.expires_in), scope: token.scope || connection.scope } });
  return token.access_token;
}

async function listSitesWithToken(token: string): Promise<Site[]> {
  const response = await fetch(`${API_URL}/sites`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await readGoogleResponse(response) as { siteEntry?: Site[] };
  return data.siteEntry || [];
}

export async function selectSearchConsoleSite(shop: string, siteUrl: string) {
  const connection = await prisma.searchConsoleConnection.findUnique({ where: { shop } });
  const sites = (connection?.availableSites as Site[] | null) || [];
  const site = sites.find((candidate) => candidate.siteUrl === siteUrl);
  if (!site) throw new Error("Select a verified Search Console property from the list.");
  await prisma.searchConsoleConnection.update({ where: { shop }, data: { selectedSiteUrl: site.siteUrl, selectedPermissionLevel: site.permissionLevel, lastSyncError: null } });
}

export async function syncSearchConsole(shop: string) {
  const connection = await prisma.searchConsoleConnection.findUnique({ where: { shop } });
  if (!connection?.selectedSiteUrl) throw new Error("Select a Search Console property first.");
  try {
    const token = await accessToken(shop);
    const now = new Date();
    const requestConfigs = [
      { days: 7, period: "current", offsetDays: 0 },
      { days: 28, period: "current", offsetDays: 0 },
      { days: 90, period: "current", offsetDays: 0 },
      { days: 28, period: "previous", offsetDays: 28 },
    ];
    const requests = requestConfigs.map(async ({ days, period, offsetDays }) => {
      const [rows, totals] = await Promise.all([
        query(token, connection.selectedSiteUrl!, days, offsetDays, ["page", "query"]),
        query(token, connection.selectedSiteUrl!, days, offsetDays, []),
      ]);
      return { days, period, rows, total: totals[0] };
    });
    const results = await Promise.all(requests);
    const records = results.flatMap(({ days, period, rows, total }) => [
      ...rows.map((row) => ({ shop, siteUrl: connection.selectedSiteUrl!, pageUrl: row.keys?.[0] || "", query: row.keys?.[1] || "", windowDays: days, period, clicks: row.clicks || 0, impressions: row.impressions || 0, ctr: row.ctr || 0, position: row.position || 0, syncedAt: now })),
      ...(total ? [{ shop, siteUrl: connection.selectedSiteUrl!, pageUrl: SEARCH_CONSOLE_TOTAL_PAGE, query: "", windowDays: days, period, clicks: total.clicks || 0, impressions: total.impressions || 0, ctr: total.ctr || 0, position: total.position || 0, syncedAt: now }] : []),
    ]).filter((row) => row.pageUrl);
    await prisma.$transaction([
      prisma.searchConsoleMetric.deleteMany({ where: { shop, siteUrl: connection.selectedSiteUrl } }),
      ...(records.length ? [prisma.searchConsoleMetric.createMany({ data: records, skipDuplicates: true })] : []),
      prisma.searchConsoleConnection.update({ where: { shop }, data: { lastSyncedAt: now, lastSyncError: null } }),
    ]);
    return records.length;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Search Console sync failed.";
    await prisma.searchConsoleConnection.update({ where: { shop }, data: { lastSyncError: message } });
    throw error;
  }
}

async function query(token: string, siteUrl: string, days: number, offsetDays: number, dimensions: string[]): Promise<MetricRow[]> {
  // Search Console's finalized performance data normally trails the current date.
  // Use the same complete-data window shown by its default performance report.
  const end = new Date(); end.setUTCDate(end.getUTCDate() - 3 - offsetDays);
  const start = new Date(end); start.setUTCDate(start.getUTCDate() - days + 1);
  const response = await fetch(`${API_URL}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ startDate: date(start), endDate: date(end), dimensions, rowLimit: 25000, dataState: "final" }) });
  const data = await readGoogleResponse(response) as { rows?: MetricRow[] };
  return data.rows || [];
}

export async function disconnectSearchConsole(shop: string) {
  await prisma.$transaction([prisma.searchConsoleMetric.deleteMany({ where: { shop } }), prisma.searchConsoleConnection.deleteMany({ where: { shop } }), prisma.searchConsoleOAuthState.deleteMany({ where: { shop } })]);
}

async function readGoogleResponse(response: Response) {
  const data = await response.json().catch(() => ({})) as { error?: { message?: string } | string };
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : data.error?.message || `Google API request failed (${response.status}).`);
  return data;
}
function expiresAt(seconds = 3600) { return new Date(Date.now() + seconds * 1000); }
function date(value: Date) { return value.toISOString().slice(0, 10); }
function hash(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }
function safeEqual(a: string, b: string) { const left = Buffer.from(a); const right = Buffer.from(b); return left.length === right.length && crypto.timingSafeEqual(left, right); }
