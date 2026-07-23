import { describe, expect, it } from "vitest";
import {
  getContentBriefProductBlockId,
  prepareContentBriefProductBody,
  removeContentBriefProductBlock,
  stripInvalidProductMarkers,
} from "./content-brief-products";

describe("content brief product placement", () => {
  it("removes AI-invented product-title markers but preserves supported markers", () => {
    expect(stripInvalidProductMarkers(
      "<p>Before</p>[[SBS_PRODUCTS:Ontario Lotus Silver]][[SBS_PRODUCTS:block_123]]",
    )).toBe("<p>Before</p>[[SBS_PRODUCTS:block_123]]");
  });

  it("inserts one stable product block after the list containing the first product mention", () => {
    const body = [
      "<p>Introduction.</p>",
      "<ul><li>Try Ontario Lotus Silver for this use case.</li><li>Another option.</li></ul>",
      "<h2>Care guide</h2>",
    ].join("");

    const result = prepareContentBriefProductBody(body, "cm123", [
      { productTitle: "Ontario Lotus Silver" },
    ]);

    expect(result).toBe(
      "<p>Introduction.</p><ul><li>Try Ontario Lotus Silver for this use case.</li><li>Another option.</li></ul>" +
      "<p>[[SBS_PRODUCTS:brief_cm123]]</p><h2>Care guide</h2>",
    );
    expect(prepareContentBriefProductBody(result, "cm123", [{ productTitle: "Ontario Lotus Silver" }]))
      .toBe(result);
  });

  it("does not insert a product block when the brief has no products", () => {
    expect(prepareContentBriefProductBody("<p>Article</p>", "cm123", []))
      .toBe("<p>Article</p>");
  });

  it("removes the generated brief block when no product can be linked", () => {
    expect(removeContentBriefProductBlock(
      "<p>Before</p><p>[[SBS_PRODUCTS:brief_cm123]]</p><p>After</p>",
      "cm123",
    )).toBe("<p>Before</p><p>After</p>");
  });

  it("creates a marker-safe block id with a maximum length of 64", () => {
    const blockId = getContentBriefProductBlockId(`unsafe id/${"x".repeat(100)}`);
    expect(blockId).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(blockId.length).toBeLessThanOrEqual(64);
  });
});
