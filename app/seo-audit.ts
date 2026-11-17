/**
 * The single SEO engine for blog articles. The post editor (live checklist),
 * SEO Audit scans and stored issues all come from auditSeo(), so a post always
 * shows the same score and the same problems everywhere.
 *
 * Scoring model: every finding deducts points inside one score area, and each
 * area has a maximum it can lose. Advisory heuristics (numbers in titles,
 * keyword in alt text, external links…) are reported as "info" and never cost
 * points. A post hidden from search engines is capped at HIDDEN_SCORE_CAP.
 */

export type SeoAuditCategory = "basic" | "additional" | "image_seo" | "title_readability" | "content_readability" | "content_quality";
export type SeoAuditSeverity = "good" | "info" | "warning" | "critical";
export type SeoAuditWeight = "Low" | "Medium" | "High";
export type SeoScoreArea = "search_appearance" | "content" | "keywords" | "media" | "links";

export const SEO_SCORE_AREAS: Record<SeoScoreArea, { label: string; max: number }> = {
  search_appearance: { label: "Search appearance", max: 30 },
  content: { label: "Content", max: 30 },
  keywords: { label: "Keywords", max: 15 },
  media: { label: "Images & media", max: 15 },
  links: { label: "Links", max: 10 },
};

export const HIDDEN_SCORE_CAP = 20;
export const SEO_TITLE_RANGE = { min: 25, max: 60 } as const;
export const META_DESCRIPTION_RANGE = { min: 70, max: 160 } as const;

export type SeoAuditIssue = {
  type: string;
  category?: SeoAuditCategory;
  label: string;
  message: string;
  severity: SeoAuditSeverity;
  impact?: SeoAuditWeight;
  effort?: SeoAuditWeight;
  fix?: string;
  details?: SeoAuditIssueDetail[];
  /** Points deducted inside the issue's score area. */
  points?: number;
};

export type SeoAuditIssueDetail = {
  index: number;
  wordCount: number;
  preview: string;
};

type SeoAuditInput = {
  /** Effective SEO title (custom SEO title, falling back to the article title). */
  title: string;
  handle: string;
  /** Effective meta description (custom description, falling back to the excerpt). */
  summary: string;
  body: string;
  hasImage: boolean;
  imageAlt: string;
  imageWidth?: number | null;
  imageHeight?: number | null;
  productCount: number;
  focusKeyword?: string;
  shopDomain?: string;
  shopDomains?: string[];
  canUseTableOfContents?: boolean;
  tocEnabled?: boolean;
  tocAutoInsertEnabled?: boolean;
  authorName?: string;
  publishedAt?: string | Date | null;
  updatedAt?: string | Date | null;
  /** Shopify `seo.hidden` metafield is set: the page is excluded from search engines. */
  hiddenFromSearch?: boolean;
};

export type SeoAuditResult = {
  score: number;
  issues: SeoAuditIssue[];
  keywordScores: Record<string, "success" | "warning" | "critical">;
  breakdown: Record<SeoScoreArea, { score: number; max: number }>;
};

export type ContentQualityInput = Pick<SeoAuditInput, "body" | "summary" | "authorName" | "publishedAt" | "updatedAt" | "productCount"> & {
  shopDomain?: string;
  shopDomains?: string[];
};

