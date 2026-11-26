/**
 * Builds the Home page "What to do next" queue and the store-wide SEO health
 * score from data that other workspaces already store. Pure functions only, so
 * the ranking rules are unit tested and stay identical everywhere they are used.
 */

export type HomeTaskImpact = "High" | "Medium" | "Low";

export type HomeTask = {
  id: string;
  title: string;
  detail: string;
  impact: HomeTaskImpact;
  area: "SEO Analyzer" | "Posts" | "Products & collections" | "Analytics" | "Setup";
  actionLabel: string;
  url: string;
  /** True when the merchant's plan does not include the tool that fixes this. */
  locked: boolean;
};

export type HomeTaskInput = {
  now?: Date;
  lastScanAt: Date | null;
  articlesScanned: number;
  lowScoreArticles: number;
  missingMetaDescriptions: number;
  metaLengthProblems: number;
  missingFeaturedAlt: number;
  productIssues: number;
  collectionIssues: number;
  decay: { high: number; total: number } | null;
  internalLinks: { orphans: number; broken: number } | null;
  highTrafficNoProducts: number;
  noLinkedProducts: number;
  lowCtrPosts: number;
  trackingEventsReceived: boolean;
  limits: {
    canBulkReview: boolean;
    canCatalogSeo: boolean;
    canContentDecay: boolean;
    canInternalLinking: boolean;
  };
};

const STALE_SCAN_DAYS = 14;
const IMPACT_RANK: Record<HomeTaskImpact, number> = { High: 0, Medium: 1, Low: 2 };

export function buildHomeTasks(input: HomeTaskInput, maxTasks = 8): HomeTask[] {
  const now = input.now || new Date();
  const tasks: HomeTask[] = [];
  const add = (task: Omit<HomeTask, "locked"> & { locked?: boolean }) => tasks.push({ locked: false, ...task });

  if (!input.lastScanAt || !input.articlesScanned) {
    add({ id: "first-scan", title: "Run your first SEO scan", detail: "One scan audits blog posts, products and collections so the app can prioritize fixes.", impact: "High", area: "SEO Analyzer", actionLabel: "Run scan", url: "/app/seo" });
  } else if (now.getTime() - input.lastScanAt.getTime() > STALE_SCAN_DAYS * 86_400_000) {
    add({ id: "stale-scan", title: "Refresh your SEO scan", detail: `The last scan is more than ${STALE_SCAN_DAYS} days old, so these priorities may be outdated.`, impact: "Medium", area: "SEO Analyzer", actionLabel: "Run scan", url: "/app/seo" });
  }

  if (input.missingMetaDescriptions > 0) {
    add({ id: "meta-description", title: `Write meta descriptions for ${plural(input.missingMetaDescriptions, "post")}`, detail: "Search engines show these snippets in results; missing ones lower click-through.", impact: "High", area: "SEO Analyzer", actionLabel: "Fix in bulk", url: "/app/optimize", locked: !input.limits.canBulkReview });
  }

  if (input.lowScoreArticles > 0) {
    add({ id: "low-score", title: `Fix ${plural(input.lowScoreArticles, "post")} scoring below 50`, detail: "These posts have the most critical on-page SEO issues.", impact: "High", area: "SEO Analyzer", actionLabel: "Review issues", url: "/app/seo" });
  }

  if (input.decay && input.decay.high > 0) {
    add({ id: "decay", title: `Refresh ${plural(input.decay.high, "post")} losing traffic`, detail: "Declining clicks or stale facts. Refreshing them is usually faster than writing new posts.", impact: "High", area: "Analytics", actionLabel: "View decay", url: "/app/content-decay", locked: !input.limits.canContentDecay });
  }

  if (input.highTrafficNoProducts > 0) {
    add({ id: "traffic-no-products", title: `Add products to ${plural(input.highTrafficNoProducts, "post")} that already get views`, detail: "Readers are arriving but have nothing to buy from these posts.", impact: "High", area: "Posts", actionLabel: "Link products", url: "/app/blogs" });
  }

  const catalogIssues = input.productIssues + input.collectionIssues;
  if (catalogIssues > 0) {
    const type = input.productIssues >= input.collectionIssues ? "product" : "collection";
    add({ id: "catalog", title: `Fix SEO on ${plural(catalogIssues, "product or collection", "products and collections")}`, detail: `${input.productIssues} products and ${input.collectionIssues} collections have SEO issues.`, impact: "Medium", area: "SEO Analyzer", actionLabel: "Review issues", url: `/app/catalog-seo?view=issues&type=${type}`, locked: !input.limits.canCatalogSeo });
  }

  if (input.internalLinks && (input.internalLinks.orphans > 0 || input.internalLinks.broken > 0)) {
    const parts = [
      input.internalLinks.orphans ? `${plural(input.internalLinks.orphans, "post")} with no internal links pointing to them` : "",
      input.internalLinks.broken ? `${plural(input.internalLinks.broken, "broken internal link")}` : "",
    ].filter(Boolean);
    add({ id: "internal-links", title: "Strengthen internal linking", detail: `${parts.join(" and ")}.`, impact: input.internalLinks.broken ? "High" : "Medium", area: "SEO Analyzer", actionLabel: "Fix links", url: "/app/internal-links", locked: !input.limits.canInternalLinking });
  }

  if (input.missingFeaturedAlt > 0) {
    add({ id: "featured-alt", title: `Add alt text to ${plural(input.missingFeaturedAlt, "featured image")}`, detail: "Alt text helps image search and accessibility.", impact: "Medium", area: "SEO Analyzer", actionLabel: "Fix in bulk", url: "/app/image-seo", locked: !input.limits.canBulkReview });
  }

  if (input.metaLengthProblems > 0) {
    add({ id: "meta-length", title: `Tidy SEO titles or descriptions on ${plural(input.metaLengthProblems, "post")}`, detail: "Titles or descriptions are too long or too short and may be cut off in search results.", impact: "Low", area: "SEO Analyzer", actionLabel: "Review", url: "/app/optimize", locked: !input.limits.canBulkReview });
  }

  if (input.lowCtrPosts > 0) {
    add({ id: "low-ctr", title: `Improve product placement in ${plural(input.lowCtrPosts, "post")}`, detail: "Readers see the linked products but rarely click them (under 1% CTR).", impact: "Medium", area: "Posts", actionLabel: "Review posts", url: "/app/blogs" });
  } else if (!input.highTrafficNoProducts && input.noLinkedProducts > 0) {
    add({ id: "no-products", title: `Link products to ${plural(input.noLinkedProducts, "post")}`, detail: "Shoppable posts turn readers into customers.", impact: "Low", area: "Posts", actionLabel: "Link products", url: "/app/blogs" });
  }

  if (!input.trackingEventsReceived) {
    add({ id: "tracking", title: "Confirm storefront tracking", detail: "No widget events have been received yet. Check that the app embed and pixel are on.", impact: "Low", area: "Setup", actionLabel: "Theme setup", url: "/app/theme-setup" });
  }

  return tasks
    .map((task, order) => ({ task, order }))
    // Unlocked work first within the same impact, so merchants see what they can do today.
    .sort((a, b) => IMPACT_RANK[a.task.impact] - IMPACT_RANK[b.task.impact] || Number(a.task.locked) - Number(b.task.locked) || a.order - b.order)
    .slice(0, maxTasks)
    .map(({ task }) => task);
}

