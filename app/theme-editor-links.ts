export const THEME_BLOCK_HANDLES = {
  appEmbed: "sbs-article-embed",
  carousel: "sbs-carousel",
  grid: "sbs-grid",
  seoSchema: "sbs-seo-schema",
  breadcrumbs: "sbs-breadcrumbs",
  tableOfContents: "sbs-table-of-contents",
} as const;

export function buildAppEmbedDeepLink(shop: string, apiKey: string) {
  return `https://${shop}/admin/themes/current/editor?context=apps&activateAppId=${apiKey}/${THEME_BLOCK_HANDLES.appEmbed}&template=article`;
}

export function buildArticleBlockDeepLink(
  shop: string,
  apiKey: string,
  handle: Exclude<(typeof THEME_BLOCK_HANDLES)[keyof typeof THEME_BLOCK_HANDLES], "sbs-article-embed">,
) {
  return `https://${shop}/admin/themes/current/editor?template=article&addAppBlockId=${apiKey}/${handle}&target=newAppsSection`;
}
