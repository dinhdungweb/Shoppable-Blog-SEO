export type ChangelogRelease = {
  version: string;
  date: string;
  title: string;
  summary: string;
  tags: Array<"New" | "Improved" | "Fixed">;
  changes: Array<{ type: "New" | "Improved" | "Fixed"; text: string }>;
};

// Keep newest releases first. This is the single source used by the merchant-facing changelog.
export const CHANGELOG_RELEASES: ChangelogRelease[] = [
  {
    version: "2026.07.21",
    date: "2026-07-21",
    title: "Faster SEO Optimizer and incremental scans",
    summary: "SEO reports now open from a lightweight saved snapshot while fresh Shopify scans run only when requested.",
    tags: ["Improved", "Fixed"],
    changes: [
      { type: "Improved", text: "SEO Optimizer no longer downloads and re-audits every article when the report page opens." },
      { type: "Improved", text: "SEO scans use cursor pagination and cover stores with more than 100 articles per blog." },
      { type: "Improved", text: "Content hashes skip detailed audits for unchanged articles while preserving portfolio-wide checks." },
      { type: "Improved", text: "Search Console insights load bounded opportunity rows and database aggregates instead of every query row." },
      { type: "Improved", text: "A lightweight CSS issue chart replaces the larger chart dependency on SEO Optimizer." },
      { type: "Fixed", text: "Internal-link lookup and related-post scoring scale more efficiently for large blog libraries." },
      { type: "Improved", text: "Dashboard and Analytics now reuse the saved article snapshot instead of downloading the same Shopify article list again." },
      { type: "Improved", text: "Dashboard event metrics are aggregated by day in PostgreSQL before they reach the application." },
      { type: "Improved", text: "Theme and Web Pixel status checks load after the Dashboard renders and no longer create resources during a page view." },
      { type: "Improved", text: "Analytics now reads daily aggregates and unique-session counters instead of loading every raw tracking event." },
      { type: "Improved", text: "Existing tracking history is backfilled automatically, while new events update raw and aggregate data in one idempotent transaction." },
      { type: "New", text: "A configurable raw-event retention command keeps long-term daily reports while controlling database growth." },
      { type: "New", text: "SEO scans now run in a persistent background queue with live progress, cancellation, failure recovery and optional weekly scheduling." },
      { type: "Improved", text: "Merchants can leave SEO Optimizer while a scan runs, avoiding long browser requests and timeouts on large stores." },
      { type: "Fixed", text: "Uninstall and privacy cleanup now includes analytics aggregates, Search Console records, bulk-change history and SEO scan jobs." },
      { type: "Fixed", text: "Dashboard setup can activate a missing Shopify Web Pixel again without creating resources during page load." },
      { type: "Fixed", text: "Analytics session comparison now groups date ranges correctly on PostgreSQL." },
      { type: "Fixed", text: "Web Pixel and bulk SEO mutations now send valid GraphQL documents to Shopify." },
      { type: "Fixed", text: "Deferred setup checks show a neutral checking state instead of flashing an error before completion." },
    ],
  },
  {
    version: "2026.07.20",
    date: "2026-07-20",
    title: "Bulk SEO fixes with safe preview and undo",
    summary: "Review and apply search metadata and image accessibility improvements across multiple blog posts.",
    tags: ["New", "Improved"],
    changes: [
      { type: "New", text: "Bulk SEO Fix for SEO titles and meta descriptions, with an explicit before/after preview." },
      { type: "New", text: "Featured-image alt text suggestions that preserve existing alt text and can be edited before publishing." },
      { type: "New", text: "Per-shop change history and Undo for metadata and featured-image alt text." },
      { type: "Improved", text: "SEO Optimizer can send all posts affected by selected issues directly to Bulk SEO Fix." },
      { type: "Improved", text: "Suggestions fill missing metadata without overwriting good values that already exist." },
    ],
  },
  {
    version: "2026.07.20-search-insights",
    date: "2026-07-20",
    title: "Deeper SEO audits and optional Search Console insights",
    summary: "More useful portfolio-level SEO checks and an optional foundation for first-party search performance data.",
    tags: ["New", "Improved", "Fixed"],
    changes: [
      { type: "New", text: "Portfolio checks for duplicate titles and descriptions, keyword cannibalization, orphan content and near-duplicate posts." },
      { type: "New", text: "Optional Google Search Console connection per shop, with 7, 28 and 90-day reporting when configured." },
      { type: "New", text: "Search opportunity detection for low CTR, striking-distance rankings, traffic decay and competing pages." },
      { type: "Improved", text: "People-first scoring no longer treats a fixed word count or focus keyword as mandatory for every article." },
      { type: "Fixed", text: "SEO image, heading, unsafe-link, author and structured-data checks now cover more real storefront issues." },
    ],
  },
  {
    version: "2026.07.20-security",
    date: "2026-07-20",
    title: "Multi-store data and tracking hardening",
    summary: "Stronger tenant boundaries and safer attribution for stores using the app.",
    tags: ["Improved", "Fixed"],
    changes: [
      { type: "Improved", text: "SEO records, article-product mappings and configuration are consistently scoped to the current shop." },
      { type: "Improved", text: "Tracking requests use signed, short-lived tokens and idempotent event keys." },
      { type: "Fixed", text: "Privacy and uninstall cleanup safely remove only the data owned by the affected shop." },
    ],
  },
  {
    version: "2026.07.03",
    date: "2026-07-03",
    title: "Support and content navigation improvements",
    summary: "Better in-app support context and more consistent navigation settings.",
    tags: ["Improved", "Fixed"],
    changes: [
      { type: "Improved", text: "In-app support can identify the current store to provide more relevant assistance." },
      { type: "Improved", text: "SEO checks recognize custom shop domains as internal links." },
      { type: "Fixed", text: "SEO scoring, table-of-contents plan checks and Shopify metadata synchronization are more consistent." },
    ],
  },
];
