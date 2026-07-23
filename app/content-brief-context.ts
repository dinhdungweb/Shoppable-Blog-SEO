export type ContentBriefArticle = {
  id: string;
  title: string;
  handle: string;
  blogHandle: string;
  body: string;
  focusKeyword: string;
};

export type ContentBriefProduct = {
  id: string;
  title: string;
  handle: string;
  description: string;
  productType: string;
  vendor: string;
};

export type ContentBriefQuery = {
  pageUrl: string;
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type ContentBriefContext = {
  articles: ContentBriefArticle[];
  products: ContentBriefProduct[];
  queries: ContentBriefQuery[];
};

export function buildContentBriefContext(
  seed: string,
  sourceArticleId: string,
  input: ContentBriefContext,
): ContentBriefContext {
  const seedTokens = words(seed);
  const score = (value: string) => similarity(seedTokens, words(value));
  const source = input.articles.find((article) => article.id === sourceArticleId);
  const articles = input.articles
    .filter((article) => article.id !== sourceArticleId)
    .map((article) => ({
      article,
      score: score(`${article.title} ${article.focusKeyword} ${visibleText(article.body).slice(0, 1_500)}`),
    }))
    .filter((item) => item.score >= 0.04)
    .sort((left, right) => right.score - left.score)
    .slice(0, 18)
    .map((item) => item.article);

  const queries = input.queries
    .filter((query) => query.query)
    .map((query) => ({ query, score: score(query.query) }))
    .filter((item) => item.score >= 0.04)
    .sort((left, right) => right.score - left.score || right.query.impressions - left.query.impressions)
    .slice(0, 25)
    .map((item) => item.query);

  const products = input.products
    .map((product) => ({
      product,
      score: score(`${product.title} ${product.productType} ${product.vendor} ${visibleText(product.description).slice(0, 800)}`),
    }))
    .filter((item) => item.score >= 0.04)
    .sort((left, right) => right.score - left.score)
    .slice(0, 15)
    .map((item) => item.product);

  return {
    articles: source ? [source, ...articles] : articles,
    products,
    queries,
  };
}

export function detectQueryCompetition(queries: ContentBriefQuery[]) {
  const pagesByQuery = new Map<string, Set<string>>();
  queries.forEach((row) => {
    const query = normalize(row.query);
    if (!query || !row.pageUrl) return;
    pagesByQuery.set(query, new Set([...(pagesByQuery.get(query) || []), row.pageUrl]));
  });
  return [...pagesByQuery.entries()]
    .filter(([, pages]) => pages.size > 1)
    .map(([query, pages]) => ({ query, pages: [...pages] }))
    .slice(0, 20);
}

function words(value: string) {
  return new Set(normalize(value).split(" ").filter((word) => word.length > 2 && !STOP_WORDS.has(word)));
}

function similarity(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  left.forEach((word) => { if (right.has(word)) overlap += 1; });
  return overlap / Math.sqrt(left.size * right.size);
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function visibleText(value: string) {
  return value.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
}

const STOP_WORDS = new Set("the and for with from this that your you our are was were how what why when where into about guide best tips can will have has một những các và cho của là về cách với trong từ tại được khi sản phẩm bài viết".split(" "));
