import { describe, expect, it } from "vitest";
import {
  THEME_BLOCK_HANDLES,
  buildAppEmbedDeepLink,
  buildArticleBlockDeepLink,
} from "./theme-editor-links";

describe("theme editor deep links", () => {
  it("opens the article template with the app embed activated", () => {
    expect(buildAppEmbedDeepLink("store.myshopify.com", "api-key")).toBe(
      "https://store.myshopify.com/admin/themes/current/editor?context=apps&activateAppId=api-key/sbs-article-embed&template=article",
    );
  });

  it("adds one app block to a new apps section on the article template", () => {
    expect(
      buildArticleBlockDeepLink(
        "store.myshopify.com",
        "api-key",
        THEME_BLOCK_HANDLES.carousel,
      ),
    ).toBe(
      "https://store.myshopify.com/admin/themes/current/editor?template=article&addAppBlockId=api-key/sbs-carousel&target=newAppsSection",
    );
  });
});
