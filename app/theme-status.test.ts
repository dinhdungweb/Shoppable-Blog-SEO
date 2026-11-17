import { describe, expect, it } from "vitest";
import { parseThemeJson, summarizeThemeBlocks } from "./theme-status";
import { suggestedLanguageForCountry } from "./ai-writing-rules";
import { SETTINGS_TAB_DEFAULTS } from "./settings-defaults";

const header = "/*\n * IMPORTANT: The contents of this file are auto-generated.\n */\n";
const block = (handle: string, extra: Record<string, unknown> = {}) => ({ type: `shopify://apps/rankmath-seo/blocks/${handle}/0b4d7e8a-1111-2222-3333-444455556666`, settings: {}, ...extra });

describe("theme setup status", () => {
  it("parses Shopify JSON files that start with a comment header", () => {
    expect(parseThemeJson(`${header}{"a":1}`)).toEqual({ a: 1 });
    expect(parseThemeJson("not json")).toBeNull();
  });

  it("detects the app embed and blocks on any article template", () => {
    const status = summarizeThemeBlocks([
      { filename: "config/settings_data.json", content: header + JSON.stringify({ current: { blocks: { "1": block("sbs-article-embed") } } }) },
      { filename: "templates/article.json", content: JSON.stringify({ sections: { main: { type: "main-article", blocks: { a: block("sbs-carousel") } } } }) },
      { filename: "templates/article.guide.json", content: JSON.stringify({ sections: { apps: { type: "apps", blocks: { b: block("sbs-table-of-contents"), c: block("sbs-breadcrumbs", { disabled: true }) } } } }) },
      { filename: "templates/product.json", content: JSON.stringify({ sections: { x: { blocks: { d: block("sbs-grid") } } } }) },
    ]);
    expect(status).toEqual({ appEmbed: true, carousel: true, grid: false, seoSchema: false, breadcrumbs: false, tableOfContents: true });
  });

  it("treats a disabled embed and a preset name as expected", () => {
    const disabled = summarizeThemeBlocks([{ filename: "config/settings_data.json", content: JSON.stringify({ current: { blocks: { "1": block("sbs-article-embed", { disabled: true }) } } }) }]);
    expect(disabled.appEmbed).toBe(false);
    const preset = summarizeThemeBlocks([{ filename: "config/settings_data.json", content: JSON.stringify({ current: "Dawn", presets: { Dawn: { blocks: { "1": block("sbs-article-embed") } } } }) }]);
    expect(preset.appEmbed).toBe(true);
  });
});

describe("settings helpers", () => {
  it("suggests a content language only for clear countries", () => {
    expect(suggestedLanguageForCountry("vn")).toBe("Vietnamese");
    expect(suggestedLanguageForCountry("CH")).toBeNull();
  });

  it("never resets custom CSS or the content language", () => {
    const keys = Object.values(SETTINGS_TAB_DEFAULTS).flatMap((tab) => Object.keys(tab));
    expect(keys).not.toContain("customCss");
    expect(keys).not.toContain("contentNavCustomCss");
    expect(keys).not.toContain("language");
    expect(keys).not.toContain("appStatus");
  });
});
