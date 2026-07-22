import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveCustomPerformanceUrl, runStorefrontPerformanceScan } from "./storefront-performance.server";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GOOGLE_PAGESPEED_API_KEY;
});

describe("storefront performance scans", () => {
  it("combines mobile and desktop Lighthouse reports", async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      const mobile = url.searchParams.get("strategy") === "mobile";
      return new Response(JSON.stringify({
        loadingExperience: {
          overall_category: "AVERAGE",
          metrics: {
            LARGEST_CONTENTFUL_PAINT_MS: { percentile: 3100, category: "AVERAGE" },
            INTERACTION_TO_NEXT_PAINT: { percentile: 180, category: "FAST" },
            CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 16, category: "AVERAGE" },
          },
        },
        lighthouseResult: {
          requestedUrl: "https://shop.example.com/",
          finalUrl: "https://shop.example.com/",
          runWarnings: [],
          categories: {
            performance: { title: "Performance", score: mobile ? 0.61 : 0.88, auditRefs: [{ id: "largest-contentful-paint", group: "metrics" }] },
            accessibility: { title: "Accessibility", score: 0.87, auditRefs: [] },
            "best-practices": { title: "Best Practices", score: 0.73, auditRefs: [] },
            seo: { title: "SEO", score: mobile ? 0.92 : 0.94, auditRefs: [] },
          },
          categoryGroups: { metrics: { title: "Metrics" } },
          audits: {
            "largest-contentful-paint": { id: "largest-contentful-paint", title: "Largest Contentful Paint", description: "Improve the hero image.", displayValue: "3.1 s", score: 0.55, scoreDisplayMode: "numeric" },
          },
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const report = await runStorefrontPerformanceScan("https://shop.example.com/");

    expect(report.mobile.score).toBe(61);
    expect(report.desktop.score).toBe(88);
    expect(report.seoScore).toBe(93);
    expect(report.mobile.metrics.LCP).toBe("3.1 s");
    expect(report.mobile.opportunities[0]?.id).toBe("largest-contentful-paint");
    expect(report.mobile.categories.accessibility).toBe(87);
    expect(report.mobile.fieldData.metrics).toEqual(expect.arrayContaining([expect.objectContaining({ label: "LCP", value: "3.1 s" })]));
    expect(report.mobile.fieldData.assessment).toBe("failed");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects non-HTTPS scan targets", async () => {
    await expect(runStorefrontPerformanceScan("http://localhost:3000/"))
      .rejects.toThrow("Only public HTTPS storefront URLs can be scanned");
  });

  it("accepts only custom URLs on the current storefront domain", () => {
    expect(resolveCustomPerformanceUrl("/products/ring?variant=1#details", "https://shop.example.com/"))
      .toBe("https://shop.example.com/products/ring?variant=1");
    expect(() => resolveCustomPerformanceUrl("https://other.example.com/products/ring", "https://shop.example.com/"))
      .toThrow("this Shopify storefront domain");
  });
});
