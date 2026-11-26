import { useCallback, useEffect, useState } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  useLoaderData,
  useNavigate,
  useFetcher,
  useNavigation,
  useSearchParams,
} from "@remix-run/react";
import {
  Badge,
  Banner,
  Card,
  Modal,
  Text,
  BlockStack,
  InlineStack,
  IndexTable,
  useIndexResourceState,
  Box,
  ChoiceList,
  IndexFilters,
  useSetIndexFiltersMode,
} from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate, getActivePlanAndLimits } from "../shopify.server";
import prisma from "../db.server";
import { formatLimit } from "../pricing-plans";
import { CONTENT_WORKSPACE_TABS } from "../components/WorkspaceTabs";
import { analyticsWindow, formatMoney, groupRows } from "../analytics-core";
import { canonicalArticleId, getShopLocale, loadLinkedProducts, priceLookup } from "../analytics.server";
import { convertLegacyMarkers } from "../content-markers.server";
import { AppPage } from "../components/AppPage";
import { DotScore, StatTile, StatTiles } from "../components/rm";

const BLOG_MANAGER_PAGE_SIZE = 20;
const METRICS_WINDOW_DAYS = 30;
const NEEDS_SEO_BELOW = 60;

type BlogManagerStatus = "all" | "published" | "draft" | "needs_seo" | "no_products" | "most_read";
type BlogManagerSort = "date_desc" | "date_asc" | "title_asc" | "title_desc";

/** Tabs computed from app data across every post (not just the current Shopify page). */
const DATA_TABS = new Set<BlogManagerStatus>(["needs_seo", "no_products", "most_read"]);

function cleanParam(value: string | null) {
  const trimmed = (value || "").trim();
  return trimmed || null;
}

function getStatusParam(value: string | null): BlogManagerStatus {
  if (value === "high_traffic") return "most_read"; // old links
  if (value === "published" || value === "draft" || value === "needs_seo" || value === "no_products" || value === "most_read") return value;
  return "all";
}

function getSortParam(value: string | null): BlogManagerSort {
  if (value === "date_asc" || value === "title_asc" || value === "title_desc") return value;
  return "date_desc";
}

function getArticleSort(sort: BlogManagerSort) {
  if (sort === "title_asc") return { sortKey: "TITLE", reverse: false };
  if (sort === "title_desc") return { sortKey: "TITLE", reverse: true };
  if (sort === "date_asc") return { sortKey: "PUBLISHED_AT", reverse: false };
  return { sortKey: "PUBLISHED_AT", reverse: true };
}

function getNumericShopifyId(id: string) {
  return id.split("/").pop() || id;
}

/** Shopify search syntax: quote free text so characters like ":" cannot change the query. */
function buildArticleSearchQuery({ search, blogId, status }: { search: string | null; blogId: string | null; status: BlogManagerStatus }) {
  const parts: string[] = [];
  if (search) parts.push(`"${search.replace(/["\\]/g, " ").trim()}"`);
  if (blogId) parts.push(`blog_id:${getNumericShopifyId(blogId)}`);
  if (status === "published") parts.push("published_status:published");
  if (status === "draft") parts.push("published_status:unpublished");
  return parts.length ? parts.join(" ") : null;
}

const ARTICLE_FIELDS = `
  id
  title
  handle
  tags
  publishedAt
  updatedAt
  image { url altText }
  blog { id title handle }
`;