export function auditSeo(input: SeoAuditInput): SeoAuditResult {
  const {
    title,
    handle,
    summary,
    body,
    hasImage,
    imageAlt,
    imageWidth,
    imageHeight,
    productCount,
    focusKeyword,
    shopDomain,
    shopDomains,
    canUseTableOfContents = true,
    tocEnabled = true,
    tocAutoInsertEnabled = false,
    authorName,
    publishedAt,
    updatedAt,
    hiddenFromSearch = false,
  } = input;
  const issues: SeoAuditIssue[] = [];
  const add = (issue: SeoAuditIssue, points = 0) => issues.push(points > 0 ? { ...issue, points } : issue);
  const pass = (category: SeoAuditCategory, type: string, label: string, message: string) => issues.push({ category, type, label, message, severity: "good" });

  const seoTitle = cleanText(title);
  const seoDescription = cleanText(summary);
  const text = stripHtml(body);
  const words = text ? text.split(/\s+/).filter(Boolean) : [];
  const wordCount = words.length;
  const linkStats = analyzeLinks(body, shopDomain, shopDomains);
  const markup = analyzeTechnicalMarkup(body);
  const headings = getHeadingTexts(body);
  const hasToc = canUseTableOfContents && tocEnabled && (hasTableOfContents(body) || (tocAutoInsertEnabled && headings.length >= 3));
  const bodyImageAltText = getBodyImageAltText(body);
  const allImageAltText = `${imageAlt || ""} ${bodyImageAltText}`.trim();
  const hasAnyImage = hasImage || /<img\b/i.test(body);
  const hasMediaInBody = productCount > 0 || /<img|<iframe|<video/i.test(body);
  const imageStats = analyzeImageSeo(body);
  const keywordScores: SeoAuditResult["keywordScores"] = {};

  // ── Search appearance ────────────────────────────────────────────────────
  if (hiddenFromSearch) {
    add({ category: "basic", type: "hidden_from_search", label: "Hidden from search engines", message: "This post is hidden from search engines (Shopify seo.hidden), so it cannot rank.", severity: "critical", impact: "High", effort: "Low", fix: "Remove the “hide from search engines” setting in Shopify if this post should rank." });
  } else {
    pass("basic", "hidden_from_search", "Visible to search engines", "Search engines are allowed to index this post.");
  }

  if (!seoTitle) {
    add({ category: "basic", type: "meta_title", label: "SEO title", message: "The SEO title is empty.", severity: "critical", impact: "High", effort: "Low", fix: "Write a unique, descriptive SEO title." }, 10);
  } else if (seoTitle.length > SEO_TITLE_RANGE.max) {
    add({ category: "basic", type: "meta_title", label: "SEO title length", message: `The SEO title is ${seoTitle.length} characters and may be cut off in search results (aim for ${SEO_TITLE_RANGE.max} or fewer).`, severity: "warning", impact: "Medium", effort: "Low", fix: `Shorten the SEO title to ${SEO_TITLE_RANGE.max} characters or fewer, keeping the main topic first.` }, 5);
  } else if (seoTitle.length < SEO_TITLE_RANGE.min) {
    add({ category: "basic", type: "meta_title", label: "SEO title length", message: `The SEO title is only ${seoTitle.length} characters. A more descriptive title can earn more clicks.`, severity: "warning", impact: "Low", effort: "Low", fix: "Make the SEO title more descriptive without keyword stuffing." }, 2);
  } else {
    pass("basic", "meta_title", "SEO title length", `The SEO title is ${seoTitle.length} characters.`);
  }

  if (!seoDescription) {
    add({ category: "basic", type: "meta_description", label: "Meta description", message: "There is no meta description or excerpt, so search engines will pick a random snippet.", severity: "critical", impact: "High", effort: "Low", fix: `Write a unique ${META_DESCRIPTION_RANGE.min}–${META_DESCRIPTION_RANGE.max} character meta description with a clear benefit.` }, 15);
  } else if (seoDescription.length < META_DESCRIPTION_RANGE.min) {
    add({ category: "basic", type: "meta_description", label: "Meta description length", message: `The meta description is only ${seoDescription.length} characters.`, severity: "warning", impact: "Medium", effort: "Low", fix: "Expand the meta description with the main benefit and search intent." }, 4);
  } else if (seoDescription.length > META_DESCRIPTION_RANGE.max) {
    add({ category: "basic", type: "meta_description", label: "Meta description length", message: `The meta description is ${seoDescription.length} characters and may be truncated (aim for ${META_DESCRIPTION_RANGE.max} or fewer).`, severity: "warning", impact: "Low", effort: "Low", fix: `Trim the meta description to ${META_DESCRIPTION_RANGE.max} characters or fewer.` }, 3);
  } else {
    pass("basic", "meta_description", "Meta description length", `The meta description is ${seoDescription.length} characters.`);
  }

  if (!handle || handle.length > 75) {
    add({ category: "additional", type: "url_length", label: "URL Length", message: "Your URL is too long. Keep it short and descriptive.", severity: "warning", impact: "Low", effort: "Low", fix: "Shorten the URL handle and keep a redirect from the old URL." }, 2);
  } else {
    pass("additional", "url_length", "URL Length", "Your URL is short and descriptive.");
  }

  // ── Content ──────────────────────────────────────────────────────────────
  if (wordCount < 80) {
    add({ category: "basic", type: "content_length", label: "Content length", message: `The article has ${wordCount} words, which is too little to satisfy most searches. Google has no preferred word count, but thin pages rarely rank.`, severity: "critical", impact: "High", effort: "Medium", fix: "Add the information readers need to complete their task." }, 20);
  } else if (wordCount < 300) {
    add({ category: "basic", type: "content_length", label: "Content length", message: `The article has ${wordCount} words. Check whether it fully satisfies the reader's intent; Google has no preferred word count.`, severity: "warning", impact: "Medium", effort: "Medium", fix: "Expand only where important questions or evidence are missing." }, 8);
  } else if (wordCount < 600) {
    add({ category: "basic", type: "content_length", label: "Content length", message: `The article has ${wordCount} words. Expand it only if important questions or evidence are missing.`, severity: "info", impact: "Low", effort: "Medium" });
  } else {
    pass("basic", "content_length", "Content length", `Great! Your article is ${wordCount} words long.`);
  }

  if (wordCount >= 300 && headings.length === 0) {
    add({ category: "content_readability", type: "subheadings", label: "Subheadings", message: "The article has no H2–H6 subheadings, which makes it hard to scan.", severity: "warning", impact: "Medium", effort: "Low", fix: "Organize the article with descriptive H2 and H3 subheadings." }, 4);
  } else if (headings.length) {
    pass("content_readability", "subheadings", "Subheadings", "The article uses subheadings.");
  }

  if (markup.skippedHeadingLevels > 0) {
    add({ category: "content_readability", type: "heading_hierarchy", label: "Heading hierarchy", message: `${markup.skippedHeadingLevels} heading transition(s) skip a level.`, severity: "warning", impact: "Low", effort: "Low", fix: "Keep the outline sequential, such as H2 followed by H3 rather than H4." }, 2);
  }
  if (markup.duplicateHeadingIds > 0) {
    add({ category: "content_readability", type: "duplicate_heading_ids", label: "Duplicate heading anchors", message: `${markup.duplicateHeadingIds} heading id(s) are duplicated and can break table-of-contents links.`, severity: "warning", impact: "Medium", effort: "Low", fix: "Give every heading a unique id value." }, 3);
  }

  const paragraphs = [...body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((match, index) => {
    const paragraphText = stripHtml(match[1] || "");
    return { index: index + 1, text: paragraphText, wordCount: paragraphText.split(/\s+/).filter(Boolean).length };
  });
  const longParagraphs = paragraphs.filter((paragraph) => paragraph.wordCount > 120);
  if (longParagraphs.length > 0) {
    add({
      category: "content_readability",
      type: "paragraph_length",
      label: "Paragraph Length",
      message: `${longParagraphs.length} paragraph${longParagraphs.length === 1 ? " is" : "s are"} over 120 words.`,
      severity: "warning",
      impact: "Low",
      effort: "Low",
      fix: "Split only the identified long paragraphs at natural transitions. Preserve every fact, link, image, and the original meaning.",
      details: longParagraphs.slice(0, 10).map((paragraph) => ({
        index: paragraph.index,
        wordCount: paragraph.wordCount,
        preview: paragraph.text.length > 180 ? `${paragraph.text.slice(0, 177).trim()}...` : paragraph.text,
      })),
    }, 2);
  } else {
    pass("content_readability", "paragraph_length", "Paragraph Length", "Your paragraphs are nicely broken down.");
  }

  if (canUseTableOfContents) {
    if (hasToc) pass("content_readability", "toc", "Table of contents", "Your article has an active Table of Contents.");
    else if (headings.length >= 3) add({ category: "content_readability", type: "toc", label: "Table of contents", message: "A table of contents can help readers jump to the section they need.", severity: "info", impact: "Low", effort: "Low" });
  }

  for (const quality of auditContentQuality({ body, summary: seoDescription, authorName, publishedAt, updatedAt, productCount, shopDomain, shopDomains })) {
    if (quality.type === "eeat_author" && quality.severity === "warning") add(quality, 4);
    else if (quality.type === "eeat_direct_answer" && quality.severity === "warning") add(quality, 3);
    else add(quality);
  }

  // ── Images & media ───────────────────────────────────────────────────────
  if (!hasImage && !hasMediaInBody) {
    add({ category: "content_readability", type: "media", label: "Media", message: "Add images, products, or videos to make your content more engaging.", severity: "warning", impact: "Medium", effort: "Medium", fix: "Add an original image, video or linked products that support the article." }, 5);
  } else {
    pass("content_readability", "media", "Media", "Your content contains engaging media.");
  }

  if (hasImage) {
    if (cleanText(imageAlt)) pass("image_seo", "featured_image_alt", "Featured image alt text", "The featured image has alt text.");
    else add({ category: "image_seo", type: "featured_image_alt", label: "Featured image alt text", message: "The featured image is missing alt text.", severity: "warning", impact: "Medium", effort: "Low", fix: "Add a concise description in the featured image alt text field." }, 4);
  }
  if (imageStats.missingAlt > 0) {
    add({ category: "image_seo", type: "inline_images_missing_alt", label: "Inline image alt text", message: `${imageStats.missingAlt} inline image(s) have no alt attribute.`, severity: "warning", impact: "Medium", effort: "Low", fix: "Add concise descriptive alt text, or alt=\"\" for decorative images." }, Math.min(6, imageStats.missingAlt * 2));
  } else if (imageStats.totalImages > 0) {
    pass("image_seo", "inline_images_missing_alt", "Inline image alt text", "All inline images include an alt attribute.");
  }
  if (imageStats.missingDimensions > 0) {
    add({ category: "image_seo", type: "images_missing_dimensions", label: "Image dimensions", message: `${imageStats.missingDimensions} inline image(s) are missing width or height.`, severity: "warning", impact: "Medium", effort: "Low", fix: "Set intrinsic width and height to reduce layout shift." }, Math.min(3, imageStats.missingDimensions));
  } else if (imageStats.totalImages > 0) {
    pass("image_seo", "images_missing_dimensions", "Image dimensions", "All inline images include width and height.");
  }
  if (imageStats.genericFilenames > 0) {
    add({ category: "image_seo", type: "generic_image_filenames", label: "Image filenames", message: `${imageStats.genericFilenames} image(s) use a generic filename that provides little search context.`, severity: "info", impact: "Low", effort: "Medium", fix: "When replacing the image, upload it to Shopify with a short descriptive filename." });
  } else if (imageStats.totalImages > 0) {
    pass("image_seo", "generic_image_filenames", "Image filenames", "Inline images use descriptive filenames.");
  }
  if (imageStats.stuffedAlt > 0) {
    add({ category: "image_seo", type: "image_alt_stuffing", label: "Natural alt text", message: `${imageStats.stuffedAlt} image alt value(s) are overly long or repeat the same terms.`, severity: "warning", impact: "Medium", effort: "Low", fix: "Rewrite alt text as one concise, natural description of the image." }, Math.min(4, imageStats.stuffedAlt * 2));
  } else if (imageStats.totalImages > 0 || hasImage) {
    pass("image_seo", "image_alt_stuffing", "Natural alt text", "Image alt text is concise and does not repeat terms excessively.");
  }
  if (imageStats.decorativeWithAlt > 0) {
    add({ category: "image_seo", type: "decorative_image_alt", label: "Decorative image alt text", message: `${imageStats.decorativeWithAlt} decorative image(s) contain descriptive alt text.`, severity: "warning", impact: "Low", effort: "Low", fix: "Use alt=\"\" for images marked as decorative or aria-hidden." }, 1);
  } else if (imageStats.decorativeImages > 0) {
    pass("image_seo", "decorative_image_alt", "Decorative image alt text", "Decorative images use empty alt text correctly.");
  }
  if (imageStats.uncrawlableSources > 0) {
    add({ category: "image_seo", type: "uncrawlable_image_urls", label: "Crawlable image URLs", message: `${imageStats.uncrawlableSources} image(s) use a missing, data, blob, or JavaScript source that search engines cannot reliably crawl.`, severity: "critical", impact: "High", effort: "Medium", fix: "Upload the image to Shopify Files or the article editor and use its HTTPS CDN URL." }, Math.min(8, imageStats.uncrawlableSources * 4));
  } else if (imageStats.totalImages > 0) {
    pass("image_seo", "uncrawlable_image_urls", "Crawlable image URLs", "All inline images use crawlable URLs.");
  }
  const featuredImageTooSmall = Boolean(hasImage && imageWidth && imageHeight && imageWidth * imageHeight < 50_000);
  if (imageStats.tooSmall > 0 || featuredImageTooSmall) {
    const count = imageStats.tooSmall + (featuredImageTooSmall ? 1 : 0);
    add({ category: "image_seo", type: "small_article_images", label: "Image resolution", message: `${count} image(s) have known dimensions below 50,000 pixels and may be too small for prominent search presentation.`, severity: "warning", impact: "Medium", effort: "Medium", fix: "Replace important article images with higher-resolution Shopify-hosted images." }, Math.min(4, count * 2));
  } else if (imageStats.knownDimensions > 0 || Boolean(hasImage && imageWidth && imageHeight)) {
    pass("image_seo", "small_article_images", "Image resolution", "Images with known dimensions are large enough for search presentation.");
  }

  // ── Links ────────────────────────────────────────────────────────────────
  if (linkStats.internal < 1) {
    add({ category: "additional", type: "internal_links", label: "Internal links", message: "Add internal links in your content.", severity: "warning", impact: "Medium", effort: "Low", fix: "Link to related articles, collections or products where it helps readers." }, 5);
  } else {
    pass("additional", "internal_links", "Internal links", "Your content includes internal links.");
  }
  if (markup.unsafeLinks > 0) {
    add({ category: "additional", type: "unsafe_links", label: "Uncrawlable links", message: `${markup.unsafeLinks} link(s) use an empty or JavaScript URL.`, severity: "critical", impact: "High", effort: "Low", fix: "Replace empty and JavaScript href values with real crawlable URLs or buttons." }, Math.min(10, markup.unsafeLinks * 5));
  }
  // Advisory only: Google does not require outbound links.
  if (linkStats.external < 1) {
    add({ category: "additional", type: "external_links", label: "External links", message: "Consider linking to an external source when it supports a claim.", severity: "info", impact: "Low", effort: "Low" });
  } else {
    pass("additional", "external_links", "External links", "You are linking out to external resources.");
  }
  if (linkStats.external > 0 && linkStats.dofollowExternal < 1) {
    add({ category: "additional", type: "dofollow_external_links", label: "External link qualification", message: "All external links are nofollow, sponsored or ugc. That is fine when it reflects the relationship.", severity: "info", impact: "Low", effort: "Low" });
  } else if (linkStats.dofollowExternal > 0) {
    pass("additional", "dofollow_external_links", "DoFollow external links", "At least one external link is DoFollow.");
  }

  // Advisory only: numbers can help some titles but are not a ranking factor.
  if (/\d/.test(seoTitle)) pass("title_readability", "title_number", "Number in Title", "Your SEO title contains a number.");
  else add({ category: "title_readability", type: "title_number", label: "Number in Title", message: "Optional: a number (such as a count or year) can make some titles more specific.", severity: "info", impact: "Low", effort: "Low" });

  // ── Keywords ─────────────────────────────────────────────────────────────
  const keywords = (focusKeyword || "").split(",").map((keyword) => normalizeMatchText(keyword)).filter(Boolean);
  if (!keywords.length) {
    add({ category: "basic", type: "kw_missing", label: "Focus keyword not set", message: "Set a focus keyword to complete keyword placement, relevance, and cannibalization checks.", severity: "warning", impact: "Medium", effort: "Low", fix: "Choose the primary search topic for this article." }, 5);
  }

  const leadText = words.slice(0, Math.max(20, Math.floor(wordCount * 0.1))).join(" ");
  keywords.forEach((keyword, index) => {
    const isPrimary = index === 0;
    const occurrences = countPhrase(text, keyword);
    const keywordWordCount = keyword.split(" ").length;
    const density = wordCount > 0 ? ((occurrences * keywordWordCount) / wordCount) * 100 : 0;
    const inTitle = containsPhrase(seoTitle, keyword);
    const inSummary = containsPhrase(seoDescription, keyword);
    const inHandle = handleContainsSlug(handle, slugifySeoText(keyword));
    const inLead = containsPhrase(leadText, keyword);
    const inHeading = headings.some((heading) => containsPhrase(heading, keyword));
    const inImageAlt = hasAnyImage && containsPhrase(allImageAltText, keyword);

    let keywordScore = 100;
    if (!inTitle) keywordScore -= isPrimary ? 10 : 5;
    if (!inSummary) keywordScore -= isPrimary ? 5 : 2;
    if (!inHandle) keywordScore -= isPrimary ? 5 : 2;
    if (occurrences === 0) keywordScore -= 15;
    else if (density > 4) keywordScore -= 5;
    if (!inLead) keywordScore -= 5;
    keywordScores[keyword] = keywordScore >= 80 ? "success" : keywordScore >= 50 ? "warning" : "critical";

    if (!isPrimary) {
      if (occurrences === 0) add({ category: "additional", type: `secondary_kw_content_${index}`, label: "Secondary Keyword in Content", message: `Secondary keyword "${keyword}" does not appear in the content.`, severity: "info", impact: "Low", effort: "Low" });
      else pass("additional", `secondary_kw_content_${index}`, "Secondary Keyword in Content", `Secondary keyword "${keyword}" appears in the content.`);
      return;
    }

    if (inTitle) pass("basic", "kw_title", "Keyword in Title", "Focus Keyword is in the SEO title.");
    else add({ category: "basic", type: "kw_title", label: "Keyword in Title", message: "Focus Keyword does not appear in the SEO title.", severity: "critical", impact: "High", effort: "Low", fix: "Use the focus keyword naturally in the SEO title." }, 6);

    if (occurrences > 0) pass("basic", "kw_content", "Keyword in Content", "Focus Keyword appears in the content.");
    else add({ category: "basic", type: "kw_content", label: "Keyword in Content", message: "Focus Keyword does not appear in the content.", severity: "critical", impact: "High", effort: "Medium", fix: "Cover the focus topic explicitly in the article." }, 6);

    if (inSummary) pass("basic", "kw_summary", "Keyword in Meta", "Focus Keyword is in the SEO Meta Description.");
    else add({ category: "basic", type: "kw_summary", label: "Keyword in Meta", message: "Focus Keyword not found in your SEO Meta Description.", severity: "warning", impact: "Medium", effort: "Low", fix: "Use the focus keyword naturally in the meta description." }, 3);

    if (inLead) pass("basic", "kw_early", "Keyword at Start", "Focus Keyword appears in the first 10% of the content.");
    else add({ category: "basic", type: "kw_early", label: "Keyword at Start", message: "Focus Keyword does not appear in the first 10% of the content.", severity: "warning", impact: "Low", effort: "Low", fix: "Mention the topic early so readers know they are in the right place." }, 2);

    if (inHandle) pass("basic", "kw_url", "Keyword in URL", "Focus Keyword is in the URL.");
    else add({ category: "basic", type: "kw_url", label: "Keyword in URL", message: "Focus Keyword not found in the URL.", severity: "warning", impact: "Low", effort: "Low", fix: "Include the topic in the handle only if a redirect from the old URL is acceptable." }, 1);

    if (inHeading) pass("additional", "kw_heading", "Keyword in Subheadings", "Focus Keyword found in subheading(s).");
    else if (headings.length) add({ category: "additional", type: "kw_heading", label: "Keyword in Subheadings", message: "Focus Keyword not found in subheading(s) like H2, H3, etc.", severity: "warning", impact: "Low", effort: "Low", fix: "Use the topic in one relevant H2 or H3 heading." }, 1);

    if (occurrences > 0 && density > 4) {
      add({ category: "additional", type: "kw_density", label: "Keyword Density", message: `The exact phrase appears at ${density.toFixed(2)}% density. Review the copy for repetitive or unnatural wording.`, severity: "warning", impact: "Low", effort: "Medium", fix: "Replace some repetitions with natural variants." }, 2);
    } else if (occurrences > 0 && density >= 0.5) {
      pass("additional", "kw_density", "Keyword Density", `The exact focus phrase appears naturally in the article (${density.toFixed(2)}%).`);
    } else {
      add({ category: "additional", type: "kw_density", label: "Keyword Density", message: occurrences ? `The exact phrase appears at ${density.toFixed(2)}% density. This is informational; natural variants also count.` : "The exact focus phrase was not found. Natural variants may still cover the topic.", severity: "info", impact: "Low", effort: "Medium" });
    }

    // Advisory only: alt text should describe the image, not repeat keywords.
    if (inImageAlt) pass("additional", "kw_alt", "Keyword in Image Alt", "Focus Keyword found in image alt attributes.");
    else add({ category: "additional", type: "kw_alt", label: "Keyword in Image Alt", message: "Optional: use the keyword in alt text only when it accurately describes an image.", severity: "info", impact: "Low", effort: "Low" });

    const titlePosition = normalizeMatchText(seoTitle).search(phraseRegex(keyword));
    if (titlePosition >= 0 && titlePosition < 20) pass("title_readability", "kw_title_pos", "Keyword Position", "Focus Keyword used at the beginning of SEO title.");
    else if (inTitle) add({ category: "title_readability", type: "kw_title_pos", label: "Keyword Position", message: "Optional: moving the keyword closer to the start of the SEO title can make it clearer.", severity: "info", impact: "Low", effort: "Low" });
  });

  return finalizeScore(issues, keywordScores, hiddenFromSearch);
}

function finalizeScore(issues: SeoAuditIssue[], keywordScores: SeoAuditResult["keywordScores"], hiddenFromSearch: boolean): SeoAuditResult {
  const lost = Object.fromEntries(Object.keys(SEO_SCORE_AREAS).map((area) => [area, 0])) as Record<SeoScoreArea, number>;
  for (const issue of issues) {
    if (issue.points) lost[getSeoIssueArea(issue.type)] += issue.points;
  }
  const breakdown = {} as SeoAuditResult["breakdown"];
  let score = 100;
  for (const [area, { max }] of Object.entries(SEO_SCORE_AREAS) as Array<[SeoScoreArea, { max: number }]>) {
    const deducted = Math.min(max, lost[area]);
    breakdown[area] = { score: max - deducted, max };
    score -= deducted;
  }
  if (hiddenFromSearch) score = Math.min(score, HIDDEN_SCORE_CAP);
  return { score: Math.max(0, Math.min(100, Math.round(score))), issues, keywordScores, breakdown };
}

/** Score area an issue type belongs to. Single source for scoring and grouping. */
export function getSeoIssueArea(type: string): SeoScoreArea {
  if (type.startsWith("kw_") || type.startsWith("secondary_kw_")) return "keywords";
  if (["meta_title", "meta_description", "url_length", "hidden_from_search"].includes(type)) return "search_appearance";
  if (["internal_links", "unsafe_links", "external_links", "dofollow_external_links"].includes(type)) return "links";
  if (type === "media" || type.includes("image") || type.includes("alt")) return "media";
  return "content";
}

export type StoredSeoIssue = {
  type: string;
  category: "on_page" | "image" | "content" | "product_linking" | "schema";
  label: string;
  message: string;
  severity: Exclude<SeoAuditSeverity, "good">;
  impact: SeoAuditWeight;
  effort: SeoAuditWeight;
  fix: string;
  points?: number;
};

/**
 * Converts engine output into the problems SEO Audit lists and persists.
 * Passed checks and advisory ("info") items stay in the editor checklist only.
 */
export function toStoredSeoIssues(issues: SeoAuditIssue[]): StoredSeoIssue[] {
  return issues
    .filter((issue) => issue.severity === "warning" || issue.severity === "critical")
    .map((issue) => ({
      type: issue.type,
      category: getStoredIssueCategory(issue.type),
      label: issue.label,
      message: issue.message,
      severity: issue.severity as StoredSeoIssue["severity"],
      impact: issue.impact || (issue.severity === "critical" ? "High" : "Medium"),
      effort: issue.effort || "Low",
      fix: issue.fix || "Review this item and improve it only when it helps readers.",
      ...(issue.points ? { points: issue.points } : {}),
    }));
}

function getStoredIssueCategory(type: string): StoredSeoIssue["category"] {
  const area = getSeoIssueArea(type);
  if (area === "media") return type === "media" ? "content" : "image";
  if (area === "content") return "content";
  return "on_page";
}

export function auditContentQuality({
  body,
  summary,
  authorName,
  shopDomain,
  shopDomains,
}: ContentQualityInput): SeoAuditIssue[] {
  const text = stripHtml(body);
  const linkStats = analyzeLinks(body, shopDomain, shopDomains);
  const firstParagraph = getFirstParagraph(body) || text.slice(0, 500);
  const hasExperienceEvidence = /\b(i|we|our|tested|reviewed|compared|measured|results?|case study|before and after|in our experience)\b/i.test(text)
    || /(?:tôi|chúng tôi|kinh nghiệm|trải nghiệm|đã dùng|đã thử|thử nghiệm|đo lường|kết quả thực tế|đánh giá thực tế|trước và sau)/i.test(text)
    || (body.match(/<img\b/gi)?.length || 0) >= 2;
  const directlyAnswersIntent = stripHtml(firstParagraph).split(/\s+/).filter(Boolean).length >= 35 || stripHtml(summary).length >= 90;

  return [
    authorName?.trim()
      ? qualityIssue("eeat_author", "Author attribution", `The article identifies ${authorName.trim()} as its author.`, "good")
      : qualityIssue("eeat_author", "Author attribution", "No author is assigned to this article.", "warning", "Medium", "Assign a real author and show the byline on the storefront."),
    linkStats.external > 0
      ? qualityIssue("eeat_sources", "Sources and citations", "The article links to at least one external source readers can inspect.", "good")
      : qualityIssue("eeat_sources", "Sources and citations", "No external citation was found. Add trustworthy sources for factual or high-stakes claims.", "info"),
    hasExperienceEvidence
      ? qualityIssue("eeat_experience", "First-hand experience", "The content includes signals of original experience, testing, results, or original imagery.", "good")
      : qualityIssue("eeat_experience", "First-hand experience", "Manual review: add first-hand experience, original photos, comparisons, or test results when relevant.", "info"),
    directlyAnswersIntent
      ? qualityIssue("eeat_direct_answer", "Direct answer to reader intent", "The introduction or summary gives readers a substantive answer quickly.", "good")
      : qualityIssue("eeat_direct_answer", "Direct answer to reader intent", "The opening does not clearly answer the main reader need.", "warning", "Medium", "Add a concise, direct answer or outcome near the beginning."),
  ];
}

function qualityIssue(
  type: string,
  label: string,
  message: string,
  severity: SeoAuditSeverity,
  impact: SeoAuditWeight = "Low",
  fix?: string,
): SeoAuditIssue {
  return { type, category: "content_quality", label, message, severity, impact, effort: "Low", ...(fix ? { fix } : {}) };
}

// ── Text matching ──────────────────────────────────────────────────────────

/** NFC + lowercase + collapsed whitespace, so composed/decomposed Unicode match. */
export function normalizeMatchText(value: string) {
  return String(value || "").normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
}

function phraseRegex(phrase: string) {
  const escaped = normalizeMatchText(phrase).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
  // Whole-word match in any script: "art" must not match "start" or "party".
  return new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${escaped}(?![\\p{L}\\p{M}\\p{N}])`, "gu");
}

export function countPhrase(text: string, phrase: string) {
  if (!normalizeMatchText(phrase)) return 0;
  return normalizeMatchText(text).match(phraseRegex(phrase))?.length || 0;
}

export function containsPhrase(text: string, phrase: string) {
  return countPhrase(text, phrase) > 0;
}

function handleContainsSlug(handle: string, slug: string) {
  if (!slug) return false;
  return `-${String(handle || "").toLowerCase()}-`.includes(`-${slug}-`);
}

// ── HTML analysis ──────────────────────────────────────────────────────────

function getFirstParagraph(body: string) {
  return body.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] || "";
}

function analyzeLinks(body: string, shopDomain?: string, shopDomains: string[] = []) {
  const stats = { internal: 0, external: 0, dofollowExternal: 0 };
  const shopHosts = buildShopHosts(shopDomain, shopDomains);
  for (const match of (body || "").matchAll(/<a\b([^>]*)>/gi)) {
    const attrs = match[1] || "";
    const href = getHtmlAttribute(attrs, "href").trim();
    if (!href || /^(mailto:|tel:|sms:|javascript:)/i.test(href)) continue;
    const rel = getHtmlAttribute(attrs, "rel").toLowerCase();
    const isNoFollow = /\b(nofollow|sponsored|ugc)\b/i.test(rel);
    if (isInternalHref(href, shopHosts)) {
      stats.internal += 1;
    } else {
      stats.external += 1;
      if (!isNoFollow) stats.dofollowExternal += 1;
    }
  }
  return stats;
}

export function analyzeTechnicalMarkup(body: string) {
  let unsafeLinks = 0;
  for (const match of (body || "").matchAll(/<a\b([^>]*)>/gi)) {
    const attrs = match[1] || "";
    // Named anchors (<a id="…"> without href) are valid and not links.
    if (!/\bhref\s*=/i.test(attrs)) continue;
    const href = getHtmlAttribute(attrs, "href").trim();
    if (!href || /^javascript:/i.test(href)) unsafeLinks += 1;
  }
  const levels = Array.from((body || "").matchAll(/<h([2-6])\b/gi), (match) => Number(match[1]));
  let skippedHeadingLevels = 0;
  levels.forEach((level, index) => {
    if (index > 0 && level > levels[index - 1] + 1) skippedHeadingLevels += 1;
  });
  const ids = Array.from((body || "").matchAll(/<h[2-6]\b([^>]*)>/gi), (match) => getHtmlAttribute(match[1] || "", "id")).filter(Boolean);
  const duplicateHeadingIds = ids.length - new Set(ids).size;
  return { unsafeLinks, skippedHeadingLevels, duplicateHeadingIds };
}

function getHtmlAttribute(attrs: string, name: string) {
  const match = attrs.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match?.[2] || match?.[3] || match?.[4] || "";
}

function isInternalHref(href: string, shopHosts: Set<string>) {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("/")) return true;
  try {
    const url = new URL(trimmed);
    const host = normalizeHost(url.hostname);
    return Array.from(shopHosts).some((shopHost) => host === shopHost || host.endsWith(`.${shopHost}`));
  } catch {
    return true;
  }
}

function buildShopHosts(shopDomain?: string, shopDomains: string[] = []) {
  const hosts = new Set<string>();
  [shopDomain, ...shopDomains].forEach((domain) => {
    const host = normalizeHost(domain || "");
    if (host) hosts.add(host);
  });
  return hosts;
}

function normalizeHost(value: string) {
  return value.replace(/^https?:\/\//i, "").split(/[/?#]/)[0].replace(/^www\./i, "").toLowerCase();
}

function getHeadingTexts(body: string) {
  return Array.from((body || "").matchAll(/<h[2-6][^>]*>([\s\S]*?)<\/h[2-6]>/gi), (match) => stripHtml(match[1] || "")).filter(Boolean);
}

function hasTableOfContents(body: string) {
  return /\[\[SBS_TOC(?::[^\]]+)?\]\]/i.test(body) || /\bdata-sbs-toc\s*=/i.test(body) || /data-bp-content-nav=["']toc["']|class=["'][^"']*\bbp-toc\b/i.test(body);
}

function getBodyImageAltText(body: string) {
  return Array.from((body || "").matchAll(/<img\b([^>]*)>/gi), (match) => getHtmlAttribute(match[1] || "", "alt")).filter(Boolean).join(" ");
}

export function analyzeImageSeo(body: string) {
  const stats = {
    totalImages: 0,
    knownDimensions: 0,
    decorativeImages: 0,
    missingAlt: 0,
    missingDimensions: 0,
    genericFilenames: 0,
    stuffedAlt: 0,
    decorativeWithAlt: 0,
    tooSmall: 0,
    uncrawlableSources: 0,
  };
  for (const match of (body || "").matchAll(/<img\b([^>]*)>/gi)) {
    stats.totalImages += 1;
    const attrs = match[1] || "";
    const hasAltAttribute = /\balt\s*=/i.test(attrs);
    const alt = getHtmlAttribute(attrs, "alt").trim();
    const width = Number.parseInt(getHtmlAttribute(attrs, "width"), 10);
    const height = Number.parseInt(getHtmlAttribute(attrs, "height"), 10);
    const src = getHtmlAttribute(attrs, "src").trim();
    if (!hasAltAttribute) stats.missingAlt += 1;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) stats.missingDimensions += 1;
    else {
      stats.knownDimensions += 1;
      if (width * height < 50_000) stats.tooSmall += 1;
    }
    if (isStuffedAlt(alt)) stats.stuffedAlt += 1;
    const isDecorative = /\brole\s*=\s*["']presentation["']/i.test(attrs) || /\baria-hidden\s*=\s*["']true["']/i.test(attrs);
    if (isDecorative) stats.decorativeImages += 1;
    if (isDecorative && alt) stats.decorativeWithAlt += 1;
    if (!src || /^(?:data:|blob:|javascript:)/i.test(src)) stats.uncrawlableSources += 1;
    const filename = src.split(/[?#]/)[0].split("/").pop() || "";
    if (/^(img|image|photo|pic|dsc|screenshot|untitled)[-_]?\d*\.(jpe?g|png|gif|webp|avif)$/i.test(filename)) stats.genericFilenames += 1;
  }
  return stats;
}

function isStuffedAlt(alt: string) {
  if (!alt) return false;
  if (alt.length > 160) return true;
  const tokens = alt.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [];
  if (tokens.length < 5) return false;
  const counts = new Map<string, number>();
  tokens.forEach((token) => counts.set(token, (counts.get(token) || 0) + 1));
  return Math.max(...counts.values()) >= 3;
}

const HTML_ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", quot: "\"", apos: "'", lt: "<", gt: ">", "#39": "'" };

export function stripHtml(value: string) {
  return String(value || "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(nbsp|amp|quot|apos|lt|gt|#39);/gi, (_match, entity: string) => HTML_ENTITIES[entity.toLowerCase()] || " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanText(value: string | null | undefined) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function slugifySeoText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0111/g, "d")
    .replace(/\u0110/g, "D")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