export type ScorePart = { label: string; score: number | null; count: number };

export type StoreSeoScore = {
  score: number | null;
  parts: ScorePart[];
};

/**
 * Store-wide SEO health: content scores weighted by how many resources were
 * scanned, then blended 80/20 with storefront speed when a speed scan exists.
 */
export function computeStoreSeoScore(input: {
  blog: { average: number | null; count: number };
  products: { average: number | null; count: number };
  collections: { average: number | null; count: number };
  speed: number | null;
}): StoreSeoScore {
  const parts: ScorePart[] = [
    { label: "Blog posts", score: roundOrNull(input.blog.average), count: input.blog.count },
    { label: "Products", score: roundOrNull(input.products.average), count: input.products.count },
    { label: "Collections", score: roundOrNull(input.collections.average), count: input.collections.count },
    { label: "Site speed", score: roundOrNull(input.speed), count: input.speed === null ? 0 : 1 },
  ];

  const content = parts.slice(0, 3).filter((part) => part.score !== null && part.count > 0);
  const contentCount = content.reduce((sum, part) => sum + part.count, 0);
  const contentScore = contentCount
    ? content.reduce((sum, part) => sum + (part.score as number) * part.count, 0) / contentCount
    : null;

  let score: number | null = contentScore;
  if (contentScore !== null && input.speed !== null) score = contentScore * 0.8 + input.speed * 0.2;
  else if (contentScore === null && input.speed !== null) score = input.speed;

  return { score: roundOrNull(score), parts };
}

function roundOrNull(value: number | null) {
  return value === null || !Number.isFinite(value) ? null : Math.max(0, Math.min(100, Math.round(value)));
}

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}