/** Ordered article ids for a data tab, plus counts for every data tab. */
async function loadDataTabs(shop: string, metricsStart: Date) {
  const [seoRows, linked, readers] = await Promise.all([
    prisma.articleSEO.findMany({
      where: { shop, lastAnalyzedAt: { not: null } },
      select: { articleId: true, articleTitle: true, blogHandle: true, seoScore: true, sourceUpdatedAt: true },
    }),
    prisma.articleProduct.findMany({ where: { shop, isActive: true }, select: { articleId: true }, distinct: ["articleId"] }),
    prisma.analyticsDaily.groupBy({
      by: ["articleId"],
      where: { shop, date: { gte: metricsStart }, views: { gt: 0 } },
      _sum: { views: true },
    }),
  ]);
  const withProducts = new Set(linked.map((row) => canonicalArticleId(row.articleId)));
  const byRecent = (a: { sourceUpdatedAt: Date | null }, b: { sourceUpdatedAt: Date | null }) => (b.sourceUpdatedAt?.getTime() || 0) - (a.sourceUpdatedAt?.getTime() || 0);
  const scanned = seoRows.map((row) => ({ ...row, articleId: canonicalArticleId(row.articleId) }));
  const viewTotals = new Map<string, number>();
  for (const row of readers) {
    const id = canonicalArticleId(row.articleId);
    viewTotals.set(id, (viewTotals.get(id) || 0) + (row._sum.views || 0));
  }
  return {
    scanned,
    lists: {
      needs_seo: scanned.filter((row) => row.seoScore < NEEDS_SEO_BELOW).sort((a, b) => a.seoScore - b.seoScore).map((row) => row.articleId),
      no_products: scanned.filter((row) => !withProducts.has(row.articleId)).sort(byRecent).map((row) => row.articleId),
      most_read: [...viewTotals].sort((a, b) => b[1] - a[1]).map(([id]) => id),
    } as Record<"needs_seo" | "no_products" | "most_read", string[]>,
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session, billing } = await authenticate.admin(request);
  const shop = session.shop;
  const { limits } = await getActivePlanAndLimits(billing, shop);
  const url = new URL(request.url);
  const search = cleanParam(url.searchParams.get("search"));
  const blogId = cleanParam(url.searchParams.get("blog"));
  const status = getStatusParam(url.searchParams.get("status"));
  const sort = getSortParam(url.searchParams.get("sort"));
  const after = cleanParam(url.searchParams.get("after"));
  const before = cleanParam(url.searchParams.get("before"));
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const isDataTab = DATA_TABS.has(status);

  const locale = await getShopLocale(admin, shop);
  const { currentStart: metricsStart } = analyticsWindow(new Date(), METRICS_WINDOW_DAYS, locale.timezone);
  const [dataTabs, config] = await Promise.all([
    loadDataTabs(shop, metricsStart),
    prisma.shopConfig.findUnique({ where: { shop }, select: { markersMigratedAt: true } }),
  ]);

  let blogs: Array<{ id: string; title: string; handle: string }> = [];
  let nodes: any[] = [];
  let shopifyError: string | null = null;
  let pagination = { mode: "cursor" as "cursor" | "offset", page, hasNextPage: false, hasPreviousPage: false, startCursor: null as string | null, endCursor: null as string | null, total: null as number | null };

  try {
    if (isDataTab) {
      // Data tabs page through app data, then load just this page from Shopify.
      const blogsResponse = await admin.graphql(`#graphql
        query BlogManagerBlogs { blogs(first: 250) { nodes { id title handle } } }`);
      blogs = ((await blogsResponse.json()) as any).data?.blogs?.nodes || [];
      const blogHandle = blogId ? blogs.find((blog) => blog.id === blogId)?.handle : null;
      const titleMatch = search?.toLowerCase();
      const scannedById = new Map(dataTabs.scanned.map((row) => [row.articleId, row]));
      const ids = dataTabs.lists[status as "needs_seo" | "no_products" | "most_read"].filter((id) => {
        const row = scannedById.get(id);
        if (blogHandle && row && row.blogHandle !== blogHandle) return false;
        if (titleMatch && row && !row.articleTitle.toLowerCase().includes(titleMatch)) return false;
        return true;
      });
      const pageIds = ids.slice((page - 1) * BLOG_MANAGER_PAGE_SIZE, page * BLOG_MANAGER_PAGE_SIZE);
      if (pageIds.length) {
        const response = await admin.graphql(`#graphql
          query BlogManagerArticlesById($ids: [ID!]!) { nodes(ids: $ids) { ... on Article { ${ARTICLE_FIELDS} } } }`, { variables: { ids: pageIds } });
        const payload: any = await response.json();
        if (payload.errors?.length) throw new Error(payload.errors.map((error: any) => error.message).join("; "));
        nodes = (payload.data?.nodes || []).filter(Boolean);
      }
      pagination = { ...pagination, mode: "offset", hasNextPage: page * BLOG_MANAGER_PAGE_SIZE < ids.length, hasPreviousPage: page > 1, total: ids.length };
    } else {
      const { sortKey, reverse } = getArticleSort(sort);
      const response = await admin.graphql(`#graphql
        query GetBlogManagerArticles($first: Int, $last: Int, $after: String, $before: String, $query: String, $sortKey: ArticleSortKeys!, $reverse: Boolean!) {
          articles(first: $first, last: $last, after: $after, before: $before, query: $query, sortKey: $sortKey, reverse: $reverse) {
            nodes { ${ARTICLE_FIELDS} }
            pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
          }
          blogs(first: 250) { nodes { id title handle } }
        }`, {
        variables: {
          first: before ? null : BLOG_MANAGER_PAGE_SIZE,
          last: before ? BLOG_MANAGER_PAGE_SIZE : null,
          after: before ? null : after,
          before,
          query: buildArticleSearchQuery({ search, blogId, status }),
          sortKey,
          reverse,
        },
      });
      const payload: any = await response.json();
      if (payload.errors?.length) throw new Error(payload.errors.map((error: any) => error.message).join("; "));
      nodes = payload.data?.articles?.nodes || [];
      blogs = payload.data?.blogs?.nodes || [];
      const info = payload.data?.articles?.pageInfo || {};
      pagination = { ...pagination, hasNextPage: Boolean(info.hasNextPage), hasPreviousPage: Boolean(info.hasPreviousPage), startCursor: info.startCursor || null, endCursor: info.endCursor || null };
    }
  } catch (error) {
    console.error("[blogs] Failed to load articles from Shopify:", error);
    shopifyError = "Failed to load articles from Shopify.";
  }

  // Page metrics: same aggregates and currency as Insights, last 30 days.
  const articleIds = nodes.map((node) => node.id as string);
  const numericIds = articleIds.map(getNumericShopifyId);
  const [productCounts, seoRows, dailyRows, linkedProducts] = articleIds.length
    ? await Promise.all([
        prisma.articleProduct.groupBy({ by: ["articleId"], where: { shop, articleId: { in: [...articleIds, ...numericIds] }, isActive: true }, _count: { productId: true } }),
        prisma.articleSEO.findMany({ where: { shop, articleId: { in: articleIds } }, select: { articleId: true, seoScore: true, lastAnalyzedAt: true, focusKeyword: true } }),
        prisma.analyticsDaily.findMany({ where: { shop, date: { gte: metricsStart }, articleId: { in: [...articleIds, ...numericIds] } } }),
        loadLinkedProducts(shop),
      ])
    : [[], [], [], []];
  const productCountMap = new Map<string, number>();
  for (const row of productCounts) {
    const id = canonicalArticleId(row.articleId);
    productCountMap.set(id, (productCountMap.get(id) || 0) + row._count.productId);
  }
  const seoMap = new Map(seoRows.map((row) => [row.articleId, row.lastAnalyzedAt ? row.seoScore : null]));
  const keywordMap = new Map(seoRows.map((row) => [row.articleId, row.focusKeyword || ""]));
  const metrics = groupRows(
    dailyRows.map((row) => ({ ...row, articleId: canonicalArticleId(row.articleId), revenue: Number(row.revenue) })),
    (row) => row.articleId,
    locale.currencyCode,
    priceLookup(linkedProducts),
  );

  const articles = nodes.map((article) => {
    const postMetrics = metrics.get(article.id);
    return {
      id: article.id as string,
      title: article.title as string,
      handle: article.handle as string,
      publishedAt: article.publishedAt as string | null,
      updatedAt: article.updatedAt as string | null,
      image: article.image?.url || null,
      blogTitle: article.blog?.title || "Default",
      productCount: productCountMap.get(article.id) || 0,
      seoScore: seoMap.has(article.id) ? seoMap.get(article.id)! : null,
      focusKeyword: keywordMap.get(article.id) || "",
      readers: postMetrics?.views || 0,
      clicks: postMetrics?.clicks || 0,
      revenue: postMetrics?.revenue || 0,
    };
  });

  return {
    articles,
    blogs: blogs.map((blog) => ({ id: blog.id, title: blog.title, handle: blog.handle })),
    summary: {
      scanned: dataTabs.scanned.length,
      averageScore: dataTabs.scanned.length ? Math.round(dataTabs.scanned.reduce((sum, row) => sum + row.seoScore, 0) / dataTabs.scanned.length) : null,
      readers: articles.reduce((sum, article) => sum + article.readers, 0),
    },
    tabCounts: {
      needsSeo: dataTabs.lists.needs_seo.length,
      noProducts: dataTabs.lists.no_products.length,
      mostRead: dataTabs.lists.most_read.length,
    },
    filters: { search: search || "", blogId: blogId || "all", status, sort },
    pagination: { ...pagination, pageSize: BLOG_MANAGER_PAGE_SIZE },
    currency: locale.currencyCode,
    metricsWindowDays: METRICS_WINDOW_DAYS,
    markersMigrated: Boolean(config?.markersMigratedAt),
    error: shopifyError,
    shop,
    canBulkReview: limits.canBulkReview,
  };
};

