import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData, useNavigate } from "@remix-run/react";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  ButtonGroup,
  Card,
  Checkbox,
  ChoiceList,
  Divider,
  EmptyState,
  Icon,
  IndexTable,
  InlineGrid,
  InlineStack,
  Modal,
  Page,
  ProgressBar,
  Select,
  Tabs,
  Text,
  TextField,
  Thumbnail,
} from "@shopify/polaris";
import {
  AlertCircleIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  CashDollarIcon,
  CheckIcon,
  CodeIcon,
  DeleteIcon,
  EditIcon,
  ExternalIcon,
  ImageIcon,
  LinkIcon,
  MagicIcon,
  MenuHorizontalIcon,
  PlusIcon,
  PlayCircleIcon,
  ProductIcon,
  SearchIcon,
  SortIcon,
  DataTableIcon,
  ViewIcon,
} from "@shopify/polaris-icons";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

type SeoIssue = {
  type: string;
  label: string;
  message: string;
  severity: "good" | "info" | "warning" | "critical";
  impact: "Low" | "Medium" | "High";
  effort: "Low" | "Medium" | "High";
};

type ProductMetric = {
  productId: string;
  clicks: number;
  impressions: number;
  addToCarts: number;
  purchases: number;
  revenue: number;
  ctr: number;
};

type ShopifyImageFile = {
  id: string;
  url: string;
  alt: string;
  title: string;
  width?: number;
  height?: number;
  status?: string;
  updatedAt?: string;
};

type EditorImageAlignment = "left" | "center" | "right";
type EditorImageSpacing = {
  top: string;
  right: string;
  bottom: string;
  left: string;
};

type ProductBlockOption = {
  id: string;
  label: string;
  marker: string;
  productCount: number;
};

const DEFAULT_PRODUCT_BLOCK_ID = "default";
const PRODUCT_BLOCK_MARKER_PATTERN = /\[\[SBS_PRODUCTS(?::([a-zA-Z0-9_-]+)(?::([a-zA-Z0-9_-]+))?)?\]\]/g;
const LEGACY_PRODUCT_STYLE_TOKENS = new Set(["carousel", "grid"]);

const STYLE_OPTIONS = [
  { label: "Card", value: "card" },
  { label: "Compact list", value: "compact" },
  { label: "Featured", value: "featured" },
];

const EDITOR_IMAGE_SIZE_OPTIONS = [
  { label: "Original size", value: "original", width: null },
  { label: "Inline (16px)", value: "inline", width: 16 },
  { label: "Icon (32px)", value: "icon", width: 32 },
  { label: "Thumbnail (50px)", value: "thumbnail", width: 50 },
  { label: "Small logo (100px)", value: "small_logo", width: 100 },
  { label: "Logo (160px)", value: "logo", width: 160 },
  { label: "Product thumbnail (240px)", value: "product_thumbnail", width: 240 },
  { label: "Product image (480px)", value: "product_image", width: 480 },
  { label: "Banner image (600px)", value: "banner", width: 600 },
  { label: "Wallpaper (1024px)", value: "wallpaper_1024", width: 1024 },
  { label: "Wallpaper (2048px)", value: "wallpaper_2048", width: 2048 },
] as const;

