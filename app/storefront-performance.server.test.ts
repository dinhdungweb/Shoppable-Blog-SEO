import { afterEach, describe, expect, it, vi } from "vitest";
import { runStorefrontPerformanceScan } from "./storefront-performance.server";

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
        lighthouseResult: {
          requestedUrl: "https://shop.example.com/",
          finalUrl: "https://shop.example.com/",
          runWarnings: [],
          categories: {
            performance: { score: mobile ? 0.61 : 0.88 },
            seo: { score: mobile ? 0.92 : 0.94 },
          },
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
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects non-HTTPS scan targets", async () => {
    await expect(runStorefrontPerformanceScan("http://localhost:3000/"))
      .rejects.toThrow("Only public HTTPS storefront URLs can be scanned");
  });
});