/** Runs Shopify mutations a few at a time and reports per-article failures. */
async function runForArticles(
  ids: string[],
  run: (id: string) => Promise<string | null>,
  concurrency = 4,
) {
  const failed: Array<{ id: string; error: string }> = [];
  const succeeded: string[] = [];
  for (let index = 0; index < ids.length; index += concurrency) {
    const results = await Promise.all(ids.slice(index, index + concurrency).map(async (id) => {
      try {
        return { id, error: await run(id) };
      } catch (error) {
        return { id, error: error instanceof Error ? error.message : "Request failed" };
      }
    }));
    for (const result of results) {
      if (result.error) failed.push({ id: result.id, error: result.error });
      else succeeded.push(result.id);
    }
  }
  return { succeeded, failed };
}

function userErrorMessage(payload: any, key: string) {
  const errors = [...(payload.errors || []), ...(payload.data?.[key]?.userErrors || [])];
  return errors.length ? String(errors[0].message || "Shopify rejected the change") : null;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session, billing } = await authenticate.admin(request);
  const shop = session.shop;
  const { limits, planKey } = await getActivePlanAndLimits(billing, shop);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "bulk_draft" || intent === "bulk_publish") {
    const ids = parseArticleIds(String(formData.get("ids") || ""));
    const result = await runForArticles(ids, async (id) => {
      const response = await admin.graphql(`#graphql
        mutation BulkPublishArticle($id: ID!, $article: ArticleUpdateInput!) {
          articleUpdate(id: $id, article: $article) { article { id } userErrors { field message } }
        }`, { variables: { id, article: { isPublished: intent === "bulk_publish" } } });
      return userErrorMessage(await response.json(), "articleUpdate");
    });
    return json({ intent, updated: result.succeeded.length, failed: result.failed });
  }

  if (intent === "bulk_delete") {
    const ids = parseArticleIds(String(formData.get("ids") || ""));
    const result = await runForArticles(ids, async (id) => {
      const response = await admin.graphql(`#graphql
        mutation DeleteArticle($id: ID!) { articleDelete(id: $id) { deletedArticleId userErrors { field message } } }`, { variables: { id } });
      return userErrorMessage(await response.json(), "articleDelete");
    });
    if (result.succeeded.length) {
      // App data for deleted posts (both stored id formats). Analytics history is kept.
      const deletedIds = [...result.succeeded, ...result.succeeded.map(getNumericShopifyId)];
      await prisma.$transaction([
        prisma.articleProduct.deleteMany({ where: { shop, articleId: { in: deletedIds } } }),
        prisma.articleSEO.deleteMany({ where: { shop, articleId: { in: deletedIds } } }),
      ]);
    }
    return json({ intent, deleted: result.succeeded.length, failed: result.failed });
  }

  if (intent === "convert_markers") {
    try {
      return json({ intent, ...(await convertLegacyMarkers(admin, shop)) });
    } catch (error) {
      return json({ intent, error: error instanceof Error ? error.message : "Could not update placeholders." }, { status: 500 });
    }
  }

  if (intent === "link_products") {
    const articleId = formData.get("articleId") as string;
    const articleTitle = formData.get("articleTitle") as string;
    const articleHandle = formData.get("articleHandle") as string;
    const blogId = formData.get("blogId") as string;
    const productsJson = formData.get("products") as string;

    if (!articleId || !productsJson) return json({ error: "Missing data" }, { status: 400 });

    const submittedProducts = parseProductSelection(productsJson);
    const articleResponse = await admin.graphql(
      `#graphql
      query ValidateArticleAndProducts($articleId: ID!, $productIds: [ID!]!) {
        article: node(id: $articleId) { ... on Article { id title handle blog { id } } }
        products: nodes(ids: $productIds) {
          ... on Product { id title handle featuredImage { url } priceRangeV2 { minVariantPrice { amount } } }
        }
      }`,
      { variables: { articleId, productIds: submittedProducts.map((product) => product.id) } },
    );
    const validationPayload: any = await articleResponse.json();
    const verifiedArticle = validationPayload.data?.article;
    const products = (validationPayload.data?.products || []).filter(Boolean);
    if (!verifiedArticle || products.length !== submittedProducts.length) {
      return json({ error: "One or more selected resources do not belong to this shop." }, { status: 400 });
    }

    const alreadyShoppable = await prisma.articleProduct.findFirst({
      where: { shop, articleId, isActive: true },
      select: { id: true },
    });
    if (!alreadyShoppable && Number.isFinite(limits.shoppableArticles)) {
      const activeArticles = await prisma.articleProduct.groupBy({
        by: ["articleId"],
        where: { shop, isActive: true },
      });
      if (activeArticles.length >= limits.shoppableArticles) {
        return json(
          { error: `Your ${planKey} plan allows ${formatLimit(limits.shoppableArticles)} shoppable articles.` },
          { status: 403 },
        );
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.articleProduct.updateMany({
        where: { shop, articleId, blockId: "default" },
        data: { isActive: false },
      });
      for (let i = 0; i < products.length; i++) {
        const product = products[i];
        const data = {
          articleTitle: verifiedArticle.title || articleTitle,
          articleHandle: verifiedArticle.handle || articleHandle,
          blogId: verifiedArticle.blog?.id || blogId,
          productTitle: product.title,
          productHandle: product.handle,
          productImage: product.featuredImage?.url || "",
          productPrice: product.priceRangeV2?.minVariantPrice?.amount || "0",
          position: i,
        };
        await tx.articleProduct.upsert({
          where: { shop_articleId_blockId_productId: { shop, articleId, blockId: "default", productId: product.id } },
          update: { ...data, isActive: true },
          create: { shop, articleId, blockId: "default", productId: product.id, ...data },
        });
      }
    });

    return json({ success: true, linkedCount: products.length });
  }

  return json({ error: "Invalid intent" }, { status: 400 });
};

