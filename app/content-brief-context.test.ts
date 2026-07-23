import { describe, expect, it } from "vitest";
import { buildContentBriefContext, detectQueryCompetition } from "./content-brief-context";

describe("content brief context", () => {
  it("keeps only related real articles, products and Search Console queries", () => {
    const result = buildContentBriefContext("running shoe sizing", "", {
      articles: [
        { id: "a1", title: "Running shoe size guide", handle: "shoe-size", blogHandle: "news", body: "", focusKeyword: "running shoe sizing" },
        { id: "a2", title: "Coffee brewing", handle: "coffee", blogHandle: "news", body: "", focusKeyword: "coffee" },
      ],
      products: [
        { id: "p1", title: "Road running shoe", handle: "road-shoe", description: "Multiple shoe sizes", productType: "Shoes", vendor: "Store" },
        { id: "p2", title: "Coffee mug", handle: "mug", description: "", productType: "Kitchen", vendor: "Store" },
      ],
      queries: [
        { pageUrl: "/shoe", query: "running shoe size", clicks: 10, impressions: 100, ctr: 0.1, position: 6 },
        { pageUrl: "/coffee", query: "coffee grind", clicks: 5, impressions: 50, ctr: 0.1, position: 4 },
      ],
    });
    expect(result.articles.map((item) => item.id)).toEqual(["a1"]);
    expect(result.products.map((item) => item.id)).toEqual(["p1"]);
    expect(result.queries.map((item) => item.query)).toEqual(["running shoe size"]);
  });

  it("detects a Search Console query ranking on multiple pages", () => {
    expect(detectQueryCompetition([
      { pageUrl: "/one", query: "running shoes", clicks: 1, impressions: 20, ctr: 0.05, position: 8 },
      { pageUrl: "/two", query: "Running Shoes", clicks: 2, impressions: 30, ctr: 0.06, position: 9 },
    ])).toEqual([{ query: "running shoes", pages: ["/one", "/two"] }]);
  });
});