type EditorImageSize = (typeof EDITOR_IMAGE_SIZE_OPTIONS)[number]["value"];

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const articleId = getArticleId(params.blogId || "");

  const articleResponse = await admin.graphql(
    `#graphql
    query GetArticle($id: ID!) {
      article(id: $id) {
        id
        title
        handle
        tags
        body
        summary
        publishedAt
        updatedAt
        isPublished
        templateSuffix
        image {
          url
          altText
        }
        author {
          name
        }
        blog {
          id
          title
          handle
        }
      }
    }`,
    { variables: { id: articleId } },
  );

  const articleJson = await articleResponse.json();
  const article = articleJson.data?.article;

  if (!article) {
    throw new Response("Article not found", { status: 404 });
  }

  const [linkedProducts, seoData, eventGroups, imageFilesResult] = await Promise.all([
    prisma.articleProduct.findMany({
      where: { shop, articleId, isActive: true },
      orderBy: { position: "asc" },
    }),
    prisma.articleSEO.findFirst({
      where: { shop, articleId },
    }),
    prisma.widgetEvent.groupBy({
      by: ["productId", "blockId", "eventType"],
      where: { shop, articleId },
      _count: { _all: true },
    }),
    fetchShopifyImageFiles(admin),
  ]);

  const metricMap = buildProductMetricMap(eventGroups);
  const embeddedProducts = linkedProducts.map((product) => {
    const metric =
      metricMap.get(productMetricKey(product.blockId, product.productId)) ||
      emptyMetric(product.productId);
    const price = parseMoney(product.productPrice);
    const revenue = metric.purchases * price;

    return {
      ...product,
      clicks: metric.clicks,
      impressions: metric.impressions,
      addToCarts: metric.addToCarts,
      purchases: metric.purchases,
      revenue,
      ctr: metric.impressions > 0 ? (metric.clicks / metric.impressions) * 100 : 0,
    };
  });

  const stats = embeddedProducts.reduce(
    (acc, product) => ({
      clicks: acc.clicks + product.clicks,
      impressions: acc.impressions + product.impressions,
      addToCarts: acc.addToCarts + product.addToCarts,
      purchases: acc.purchases + product.purchases,
      revenue: acc.revenue + product.revenue,
    }),
    { clicks: 0, impressions: 0, addToCarts: 0, purchases: 0, revenue: 0 },
  );

  const initialAudit = auditSeo({
    title: seoData?.metaTitle || article.title || "",
    handle: article.handle || "",
    summary: seoData?.metaDescription || article.summary || "",
    body: article.body || "",
    hasImage: Boolean(article.image?.url),
    imageAlt: article.image?.altText || "",
    productCount: embeddedProducts.length,
  });

  const livePostUrl =
    article.blog?.handle && article.handle
      ? `https://${shop}/blogs/${article.blog.handle}/${article.handle}`
      : `https://${shop}`;

  return json({
    shop,
    article,
    embeddedProducts,
    seoData,
    stats: {
      ...stats,
      ctr: stats.impressions > 0 ? (stats.clicks / stats.impressions) * 100 : 0,
    },
    initialAudit,
    livePostUrl,
    fileImages: imageFilesResult.images,
    fileImagesError: imageFilesResult.error,
  });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const articleId = getArticleId(params.blogId || "");
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "update_post") {
    const title = cleanString(formData.get("title"));
    const handle = cleanHandle(cleanString(formData.get("handle")));
    const summary = cleanString(formData.get("summary"));
    const body = cleanString(formData.get("body"));
    const metaTitle = cleanString(formData.get("metaTitle")) || title;
    const metaDescription = cleanString(formData.get("metaDescription")) || summary;
    const tags = parseTags(cleanString(formData.get("tags")));
    const isPublished = cleanString(formData.get("visibility")) !== "hidden";
    const templateSuffix = cleanString(formData.get("templateSuffix"));
    const hasImage = formData.get("hasImage") === "true";
    const imageUrl = cleanString(formData.get("imageUrl"));
    const imageAlt = cleanString(formData.get("imageAlt"));
    const removeImage = formData.get("removeImage") === "true";
    const productCount = Number(formData.get("productCount") || "0");

    if (!title || !handle) {
      return json(
        { success: false, error: "Title and URL handle are required." },
        { status: 400 },
      );
    }

    const articleInput: Record<string, unknown> = {
      title,
      handle,
      body,
      summary,
      tags,
      isPublished,
      templateSuffix: templateSuffix === "default" ? "" : templateSuffix,
      redirectNewHandle: true,
    };

    if (removeImage) {
      articleInput.image = null;
    } else if (imageUrl) {
      articleInput.image = {
        url: imageUrl,
        altText: imageAlt,
      };
    }

    const response = await admin.graphql(
      `#graphql
      mutation UpdateArticle($id: ID!, $article: ArticleUpdateInput!) {
        articleUpdate(id: $id, article: $article) {
          article {
            id
            title
            handle
            body
            summary
            tags
            publishedAt
            updatedAt
            isPublished
            templateSuffix
            image {
              url
              altText
            }
            blog {
              id
              title
              handle
            }
          }
          userErrors {
            code
            field
            message
          }
        }
      }`,
      { variables: { id: articleId, article: articleInput } },
    );

    const result: any = await response.json();
    const userErrors = result.data?.articleUpdate?.userErrors || [];
    const graphQLErrors = result.errors || [];

    if (userErrors.length || graphQLErrors.length) {
      const message =
        userErrors[0]?.message ||
        graphQLErrors[0]?.message ||
        "Shopify could not update this article.";
      return json({ success: false, error: message }, { status: 400 });
    }

    const audit = auditSeo({
      title: metaTitle,
      handle,
      summary: metaDescription,
      body,
      hasImage: removeImage ? false : Boolean(imageUrl || hasImage),
      imageAlt,
      productCount,
    });

    await prisma.articleSEO.upsert({
      where: { articleId },
      update: {
        shop,
        articleTitle: title,
        seoScore: audit.score,
        metaTitle,
        metaDescription,
        issues: JSON.stringify(audit.issues),
        lastAnalyzedAt: new Date(),
      },
      create: {
        shop,
        articleId,
        articleTitle: title,
        seoScore: audit.score,
        metaTitle,
        metaDescription,
        issues: JSON.stringify(audit.issues),
        lastAnalyzedAt: new Date(),
      },
    });

    return json({
      success: true,
      action: "post_updated",
      article: result.data.articleUpdate.article,
      score: audit.score,
      issues: audit.issues,
    });
  }

  if (intent === "add_products") {
    const products = JSON.parse(cleanString(formData.get("products")) || "[]");
    const articleTitle = cleanString(formData.get("articleTitle"));
    const articleHandle = cleanHandle(cleanString(formData.get("articleHandle")));
    const blogId = cleanString(formData.get("blogId"));
    const blockId = cleanProductBlockId(cleanString(formData.get("blockId")));

    const maxPos = await prisma.articleProduct.findFirst({
      where: { shop, articleId, blockId },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    let nextPosition = (maxPos?.position ?? -1) + 1;

    for (const product of products) {
      await prisma.articleProduct.upsert({
        where: {
          articleId_blockId_productId: {
            articleId,
            blockId,
            productId: product.id,
          },
        },
        update: {
          isActive: true,
          productTitle: product.title,
          productHandle: product.handle,
          productImage: getPickerImage(product),
          productPrice: getPickerPrice(product),
        },
        create: {
          shop,
          articleId,
          articleTitle,
          articleHandle,
          blogId,
          blockId,
          productId: product.id,
          productTitle: product.title,
          productHandle: product.handle,
          productImage: getPickerImage(product),
          productPrice: getPickerPrice(product),
          position: nextPosition++,
          displayStyle: "card",
        },
      });
    }

    return json({ success: true, action: "products_added", count: products.length });
  }

  if (intent === "remove_product") {
    const recordId = cleanString(formData.get("recordId"));
    const productId = cleanString(formData.get("productId"));
    await prisma.articleProduct.updateMany({
      where: recordId ? { shop, articleId, id: recordId } : { shop, articleId, productId },
      data: { isActive: false },
    });
    return json({ success: true, action: "product_removed" });
  }

  if (intent === "update_style") {
    const recordId = cleanString(formData.get("recordId"));
    const productId = cleanString(formData.get("productId"));
    const displayStyle = cleanString(formData.get("displayStyle")) || "card";
    await prisma.articleProduct.updateMany({
      where: recordId ? { shop, articleId, id: recordId } : { shop, articleId, productId },
      data: { displayStyle },
    });
    return json({ success: true, action: "style_updated" });
  }

  if (intent === "reorder") {
    const order = JSON.parse(cleanString(formData.get("order")) || "[]") as string[];
    const blockId = cleanProductBlockId(cleanString(formData.get("blockId")));

    for (let i = 0; i < order.length; i++) {
      await prisma.articleProduct.updateMany({
        where: { shop, articleId, blockId, id: order[i] },
        data: { position: i },
      });
    }

    return json({ success: true, action: "products_reordered" });
  }

  if (intent === "analyze_seo") {
    const audit = auditSeo({
      title: cleanString(formData.get("metaTitle")),
      handle: cleanString(formData.get("handle")),
      summary: cleanString(formData.get("metaDescription")),
      body: cleanString(formData.get("body")),
      hasImage: formData.get("hasImage") === "true",
      imageAlt: cleanString(formData.get("imageAlt")),
      productCount: Number(formData.get("productCount") || "0"),
    });

    await prisma.articleSEO.upsert({
      where: { articleId },
      update: {
        shop,
        articleTitle: cleanString(formData.get("articleTitle")),
        seoScore: audit.score,
        metaTitle: cleanString(formData.get("metaTitle")),
        metaDescription: cleanString(formData.get("metaDescription")),
        issues: JSON.stringify(audit.issues),
        lastAnalyzedAt: new Date(),
      },
      create: {
        shop,
        articleId,
        articleTitle: cleanString(formData.get("articleTitle")),
        seoScore: audit.score,
        metaTitle: cleanString(formData.get("metaTitle")),
        metaDescription: cleanString(formData.get("metaDescription")),
        issues: JSON.stringify(audit.issues),
        lastAnalyzedAt: new Date(),
      },
    });

    return json({ success: true, action: "seo_analyzed", score: audit.score, issues: audit.issues });
  }

  if (intent === "apply_seo_suggestions") {
    const articleTitle = cleanString(formData.get("articleTitle"));
    const body = cleanString(formData.get("body"));
    const handle = cleanString(formData.get("handle"));
    const productCount = Number(formData.get("productCount") || "0");
    const suggestedTitle = makeSeoTitle(articleTitle);
    const suggestedDescription = makeMetaDescription(articleTitle, body);
    const audit = auditSeo({
      title: suggestedTitle,
      handle,
      summary: suggestedDescription,
      body,
      hasImage: formData.get("hasImage") === "true",
      imageAlt: cleanString(formData.get("imageAlt")),
      productCount,
    });

    await prisma.articleSEO.upsert({
      where: { articleId },
      update: {
        shop,
        articleTitle,
        seoScore: audit.score,
        metaTitle: suggestedTitle,
        metaDescription: suggestedDescription,
        issues: JSON.stringify(audit.issues),
        lastAnalyzedAt: new Date(),
      },
      create: {
        shop,
        articleId,
        articleTitle,
        seoScore: audit.score,
        metaTitle: suggestedTitle,
        metaDescription: suggestedDescription,
        issues: JSON.stringify(audit.issues),
        lastAnalyzedAt: new Date(),
      },
    });

    return json({
      success: true,
      action: "seo_suggestions_applied",
      metaTitle: suggestedTitle,
      metaDescription: suggestedDescription,
      score: audit.score,
      issues: audit.issues,
    });
  }

  if (intent === "search_images") {
    const result = await fetchShopifyImageFiles(admin, cleanString(formData.get("query")));

    return json({
      success: !result.error,
      action: "images_searched",
      images: result.images,
      error: result.error,
    });
  }

  if (intent === "upload_image") {
    const file = formData.get("file");

    if (!(file instanceof File) || !file.size) {
      return json(
        { success: false, action: "image_uploaded", error: "Choose an image file to upload." },
        { status: 400 },
      );
    }

    if (!file.type.startsWith("image/")) {
      return json(
        { success: false, action: "image_uploaded", error: "Only image files can be uploaded." },
        { status: 400 },
      );
    }

    const result = await uploadShopifyImageFile(admin, file);

    return json({
      success: !result.error,
      action: "image_uploaded",
      image: result.image,
      error: result.error,
    });
  }

  return json({ success: false, error: "Invalid action." }, { status: 400 });
};

export default function ArticleDetail() {
  const { article, embeddedProducts, seoData, stats, initialAudit, livePostUrl, fileImages, fileImagesError } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const imageFetcher = useFetcher<typeof action>();
  const uploadFetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const navigate = useNavigate();

  const [selectedTab, setSelectedTab] = useState(0);
  const [title, setTitle] = useState(article.title || "");
  const [handle, setHandle] = useState(article.handle || "");
  const [excerpt, setExcerpt] = useState(
    stripHtml(seoData?.metaDescription || article.summary || makeMetaDescription(article.title, article.body || "")),
  );
  const [body, setBody] = useState(article.body || "");
  const [metaTitle, setMetaTitle] = useState(seoData?.metaTitle || article.title || "");
  const [metaDescription, setMetaDescription] = useState(
    seoData?.metaDescription || stripHtml(article.summary || ""),
  );
  const [tags, setTags] = useState((article.tags || []).join(", "));
  const [themeTemplate, setThemeTemplate] = useState(article.templateSuffix || "default");
  const [visibility, setVisibility] = useState(article.isPublished ? "visible" : "hidden");
  const [featuredImageUrl, setFeaturedImageUrl] = useState(article.image?.url || "");
  const [featuredImageAlt, setFeaturedImageAlt] = useState(article.image?.altText || "");
  const [imageFiles, setImageFiles] = useState<ShopifyImageFile[]>(fileImages || []);
  const [imageFilesMessage, setImageFilesMessage] = useState(fileImagesError || "");
  const [imageSearchQuery, setImageSearchQuery] = useState("");
  const [selectedImage, setSelectedImage] = useState<ShopifyImageFile | null>(null);
  const [isImageModalOpen, setIsImageModalOpen] = useState(false);
  const [imagePickerMode, setImagePickerMode] = useState<"featured" | "editor">("featured");
  const [imageRemoved, setImageRemoved] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [showStyleModal, setShowStyleModal] = useState(false);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [selectedStyle, setSelectedStyle] = useState("card");
  const [selectedProductBlockId, setSelectedProductBlockId] = useState(DEFAULT_PRODUCT_BLOCK_ID);
  const editorImageInsertRef = useRef<((image: ShopifyImageFile) => void) | null>(null);
  const previousProductBlockIdsRef = useRef<string[]>([]);

  const fetcherData = fetcher.data as any;
  const imageFetcherData = imageFetcher.data as any;
  const uploadFetcherData = uploadFetcher.data as any;
  const handledFetcherDataRef = useRef<any>(null);
  const persistedIssues = parseIssues(seoData?.issues);
  const currentAudit = useMemo(
    () =>
      auditSeo({
        title: metaTitle,
        handle,
        summary: metaDescription || excerpt,
        body,
        hasImage: Boolean(featuredImageUrl) && !imageRemoved,
        imageAlt: featuredImageAlt,
        productCount: embeddedProducts.length,
      }),
    [
      body,
      embeddedProducts.length,
      excerpt,
      featuredImageAlt,
      featuredImageUrl,
      handle,
      imageRemoved,
      metaDescription,
      metaTitle,
    ],
  );

  const seoScore =
    typeof fetcherData?.score === "number"
      ? fetcherData.score
      : seoData?.seoScore || initialAudit.score || currentAudit.score;
  const seoIssues = Array.isArray(fetcherData?.issues)
    ? fetcherData.issues
    : persistedIssues.length
      ? persistedIssues
      : currentAudit.issues;
  const goodChecks = getGoodSeoChecks(currentAudit, seoIssues);
  const needsImprovement = seoIssues.filter((issue: SeoIssue) => issue.severity !== "good");
  const productBlockOptions = useMemo(
    () => buildProductBlockOptions(body, embeddedProducts),
    [body, embeddedProducts],
  );
  const selectedProductBlock =
    productBlockOptions.find((block) => block.id === selectedProductBlockId) || productBlockOptions[0];
  const selectedBlockProducts = useMemo(
    () =>
      embeddedProducts.filter(
        (product: any) => getProductBlockId(product.blockId) === selectedProductBlock?.id,
      ),
    [embeddedProducts, selectedProductBlock?.id],
  );
  const topProduct = [...embeddedProducts].sort((a, b) => b.clicks - a.clicks)[0] || embeddedProducts[0];
  const isSubmitting = fetcher.state !== "idle";
  const activeImage = imageRemoved ? null : featuredImageUrl;
  const isLoadingImages = imageFetcher.state !== "idle";
  const isUploadingImage = uploadFetcher.state !== "idle";
  const shouldShowSaveBar = isDirty && !isImageModalOpen && !showStyleModal;

  useEffect(() => {
    const ids = productBlockOptions.map((block) => block.id);
    const previousIds = previousProductBlockIdsRef.current;
    const addedId = ids.find((id) => !previousIds.includes(id) && id !== DEFAULT_PRODUCT_BLOCK_ID);

    if (addedId) {
      setSelectedProductBlockId(addedId);
    } else if (!ids.includes(selectedProductBlockId)) {
      setSelectedProductBlockId(ids[0] || DEFAULT_PRODUCT_BLOCK_ID);
    }

    previousProductBlockIdsRef.current = ids;
  }, [productBlockOptions, selectedProductBlockId]);

  useEffect(() => {
    if (!fetcherData) return;
    if (handledFetcherDataRef.current === fetcherData) return;
    handledFetcherDataRef.current = fetcherData;

    if (!fetcherData.success) {
      shopify.toast.show(fetcherData.error || "Action failed.", { isError: true });
      return;
    }

    if (fetcherData.action === "post_updated") {
      setIsDirty(false);
      setImageRemoved(false);
      if (fetcherData.article) {
        setTitle(fetcherData.article.title ?? "");
        setHandle(fetcherData.article.handle ?? "");
        setBody(fetcherData.article.body ?? "");
        setExcerpt(stripHtml(fetcherData.article.summary ?? ""));
        setTags((fetcherData.article.tags || []).join(", "));
        setVisibility(fetcherData.article.isPublished ? "visible" : "hidden");
        setThemeTemplate(fetcherData.article.templateSuffix || "default");
        setFeaturedImageUrl(fetcherData.article.image?.url || "");
        setFeaturedImageAlt(fetcherData.article.image?.altText || "");
      }
      shopify.toast.show("Post updated successfully");
    }

    if (fetcherData.action === "seo_analyzed") {
      shopify.toast.show(`SEO scan complete: ${fetcherData.score}/100`);
    }

    if (fetcherData.action === "seo_suggestions_applied") {
      setMetaTitle(fetcherData.metaTitle);
      setMetaDescription(fetcherData.metaDescription);
      setExcerpt(fetcherData.metaDescription);
      setIsDirty(true);
      shopify.toast.show("SEO suggestions applied. Save the post to publish them.");
    }

    if (fetcherData.action === "products_added") {
      shopify.toast.show(`${fetcherData.count} product${fetcherData.count === 1 ? "" : "s"} added`);
    }

    if (fetcherData.action === "product_removed") {
      shopify.toast.show("Product removed from this article");
    }

    if (fetcherData.action === "products_reordered") {
      shopify.toast.show("Product order updated");
    }

    if (fetcherData.action === "style_updated") {
      setShowStyleModal(false);
      shopify.toast.show("Product display style updated");
    }
  }, [fetcherData, shopify]);

  useEffect(() => {
    if (!imageFetcherData) return;

    if (imageFetcherData.action !== "images_searched") return;

    setImageFiles(imageFetcherData.images || []);
    setImageFilesMessage(imageFetcherData.error || "");
  }, [imageFetcherData]);

  useEffect(() => {
    if (!uploadFetcherData) return;

    if (uploadFetcherData.action !== "image_uploaded") return;

    if (!uploadFetcherData.success || !uploadFetcherData.image) {
      setImageFilesMessage(uploadFetcherData.error || "Could not upload image.");
      return;
    }

    setImageFiles((current) => [
      uploadFetcherData.image,
      ...current.filter((image) => image.id !== uploadFetcherData.image.id),
    ]);
    setSelectedImage(uploadFetcherData.image);
    setImageFilesMessage("");
    shopify.toast.show("Image uploaded");
  }, [shopify, uploadFetcherData]);

  useEffect(() => {
    if (!isImageModalOpen) return;

    const timeout = window.setTimeout(() => {
      const formData = new FormData();
      formData.append("intent", "search_images");
      formData.append("query", imageSearchQuery);
      imageFetcher.submit(formData, { method: "POST" });
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [imageSearchQuery, isImageModalOpen]);

  const markDirty = useCallback(() => setIsDirty(true), []);

  const handleProductBlockInserted = useCallback((blockId: string) => {
    setSelectedProductBlockId(blockId);
  }, []);

  const openImageModal = useCallback(() => {
    const currentImage =
      imageFiles.find((image) => image.url === featuredImageUrl) ||
      (featuredImageUrl
        ? {
            id: featuredImageUrl,
            url: featuredImageUrl,
            alt: featuredImageAlt,
            title: featuredImageAlt || imageTitleFromUrl(featuredImageUrl),
          }
        : null);

    setImagePickerMode("featured");
    editorImageInsertRef.current = null;
    setSelectedImage(currentImage);
    setIsImageModalOpen(true);
  }, [featuredImageAlt, featuredImageUrl, imageFiles]);

  const openEditorImagePicker = useCallback((insertImage: (image: ShopifyImageFile) => void) => {
    editorImageInsertRef.current = insertImage;
    setImagePickerMode("editor");
    setSelectedImage(null);
    setIsImageModalOpen(true);
  }, []);

  const closeImagePicker = useCallback(() => {
    editorImageInsertRef.current = null;
    setIsImageModalOpen(false);
  }, []);

  const applyPickedImage = useCallback(() => {
    if (!selectedImage?.url) return;

    if (imagePickerMode === "editor") {
      editorImageInsertRef.current?.(selectedImage);
      editorImageInsertRef.current = null;
      setSelectedImage(null);
      setIsImageModalOpen(false);
      return;
    }

    setFeaturedImageUrl(selectedImage.url);
    setFeaturedImageAlt(selectedImage.alt || "");
    setImageRemoved(false);
    setIsImageModalOpen(false);
    markDirty();
  }, [imagePickerMode, markDirty, selectedImage]);

  const uploadImageFile = useCallback(
    (file: File) => {
      const formData = new FormData();
      formData.append("intent", "upload_image");
      formData.append("file", file);
      uploadFetcher.submit(formData, {
        method: "POST",
        encType: "multipart/form-data",
      });
    },
    [uploadFetcher],
  );

  const handleSave = useCallback(() => {
    const formData = new FormData();
    formData.append("intent", "update_post");
    formData.append("title", title);
    formData.append("handle", handle);
    formData.append("summary", excerpt);
    formData.append("body", body);
    formData.append("tags", tags);
    formData.append("visibility", visibility);
    formData.append("templateSuffix", themeTemplate);
    formData.append("metaTitle", metaTitle);
    formData.append("metaDescription", metaDescription || excerpt);
    formData.append("hasImage", activeImage ? "true" : "false");
    formData.append("imageUrl", featuredImageUrl);
    formData.append("imageAlt", featuredImageAlt);
    formData.append("removeImage", imageRemoved ? "true" : "false");
    formData.append("productCount", String(embeddedProducts.length));
    fetcher.submit(formData, { method: "POST" });
  }, [
    activeImage,
    body,
    embeddedProducts.length,
    excerpt,
    fetcher,
    featuredImageAlt,
    featuredImageUrl,
    handle,
    imageRemoved,
    metaDescription,
    metaTitle,
    tags,
    themeTemplate,
    title,
    visibility,
  ]);

  const handleRunSeoScan = useCallback(() => {
    const formData = new FormData();
    formData.append("intent", "analyze_seo");
    formData.append("articleTitle", title);
    formData.append("metaTitle", metaTitle);
    formData.append("metaDescription", metaDescription || excerpt);
    formData.append("handle", handle);
    formData.append("body", body);
    formData.append("hasImage", activeImage ? "true" : "false");
    formData.append("imageAlt", featuredImageAlt);
    formData.append("productCount", String(embeddedProducts.length));
    fetcher.submit(formData, { method: "POST" });
  }, [
    activeImage,
    body,
    embeddedProducts.length,
    excerpt,
    fetcher,
    featuredImageAlt,
    handle,
    metaDescription,
    metaTitle,
    title,
  ]);

  const handleApplySeoSuggestions = useCallback(() => {
    const formData = new FormData();
    formData.append("intent", "apply_seo_suggestions");
    formData.append("articleTitle", title);
    formData.append("handle", handle);
    formData.append("body", body);
    formData.append("hasImage", activeImage ? "true" : "false");
    formData.append("imageAlt", featuredImageAlt);
    formData.append("productCount", String(embeddedProducts.length));
    fetcher.submit(formData, { method: "POST" });
  }, [
    activeImage,
    body,
    embeddedProducts.length,
    fetcher,
    featuredImageAlt,
    handle,
    title,
  ]);

  const handleAddProducts = useCallback(async () => {
    try {
      const selected = await shopify.resourcePicker({
        type: "product",
        multiple: true,
        action: "select",
      });

      if (!selected || selected.length === 0) return;

      const products = selected.map((product: any) => ({
        id: product.id,
        title: product.title,
        handle: product.handle,
        images: product.images,
        featuredImage: product.featuredImage,
        variants: product.variants,
        priceRangeV2: product.priceRangeV2,
      }));

      const formData = new FormData();
      formData.append("intent", "add_products");
      formData.append("products", JSON.stringify(products));
      formData.append("articleTitle", title);
      formData.append("articleHandle", handle);
      formData.append("blogId", article.blog.id);
      formData.append("blockId", selectedProductBlock?.id || DEFAULT_PRODUCT_BLOCK_ID);
      fetcher.submit(formData, { method: "POST" });
    } catch (error) {
      console.error("Resource picker error:", error);
      shopify.toast.show("Could not open product picker", { isError: true });
    }
  }, [article.blog.id, fetcher, handle, selectedProductBlock?.id, shopify, title]);

  const handleRemoveProduct = (recordId: string) => {
    const formData = new FormData();
    formData.append("intent", "remove_product");
    formData.append("recordId", recordId);
    fetcher.submit(formData, { method: "POST" });
  };

  const handleMoveProduct = (index: number, direction: "up" | "down") => {
    if (
      (direction === "up" && index === 0) ||
      (direction === "down" && index === selectedBlockProducts.length - 1)
    ) {
      return;
    }

    const ordered = [...selectedBlockProducts];
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    [ordered[index], ordered[targetIndex]] = [ordered[targetIndex], ordered[index]];

    const formData = new FormData();
    formData.append("intent", "reorder");
    formData.append("blockId", selectedProductBlock?.id || DEFAULT_PRODUCT_BLOCK_ID);
    formData.append("order", JSON.stringify(ordered.map((product) => product.id)));
    fetcher.submit(formData, { method: "POST" });
  };

  const openStyleModal = (recordId: string, style: string) => {
    setEditingProductId(recordId);
    setSelectedStyle(style || "card");
    setShowStyleModal(true);
  };

  const submitStyleChange = () => {
    if (!editingProductId) return;
    const formData = new FormData();
    formData.append("intent", "update_style");
    formData.append("recordId", editingProductId);
    formData.append("displayStyle", selectedStyle);
    fetcher.submit(formData, { method: "POST" });
  };

  const resetChanges = () => {
    setTitle(article.title || "");
    setHandle(article.handle || "");
    setExcerpt(stripHtml(seoData?.metaDescription || article.summary || ""));
    setBody(article.body || "");
    setTags((article.tags || []).join(", "));
    setVisibility(article.isPublished ? "visible" : "hidden");
    setThemeTemplate(article.templateSuffix || "default");
    setMetaTitle(seoData?.metaTitle || article.title || "");
    setMetaDescription(seoData?.metaDescription || stripHtml(article.summary || ""));
    setFeaturedImageUrl(article.image?.url || "");
    setFeaturedImageAlt(article.image?.altText || "");
    setSelectedImage(null);
    setIsImageModalOpen(false);
    setImageRemoved(false);
    setIsDirty(false);
  };

  const tabs = [
    { id: "content", content: "Content" },
    { id: "products", content: "Products", badge: String(embeddedProducts.length) },
    { id: "seo", content: "SEO", badge: String(needsImprovement.length) },
    { id: "performance", content: "Performance" },
    { id: "history", content: "History" },
  ];

  return (
    <Page fullWidth>
      <TitleBar title="Blog detail" />
      <style>{DETAIL_STYLES}</style>

      <div className="bp-detail-shell">
        <div className="bp-detail-header">
          <BlockStack gap="300">
            <InlineStack gap="200" blockAlign="center">
              <Button variant="plain" onClick={() => navigate("/app/blogs")}>
                Blog Manager
              </Button>
              <Text as="span" variant="bodySm" tone="subdued">
                /
              </Text>
              <Text as="span" variant="bodySm" fontWeight="semibold">
                {article.title}
              </Text>
            </InlineStack>

            <BlockStack gap="200">
              <InlineStack gap="300" blockAlign="center">
                <Text as="h1" variant="headingXl" fontWeight="bold">
                  {title || article.title}
                </Text>
                <Badge tone={article.isPublished ? "success" : "attention"}>
                  {article.isPublished ? "Published" : "Draft"}
                </Badge>
              </InlineStack>
              <InlineStack gap="300" blockAlign="center">
                <Text as="span" variant="bodySm" tone="subdued">
                  {article.blog.title}
                </Text>
                <Text as="span" variant="bodySm" tone="subdued">
                  {formatDateTime(article.publishedAt || article.updatedAt)}
                </Text>
                <Text as="span" variant="bodySm" tone="subdued">
                  {embeddedProducts.length} products linked
                </Text>
                <InlineStack gap="100" blockAlign="center">
                  <span className="bp-score-dot" />
                  <Text as="span" variant="bodySm" tone="subdued">
                    SEO score: {seoScore}/100
                  </Text>
                </InlineStack>
              </InlineStack>
            </BlockStack>
          </BlockStack>

          <InlineStack gap="300" blockAlign="center">
            <Button icon={ExternalIcon} url={livePostUrl} target="_blank">
              Preview post
            </Button>
            <Button loading={isSubmitting && fetcherData?.action === "seo_analyzed"} onClick={handleRunSeoScan}>
              Run SEO scan
            </Button>
            <Button variant="primary" loading={isSubmitting && fetcherData?.action === "post_updated"} onClick={handleSave}>
              Update post
            </Button>
          </InlineStack>
        </div>

        <InlineGrid columns={{ xs: 1, sm: 2, md: 5 }} gap="400">
          <MetricCard
            title="Status"
            value={article.isPublished ? "Published" : "Draft"}
            tone={article.isPublished ? "success" : "attention"}
            icon={ViewIcon}
          />
          <MetricCard
            title="SEO score"
            value={String(seoScore)}
            suffix="/100"
            tone={seoScore >= 80 ? "success" : seoScore >= 60 ? "warning" : "critical"}
            icon={SortIcon}
            progress={seoScore}
          />
          <MetricCard
            title="Products linked"
            value={String(embeddedProducts.length)}
            tone="info"
            icon={LinkIcon}
          />
          <MetricCard
            title="Product clicks"
            value={String(stats.clicks)}
            tone="magic"
            icon={CheckIcon}
          />
          <MetricCard
            title="Revenue"
            value={formatMoney(stats.revenue)}
            tone="success"
            icon={CashDollarIcon}
          />
        </InlineGrid>

        <div className="bp-detail-tabs">
          <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab} />
        </div>

        <div className="bp-detail-main">
          <main className="bp-detail-content">
            {selectedTab === 0 && (
              <ShopifyContentEditor
                title={title}
                body={body}
                excerpt={excerpt}
                articleTitle={article.title}
                onTitleChange={(value) => {
                  setTitle(value);
                  if (!metaTitle || metaTitle === article.title) setMetaTitle(value);
                  markDirty();
                }}
                onBodyChange={(value) => {
                  setBody(value);
                  markDirty();
                }}
                onExcerptChange={(value) => {
                  setExcerpt(value);
                  if (!metaDescription || metaDescription === seoData?.metaDescription) {
                    setMetaDescription(stripHtml(value));
                  }
                  markDirty();
                }}
                onOpenImagePicker={openEditorImagePicker}
                onProductBlockInserted={handleProductBlockInserted}
              />
            )}

            {selectedTab === 1 && (
              <ProductsPanel
                products={selectedBlockProducts}
                blocks={productBlockOptions}
                selectedBlockId={selectedProductBlock?.id || DEFAULT_PRODUCT_BLOCK_ID}
                onBlockChange={setSelectedProductBlockId}
                onAddProducts={handleAddProducts}
                onMoveProduct={handleMoveProduct}
                onRemoveProduct={handleRemoveProduct}
                onOpenStyleModal={openStyleModal}
              />
            )}

            {selectedTab === 2 && (
              <SeoPanel
                metaTitle={metaTitle}
                metaDescription={metaDescription}
                seoScore={seoScore}
                issues={seoIssues}
                onMetaTitleChange={(value) => {
                  setMetaTitle(value);
                  markDirty();
                }}
                onMetaDescriptionChange={(value) => {
                  setMetaDescription(value);
                  setExcerpt(value);
                  markDirty();
                }}
                onScan={handleRunSeoScan}
                onApplySuggestions={handleApplySeoSuggestions}
                isSubmitting={isSubmitting}
              />
            )}

            {selectedTab === 3 && (
              <PerformancePanel products={embeddedProducts} stats={stats} />
            )}

            {selectedTab === 4 && (
              <HistoryPanel article={article} seoData={seoData} products={embeddedProducts} />
            )}
          </main>

          <aside className="bp-detail-sidebar">
            {selectedTab === 0 ? (
              <>
                <SeoSidebar
                  seoScore={seoScore}
                  goodChecks={goodChecks}
                  issues={needsImprovement}
                  onFixIssues={handleApplySeoSuggestions}
                  isSubmitting={isSubmitting}
                />
                <RecommendationsCard
                  issues={needsImprovement}
                  onApplyAll={handleApplySeoSuggestions}
                  onManageProducts={() => setSelectedTab(1)}
                />
                <ProductsSummaryCard
                  productCount={embeddedProducts.length}
                  ctr={stats.ctr}
                  revenue={stats.revenue}
                  topProduct={topProduct}
                  onManageProducts={() => setSelectedTab(1)}
                />
                <ArticleImageCard
                  article={article}
                  activeImage={activeImage}
                  imageAlt={featuredImageAlt}
                  onOpenImageModal={openImageModal}
                  onRemoveImage={() => {
                    setFeaturedImageUrl("");
                    setFeaturedImageAlt("");
                    setImageRemoved(true);
                    markDirty();
                  }}
                />
              </>
            ) : (
              <>
                <SeoSidebar
                  seoScore={seoScore}
                  goodChecks={goodChecks}
                  issues={needsImprovement}
                  onFixIssues={handleApplySeoSuggestions}
                  isSubmitting={isSubmitting}
                />
                <RecommendationsCard
                  issues={needsImprovement}
                  onApplyAll={handleApplySeoSuggestions}
                  onManageProducts={() => setSelectedTab(1)}
                />
                <ProductsSummaryCard
                  productCount={embeddedProducts.length}
                  ctr={stats.ctr}
                  revenue={stats.revenue}
                  topProduct={topProduct}
                  onManageProducts={() => setSelectedTab(1)}
                />
                <PublishingCard article={article} livePostUrl={livePostUrl} />
              </>
            )}
          </aside>
        </div>
      </div>

      {shouldShowSaveBar && (
        <div className="bp-save-bar">
          <InlineStack align="space-between" blockAlign="center">
            <InlineStack gap="200" blockAlign="center">
              <Icon source={AlertCircleIcon} tone="base" />
              <Text as="span" variant="bodyMd" fontWeight="semibold">
                You have unsaved changes
              </Text>
            </InlineStack>
            <ButtonGroup>
              <Button onClick={resetChanges} disabled={isSubmitting}>
                Discard changes
              </Button>
              <Button variant="primary" loading={isSubmitting} onClick={handleSave}>
                Save changes
              </Button>
            </ButtonGroup>
          </InlineStack>
        </div>
      )}

      <Modal
        open={showStyleModal}
        onClose={() => setShowStyleModal(false)}
        title="Product display style"
        primaryAction={{ content: "Save style", onAction: submitStyleChange, loading: isSubmitting }}
        secondaryActions={[{ content: "Cancel", onAction: () => setShowStyleModal(false) }]}
      >
        <Modal.Section>
          <ChoiceList
            title="Display style"
            choices={STYLE_OPTIONS}
            selected={[selectedStyle]}
            onChange={(selected) => setSelectedStyle(selected[0] || "card")}
          />
        </Modal.Section>
      </Modal>

      <ImagePickerModal
        open={isImageModalOpen}
        images={imageFiles}
        selectedImage={selectedImage}
        searchQuery={imageSearchQuery}
        loading={isLoadingImages}
        uploading={isUploadingImage}
        message={imageFilesMessage}
        onSearchQueryChange={setImageSearchQuery}
        onUploadImage={uploadImageFile}
        onSelectImage={setSelectedImage}
        onClose={closeImagePicker}
        onDone={applyPickedImage}
      />
    </Page>
  );
}

function MetricCard({
  title,
  value,
  suffix,
  tone,
  icon,
  progress,
}: {
  title: string;
  value: string;
  suffix?: string;
  tone: "success" | "attention" | "info" | "magic" | "warning" | "critical";
  icon: any;
  progress?: number;
}) {
  return (
    <Card padding="400">
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="start">
          <BlockStack gap="100">
            <Text as="span" variant="bodySm" tone="subdued">
              {title}
            </Text>
            <InlineStack gap="100" blockAlign="baseline">
              <Text as="span" variant="headingLg" fontWeight="bold" tone={tone as any}>
                {value}
              </Text>
              {suffix && (
                <Text as="span" variant="bodySm" tone="subdued">
                  {suffix}
                </Text>
              )}
            </InlineStack>
          </BlockStack>
          <span className={`bp-metric-icon bp-metric-icon--${tone}`}>
            <Icon source={icon} tone={tone as any} />
          </span>
        </InlineStack>
        {typeof progress === "number" && <ProgressBar progress={progress} tone={progress >= 80 ? "success" : "critical"} />}
      </BlockStack>
    </Card>
  );
}

function ShopifyContentEditor({
  title,
  body,
  excerpt,
  articleTitle,
  onTitleChange,
  onBodyChange,
  onExcerptChange,
  onOpenImagePicker,
  onProductBlockInserted,
}: {
  title: string;
  body: string;
  excerpt: string;
  articleTitle: string;
  onTitleChange: (value: string) => void;
  onBodyChange: (value: string) => void;
  onExcerptChange: (value: string) => void;
  onOpenImagePicker: (insertImage: (image: ShopifyImageFile) => void) => void;
  onProductBlockInserted: (blockId: string) => void;
}) {
  return (
    <BlockStack gap="400">
      <Card padding="400">
        <BlockStack gap="400">
          <TextField
            label="Title"
            value={title}
            suffix={<Icon source={MagicIcon} tone="subdued" />}
            onChange={onTitleChange}
            autoComplete="off"
          />

          <BlockStack gap="200">
            <Text as="span" variant="bodyMd" fontWeight="medium">
              Content
            </Text>
            <RichArticleEditor
              value={body}
              minHeight={500}
              placeholder={`Write ${articleTitle || "your post"}...`}
              onChange={onBodyChange}
              showProductButton
              onOpenImagePicker={onOpenImagePicker}
              onProductBlockInserted={onProductBlockInserted}
            />
          </BlockStack>
        </BlockStack>
      </Card>

      <Card padding="400">
        <BlockStack gap="300">
          <BlockStack gap="100">
            <Text as="h2" variant="headingMd" fontWeight="semibold">
              Excerpt
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              Add a summary of the post to appear on your home page or blog.
            </Text>
          </BlockStack>
          <RichArticleEditor
            value={excerpt}
            minHeight={150}
            placeholder="Write a short summary..."
            onChange={onExcerptChange}
            onOpenImagePicker={onOpenImagePicker}
          />
        </BlockStack>
      </Card>
    </BlockStack>
  );
}

function ImagePickerModal({
  open,
  images,
  selectedImage,
  searchQuery,
  loading,
  uploading,
  message,
  onSearchQueryChange,
  onUploadImage,
  onSelectImage,
  onClose,
  onDone,
}: {
  open: boolean;
  images: ShopifyImageFile[];
  selectedImage: ShopifyImageFile | null;
  searchQuery: string;
  loading: boolean;
  uploading: boolean;
  message?: string;
  onSearchQueryChange: (value: string) => void;
  onUploadImage: (file: File) => void;
  onSelectImage: (image: ShopifyImageFile) => void;
  onClose: () => void;
  onDone: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const uploadFirstImage = (files?: FileList | null) => {
    const file = Array.from(files || []).find((candidate) => candidate.type.startsWith("image/"));
    if (file) onUploadImage(file);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Select image"
      size="large"
      primaryAction={{
        content: "Done",
        onAction: onDone,
        disabled: !selectedImage,
      }}
      secondaryActions={[{ content: "Cancel", onAction: onClose }]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          <InlineStack align="space-between" blockAlign="center" gap="300">
            <div className="bp-image-picker-search">
              <TextField
                label="Search files"
                labelHidden
                value={searchQuery}
                onChange={onSearchQueryChange}
                autoComplete="off"
                placeholder="Search files"
                prefix={<Icon source={SearchIcon} tone="base" />}
              />
            </div>
            <InlineStack gap="200" blockAlign="center">
              <Button icon={SortIcon}>Sort</Button>
              <Button icon={ViewIcon} accessibilityLabel="Grid view" />
            </InlineStack>
          </InlineStack>

          <InlineStack gap="200">
            <Button size="micro">File size</Button>
            <Button size="micro">Used in</Button>
            <Button size="micro">Product</Button>
          </InlineStack>

          <div
            className="bp-image-picker-upload"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              uploadFirstImage(event.dataTransfer.files);
            }}
          >
            <input
              ref={fileInputRef}
              className="bp-image-picker-input"
              type="file"
              accept="image/*"
              onChange={(event) => {
                uploadFirstImage(event.currentTarget.files);
                event.currentTarget.value = "";
              }}
            />
            <InlineStack gap="200" align="center">
              <Button icon={PlusIcon} loading={uploading} onClick={() => fileInputRef.current?.click()}>
                Add files
              </Button>
            </InlineStack>
            <Text as="span" variant="bodySm" tone="subdued">
              Drag and drop images
            </Text>
          </div>

          {message ? (
            <Box padding="300" background="bg-surface-critical" borderRadius="200">
              <Text as="p" variant="bodySm" tone="critical">
                {message}
              </Text>
            </Box>
          ) : null}

          {loading ? (
            <div className="bp-image-picker-empty">
              <Text as="span" variant="bodyMd" tone="subdued">
                Loading images...
              </Text>
            </div>
          ) : images.length ? (
            <div className="bp-image-picker-grid">
              {images.map((image) => {
                const selected = selectedImage?.id === image.id || selectedImage?.url === image.url;
                return (
                  <button
                    key={image.id}
                    type="button"
                    className={`bp-image-picker-item${selected ? " bp-image-picker-item--selected" : ""}`}
                    onClick={() => onSelectImage(image)}
                    onDoubleClick={() => {
                      onSelectImage(image);
                      onDone();
                    }}
                  >
                    <span className="bp-image-picker-check">{selected ? <Icon source={CheckIcon} tone="base" /> : null}</span>
                    <span className="bp-image-picker-thumb">
                      <img src={image.url} alt={image.alt || image.title} />
                    </span>
                    <span className="bp-image-picker-title">{compactImageTitle(image.title)}</span>
                    <span className="bp-image-picker-meta">{imageFormatFromUrl(image.url)}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="bp-image-picker-empty">
              <Text as="span" variant="bodyMd" tone="subdued">
                No images found
              </Text>
            </div>
          )}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}

function ArticleImageCard({
  article,
  activeImage,
  imageAlt,
  onOpenImageModal,
  onRemoveImage,
}: {
  article: any;
  activeImage: string | null | undefined;
  imageAlt: string;
  onOpenImageModal: () => void;
  onRemoveImage: () => void;
}) {
  return (
    <Card padding="400">
      <BlockStack gap="300">
        <Text as="h2" variant="headingMd" fontWeight="semibold">
          Image
        </Text>
        {activeImage ? (
          <BlockStack gap="300">
            <div className="bp-native-image-preview">
              <img src={activeImage} alt={imageAlt || article.title} />
            </div>
            <InlineStack gap="200" align="end">
              <Button onClick={onOpenImageModal}>Change</Button>
              <Button tone="critical" onClick={onRemoveImage}>
                Remove
              </Button>
            </InlineStack>
          </BlockStack>
        ) : (
          <div className="bp-native-image-dropzone">
            <Button onClick={onOpenImageModal}>Add image</Button>
            <Text as="span" variant="bodySm" tone="subdued">
              Choose from Shopify files
            </Text>
          </div>
        )}
      </BlockStack>
    </Card>
  );
}

function RichArticleEditor({
  value,
  onChange,
  minHeight = 300,
  placeholder = "Start writing your post...",
  showProductButton = false,
  onOpenImagePicker,
  onProductBlockInserted,
}: {
  value: string;
  onChange: (value: string) => void;
  minHeight?: number;
  placeholder?: string;
  showProductButton?: boolean;
  onOpenImagePicker?: (insertImage: (image: ShopifyImageFile) => void) => void;
  onProductBlockInserted?: (blockId: string) => void;
}) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const lastHtmlRef = useRef("");
  const savedSelectionRef = useRef<Range | null>(null);
  const selectedImageElementRef = useRef<HTMLImageElement | null>(null);
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkText, setLinkText] = useState("");
  const [videoModalOpen, setVideoModalOpen] = useState(false);
  const [videoUrl, setVideoUrl] = useState("");
  const [imageEditModalOpen, setImageEditModalOpen] = useState(false);
  const [editImageSize, setEditImageSize] = useState<EditorImageSize>("original");
  const [editImageAlt, setEditImageAlt] = useState("");
  const [editImageAlignment, setEditImageAlignment] = useState<EditorImageAlignment>("left");
  const [editImageWrap, setEditImageWrap] = useState(false);
  const [editImageSpacing, setEditImageSpacing] = useState<EditorImageSpacing>({
    top: "0",
    right: "0",
    bottom: "16",
    left: "0",
  });

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || value === lastHtmlRef.current) return;
    editor.innerHTML = value || "";
    lastHtmlRef.current = value;
  }, [value]);

  const emitChange = useCallback(() => {
    const next = editorRef.current?.innerHTML || "";
    lastHtmlRef.current = next;
    onChange(next);
  }, [onChange]);

  const saveSelection = useCallback(() => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;
    if (editor.contains(container.nodeType === Node.TEXT_NODE ? container.parentNode : container)) {
      savedSelectionRef.current = range.cloneRange();
    }
  }, []);

  const restoreSelection = useCallback(() => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || !savedSelectionRef.current) return;

    editor.focus();
    selection.removeAllRanges();
    selection.addRange(savedSelectionRef.current);
  }, []);

  const insertHtml = useCallback(
    (html: string) => {
      const editor = editorRef.current;
      if (!editor) return;

      restoreSelection();
      document.execCommand("insertHTML", false, html);
      emitChange();
      saveSelection();
    },
    [emitChange, restoreSelection, saveSelection],
  );

  const runCommand = useCallback(
    (command: string, commandValue?: string) => {
      const editor = editorRef.current;
      if (!editor) return;
      restoreSelection();
      editor.focus();
      document.execCommand(command, false, commandValue);
      emitChange();
      saveSelection();
    },
    [emitChange, restoreSelection, saveSelection],
  );

  const openLinkModal = () => {
    saveSelection();
    setLinkText(window.getSelection()?.toString() || "");
    setLinkUrl("");
    setLinkModalOpen(true);
  };

  const applyLink = () => {
    const href = normalizeEditorUrl(linkUrl);
    if (!href) return;

    const text = linkText.trim() || linkUrl.trim();
    insertHtml(`<a href="${escapeAttribute(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(text)}</a>`);
    setLinkModalOpen(false);
    setLinkUrl("");
    setLinkText("");
  };

  const insertImage = () => {
    saveSelection();
    onOpenImagePicker?.((image) => {
      const alt = image.alt || image.title || "";
      insertHtml(`<p><img src="${escapeAttribute(image.url)}" alt="${escapeAttribute(alt)}"></p>`);
    });
  };

  const openVideoModal = () => {
    saveSelection();
    setVideoUrl("");
    setVideoModalOpen(true);
  };

  const applyVideo = () => {
    const html = makeEditorVideoHtml(videoUrl);
    if (!html) return;

    insertHtml(html);
    setVideoModalOpen(false);
    setVideoUrl("");
  };

  const insertTable = () => {
    insertHtml(
      `<table class="bp-editor-content-table"><tbody><tr><td><br></td><td><br></td></tr><tr><td><br></td><td><br></td></tr></tbody></table><p><br></p>`,
    );
  };

  const insertProductBlock = () => {
    const editor = editorRef.current;
    if (!editor) return;

    const blockId = createProductBlockId();
    insertHtml(`<p>[[SBS_PRODUCTS:${blockId}]]</p>`);
    onProductBlockInserted?.(blockId);
  };

  const applyTextColor = (value: string) => {
    if (!value) return;
    runCommand("foreColor", value);
  };

  const applyAlignment = (value: string) => {
    if (!value) return;
    runCommand(value);
  };

  const handleEditorKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Enter") return;

      event.preventDefault();
      event.stopPropagation();
      event.nativeEvent.stopImmediatePropagation?.();

      const command = event.shiftKey ? "insertLineBreak" : "insertParagraph";
      const inserted = document.execCommand(command);

      if (!inserted) {
        document.execCommand("insertHTML", false, event.shiftKey ? "<br>" : "<p><br></p>");
      }

      emitChange();
      saveSelection();
    },
    [emitChange, saveSelection],
  );

  const handleEditorDoubleClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    const image = target?.closest("img") as HTMLImageElement | null;

    if (!image || !editorRef.current?.contains(image)) return;

    event.preventDefault();
    event.stopPropagation();

    selectedImageElementRef.current = image;
    setEditImageSize(readEditorImageSize(image));
    setEditImageAlt(image.getAttribute("alt") || "");
    setEditImageAlignment(readEditorImageAlignment(image));
    setEditImageWrap(readEditorImageWrap(image));
    setEditImageSpacing(readEditorImageSpacing(image));
    setImageEditModalOpen(true);
  }, []);

  const updateEditImageSpacing = useCallback((key: keyof EditorImageSpacing, value: string) => {
    setEditImageSpacing((current) => ({
      ...current,
      [key]: value,
    }));
  }, []);

  const applyImageEdit = useCallback(() => {
    const image = selectedImageElementRef.current;
    if (!image) return;

    applyEditorImageSettings(image, {
      size: editImageSize,
      alt: editImageAlt,
      alignment: editImageAlignment,
      wrap: editImageWrap,
      spacing: editImageSpacing,
    });

    setImageEditModalOpen(false);
    selectedImageElementRef.current = null;
    emitChange();
  }, [
    editImageAlignment,
    editImageAlt,
    editImageSize,
    editImageSpacing,
    editImageWrap,
    emitChange,
  ]);

  const removeEditedImage = useCallback(() => {
    const image = selectedImageElementRef.current;
    if (!image) return;

    const container = image.parentElement;
    image.remove();

    if (container?.tagName === "P" && !container.textContent?.trim() && container.querySelectorAll("img").length === 0) {
      container.remove();
    }

    setImageEditModalOpen(false);
    selectedImageElementRef.current = null;
    emitChange();
  }, [emitChange]);

  return (
    <>
      <div className="bp-editor">
        <div className="bp-editor-toolbar">
          <button
            type="button"
            className="bp-editor-icon-button"
            title="Writing assistant"
            onMouseDown={(event) => event.preventDefault()}
          >
            <Icon source={MagicIcon} tone="base" />
          </button>
          <span className="bp-editor-separator" />
          <select
            className="bp-editor-select"
            aria-label="Text style"
            defaultValue="p"
            onMouseDown={saveSelection}
            onChange={(event) => runCommand("formatBlock", event.currentTarget.value)}
          >
            <option value="p">Paragraph</option>
            <option value="h2">Heading 2</option>
            <option value="h3">Heading 3</option>
            <option value="blockquote">Quote</option>
          </select>
          <span className="bp-editor-separator" />
          <button
            type="button"
            className="bp-editor-icon-button"
            title="Bold"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => runCommand("bold")}
          >
            B
          </button>
          <button
            type="button"
            className="bp-editor-icon-button"
            title="Italic"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => runCommand("italic")}
          >
            <em>I</em>
          </button>
          <button
            type="button"
            className="bp-editor-icon-button"
            title="Underline"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => runCommand("underline")}
          >
            <u>U</u>
          </button>
          <select
            className="bp-editor-icon-select"
            aria-label="Text color"
            defaultValue=""
            onMouseDown={saveSelection}
            onChange={(event) => {
              applyTextColor(event.currentTarget.value);
              event.currentTarget.value = "";
            }}
          >
            <option value="">A</option>
            <option value="#202223">Black</option>
            <option value="#2563eb">Blue</option>
            <option value="#16a34a">Green</option>
            <option value="#d97706">Orange</option>
            <option value="#dc2626">Red</option>
          </select>
          <span className="bp-editor-separator" />
          <select
            className="bp-editor-icon-select bp-editor-align-select"
            aria-label="Text alignment"
            defaultValue="justifyLeft"
            onMouseDown={saveSelection}
            onChange={(event) => applyAlignment(event.currentTarget.value)}
          >
            <option value="justifyLeft">Left</option>
            <option value="justifyCenter">Center</option>
            <option value="justifyRight">Right</option>
          </select>
          <button
            type="button"
            title="Bulleted list"
            className="bp-editor-icon-button bp-editor-list-button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => runCommand("insertUnorderedList")}
          >
            List
          </button>
          <span className="bp-editor-separator" />
          <button
            type="button"
            className="bp-editor-icon-button"
            title="Add link"
            onMouseDown={(event) => event.preventDefault()}
            onClick={openLinkModal}
          >
            <Icon source={LinkIcon} tone="base" />
          </button>
          <button
            type="button"
            className="bp-editor-icon-button"
            title="Insert image"
            onMouseDown={(event) => event.preventDefault()}
            onClick={insertImage}
          >
            <Icon source={ImageIcon} tone="base" />
          </button>
          <button
            type="button"
            className="bp-editor-icon-button"
            title="Insert video"
            onMouseDown={(event) => event.preventDefault()}
            onClick={openVideoModal}
          >
            <Icon source={PlayCircleIcon} tone="base" />
          </button>
          <button
            type="button"
            className="bp-editor-icon-button"
            title="Insert table"
            onMouseDown={(event) => event.preventDefault()}
            onClick={insertTable}
          >
            <Icon source={DataTableIcon} tone="base" />
          </button>
          {showProductButton && (
            <button
              type="button"
              className="bp-editor-icon-button bp-editor-products-button"
              title="Insert products marker"
              onMouseDown={(event) => event.preventDefault()}
              onClick={insertProductBlock}
            >
              Products
            </button>
          )}
          <span className="bp-editor-separator" />
          <button
            type="button"
            className="bp-editor-icon-button"
            title="More"
            onMouseDown={(event) => event.preventDefault()}
          >
            <Icon source={MenuHorizontalIcon} tone="base" />
          </button>
          <button
            type="button"
            className="bp-editor-icon-button bp-editor-code-button"
            title="HTML source"
            onMouseDown={(event) => event.preventDefault()}
          >
            <Icon source={CodeIcon} tone="base" />
          </button>
        </div>
        <div
          ref={editorRef}
          className="bp-editor-canvas"
          style={{ minHeight }}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-label="Blog post content"
          data-placeholder={placeholder}
          onKeyDown={handleEditorKeyDown}
          onDoubleClick={handleEditorDoubleClick}
          onInput={emitChange}
          onBlur={emitChange}
          onKeyUp={saveSelection}
          onMouseUp={saveSelection}
          onFocus={saveSelection}
        />
      </div>

      <Modal
        open={linkModalOpen}
        onClose={() => setLinkModalOpen(false)}
        title="Add link"
        primaryAction={{
          content: "Insert link",
          onAction: applyLink,
          disabled: !normalizeEditorUrl(linkUrl),
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setLinkModalOpen(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <TextField
              label="Link to"
              value={linkUrl}
              onChange={setLinkUrl}
              autoComplete="off"
              placeholder="https://example.com"
              error={linkUrl.trim() && !normalizeEditorUrl(linkUrl) ? "Enter a valid URL." : undefined}
            />
            <TextField
              label="Text to display"
              value={linkText}
              onChange={setLinkText}
              autoComplete="off"
              placeholder="Selected text or link label"
            />
          </BlockStack>
        </Modal.Section>
      </Modal>

      <Modal
        open={videoModalOpen}
        onClose={() => setVideoModalOpen(false)}
        title="Insert video"
        primaryAction={{
          content: "Insert video",
          onAction: applyVideo,
          disabled: !makeEditorVideoHtml(videoUrl),
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setVideoModalOpen(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <TextField
              label="Video URL"
              value={videoUrl}
              onChange={setVideoUrl}
              autoComplete="off"
              placeholder="https://www.youtube.com/watch?v=..."
              error={videoUrl.trim() && !makeEditorVideoHtml(videoUrl) ? "Enter a valid video URL." : undefined}
            />
            <Text as="p" variant="bodySm" tone="subdued">
              YouTube and Vimeo links are embedded. Other valid video URLs are inserted as links.
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>

      <Modal
        open={imageEditModalOpen}
        onClose={() => setImageEditModalOpen(false)}
        title="Edit image"
        primaryAction={{
          content: "Edit image",
          onAction: applyImageEdit,
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setImageEditModalOpen(false) }]}
      >
        <Modal.Section>
          <div className="bp-editor-image-modal">
            <BlockStack gap="400">
              <Select
                label="Image size"
                options={EDITOR_IMAGE_SIZE_OPTIONS.map(({ label, value }) => ({ label, value }))}
                value={editImageSize}
                onChange={(value) => setEditImageSize(value as EditorImageSize)}
              />
              <BlockStack gap="150">
                <TextField
                  label="Alt text"
                  value={editImageAlt}
                  onChange={setEditImageAlt}
                  autoComplete="off"
                />
                <Text as="p" variant="bodySm" tone="subdued">
                  Write a brief description of the file for people with visual impairment or low-bandwidth connections.
                </Text>
              </BlockStack>

              <BlockStack gap="200">
                <Text as="span" variant="bodyMd" fontWeight="medium">
                  Alignment
                </Text>
                <InlineStack gap="200">
                  {(["left", "center", "right"] as EditorImageAlignment[]).map((alignment) => (
                    <button
                      key={alignment}
                      type="button"
                      className={`bp-editor-align-button${
                        editImageAlignment === alignment ? " bp-editor-align-button--selected" : ""
                      }`}
                      onClick={() => setEditImageAlignment(alignment)}
                    >
                      {alignment}
                    </button>
                  ))}
                </InlineStack>
                <Checkbox
                  label="Wrap text around image"
                  checked={editImageWrap}
                  onChange={setEditImageWrap}
                />
              </BlockStack>
            </BlockStack>

            <div className="bp-editor-spacing-panel">
              <Text as="h3" variant="headingMd" fontWeight="semibold" alignment="center">
                Spacing
              </Text>
              <Divider />
              <div className="bp-editor-spacing-grid">
                <div className="bp-editor-spacing-top">
                  <TextField
                    label="Top"
                    type="number"
                    value={editImageSpacing.top}
                    onChange={(value) => updateEditImageSpacing("top", value)}
                    autoComplete="off"
                  />
                </div>
                <div className="bp-editor-spacing-left">
                  <TextField
                    label="Left"
                    type="number"
                    value={editImageSpacing.left}
                    onChange={(value) => updateEditImageSpacing("left", value)}
                    autoComplete="off"
                  />
                </div>
                <div className="bp-editor-spacing-right">
                  <TextField
                    label="Right"
                    type="number"
                    value={editImageSpacing.right}
                    onChange={(value) => updateEditImageSpacing("right", value)}
                    autoComplete="off"
                  />
                </div>
                <div className="bp-editor-spacing-bottom">
                  <TextField
                    label="Bottom"
                    type="number"
                    value={editImageSpacing.bottom}
                    onChange={(value) => updateEditImageSpacing("bottom", value)}
                    autoComplete="off"
                  />
                </div>
              </div>
            </div>
          </div>
        </Modal.Section>
        <Modal.Section>
          <InlineStack align="start">
            <Button tone="critical" onClick={removeEditedImage}>
              Remove image
            </Button>
          </InlineStack>
        </Modal.Section>
      </Modal>
    </>
  );
}

function ProductsPanel({
  products,
  blocks,
  selectedBlockId,
  onBlockChange,
  onAddProducts,
  onMoveProduct,
  onRemoveProduct,
  onOpenStyleModal,
}: {
  products: any[];
  blocks: ProductBlockOption[];
  selectedBlockId: string;
  onBlockChange: (blockId: string) => void;
  onAddProducts: () => void;
  onMoveProduct: (index: number, direction: "up" | "down") => void;
  onRemoveProduct: (recordId: string) => void;
  onOpenStyleModal: (recordId: string, style: string) => void;
}) {
  const selectedBlock = blocks.find((block) => block.id === selectedBlockId) || blocks[0];

  return (
    <BlockStack gap="400">
      <InlineStack align="space-between" blockAlign="center">
        <BlockStack gap="100">
          <Text as="h2" variant="headingLg" fontWeight="bold">
            Embedded products
          </Text>
          <Text as="span" variant="bodySm" tone="subdued">
            Products shown by the selected marker in this article.
          </Text>
        </BlockStack>
        <Button variant="primary" icon={ProductIcon} onClick={onAddProducts}>
          Add product
        </Button>
      </InlineStack>

      <Card padding="400">
        <InlineGrid columns={{ xs: 1, md: "minmax(260px, 360px) 1fr" }} gap="400">
          <Select
            label="Product block"
            options={blocks.map((block) => ({
              label: `${block.label} (${block.productCount})`,
              value: block.id,
            }))}
            value={selectedBlockId}
            onChange={onBlockChange}
          />
          <BlockStack gap="100">
            <Text as="span" variant="bodySm" fontWeight="semibold">
              Marker
            </Text>
            <code className="bp-product-block-marker">{selectedBlock?.marker || "[[SBS_PRODUCTS]]"}</code>
          </BlockStack>
        </InlineGrid>
      </Card>

      <Card padding="0">
        <IndexTable
          resourceName={{ singular: "product", plural: "products" }}
          itemCount={products.length}
          headings={[
            { title: "" },
            { title: "Product" },
            { title: "Price" },
            { title: "Clicks" },
            { title: "CTR" },
            { title: "Style" },
            { title: "Actions" },
          ]}
          selectable={false}
        >
          {products.map((product, index) => (
            <IndexTable.Row id={product.id} key={product.id} position={index}>
              <IndexTable.Cell>
                <Thumbnail source={product.productImage || ImageIcon} alt={product.productTitle} size="small" />
              </IndexTable.Cell>
              <IndexTable.Cell>
                <Text as="span" variant="bodyMd" fontWeight="semibold">
                  {product.productTitle}
                </Text>
              </IndexTable.Cell>
              <IndexTable.Cell>{formatProductPrice(product.productPrice)}</IndexTable.Cell>
              <IndexTable.Cell>{product.clicks}</IndexTable.Cell>
              <IndexTable.Cell>{formatPercent(product.ctr)}</IndexTable.Cell>
              <IndexTable.Cell>
                <Button size="micro" onClick={() => onOpenStyleModal(product.id, product.displayStyle)}>
                  {styleLabel(product.displayStyle)}
                </Button>
              </IndexTable.Cell>
              <IndexTable.Cell>
                <InlineStack wrap={false} gap="200" blockAlign="center">
                  <ButtonGroup variant="segmented">
                    <Button
                      size="micro"
                      icon={ArrowUpIcon}
                      disabled={index === 0}
                      onClick={() => onMoveProduct(index, "up")}
                    />
                    <Button
                      size="micro"
                      icon={ArrowDownIcon}
                      disabled={index === products.length - 1}
                      onClick={() => onMoveProduct(index, "down")}
                    />
                  </ButtonGroup>
                  <Button size="micro" icon={DeleteIcon} tone="critical" onClick={() => onRemoveProduct(product.id)} />
                </InlineStack>
              </IndexTable.Cell>
            </IndexTable.Row>
          ))}
        </IndexTable>
        {products.length === 0 && (
          <Box padding="600">
            <EmptyState
              heading="No products linked yet"
              action={{ content: "Add products", onAction: onAddProducts }}
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>Link products to this marker to make this part of the article shoppable.</p>
            </EmptyState>
          </Box>
        )}
      </Card>
    </BlockStack>
  );
}

function SeoPanel({
  metaTitle,
  metaDescription,
  seoScore,
  issues,
  onMetaTitleChange,
  onMetaDescriptionChange,
  onScan,
  onApplySuggestions,
  isSubmitting,
}: {
  metaTitle: string;
  metaDescription: string;
  seoScore: number;
  issues: SeoIssue[];
  onMetaTitleChange: (value: string) => void;
  onMetaDescriptionChange: (value: string) => void;
  onScan: () => void;
  onApplySuggestions: () => void;
  isSubmitting: boolean;
}) {
  return (
    <BlockStack gap="500">
      <InlineStack align="space-between" blockAlign="center">
        <BlockStack gap="100">
          <Text as="h2" variant="headingLg" fontWeight="bold">
            SEO optimizer
          </Text>
          <Text as="span" variant="bodySm" tone="subdued">
            Tune metadata and scan for content issues before publishing changes.
          </Text>
        </BlockStack>
        <InlineStack gap="200">
          <Button onClick={onApplySuggestions} loading={isSubmitting}>
            Apply suggestions
          </Button>
          <Button variant="primary" onClick={onScan} loading={isSubmitting}>
            Run scan
          </Button>
        </InlineStack>
      </InlineStack>

      <InlineGrid columns={{ xs: 1, md: "220px 1fr" }} gap="400">
        <Card padding="400">
          <BlockStack gap="300" inlineAlign="center">
            <ScoreRing score={seoScore} />
            <Text as="span" variant="bodySm" tone="subdued">
              Current SEO score
            </Text>
          </BlockStack>
        </Card>
        <Card padding="400">
          <BlockStack gap="400">
            <TextField
              label="Meta title"
              value={metaTitle}
              maxLength={60}
              showCharacterCount
              onChange={onMetaTitleChange}
              autoComplete="off"
            />
            <TextField
              label="Meta description"
              value={metaDescription}
              multiline={3}
              maxLength={160}
              showCharacterCount
              onChange={onMetaDescriptionChange}
              autoComplete="off"
            />
          </BlockStack>
        </Card>
      </InlineGrid>

      <Card padding="0">
        <Box padding="400">
          <Text as="h3" variant="headingMd" fontWeight="bold">
            Scan results
          </Text>
        </Box>
        <Divider />
        <BlockStack gap="0">
          {issues.length === 0 ? (
            <Box padding="400">
              <InlineStack gap="200" blockAlign="center">
                <Icon source={CheckIcon} tone="success" />
                <Text as="span" variant="bodyMd">
                  No SEO issues found.
                </Text>
              </InlineStack>
            </Box>
          ) : (
            issues.map((issue) => <IssueRow issue={issue} key={issue.type} />)
          )}
        </BlockStack>
      </Card>
    </BlockStack>
  );
}

function PerformancePanel({ products, stats }: { products: any[]; stats: any }) {
  return (
    <BlockStack gap="500">
      <InlineStack align="space-between" blockAlign="center">
        <BlockStack gap="100">
          <Text as="h2" variant="headingLg" fontWeight="bold">
            Performance
          </Text>
          <Text as="span" variant="bodySm" tone="subdued">
            Storefront widget events tracked for this article.
          </Text>
        </BlockStack>
      </InlineStack>

      <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
        <Card padding="400">
          <MetricNumber label="Impressions" value={String(stats.impressions)} />
        </Card>
        <Card padding="400">
          <MetricNumber label="Clicks" value={String(stats.clicks)} />
        </Card>
        <Card padding="400">
          <MetricNumber label="Product CTR" value={formatPercent(stats.ctr)} />
        </Card>
        <Card padding="400">
          <MetricNumber label="Revenue" value={formatMoney(stats.revenue)} />
        </Card>
      </InlineGrid>

      <Card padding="0">
        <IndexTable
          resourceName={{ singular: "product", plural: "products" }}
          itemCount={products.length}
          headings={[
            { title: "Product" },
            { title: "Impressions" },
            { title: "Clicks" },
            { title: "Add to carts" },
            { title: "CTR" },
            { title: "Revenue" },
          ]}
          selectable={false}
        >
          {products.map((product, index) => (
            <IndexTable.Row id={`perf-${product.id}`} key={product.id} position={index}>
              <IndexTable.Cell>
                <InlineStack gap="300" blockAlign="center" wrap={false}>
                  <Thumbnail source={product.productImage || ImageIcon} alt={product.productTitle} size="small" />
                  <Text as="span" variant="bodyMd" fontWeight="semibold">
                    {product.productTitle}
                  </Text>
                </InlineStack>
              </IndexTable.Cell>
              <IndexTable.Cell>{product.impressions}</IndexTable.Cell>
              <IndexTable.Cell>{product.clicks}</IndexTable.Cell>
              <IndexTable.Cell>{product.addToCarts}</IndexTable.Cell>
              <IndexTable.Cell>{formatPercent(product.ctr)}</IndexTable.Cell>
              <IndexTable.Cell>{formatMoney(product.revenue)}</IndexTable.Cell>
            </IndexTable.Row>
          ))}
        </IndexTable>
      </Card>
    </BlockStack>
  );
}

function HistoryPanel({ article, seoData, products }: { article: any; seoData: any; products: any[] }) {
  const history = [
    {
      title: "Article loaded",
      detail: `${article.title} in ${article.blog.title}`,
      date: article.updatedAt,
    },
    {
      title: "Latest SEO scan",
      detail: seoData?.lastAnalyzedAt ? `Score ${seoData.seoScore}/100` : "No scan has been saved yet",
      date: seoData?.lastAnalyzedAt || article.updatedAt,
    },
    ...products.slice(0, 4).map((product) => ({
      title: "Product linked",
      detail: product.productTitle,
      date: product.updatedAt || product.createdAt,
    })),
  ];

  return (
    <BlockStack gap="400">
      <BlockStack gap="100">
        <Text as="h2" variant="headingLg" fontWeight="bold">
          History
        </Text>
        <Text as="span" variant="bodySm" tone="subdued">
          Recent changes saved by this app and Shopify article timestamps.
        </Text>
      </BlockStack>

      <Card padding="0">
        <BlockStack gap="0">
          {history.map((item, index) => (
            <div className="bp-history-row" key={`${item.title}-${index}`}>
              <span className="bp-history-dot" />
              <BlockStack gap="050">
                <Text as="span" variant="bodyMd" fontWeight="semibold">
                  {item.title}
                </Text>
                <Text as="span" variant="bodySm" tone="subdued">
                  {item.detail}
                </Text>
              </BlockStack>
              <Text as="span" variant="bodySm" tone="subdued">
                {formatDateTime(item.date)}
              </Text>
            </div>
          ))}
        </BlockStack>
      </Card>
    </BlockStack>
  );
}

function SeoSidebar({
  seoScore,
  goodChecks,
  issues,
  onFixIssues,
  isSubmitting,
}: {
  seoScore: number;
  goodChecks: string[];
  issues: SeoIssue[];
  onFixIssues: () => void;
  isSubmitting: boolean;
}) {
  return (
    <Card padding="400">
      <BlockStack gap="400">
        <InlineStack align="space-between">
          <Text as="h3" variant="headingMd" fontWeight="bold">
            SEO score
          </Text>
          <Badge tone={seoScore >= 80 ? "success" : seoScore >= 60 ? "warning" : "critical"}>
            {seoScore >= 80 ? "Good" : seoScore >= 60 ? "Needs work" : "Critical"}
          </Badge>
        </InlineStack>

        <InlineStack gap="400" wrap={false} blockAlign="center">
          <ScoreRing score={seoScore} />
          <InlineGrid columns={2} gap="400">
            <BlockStack gap="150">
              <Text as="span" variant="bodySm" fontWeight="semibold" tone="success">
                Good
              </Text>
              {goodChecks.slice(0, 4).map((check) => (
                <InlineStack key={check} gap="100" blockAlign="center" wrap={false}>
                  <Icon source={CheckIcon} tone="success" />
                  <Text as="span" variant="bodySm">
                    {check}
                  </Text>
                </InlineStack>
              ))}
            </BlockStack>
            <BlockStack gap="150">
              <Text as="span" variant="bodySm" fontWeight="semibold">
                Needs improvement
              </Text>
              {issues.slice(0, 4).map((issue) => (
                <InlineStack key={issue.type} gap="100" blockAlign="center" wrap={false}>
                  <span className="bp-warning-dot" />
                  <Text as="span" variant="bodySm">
                    {issue.label}
                  </Text>
                </InlineStack>
              ))}
            </BlockStack>
          </InlineGrid>
        </InlineStack>

        <InlineStack align="end">
          <Button size="micro" onClick={onFixIssues} loading={isSubmitting}>
            Fix SEO issues
          </Button>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}

function RecommendationsCard({
  issues,
  onApplyAll,
  onManageProducts,
}: {
  issues: SeoIssue[];
  onApplyAll: () => void;
  onManageProducts: () => void;
}) {
  const recommendations =
    issues.length > 0
      ? issues.slice(0, 3)
      : [
          {
            type: "monitor",
            label: "Monitor performance",
            message: "Keep tracking product clicks and SEO health.",
            severity: "info",
            impact: "Low",
            effort: "Low",
          } as SeoIssue,
        ];

  return (
    <Card padding="400">
      <BlockStack gap="400">
        <Text as="h3" variant="headingMd" fontWeight="bold">
          Recommended actions
        </Text>
        <BlockStack gap="300">
          {recommendations.map((issue) => (
            <InlineStack key={issue.type} gap="300" align="start" wrap={false}>
              <span className="bp-action-icon">
                <Icon source={issue.type === "products" ? LinkIcon : MagicIcon} tone="magic" />
              </span>
              <BlockStack gap="150">
                <Text as="span" variant="bodyMd">
                  {issue.message}
                </Text>
                <InlineStack gap="200">
                  <Badge tone={issue.impact === "High" ? "critical" : issue.impact === "Medium" ? "warning" : "info"}>
                    {`${issue.impact} impact`}
                  </Badge>
                  <Badge tone={issue.effort === "Low" ? "success" : "warning"}>{`${issue.effort} effort`}</Badge>
                </InlineStack>
              </BlockStack>
            </InlineStack>
          ))}
        </BlockStack>
        <Button fullWidth onClick={issues.some((issue) => issue.type === "products") ? onManageProducts : onApplyAll}>
          Apply all suggestions
        </Button>
      </BlockStack>
    </Card>
  );
}

function ProductsSummaryCard({
  productCount,
  ctr,
  revenue,
  topProduct,
  onManageProducts,
}: {
  productCount: number;
  ctr: number;
  revenue: number;
  topProduct?: any;
  onManageProducts: () => void;
}) {
  return (
    <Card padding="400">
      <BlockStack gap="400">
        <Text as="h3" variant="headingMd" fontWeight="bold">
          Products summary
        </Text>
        <InlineGrid columns={3} gap="300">
          <MetricNumber label="Active products" value={String(productCount)} />
          <MetricNumber label="Product CTR" value={formatPercent(ctr)} />
          <MetricNumber label="Revenue" value={formatMoney(revenue)} />
        </InlineGrid>

        <Divider />

        <BlockStack gap="200">
          <Text as="span" variant="bodySm" fontWeight="semibold">
            Top product
          </Text>
          {topProduct ? (
            <InlineStack gap="300" blockAlign="center" wrap={false}>
              <Thumbnail source={topProduct.productImage || ImageIcon} alt={topProduct.productTitle} size="small" />
              <BlockStack gap="050">
                <Text as="span" variant="bodySm" fontWeight="semibold">
                  {topProduct.productTitle}
                </Text>
                <Text as="span" variant="bodySm" tone="subdued">
                  {topProduct.clicks} clicks - {formatMoney(topProduct.revenue)} revenue
                </Text>
              </BlockStack>
            </InlineStack>
          ) : (
            <Text as="span" variant="bodySm" tone="subdued">
              No products linked yet
            </Text>
          )}
        </BlockStack>

        <InlineStack align="end">
          <Button size="micro" onClick={onManageProducts}>
            Manage products
          </Button>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}

function PublishingCard({ article, livePostUrl }: { article: any; livePostUrl: string }) {
  return (
    <Card padding="400">
      <BlockStack gap="400">
        <Text as="h3" variant="headingMd" fontWeight="bold">
          Publishing
        </Text>
        <InlineGrid columns={2} gap="400">
          <MetricMeta label="Status" value={article.isPublished ? "Published" : "Draft"} badge={article.isPublished} />
          <MetricMeta label="Visibility" value="Online Store" />
          <MetricMeta label="Author" value={article.author?.name || "Store admin"} />
          <MetricMeta label="Last updated" value={formatDateTime(article.updatedAt)} />
        </InlineGrid>
        <Button fullWidth icon={ExternalIcon} url={livePostUrl} target="_blank">
          Preview live post
        </Button>
      </BlockStack>
    </Card>
  );
}

function MetricNumber({ label, value }: { label: string; value: string }) {
  return (
    <BlockStack gap="100">
      <Text as="span" variant="headingMd" fontWeight="bold">
        {value}
      </Text>
      <Text as="span" variant="bodySm" tone="subdued">
        {label}
      </Text>
    </BlockStack>
  );
}

function MetricMeta({ label, value, badge }: { label: string; value: string; badge?: boolean }) {
  return (
    <BlockStack gap="100">
      <Text as="span" variant="bodySm" tone="subdued">
        {label}
      </Text>
      {badge ? (
        <Badge tone="success">{value}</Badge>
      ) : (
        <Text as="span" variant="bodyMd">
          {value}
        </Text>
      )}
    </BlockStack>
  );
}

function ScoreRing({ score }: { score: number }) {
  const color = score >= 80 ? "#16a34a" : score >= 60 ? "#d97706" : "#dc2626";
  return (
    <div className="bp-score-ring" style={{ background: `conic-gradient(${color} ${score}%, #e5e7eb 0)` }}>
      <div className="bp-score-ring-inner">
        <Text as="span" variant="headingLg" fontWeight="bold">
          {score}
        </Text>
        <Text as="span" variant="bodySm" tone="subdued">
          /100
        </Text>
      </div>
    </div>
  );
}

function IssueRow({ issue }: { issue: SeoIssue }) {
  return (
    <div className="bp-issue-row">
      <InlineStack gap="200" blockAlign="center" wrap={false}>
        {issue.severity === "critical" ? (
          <Icon source={AlertCircleIcon} tone="critical" />
        ) : issue.severity === "warning" ? (
          <span className="bp-warning-dot" />
        ) : (
          <Icon source={CheckIcon} tone="success" />
        )}
        <BlockStack gap="050">
          <Text as="span" variant="bodyMd" fontWeight="semibold">
            {issue.label}
          </Text>
          <Text as="span" variant="bodySm" tone="subdued">
            {issue.message}
          </Text>
        </BlockStack>
      </InlineStack>
      <InlineStack gap="200">
        <Badge tone={issue.impact === "High" ? "critical" : issue.impact === "Medium" ? "warning" : "info"}>
          {issue.impact}
        </Badge>
        <Badge tone={issue.effort === "Low" ? "success" : "warning"}>{issue.effort}</Badge>
      </InlineStack>
    </div>
  );
}

async function fetchShopifyImageFiles(admin: any, search = "") {
  try {
    const response = await admin.graphql(
      `#graphql
      query GetImageFiles($query: String) {
        files(first: 48, query: $query, sortKey: UPDATED_AT, reverse: true) {
          nodes {
            __typename
            id
            alt
            createdAt
            updatedAt
            fileStatus
            preview {
              image {
                url
              }
            }
            ... on MediaImage {
              image {
                url
                width
                height
              }
            }
          }
        }
      }`,
      { variables: { query: search || null } },
    );
    const result: any = await response.json();

    if (result.errors?.length) {
      return {
        images: [] as ShopifyImageFile[],
        error: result.errors[0]?.message || "Could not load Shopify images.",
      };
    }

    return {
      images: (result.data?.files?.nodes || [])
        .map(normalizeShopifyImageFile)
        .filter(Boolean) as ShopifyImageFile[],
      error: "",
    };
  } catch (error) {
    return {
      images: [] as ShopifyImageFile[],
      error: error instanceof Error ? error.message : "Could not load Shopify images.",
    };
  }
}

async function uploadShopifyImageFile(admin: any, file: File) {
  try {
    const stagedResponse = await admin.graphql(
      `#graphql
      mutation CreateImageUploadTarget($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) {
          stagedTargets {
            url
            resourceUrl
            parameters {
              name
              value
            }
          }
          userErrors {
            field
            message
          }
        }
      }`,
      {
        variables: {
          input: [
            {
              filename: file.name,
              mimeType: file.type || "image/jpeg",
              resource: "IMAGE",
              httpMethod: "POST",
            },
          ],
        },
      },
    );
    const stagedResult: any = await stagedResponse.json();
    const stagedError =
      stagedResult.data?.stagedUploadsCreate?.userErrors?.[0]?.message ||
      stagedResult.errors?.[0]?.message ||
      "";

    if (stagedError) {
      return { image: null, error: stagedError };
    }

    const target = stagedResult.data?.stagedUploadsCreate?.stagedTargets?.[0];
    if (!target?.url || !target?.resourceUrl) {
      return { image: null, error: "Shopify did not return an upload target." };
    }

    const uploadFormData = new FormData();
    for (const parameter of target.parameters || []) {
      uploadFormData.append(parameter.name, parameter.value);
    }
    uploadFormData.append("file", file, file.name);

    const uploadResponse = await fetch(target.url, {
      method: "POST",
      body: uploadFormData,
    });

    if (!uploadResponse.ok) {
      return {
        image: null,
        error: `Shopify upload failed with status ${uploadResponse.status}.`,
      };
    }

    const createResponse = await admin.graphql(
      `#graphql
      mutation CreateImageFile($files: [FileCreateInput!]!) {
        fileCreate(files: $files) {
          files {
            __typename
            id
            alt
            createdAt
            updatedAt
            fileStatus
            preview {
              image {
                url
              }
            }
            ... on MediaImage {
              image {
                url
                width
                height
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }`,
      {
        variables: {
          files: [
            {
              originalSource: target.resourceUrl,
              contentType: "IMAGE",
              filename: file.name,
            },
          ],
        },
      },
    );
    const createResult: any = await createResponse.json();
    const createError =
      createResult.data?.fileCreate?.userErrors?.[0]?.message ||
      createResult.errors?.[0]?.message ||
      "";

    if (createError) {
      return { image: null, error: createError };
    }

    const createdFile = createResult.data?.fileCreate?.files?.[0];
    let image = normalizeShopifyImageFile(createdFile);

    if (!image && createdFile?.id) {
      image = await waitForShopifyImage(admin, createdFile.id);
    }

    if (!image) {
      return {
        image: null,
        error: "Image uploaded, but Shopify is still processing it. Try searching again in a moment.",
      };
    }

    return { image, error: "" };
  } catch (error) {
    return {
      image: null,
      error: error instanceof Error ? error.message : "Could not upload image to Shopify.",
    };
  }
}

async function waitForShopifyImage(admin: any, id: string) {
  for (let attempt = 0; attempt < 5; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 800));
    const response = await admin.graphql(
      `#graphql
      query GetImageFile($id: ID!) {
        node(id: $id) {
          __typename
          id
          ... on MediaImage {
            alt
            createdAt
            updatedAt
            fileStatus
            preview {
              image {
                url
              }
            }
            image {
              url
              width
              height
            }
          }
        }
      }`,
      { variables: { id } },
    );
    const result: any = await response.json();
    const image = normalizeShopifyImageFile(result.data?.node);
    if (image) return image;
  }

  return null;
}

function normalizeShopifyImageFile(file: any): ShopifyImageFile | null {
  if (file.__typename !== "MediaImage") return null;

  const url = file.image?.url || file.preview?.image?.url || "";
  if (!url) return null;

  return {
    id: file.id,
    url,
    alt: file.alt || "",
    title: file.alt || imageTitleFromUrl(url),
    width: file.image?.width,
    height: file.image?.height,
    status: file.fileStatus,
    updatedAt: file.updatedAt,
  };
}

function getArticleId(rawParam: string) {
  const articleParam = decodeURIComponent(rawParam || "");
  return articleParam.startsWith("gid://")
    ? articleParam
    : `gid://shopify/Article/${articleParam}`;
}

function cleanString(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanHandle(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/^\/?blogs\/[^/]+\//, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function cleanProductBlockId(value?: string | null) {
  const trimmed = (value || "").trim();
  if (!trimmed || LEGACY_PRODUCT_STYLE_TOKENS.has(trimmed)) return DEFAULT_PRODUCT_BLOCK_ID;

  const cleaned = trimmed.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
  return cleaned || DEFAULT_PRODUCT_BLOCK_ID;
}

function getProductBlockId(value?: string | null) {
  return cleanProductBlockId(value);
}

function createProductBlockId() {
  return `block_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function getProductBlockMarker(blockId: string) {
  return blockId === DEFAULT_PRODUCT_BLOCK_ID ? "[[SBS_PRODUCTS]]" : `[[SBS_PRODUCTS:${blockId}]]`;
}

function buildProductBlockOptions(body: string, products: any[]): ProductBlockOption[] {
  const ids = new Set<string>();
  const productCounts = new Map<string, number>();

  PRODUCT_BLOCK_MARKER_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PRODUCT_BLOCK_MARKER_PATTERN.exec(body || "")) !== null) {
    ids.add(cleanProductBlockId(match[2] || match[1]));
  }

  for (const product of products || []) {
    const blockId = getProductBlockId(product.blockId);
    ids.add(blockId);
    productCounts.set(blockId, (productCounts.get(blockId) || 0) + 1);
  }

  if (ids.size === 0) ids.add(DEFAULT_PRODUCT_BLOCK_ID);

  let customBlockIndex = 0;
  return [...ids].map((id) => {
    const isDefault = id === DEFAULT_PRODUCT_BLOCK_ID;
    if (!isDefault) customBlockIndex += 1;

    return {
      id,
      label: isDefault ? "Default block" : `Block ${customBlockIndex}`,
      marker: getProductBlockMarker(id),
      productCount: productCounts.get(id) || 0,
    };
  });
}

function parseTags(value: string) {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function stripHtml(value: string) {
  return (value || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  const truncated = value.slice(0, maxLength - 1);
  const lastSpace = truncated.lastIndexOf(" ");
  return `${truncated.slice(0, lastSpace > 80 ? lastSpace : truncated.length).trim()}.`;
}

function imageTitleFromUrl(url: string) {
  try {
    const pathname = new URL(url).pathname;
    const filename = decodeURIComponent(pathname.split("/").filter(Boolean).pop() || "Image");
    return filename.replace(/\?.*$/, "") || "Image";
  } catch {
    return "Image";
  }
}

function compactImageTitle(value: string) {
  if (value.length <= 22) return value;
  return `${value.slice(0, 18)}...`;
}

function imageFormatFromUrl(url: string) {
  const title = imageTitleFromUrl(url);
  const extension = title.includes(".") ? title.split(".").pop() || "" : "";
  return extension ? extension.toUpperCase().slice(0, 5) : "IMAGE";
}

function readEditorImageSize(image: HTMLImageElement): EditorImageSize {
  const savedSize = image.dataset.editorImageSize as EditorImageSize | undefined;
  if (savedSize && EDITOR_IMAGE_SIZE_OPTIONS.some((option) => option.value === savedSize)) return savedSize;

  const width = Number.parseInt(image.style.width || image.getAttribute("width") || "", 10);
  const matchedSize = EDITOR_IMAGE_SIZE_OPTIONS.find((option) => option.width === width);
  return matchedSize?.value || "original";
}

function readEditorImageAlignment(image: HTMLImageElement): EditorImageAlignment {
  const savedAlignment = image.dataset.editorImageAlignment as EditorImageAlignment | undefined;
  if (savedAlignment === "left" || savedAlignment === "center" || savedAlignment === "right") return savedAlignment;
  if (image.style.float === "right") return "right";
  if (image.style.marginLeft === "auto" && image.style.marginRight === "auto") return "center";
  return "left";
}

function readEditorImageWrap(image: HTMLImageElement) {
  if (image.dataset.editorImageWrap) return image.dataset.editorImageWrap === "true";
  return image.style.float === "left" || image.style.float === "right";
}

function readEditorImageSpacing(image: HTMLImageElement): EditorImageSpacing {
  return {
    top: readSpacingValue(image.style.marginTop, "0"),
    right: readSpacingValue(image.style.marginRight, "0"),
    bottom: readSpacingValue(image.style.marginBottom, "16"),
    left: readSpacingValue(image.style.marginLeft, "0"),
  };
}

function applyEditorImageSettings(
  image: HTMLImageElement,
  settings: {
    size: EditorImageSize;
    alt: string;
    alignment: EditorImageAlignment;
    wrap: boolean;
    spacing: EditorImageSpacing;
  },
) {
  const size = EDITOR_IMAGE_SIZE_OPTIONS.find((option) => option.value === settings.size);
  const spacing = {
    top: normalizeSpacingValue(settings.spacing.top, 0),
    right: normalizeSpacingValue(settings.spacing.right, 0),
    bottom: normalizeSpacingValue(settings.spacing.bottom, 16),
    left: normalizeSpacingValue(settings.spacing.left, 0),
  };

  image.alt = settings.alt.trim();
  image.dataset.editorImageSize = settings.size;
  image.dataset.editorImageAlignment = settings.alignment;
  image.dataset.editorImageWrap = String(settings.wrap);
  image.dataset.editorImageSpacing = JSON.stringify(spacing);

  if (size?.width) {
    image.style.width = `${size.width}px`;
  } else {
    image.style.removeProperty("width");
  }

  image.style.maxWidth = "100%";
  image.style.height = "auto";
  image.style.marginTop = `${spacing.top}px`;
  image.style.marginBottom = `${spacing.bottom}px`;

  if (settings.wrap && settings.alignment !== "center") {
    image.style.float = settings.alignment;
    image.style.display = "inline";
    image.style.marginLeft = `${spacing.left}px`;
    image.style.marginRight = `${spacing.right}px`;
    return;
  }

  image.style.removeProperty("float");
  image.style.display = "block";

  if (settings.alignment === "center") {
    image.style.marginLeft = "auto";
    image.style.marginRight = "auto";
  } else if (settings.alignment === "right") {
    image.style.marginLeft = "auto";
    image.style.marginRight = `${spacing.right}px`;
  } else {
    image.style.marginLeft = `${spacing.left}px`;
    image.style.marginRight = "auto";
  }
}

function readSpacingValue(value: string, fallback: string) {
  if (value === "auto") return "0";
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) ? String(parsed) : fallback;
}

function normalizeSpacingValue(value: string, fallback: number) {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(parsed, 240));
}

function normalizeEditorUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";

  const withProtocol = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(withProtocol);
    return ["http:", "https:", "mailto:", "tel:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function makeEditorVideoHtml(value: string) {
  const url = normalizeEditorUrl(value);
  if (!url) return "";

  const embedUrl = getVideoEmbedUrl(url);
  if (embedUrl) {
    return `<div class="bp-editor-video"><iframe src="${escapeAttribute(embedUrl)}" title="Embedded video" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div><p><br></p>`;
  }

  return `<p><a href="${escapeAttribute(url)}" target="_blank" rel="noopener noreferrer">Watch video</a></p>`;
}

function getVideoEmbedUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "");

    if (host === "youtube.com" || host === "m.youtube.com") {
      const videoId = url.searchParams.get("v");
      return videoId ? `https://www.youtube.com/embed/${encodeURIComponent(videoId)}` : "";
    }

    if (host === "youtu.be") {
      const videoId = url.pathname.split("/").filter(Boolean)[0];
      return videoId ? `https://www.youtube.com/embed/${encodeURIComponent(videoId)}` : "";
    }

    if (host === "vimeo.com") {
      const videoId = url.pathname.split("/").filter(Boolean)[0];
      return videoId ? `https://player.vimeo.com/video/${encodeURIComponent(videoId)}` : "";
    }
  } catch {
    return "";
  }

  return "";
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function makeSeoTitle(title: string) {
  const cleaned = stripHtml(title);
  if (cleaned.length >= 30 && cleaned.length <= 60) return cleaned;
  return truncateText(`${cleaned} | Style guide`, 60);
}

function makeMetaDescription(title: string, body: string) {
  const text = stripHtml(body);
  const fallback = `Discover ${title.toLowerCase()} with practical styling tips, product ideas, and simple ways to build a look that fits your store.`;
  return truncateText(text.length >= 120 ? text : fallback, 158);
}

function auditSeo({
  title,
  handle,
  summary,
  body,
  hasImage,
  imageAlt,
  productCount,
}: {
  title: string;
  handle: string;
  summary: string;
  body: string;
  hasImage: boolean;
  imageAlt: string;
  productCount: number;
}) {
  const issues: SeoIssue[] = [];
  let score = 100;
  const text = stripHtml(body);
  const wordCount = text ? text.split(/\s+/).length : 0;
  const linkCount = (body.match(/<a\s/gi) || []).length;

  if (!title) {
    issues.push({
      type: "meta_title",
      label: "Meta title",
      message: "Add a meta title for search snippets.",
      severity: "critical",
      impact: "High",
      effort: "Low",
    });
    score -= 20;
  } else if (title.length < 30 || title.length > 60) {
    issues.push({
      type: "meta_title",
      label: "Meta title length",
      message: "Keep the meta title between 30 and 60 characters.",
      severity: "warning",
      impact: "Medium",
      effort: "Low",
    });
    score -= 10;
  }

  if (!summary) {
    issues.push({
      type: "meta_description",
      label: "Meta description",
      message: "Write a concise meta description for this post.",
      severity: "critical",
      impact: "High",
      effort: "Low",
    });
    score -= 20;
  } else if (summary.length < 120 || summary.length > 160) {
    issues.push({
      type: "meta_description",
      label: "Meta description length",
      message: "Keep the meta description between 120 and 160 characters.",
      severity: "warning",
      impact: "High",
      effort: "Low",
    });
    score -= 8;
  }

  if (!handle || !/^[a-z0-9-]+$/.test(handle)) {
    issues.push({
      type: "url_handle",
      label: "URL handle",
      message: "Use a clean lowercase URL handle with hyphens.",
      severity: "warning",
      impact: "Medium",
      effort: "Low",
    });
    score -= 8;
  }

  if (!hasImage) {
    issues.push({
      type: "image",
      label: "Featured image",
      message: "Add a featured image to improve sharing and article previews.",
      severity: "warning",
      impact: "Medium",
      effort: "Medium",
    });
    score -= 8;
  } else if (!imageAlt) {
    issues.push({
      type: "image_alt",
      label: "Image alt text",
      message: "Add descriptive alt text to the featured image.",
      severity: "warning",
      impact: "Medium",
      effort: "Low",
    });
    score -= 6;
  }

  if (wordCount < 250) {
    issues.push({
      type: "content",
      label: "Content depth",
      message: "Expand the article to at least 250 words for better topical coverage.",
      severity: "warning",
      impact: "Medium",
      effort: "Medium",
    });
    score -= 10;
  }

  if (linkCount < 1) {
    issues.push({
      type: "internal_links",
      label: "Internal links",
      message: "Add at least one internal link to guide readers deeper into the store.",
      severity: "warning",
      impact: "Medium",
      effort: "Low",
    });
    score -= 5;
  }

  if (productCount === 0) {
    issues.push({
      type: "products",
      label: "Products linked",
      message: "Link relevant products to make the article shoppable.",
      severity: "warning",
      impact: "High",
      effort: "Medium",
    });
    score -= 8;
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    issues,
  };
}

function getGoodSeoChecks(currentAudit: { issues: SeoIssue[] }, issues: SeoIssue[]) {
  const badTypes = new Set(issues.map((issue) => issue.type));
  const checks = [
    { type: "meta_title", label: "Meta title" },
    { type: "url_handle", label: "URL handle" },
    { type: "image", label: "Featured image" },
    { type: "internal_links", label: "Internal links" },
    { type: "products", label: "Products linked" },
  ];

  const auditBadTypes = new Set(currentAudit.issues.map((issue) => issue.type));
  return checks
    .filter((check) => !badTypes.has(check.type) && !auditBadTypes.has(check.type))
    .map((check) => check.label);
}

function parseIssues(value?: string | null): SeoIssue[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function buildProductMetricMap(groups: any[]) {
  const map = new Map<string, ProductMetric>();

  for (const group of groups) {
    const productId = group.productId;
    const key = productMetricKey(group.blockId, productId);
    const metric = map.get(key) || emptyMetric(productId);
    const count = group._count?._all || 0;

    if (group.eventType === "click") metric.clicks += count;
    if (group.eventType === "impression") metric.impressions += count;
    if (group.eventType === "add_to_cart") metric.addToCarts += count;
    if (group.eventType === "purchase" || group.eventType === "order") metric.purchases += count;

    map.set(key, metric);
  }

  return map;
}

function productMetricKey(blockId: string | null | undefined, productId: string) {
  return `${getProductBlockId(blockId)}:${productId}`;
}

function emptyMetric(productId: string): ProductMetric {
  return {
    productId,
    clicks: 0,
    impressions: 0,
    addToCarts: 0,
    purchases: 0,
    revenue: 0,
    ctr: 0,
  };
}

function getPickerImage(product: any) {
  return (
    product.images?.[0]?.originalSrc ||
    product.images?.[0]?.url ||
    product.featuredImage?.url ||
    product.featuredImage?.originalSrc ||
    ""
  );
}

function getPickerPrice(product: any) {
  return (
    product.variants?.[0]?.price ||
    product.variants?.[0]?.priceV2?.amount ||
    product.priceRangeV2?.minVariantPrice?.amount ||
    "0"
  ).toString();
}

function parseMoney(value: string) {
  const number = Number((value || "0").replace(/[^0-9.]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value || 0);
}

function formatProductPrice(value: string) {
  const number = parseMoney(value);
  return number > 0 ? formatMoney(number) : "$0";
}

function formatPercent(value: number) {
  return `${(value || 0).toFixed(1)}%`;
}

function formatDateTime(value?: string | null) {
  if (!value) return "Not available";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function styleLabel(value: string) {
  return STYLE_OPTIONS.find((option) => option.value === value)?.label || "Card";
}

const DETAIL_STYLES = `
.bp-detail-shell {
  max-width: 1680px;
  margin: 0 auto;
  padding-bottom: 88px;
}

.bp-detail-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 20px;
}

.bp-score-dot,
.bp-warning-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  display: inline-block;
  flex: 0 0 auto;
}

.bp-score-dot {
  background: #16a34a;
}

.bp-warning-dot {
  background: #f59e0b;
}

.bp-metric-icon {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.bp-metric-icon--success {
  background: #dcfce7;
}

.bp-metric-icon--attention,
.bp-metric-icon--warning {
  background: #fef3c7;
}

.bp-metric-icon--info {
  background: #e0f2fe;
}

.bp-metric-icon--magic {
  background: #ede9fe;
}

.bp-metric-icon--critical {
  background: #fee2e2;
}

.bp-detail-tabs {
  margin-top: 20px;
  border-bottom: 1px solid var(--p-color-border);
}

.bp-detail-main {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(300px, 320px);
  gap: 16px;
  align-items: start;
  margin-top: 18px;
}

.bp-detail-content {
  min-width: 0;
}

.bp-detail-sidebar {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.bp-field-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 0.65fr);
  gap: 16px;
}

.bp-featured-image {
  width: 156px;
  height: 76px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--p-color-border);
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--p-color-bg-surface-secondary);
}

.bp-featured-image .Polaris-Thumbnail {
  width: 100%;
  height: 100%;
}

.bp-featured-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.bp-native-image-preview {
  width: 100%;
  aspect-ratio: 16 / 9;
  border: 1px solid var(--p-color-border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--p-color-bg-surface-secondary);
}

.bp-native-image-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.bp-native-image-dropzone {
  min-height: 120px;
  border: 1px dashed #8a8a8a;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: #fff;
}

.bp-image-picker-search {
  flex: 1 1 420px;
  min-width: 260px;
}

.bp-image-picker-upload {
  min-height: 120px;
  border: 1px dashed #8a8a8a;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: #fff;
}

.bp-image-picker-input {
  display: none;
}

.bp-image-picker-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(96px, 1fr));
  gap: 24px 28px;
  padding: 8px 0 4px;
}

.bp-image-picker-item {
  position: relative;
  appearance: none;
  border: 0;
  background: transparent;
  padding: 0;
  min-width: 0;
  text-align: center;
  color: var(--p-color-text);
  cursor: pointer;
}

.bp-image-picker-thumb {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 1 / 1;
  border: 1px solid var(--p-color-border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--p-color-bg-surface-secondary);
}

.bp-image-picker-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.bp-image-picker-item--selected .bp-image-picker-thumb {
  border-color: #8a52ff;
  box-shadow: 0 0 0 2px #8a52ff;
}

.bp-image-picker-check {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 1;
  width: 18px;
  height: 18px;
  border: 1px solid #c9cccf;
  border-radius: 4px;
  background: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.bp-image-picker-item--selected .bp-image-picker-check {
  border-color: #8a52ff;
  background: #8a52ff;
  color: #fff;
}

.bp-image-picker-title,
.bp-image-picker-meta {
  display: block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  line-height: 18px;
}

.bp-image-picker-title {
  margin-top: 10px;
  font-weight: 500;
}

.bp-image-picker-meta {
  color: var(--p-color-text-subdued);
}

.bp-image-picker-empty {
  min-height: 180px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed var(--p-color-border);
  border-radius: 8px;
}

.bp-editor {
  border: 1px solid var(--p-color-border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--p-color-bg-surface);
}

.bp-editor-toolbar {
  min-height: 48px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--p-color-border);
  background: #fbfbfb;
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 6px;
  overflow-x: auto;
}

.bp-editor-toolbar button,
.bp-editor-toolbar select {
  height: 32px;
  border: 0;
  background: transparent;
  border-radius: 6px;
  padding: 0 10px;
  font: inherit;
  color: var(--p-color-text);
  cursor: pointer;
}

.bp-editor-toolbar .Polaris-Icon {
  width: 16px;
  height: 16px;
}

.bp-editor-toolbar button:hover {
  background: var(--p-color-bg-surface-secondary);
}

.bp-editor-icon-button {
  min-width: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
}

.bp-editor-list-button,
.bp-editor-products-button {
  width: auto;
  min-width: 44px;
}

.bp-editor-separator {
  width: 1px;
  height: 24px;
  background: var(--p-color-border);
  flex: 0 0 auto;
}

.bp-editor-code-button {
  margin-left: auto;
}

.bp-editor-button-content {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.bp-editor-button-content .Polaris-Icon {
  width: 16px;
  height: 16px;
}

.bp-editor-image-modal {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 220px;
  gap: 28px;
  align-items: start;
}

.bp-editor-align-button {
  min-width: 64px;
  height: 32px;
  border: 1px solid var(--p-color-border);
  border-radius: 6px;
  background: var(--p-color-bg-surface);
  color: var(--p-color-text);
  text-transform: capitalize;
  cursor: pointer;
}

.bp-editor-align-button--selected {
  border-color: #1a1a1a;
  box-shadow: 0 0 0 1px #1a1a1a;
}

.bp-editor-spacing-panel {
  border: 1px solid var(--p-color-border);
  padding: 16px;
  background: var(--p-color-bg-surface);
}

.bp-editor-spacing-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-areas:
    "top top"
    "left right"
    "bottom bottom";
  gap: 12px 18px;
  margin-top: 12px;
}

.bp-editor-spacing-grid .Polaris-TextField {
  max-width: 76px;
}

.bp-editor-spacing-top,
.bp-editor-spacing-bottom {
  display: flex;
  justify-content: center;
}

.bp-editor-spacing-top {
  grid-area: top;
}

.bp-editor-spacing-left {
  grid-area: left;
}

.bp-editor-spacing-right {
  grid-area: right;
  display: flex;
  justify-content: flex-end;
}

.bp-editor-spacing-bottom {
  grid-area: bottom;
}

.bp-editor-select {
  min-width: 112px;
  border: 1px solid var(--p-color-border) !important;
  background: var(--p-color-bg-surface) !important;
  text-align: left;
  cursor: pointer;
  flex: 0 0 auto;
}

.bp-editor-icon-select {
  width: 48px;
  border: 0 !important;
  background: transparent !important;
  padding: 0 4px !important;
  flex: 0 0 auto;
}

.bp-editor-align-select {
  width: 76px;
}

.bp-editor-canvas {
  min-height: 300px;
  max-height: 560px;
  overflow: auto;
  padding: 18px;
  font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 14px;
  line-height: 1.65;
  color: #202223;
  outline: none;
}

.bp-editor-canvas [dir="ltr"] {
  direction: ltr;
}

.bp-editor-canvas:empty::before {
  content: attr(data-placeholder);
  color: var(--p-color-text-subdued);
}

.bp-editor-canvas p {
  margin: 0 0 14px;
}

.bp-editor-canvas h2,
.bp-editor-canvas h3 {
  margin: 18px 0 8px;
  line-height: 1.3;
}

.bp-editor-canvas h2 {
  font-size: 20px;
}

.bp-editor-canvas h3 {
  font-size: 16px;
}

.bp-editor-canvas ul,
.bp-editor-canvas ol {
  margin: 0 0 14px 22px;
  padding: 0;
}

.bp-editor-canvas img {
  max-width: 100%;
  height: auto;
  border-radius: 8px;
  cursor: pointer;
}

.bp-editor-canvas img:hover {
  outline: 2px solid #8a52ff;
  outline-offset: 2px;
}

.bp-editor-canvas a {
  color: #2563eb;
  text-decoration: underline;
}

.bp-editor-content-table {
  width: 100%;
  border-collapse: collapse;
  margin: 16px 0;
}

.bp-editor-content-table td {
  border: 1px solid var(--p-color-border);
  min-width: 120px;
  padding: 10px;
}

.bp-editor-video {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  margin: 16px 0;
  border-radius: 8px;
  overflow: hidden;
  background: var(--p-color-bg-surface-secondary);
}

.bp-editor-video iframe {
  width: 100%;
  height: 100%;
  border: 0;
}

.bp-product-block-marker {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--p-color-border);
  border-radius: 6px;
  background: var(--p-color-bg-surface-secondary);
  color: var(--p-color-text);
  font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
  font-size: 12px;
  white-space: nowrap;
  overflow-x: auto;
}

.bp-score-ring {
  width: 104px;
  height: 104px;
  border-radius: 999px;
  padding: 10px;
}

.bp-score-ring-inner {
  width: 100%;
  height: 100%;
  border-radius: 999px;
  background: var(--p-color-bg-surface);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.bp-action-icon {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: #f4f0ff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
}

.bp-issue-row,
.bp-history-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 16px;
  align-items: center;
  padding: 16px;
  border-top: 1px solid var(--p-color-border);
}

.bp-issue-row:first-child,
.bp-history-row:first-child {
  border-top: 0;
}

.bp-history-row {
  grid-template-columns: auto minmax(0, 1fr) auto;
}

.bp-history-dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: #2563eb;
}

.bp-save-bar {
  position: fixed;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  width: min(760px, calc(100vw - 40px));
  z-index: 90;
  padding: 14px 16px;
  border: 1px solid var(--p-color-border);
  border-radius: 8px;
  background: var(--p-color-bg-surface);
  box-shadow: 0 16px 48px rgba(15, 23, 42, 0.18);
}

@media (max-width: 1100px) {
  .bp-detail-header {
    flex-direction: column;
  }

  .bp-detail-main {
    grid-template-columns: 1fr;
  }

  .bp-image-picker-grid {
    grid-template-columns: repeat(4, minmax(84px, 1fr));
  }

  .bp-editor-image-modal {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 760px) {
  .bp-field-grid {
    grid-template-columns: 1fr;
  }

  .bp-image-picker-grid {
    grid-template-columns: repeat(2, minmax(96px, 1fr));
  }

  .bp-save-bar .Polaris-InlineStack {
    gap: 12px;
  }
}
`;
