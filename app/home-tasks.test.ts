import { describe, expect, it } from "vitest";
import { buildHomeTasks, computeStoreSeoScore, type HomeTaskInput } from "./home-tasks";

const NOW = new Date("2026-11-16T00:00:00Z");
const allTools = { canBulkReview: true, canCatalogSeo: true, canContentDecay: true, canInternalLinking: true };

function input(overrides: Partial<HomeTaskInput> = {}): HomeTaskInput {
  return {
    now: NOW,
    lastScanAt: new Date("2026-11-15T00:00:00Z"),
    articlesScanned: 10,
    lowScoreArticles: 0,
    missingMetaDescriptions: 0,
    metaLengthProblems: 0,
    missingFeaturedAlt: 0,
    productIssues: 0,
    collectionIssues: 0,
    decay: null,
    internalLinks: null,
    highTrafficNoProducts: 0,
    noLinkedProducts: 0,
    lowCtrPosts: 0,
    trackingEventsReceived: true,
    limits: allTools,
    ...overrides,
  };
}

describe("buildHomeTasks", () => {
  it("returns nothing for a healthy, recently scanned store", () => {
    expect(buildHomeTasks(input())).toEqual([]);
  });

  it("asks for a first scan before anything else", () => {
    const tasks = buildHomeTasks(input({ lastScanAt: null, articlesScanned: 0, trackingEventsReceived: false }));
    expect(tasks[0].id).toBe("first-scan");
    expect(tasks.map((task) => task.id)).toContain("tracking");
  });

  it("flags stale scans", () => {
    const tasks = buildHomeTasks(input({ lastScanAt: new Date("2026-10-01T00:00:00Z") }));
    expect(tasks.map((task) => task.id)).toEqual(["stale-scan"]);
  });

  it("orders by impact and puts unlocked work first within an impact level", () => {
    const tasks = buildHomeTasks(input({
      missingMetaDescriptions: 4,
      lowScoreArticles: 2,
      missingFeaturedAlt: 3,
      productIssues: 5,
      limits: { ...allTools, canBulkReview: false },
    }));
    expect(tasks.map((task) => task.id)).toEqual(["low-score", "meta-description", "catalog", "featured-alt"]);
    expect(tasks.find((task) => task.id === "meta-description")?.locked).toBe(true);
    expect(tasks.find((task) => task.id === "low-score")?.locked).toBe(false);
  });

  it("links catalog work to the resource type with more issues", () => {
    const [task] = buildHomeTasks(input({ productIssues: 1, collectionIssues: 4 }));
    expect(task.url).toBe("/app/catalog-seo?view=issues&type=collection");
    expect(task.title).toBe("Fix SEO on 5 products and collections");
  });

  it("raises internal links to high impact when links are broken", () => {
    const [task] = buildHomeTasks(input({ internalLinks: { orphans: 1, broken: 2 } }));
    expect(task.impact).toBe("High");
    expect(task.detail).toBe("1 post with no internal links pointing to them and 2 broken internal links.");
  });

  it("caps the queue length", () => {
    const tasks = buildHomeTasks(input({
      lastScanAt: null, missingMetaDescriptions: 1, lowScoreArticles: 1, decay: { high: 1, total: 2 },
      highTrafficNoProducts: 1, productIssues: 1, internalLinks: { orphans: 1, broken: 0 },
      missingFeaturedAlt: 1, metaLengthProblems: 1, lowCtrPosts: 1, trackingEventsReceived: false,
    }), 5);
    expect(tasks).toHaveLength(5);
    expect(tasks.every((task) => task.impact === "High")).toBe(true);
  });
});

describe("computeStoreSeoScore", () => {
  it("weights content scores by resource count and blends speed 80/20", () => {
    const result = computeStoreSeoScore({
      blog: { average: 80, count: 10 },
      products: { average: 50, count: 30 },
      collections: { average: null, count: 0 },
      speed: 90,
    });
    // content = (80*10 + 50*30) / 40 = 57.5 → 57.5*0.8 + 90*0.2 = 64
    expect(result.score).toBe(64);
    expect(result.parts.map((part) => part.score)).toEqual([80, 50, null, 90]);
  });

  it("returns null when nothing has been scanned", () => {
    expect(computeStoreSeoScore({
      blog: { average: null, count: 0 }, products: { average: null, count: 0 }, collections: { average: null, count: 0 }, speed: null,
    }).score).toBeNull();
  });

  it("falls back to speed alone", () => {
    expect(computeStoreSeoScore({
      blog: { average: null, count: 0 }, products: { average: null, count: 0 }, collections: { average: null, count: 0 }, speed: 71.6,
    }).score).toBe(72);
  });
});