function parseArticleIds(value: string) {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Response("Invalid article list", { status: 400 }); }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 50 || parsed.some((id) => typeof id !== "string" || !/^gid:\/\/shopify\/Article\/\d+$/.test(id))) {
    throw new Response("Invalid article list", { status: 400 });
  }
  return [...new Set(parsed)] as string[];
}

function parseProductSelection(value: string) {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Response("Invalid product selection", { status: 400 }); }
  if (!Array.isArray(parsed) || parsed.length > 12 || parsed.some((product) => !product || typeof product.id !== "string" || !/^gid:\/\/shopify\/Product\/\d+$/.test(product.id))) {
    throw new Response("Invalid product selection", { status: 400 });
  }
  const unique = new Map(parsed.map((product: { id: string }) => [product.id, product]));
  return [...unique.values()] as Array<{ id: string }>;
}


type ActionResult = {
  intent?: string;
  updated?: number;
  deleted?: number;
  converted?: number;
  scanned?: number;
  done?: boolean;
  failed?: Array<{ id: string; error: string } | string>;
  error?: string;
};

const POST_VIEWS: Array<{ id: BlogManagerStatus; label: string; count?: "needsSeo" | "noProducts" | "mostRead" }> = [
  { id: "all", label: "All" },
  { id: "published", label: "Published" },
  { id: "draft", label: "Draft" },
  { id: "needs_seo", label: "Needs SEO", count: "needsSeo" },
  { id: "no_products", label: "No products", count: "noProducts" },
  { id: "most_read", label: "Most read", count: "mostRead" },
];

