import { describe, expect, it } from "vitest";
import { containsTextMarkers, markersToStorage, storageToMarkers } from "./content-markers";

describe("content markers", () => {
  it("stores marker-only paragraphs as hidden block placeholders", () => {
    expect(markersToStorage("<p>Intro</p><p>[[SBS_PRODUCTS]]</p><p> [[SBS_PRODUCTS:abc:grid]]<br></p>"))
      .toBe('<p>Intro</p><div data-sbs-products="" hidden></div><div data-sbs-products="abc:grid" hidden></div>');
  });

  it("stores inline markers as hidden spans and supports TOC and breadcrumbs", () => {
    expect(markersToStorage("<p>See [[SBS_TOC:left-rail]] below</p><div>[[SBS_BREADCRUMBS]]</div>"))
      .toBe('<p>See <span data-sbs-toc="left-rail" hidden></span> below</p><div data-sbs-breadcrumbs="" hidden></div>');
  });

  it("round-trips back to editor markers", () => {
    const original = "<p>Intro</p><p>[[SBS_PRODUCTS:abc]]</p><p>Text [[SBS_TOC]] more</p>";
    expect(storageToMarkers(markersToStorage(original))).toBe(original);
  });

  it("reads placeholders after Shopify rewrites attributes", () => {
    expect(storageToMarkers('<div hidden="" class="x" data-sbs-products="abc"></div>')).toBe("<p>[[SBS_PRODUCTS:abc]]</p>");
  });

  it("leaves unrelated and malformed elements alone", () => {
    const html = '<div data-other="1"></div><div data-sbs-products="bad value<"></div><p>Plain</p>';
    expect(storageToMarkers(html)).toBe(html);
    expect(markersToStorage("<p>No markers</p>")).toBe("<p>No markers</p>");
    expect(containsTextMarkers("<p>[[SBS_PRODUCTS]]</p>")).toBe(true);
  });
});
