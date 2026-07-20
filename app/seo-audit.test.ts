import { describe, expect, it } from "vitest";
import { auditSeo } from "./seo-audit";

const base = {
  title: "A useful guide",
  handle: "useful-guide",
  summary: "A practical description that explains what readers will learn from this useful guide.",
  body: "<h2>Introduction</h2><p>This guide gives readers practical, original advice based on experience.</p>",
  hasImage: true,
  imageAlt: "A useful illustration",
  productCount: 1,
};

describe("people-first SEO scoring", () => {
  it("does not impose a 600-word requirement", () => {
    const result = auditSeo(base);
    const lengthIssue = result.issues.find((issue) => issue.type === "content_length");
    expect(lengthIssue?.message).toContain("no preferred word count");
    expect(result.score).toBeGreaterThan(50);
  });

  it("treats focus keywords as optional reporting metadata", () => {
    const withoutKeyword = auditSeo(base);
    const issue = withoutKeyword.issues.find((item) => item.type === "kw_missing");
    expect(issue?.severity).toBe("info");
    expect(withoutKeyword.score).toBeGreaterThanOrEqual(70);
  });
});
