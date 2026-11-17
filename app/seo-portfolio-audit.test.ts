import { describe, expect, it } from "vitest";
import { auditSeoPortfolio, type PortfolioSeoPost } from "./seo-portfolio-audit";

function post(overrides: Partial<PortfolioSeoPost>): PortfolioSeoPost {
  return {
    id: "1",
    title: "Guide to running shoes",
    seoTitle: "Guide to running shoes",
    seoDescription: "Learn how to choose running shoes for daily training.",
    focusKeyword: "running shoes",
    body: "<p>Original useful article content.</p>",
    blogHandle: "news",
    handle: "running-shoes",
    ...overrides,
  };
}

describe("SEO portfolio audit", () => {
  it("detects duplicate metadata and primary-topic cannibalization", () => {
    const result = auditSeoPortfolio([
      post({ id: "1" }),
      post({ id: "2", handle: "shoe-guide-two" }),
    ]);
    const types = result.get("1")?.map((issue) => issue.type);
    expect(types).toContain("duplicate_seo_title");
    expect(types).toContain("duplicate_article_title");
    expect(types).toContain("duplicate_meta_description");
    expect(types).toContain("keyword_cannibalization");
  });

  it("detects overlapping search intent without matching focus keywords", () => {
    const result = auditSeoPortfolio([
      post({ id: "1", title: "Running shoes selection guide", seoTitle: "Running shoes selection guide", focusKeyword: "running shoe guide" }),
      post({ id: "2", title: "Running shoes buying guide", seoTitle: "Running shoes buying guide", focusKeyword: "best shoes for runners", handle: "best-running-shoes" }),
    ]);

    expect(result.get("1")?.some((issue) => issue.type === "search_intent_overlap")).toBe(true);
    expect(result.get("2")?.find((issue) => issue.type === "search_intent_overlap")?.fix).toContain("Shopify URL redirect");
  });

  it("checks near-duplicate content for libraries larger than 300 posts", () => {
    const duplicateBody = `<p>${Array.from({ length: 45 }, (_, index) => `sharedtopic${index}`).join(" ")}</p>`;
    const posts = [
      post({ id: "duplicate-1", title: "First unique title", seoTitle: "First unique title", focusKeyword: "first topic", body: duplicateBody }),
      post({ id: "duplicate-2", title: "Second unique title", seoTitle: "Second unique title", focusKeyword: "second topic", body: duplicateBody }),
      ...Array.from({ length: 300 }, (_, index) => post({
        id: `filler-${index}`,
        title: `Subject fillerword${index}`,
        seoTitle: `Topic uniqueword${index}`,
        seoDescription: `A unique description for unrelated subject ${index}.`,
        focusKeyword: `separate topic ${index}`,
        handle: `unrelated-${index}`,
        body: `<p>independent${index} standalone${index} exclusive${index} material${index}</p>`,
      })),
    ];

    const result = auditSeoPortfolio(posts);
    expect(result.get("duplicate-1")?.some((issue) => issue.type === "near_duplicate_content")).toBe(true);
  });

  it("detects orphan posts and respects contextual inbound links", () => {
    const result = auditSeoPortfolio([
      post({ id: "1", body: '<a href="https://example.com/blogs/news/second-post?utm_source=blog">Read next</a>' }),
      post({ id: "2", title: "Second", seoTitle: "Second", seoDescription: "Unique second description", focusKeyword: "second topic", handle: "second-post" }),
    ]);
    expect(result.get("2")?.some((issue) => issue.type === "orphan_article")).toBe(false);
    expect(result.get("1")?.some((issue) => issue.type === "orphan_article")).toBe(true);
  });
});

describe("SEO portfolio audit scope and languages", () => {
  const types = (result: ReturnType<typeof auditSeoPortfolio>, id: string) => (result.get(id) || []).map((issue) => issue.type);

  it("skips orphan detection for partial scans", () => {
    const posts = [post({ id: "1", handle: "a", title: "Alpha guide" }), post({ id: "2", handle: "b", title: "Beta guide", focusKeyword: "beta" })];
    expect(types(auditSeoPortfolio(posts), "1")).toContain("orphan_article");
    expect(types(auditSeoPortfolio(posts, { includeOrphans: false }), "1")).not.toContain("orphan_article");
  });

  it("counts locale-prefixed links as inbound links", () => {
    const posts = [
      post({ id: "1", handle: "a", title: "Alpha guide", body: '<p><a href="https://shop.com/fr-ca/blogs/news/b">Beta</a></p>' }),
      post({ id: "2", handle: "b", title: "Beta guide", focusKeyword: "beta", body: '<p><a href="/en/blogs/news/a">Alpha</a></p>' }),
    ];
    const result = auditSeoPortfolio(posts);
    expect(types(result, "1")).not.toContain("orphan_article");
    expect(types(result, "2")).not.toContain("orphan_article");
  });

  it("detects duplicate Vietnamese titles, including đ and composition differences", () => {
    const title = "Cách chọn giày chạy địa hình";
    const result = auditSeoPortfolio([
      post({ id: "1", title, seoTitle: "Một", seoDescription: "Mô tả một", focusKeyword: "" }),
      post({ id: "2", title: title.normalize("NFD"), seoTitle: "Hai", seoDescription: "Mô tả hai", focusKeyword: "" }),
    ], { includeOrphans: false });
    expect(types(result, "1")).toContain("duplicate_article_title");
  });

  it("detects near-duplicate Vietnamese articles made of short syllables", () => {
    const body = "<p>Giày chạy bộ địa hình cần độ bám tốt, đế dày và ôm gót chân để đi đường núi an toàn hơn mỗi ngày. "
      + "Khi thử nghiệm mười hai mẫu trong ba tháng, chúng tôi đo độ êm, trọng lượng, khả năng thoát nước và độ bền của lớp vải lưới. "
      + "Người mới nên ưu tiên đệm dày, rãnh sâu bốn ly, mũi giày rộng; vận động viên lâu năm thường thích đế mỏng, nhẹ, phản hồi nhanh. "
      + "Hãy mang thử buổi chiều, đi kèm tất chuyên dụng, kiểm tra gót không trượt và ngón cái còn khoảng trống bằng một đốt tay.</p>";
    const result = auditSeoPortfolio([
      post({ id: "1", title: "Giày chạy núi", seoTitle: "Giày chạy núi", seoDescription: "A", focusKeyword: "", body }),
      post({ id: "2", title: "Chọn giày trail", seoTitle: "Chọn giày trail", seoDescription: "B", focusKeyword: "", body: body.replace("mỗi ngày", "mỗi tuần") }),
    ], { includeOrphans: false });
    expect(types(result, "1")).toContain("near_duplicate_content");
  });
});
