import { describe, expect, it } from "vitest";
import { getPublicSeoScanError } from "./seo-scan-error";

describe("getPublicSeoScanError", () => {
  it("does not expose internal endpoints", () => {
    const message = getPublicSeoScanError("SEO worker endpoint http://127.0.0.1:3004/app/seo returned text/html");
    expect(message).not.toContain("127.0.0.1");
    expect(message).not.toContain("endpoint");
  });

  it("provides actionable messages for safe known failures", () => {
    expect(getPublicSeoScanError("Shopify API rate limit exceeded")).toContain("wait a few minutes");
  });
});