const POST_SORT_OPTIONS: Array<{ label: string; value: `${string} ${"asc" | "desc"}`; directionLabel: string }> = [
  { label: "Updated", value: "date desc", directionLabel: "Newest first" },
  { label: "Updated", value: "date asc", directionLabel: "Oldest first" },
  { label: "Title", value: "title asc", directionLabel: "A–Z" },
  { label: "Title", value: "title desc", directionLabel: "Z–A" },
];

export default function BlogManager() {
  const { articles, blogs, summary, tabCounts, filters, pagination, canBulkReview, currency, metricsWindowDays, markersMigrated, error } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionResult>();
  const markerFetcher = useFetcher<ActionResult>();
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const [searchParams] = useSearchParams();
  const [searchValue, setSearchValue] = useState(filters.search);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const isDataTab = filters.status === "needs_seo" || filters.status === "no_products" || filters.status === "most_read";
  const navigation = useNavigation();
  const { mode, setMode } = useSetIndexFiltersMode();

  const getListUrl = useCallback(
    (updates: Record<string, string | null>) => {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("after");
      nextParams.delete("before");
      nextParams.delete("page");
      Object.entries(updates).forEach(([key, value]) => {
        if (!value || value === "all" || (key === "sort" && value === "date_desc")) nextParams.delete(key);
        else nextParams.set(key, value);
      });
      const queryString = nextParams.toString();
      return `/app/blogs${queryString ? `?${queryString}` : ""}`;
    },
    [searchParams],
  );

  const updateFilters = useCallback((updates: Record<string, string | null>) => navigate(getListUrl(updates)), [getListUrl, navigate]);

  const goToPage = useCallback(
    (direction: "next" | "previous") => {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("after");
      nextParams.delete("before");
      if (pagination.mode === "offset") {
        nextParams.set("page", String(Math.max(1, pagination.page + (direction === "next" ? 1 : -1))));
      } else {
        const cursor = direction === "next" ? pagination.endCursor : pagination.startCursor;
        if (!cursor) return;
        nextParams.set(direction === "next" ? "after" : "before", cursor);
      }
      const queryString = nextParams.toString();
      navigate(`/app/blogs${queryString ? `?${queryString}` : ""}`);
    },
    [navigate, pagination, searchParams],
  );

  useEffect(() => { setSearchValue(filters.search); }, [filters.search]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      if (searchValue !== filters.search) updateFilters({ search: searchValue });
    }, 400);
    return () => window.clearTimeout(handle);
  }, [filters.search, searchValue, updateFilters]);

  // Bulk action results.
  useEffect(() => {
    const result = fetcher.data;
    if (fetcher.state !== "idle" || !result) return;
    const failed = result.failed || [];
    if (result.error) shopify.toast.show(result.error, { isError: true });
    else if (result.intent === "bulk_delete") shopify.toast.show(failed.length ? `${result.deleted} deleted, ${failed.length} failed` : `${result.deleted} post(s) deleted`, { isError: failed.length > 0 });
    else if (result.intent === "bulk_publish" || result.intent === "bulk_draft") shopify.toast.show(failed.length ? `${result.updated} updated, ${failed.length} failed` : `${result.updated} post(s) updated`, { isError: failed.length > 0 });
  }, [fetcher.state, fetcher.data, shopify]);

  const { selectedResources, allResourcesSelected, handleSelectionChange, clearSelection } = useIndexResourceState(articles as any);
  const selectedArticlesData = articles.filter((article) => selectedResources.includes(article.id));
  const hasPublishedSelected = selectedArticlesData.some((article) => article.publishedAt);
  const hasDraftSelected = selectedArticlesData.some((article) => !article.publishedAt);
  const bulkFailures = (fetcher.state === "idle" && fetcher.data?.failed) || [];
  const markerResult = markerFetcher.data;
  const money = (value: number) => formatMoney(value, currency);

  const submitBulk = (intent: string) => {
    fetcher.submit({ intent, ids: JSON.stringify(selectedResources) }, { method: "POST" });
    clearSelection();
  };

  return (
    <AppPage
      title="Posts"
      subtitle="Write, optimize and add products to your blog posts."
      fullWidth
      tabs={{ items: CONTENT_WORKSPACE_TABS, activeId: "posts" }}
      primaryAction={{ content: "Create post", onAction: () => navigate("/app/blogs/new") }}
    >
      <BlockStack gap="500">

        {error && <Banner tone="critical" title={error} />}

        {!markersMigrated && !markerResult?.done && (
          <Banner
            tone="info"
            title="Make product placeholders invisible to search engines"
            action={{ content: markerResult && !markerResult.done ? "Continue" : "Update existing posts", loading: markerFetcher.state !== "idle", onAction: () => markerFetcher.submit({ intent: "convert_markers" }, { method: "POST" }) }}
          >
            <p>
              Older posts store product and table-of-contents placeholders as text such as [[SBS_PRODUCTS]], which can appear in search results, RSS feeds and excerpts.
              This updates them to invisible placeholders. Only the placeholders change; posts you save in the app are updated automatically.
            </p>
            {markerResult?.error && <p>{markerResult.error}</p>}
            {markerResult && !markerResult.error && <p>Updated {markerResult.converted} of {markerResult.scanned} scanned posts{markerResult.done ? "." : ". Run it again to continue."}</p>}
            {(markerResult?.failed || []).slice(0, 3).map((failure) => <p key={String(failure)}>{String(failure)}</p>)}
          </Banner>
        )}
        {markerResult?.done && <Banner tone="success" title={`Placeholders updated in ${markerResult.converted} post(s).`} />}

        <StatTiles>
          <StatTile label="Posts scanned" value={summary.scanned} hint="Run a scan to include new posts" />
          <StatTile label="Average SEO score" value={summary.averageScore === null ? "–" : summary.averageScore} tone={summary.averageScore === null ? "plain" : summary.averageScore >= 80 ? "good" : summary.averageScore >= 50 ? "warn" : "bad"} />
          <StatTile label="Need SEO work" value={tabCounts.needsSeo} hint={`Score below ${NEEDS_SEO_BELOW}`} />
          <StatTile label="Without products" value={tabCounts.noProducts} hint="Readers have nothing to buy" />
        </StatTiles>

        {bulkFailures.length > 0 && (
          <Banner tone="warning" title="Some posts could not be changed">
            {bulkFailures.slice(0, 5).map((failure) => typeof failure === "string" ? <p key={failure}>{failure}</p> : <p key={failure.id}>{articles.find((article) => article.id === failure.id)?.title || failure.id}: {failure.error}</p>)}
          </Banner>
        )}

        <Card padding="0">
          <BlockStack gap="0">
            <IndexFilters
              tabs={POST_VIEWS.map((view) => ({
                id: view.id,
                content: view.id === 'most_read' ? `${view.label} (${metricsWindowDays}d)` : view.label,
                isLocked: true,
                badge: view.count ? String(tabCounts[view.count]) : undefined,
                onAction: () => updateFilters({ status: view.id }),
              }))}
              selected={Math.max(0, POST_VIEWS.findIndex((view) => view.id === filters.status))}
              onSelect={(index) => updateFilters({ status: POST_VIEWS[index]?.id || 'all' })}
              canCreateNewView={false}
              queryValue={searchValue}
              queryPlaceholder="Search posts"
              onQueryChange={setSearchValue}
              onQueryClear={() => setSearchValue('')}
              sortOptions={isDataTab ? undefined : POST_SORT_OPTIONS}
              sortSelected={[filters.sort.replace('_', ' ')]}
              onSort={(value) => updateFilters({ sort: (value[0] || 'date desc').replace(' ', '_') })}
              filters={[{
                key: 'blog',
                label: 'Blog',
                shortcut: true,
                filter: (
                  <ChoiceList
                    title="Blog"
                    titleHidden
                    choices={blogs.map((blog) => ({ label: blog.title, value: blog.id }))}
                    selected={filters.blogId !== 'all' ? [filters.blogId] : []}
                    onChange={(value) => updateFilters({ blog: value[0] || null })}
                  />
                ),
              }]}
              appliedFilters={filters.blogId !== 'all' ? [{
                key: 'blog',
                label: `Blog: ${blogs.find((blog) => blog.id === filters.blogId)?.title || 'Selected'}`,
                onRemove: () => updateFilters({ blog: null }),
              }] : []}
              onClearAll={() => { setSearchValue(''); updateFilters({ blog: null, search: null }); }}
              mode={mode}
              setMode={setMode}
              loading={navigation.state === 'loading'}
            />
            {isDataTab && (
              <Box paddingInline="400" paddingBlock="200" borderBlockEndWidth="025" borderColor="border">
                <Text as="p" variant="bodySm" tone="subdued">
                  {filters.status === "needs_seo" && `Scanned posts with an SEO score below ${NEEDS_SEO_BELOW}, lowest first.`}
                  {filters.status === "no_products" && "Scanned posts without linked products, most recently updated first."}
                  {filters.status === "most_read" && `Posts by readers in the last ${metricsWindowDays} days.`}
                  {" "}Run an SEO scan to include new posts.
                </Text>
              </Box>
            )}

            <IndexTable
              resourceName={{ singular: 'post', plural: 'posts' }}
              itemCount={articles.length}
              selectedItemsCount={allResourcesSelected ? 'All' : selectedResources.length}
              onSelectionChange={handleSelectionChange}
              pagination={pagination.hasNextPage || pagination.hasPreviousPage ? {
                hasNext: pagination.hasNextPage,
                onNext: () => goToPage("next"),
                hasPrevious: pagination.hasPreviousPage,
                onPrevious: () => goToPage("previous"),
                label: pagination.mode === "offset" && pagination.total !== null
                  ? `Page ${pagination.page} of ${Math.max(1, Math.ceil(pagination.total / pagination.pageSize))} · ${pagination.total} posts`
                  : `${articles.length} posts · ${pagination.pageSize} per page`,
              } : undefined}
              promotedBulkActions={[
                {
                  content: canBulkReview ? 'Optimize meta tags' : 'Optimize meta tags (Growth)',
                  onAction: () => navigate(canBulkReview ? `/app/blogs/bulk_edit?ids=${selectedResources.map((id) => id.split('/').pop()).join(',')}` : '/app/pricing?reason=bulk_edit'),
                },
                ...(hasPublishedSelected ? [{ content: 'Set as draft', onAction: () => submitBulk("bulk_draft") }] : []),
                ...(hasDraftSelected ? [{ content: 'Publish posts', onAction: () => submitBulk("bulk_publish") }] : []),
              ]}
              bulkActions={[{ content: 'Delete posts', onAction: () => setDeleteOpen(true) }]}
              headings={[
                { title: 'Post' },
                { title: 'Status' },
                { title: 'SEO details' },
                { title: 'Products' },
                { title: `Readers (${metricsWindowDays}d)`, alignment: 'end' },
                { title: 'Clicks', alignment: 'end' },
                { title: 'Revenue', alignment: 'end' },
                { title: 'Updated' },
              ]}
              selectable
            >
              {articles.map((post, index) => (
                <IndexTable.Row id={post.id} key={post.id} position={index} selected={selectedResources.includes(post.id)} onClick={() => navigate(`/app/blogs/${encodeURIComponent(post.id)}`)}>
                  <IndexTable.Cell>
                    <BlockStack gap="050">
                      <Text as="span" variant="bodyMd" fontWeight="semibold">{post.title}</Text>
                      <Text as="span" variant="bodySm" tone="subdued">{post.blogTitle}</Text>
                    </BlockStack>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{post.publishedAt ? <Badge tone="success">Published</Badge> : <Badge tone="attention">Draft</Badge>}</IndexTable.Cell>
                  <IndexTable.Cell>
                    <InlineStack gap="200" blockAlign="center" wrap={false}>
                      <DotScore score={post.seoScore} />
                      <Text as="span" variant="bodySm" tone={post.focusKeyword ? undefined : "subdued"}>{post.focusKeyword || (post.seoScore === null ? "Not scanned" : "No focus keyword")}</Text>
                    </InlineStack>
                  </IndexTable.Cell>
                  <IndexTable.Cell><Text as="span" variant="bodyMd">{post.productCount}</Text></IndexTable.Cell>
                  <IndexTable.Cell><Text as="span" alignment="end" numeric>{post.readers.toLocaleString()}</Text></IndexTable.Cell>
                  <IndexTable.Cell><Text as="span" alignment="end" numeric>{post.clicks.toLocaleString()}</Text></IndexTable.Cell>
                  <IndexTable.Cell><Text as="span" alignment="end" numeric>{money(post.revenue)}</Text></IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text as="span" variant="bodyMd" tone="subdued">{post.updatedAt ? new Date(post.updatedAt).toLocaleDateString() : '-'}</Text>
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          </BlockStack>
        </Card>
      </BlockStack>

      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={`Delete ${selectedResources.length} post(s)?`}
        primaryAction={{ content: "Delete", destructive: true, loading: fetcher.state !== "idle", onAction: () => { submitBulk("bulk_delete"); setDeleteOpen(false); } }}
        secondaryActions={[{ content: "Cancel", onAction: () => setDeleteOpen(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="200">
            <Text as="p">This permanently deletes the posts from Shopify. It cannot be undone.</Text>
            <Text as="p" tone="subdued">Linked products and SEO data for these posts are removed from the app. Analytics history is kept.</Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </AppPage>
  );
}
