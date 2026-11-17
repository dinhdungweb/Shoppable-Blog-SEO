import prisma from "./db.server";
import { containsTextMarkers, markersToStorage } from "./content-markers";

const MAX_UPDATES_PER_RUN = 150;

/**
 * Converts legacy [[SBS_...]] text placeholders in existing Shopify articles to
 * hidden elements. Runs in batches so a large blog does not hit request limits;
 * call again while `done` is false. Only the article body is changed.
 */
export async function convertLegacyMarkers(admin: any, shop: string) {
  let cursor: string | null = null;
  let hasNextPage = true;
  let scanned = 0;
  let converted = 0;
  const failed: string[] = [];
  let remaining = false;

  while (hasNextPage) {
    const response = await admin.graphql(`#graphql
      query LegacyMarkerArticles($after: String) {
        articles(first: 100, after: $after) {
          nodes { id title body }
          pageInfo { hasNextPage endCursor }
        }
      }`, { variables: { after: cursor } });
    const payload: any = await response.json();
    if (payload.errors?.length) throw new Error(payload.errors.map((error: any) => error.message).join("; "));
    const connection = payload.data?.articles;

    for (const article of connection?.nodes || []) {
      scanned += 1;
      if (!containsTextMarkers(article.body || "")) continue;
      if (converted + failed.length >= MAX_UPDATES_PER_RUN) {
        remaining = true;
        continue;
      }
      const result = await admin.graphql(`#graphql
        mutation ConvertArticleMarkers($id: ID!, $article: ArticleUpdateInput!) {
          articleUpdate(id: $id, article: $article) { userErrors { field message } }
        }`, { variables: { id: article.id, article: { body: markersToStorage(article.body) } } });
      const resultJson: any = await result.json();
      const errors = [...(resultJson.errors || []), ...(resultJson.data?.articleUpdate?.userErrors || [])];
      if (errors.length) failed.push(`${article.title || article.id}: ${errors[0].message}`);
      else converted += 1;
    }

    hasNextPage = Boolean(connection?.pageInfo?.hasNextPage);
    cursor = connection?.pageInfo?.endCursor || null;
    if (hasNextPage && !cursor) break;
  }

  const done = !remaining && failed.length === 0;
  if (done) {
    await prisma.shopConfig.upsert({ where: { shop }, update: { markersMigratedAt: new Date() }, create: { shop, markersMigratedAt: new Date() } });
  }
  return { scanned, converted, failed, done };
}
