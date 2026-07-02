export type SeoAuditCategory = "basic" | "additional" | "title_readability" | "content_readability";
export type SeoAuditSeverity = "good" | "info" | "warning" | "critical";
export type SeoAuditWeight = "Low" | "Medium" | "High";

export type SeoAuditIssue = {
  type: string;
  category?: SeoAuditCategory;
  label: string;
  message: string;
  severity: SeoAuditSeverity;
  impact?: SeoAuditWeight;
  effort?: SeoAuditWeight;
};

type SeoAuditInput = {
  title: string;
  handle: string;
  summary: string;
  body: string;
  hasImage: boolean;
  imageAlt: string;
  productCount: number;
  focusKeyword?: string;
  shopDomain?: string;
  shopDomains?: string[];
};

export function auditSeo({
  title,
  handle,
  summary,
  body,
  hasImage,
  imageAlt,
  productCount,
  focusKeyword,
  shopDomain,
  shopDomains,
}: SeoAuditInput): { score: number; issues: SeoAuditIssue[]; keywordScores: Record<string, "success" | "warning" | "critical"> } {
  const issues: SeoAuditIssue[] = [];
  let score = 100;
  const text = stripHtml(body);
  const wordCount = text ? text.split(/\s+/).filter(Boolean).length : 0;
  const linkStats = analyzeLinks(body, shopDomain, shopDomains);
  const headings = getHeadingTexts(body);
  const hasToc = hasTableOfContents(body) || headings.length >= 3;
  const bodyImageAltText = getBodyImageAltText(body);
  const allImageAltText = `${imageAlt || ""} ${bodyImageAltText}`.trim();
  const hasAnyImage = hasImage || /<img\b/i.test(body);
  const hasMediaInBody = productCount > 0 || /<img|<iframe|<video/i.test(body);
  const keywordScores: Record<string, "success" | "warning" | "critical"> = {};

  const titleLower = title.toLowerCase();
  const summaryLower = summary.toLowerCase();
  const handleLower = handle.toLowerCase();
  const bodyLower = text.toLowerCase();
  const first10Words = text
    .split(/\s+/)
    .slice(0, Math.max(20, Math.floor(wordCount * 0.1)))
    .join(" ")
    .toLowerCase();
  const keywords = (focusKeyword || "")
    .split(",")
    .map((keyword) => keyword.trim().toLowerCase())
    .filter(Boolean);
  const primaryKeyword = keywords[0] || "";

  if (wordCount < 250) {
    issues.push({
      category: "basic",
      type: "content_length",
      label: "Content length",
      message: `Your article is too short (${wordCount} words). Aim for at least 600 words.`,
      severity: "critical",
      impact: "High",
      effort: "Medium",
    });
    score -= 15;
  } else if (wordCount < 600) {
    issues.push({
      category: "basic",
      type: "content_length",
      label: "Content length",
      message: `Your article is ${wordCount} words. Aim for at least 600 words.`,
      severity: "warning",
      impact: "Medium",
      effort: "Medium",
    });
    score -= 5;
  } else {
    issues.push({
      category: "basic",
      type: "content_length",
      label: "Content length",
      message: `Great! Your article is ${wordCount} words long.`,
      severity: "good",
    });
  }

  if (!handle || handle.length > 75) {
    issues.push({
      category: "additional",
      type: "url_length",
      label: "URL Length",
      message: "Your URL is too long. Keep it short and descriptive.",
      severity: "warning",
      impact: "Low",
      effort: "Low",
    });
    score -= 2;
  } else {
    issues.push({
      category: "additional",
      type: "url_length",
      label: "URL Length",
      message: "Your URL is short and descriptive.",
      severity: "good",
    });
  }

  if (linkStats.external < 1) {
    issues.push({
      category: "additional",
      type: "external_links",
      label: "External links",
      message: "Link out to external resources.",
      severity: "warning",
      impact: "Medium",
      effort: "Low",
    });
    score -= 3;
  } else {
    issues.push({
      category: "additional",
      type: "external_links",
      label: "External links",
      message: "You are linking out to external resources.",
      severity: "good",
    });
  }

  if (linkStats.dofollowExternal < 1) {
    issues.push({
      category: "additional",
      type: "dofollow_external_links",
      label: "DoFollow external links",
      message: "Add DoFollow links pointing to external resources.",
      severity: "warning",
      impact: "Low",
      effort: "Low",
    });
    score -= 2;
  } else {
    issues.push({
      category: "additional",
      type: "dofollow_external_links",
      label: "DoFollow external links",
      message: "At least one external link is DoFollow.",
      severity: "good",
    });
  }

  if (linkStats.internal < 1) {
    issues.push({
      category: "additional",
      type: "internal_links",
      label: "Internal links",
      message: "Add internal links in your content.",
      severity: "warning",
      impact: "Medium",
      effort: "Low",
    });
    score -= 3;
  } else {
    issues.push({
      category: "additional",
      type: "internal_links",
      label: "Internal links",
      message: "Your content includes internal links.",
      severity: "good",
    });
  }

  if (!hasImage && !hasMediaInBody) {
    issues.push({
      category: "content_readability",
      type: "media",
      label: "Media",
      message: "Add images, products, or videos to make your content more engaging.",
      severity: "warning",
      impact: "Medium",
      effort: "Medium",
    });
    score -= 5;
  } else {
    issues.push({
      category: "content_readability",
      type: "media",
      label: "Media",
      message: "Your content contains engaging media.",
      severity: "good",
    });
  }

  const paragraphs = body.split(/<\/p>/i);
  const longParagraphs = paragraphs.filter((paragraph) => stripHtml(paragraph).split(/\s+/).filter(Boolean).length > 120);
  if (longParagraphs.length > 0) {
    issues.push({
      category: "content_readability",
      type: "paragraph_length",
      label: "Paragraph Length",
      message: "Some of your paragraphs are too long. Keep them under 120 words.",
      severity: "warning",
      impact: "Low",
      effort: "Low",
    });
    score -= 3;
  } else {
    issues.push({
      category: "content_readability",
      type: "paragraph_length",
      label: "Paragraph Length",
      message: "Your paragraphs are nicely broken down.",
      severity: "good",
    });
  }

  if (!hasToc) {
    issues.push({
      category: "content_readability",
      type: "toc",
      label: "Table of contents",
      message: "You don't seem to be using a Table of Contents.",
      severity: "warning",
      impact: "Low",
      effort: "Low",
    });
    score -= 2;
  } else {
    issues.push({
      category: "content_readability",
      type: "toc",
      label: "Table of contents",
      message: "Your content structure can support a Table of Contents.",
      severity: "good",
    });
  }

  if (/\d/.test(title)) {
    issues.push({
      category: "title_readability",
      type: "title_number",
      label: "Number in Title",
      message: "Your SEO title contains a number.",
      severity: "good",
    });
  } else {
    issues.push({
      category: "title_readability",
      type: "title_number",
      label: "Number in Title",
      message: "Consider adding a number to your SEO title to improve CTR.",
      severity: "warning",
      impact: "Low",
      effort: "Low",
    });
    score -= 2;
  }

  if (primaryKeyword) {
    keywords.forEach((keyword, index) => {
      let keywordScore = 100;
      const isPrimary = index === 0;
      const occurrences = bodyLower.split(keyword).length - 1;
      const density = wordCount > 0 ? ((occurrences * keyword.split(" ").length) / wordCount) * 100 : 0;
      const inTitle = titleLower.includes(keyword);
      const inSummary = summaryLower.includes(keyword);
      const inHandle = handleLower.includes(slugifyKeyword(keyword));
      const inFirst10 = first10Words.includes(keyword);
      const inHeading = headings.some((heading) => heading.toLowerCase().includes(keyword));
      const inImageAlt = hasAnyImage && allImageAltText.toLowerCase().includes(keyword);

      if (!inTitle) keywordScore -= isPrimary ? 10 : 5;
      if (!inSummary) keywordScore -= isPrimary ? 5 : 2;
      if (!inHandle) keywordScore -= isPrimary ? 5 : 2;
      if (occurrences === 0) keywordScore -= 15;
      else if (density < 0.5) keywordScore -= 5;
      else if (density > 2.5) keywordScore -= 5;
      if (!inFirst10) keywordScore -= 5;

      if (keywordScore >= 80) keywordScores[keyword] = "success";
      else if (keywordScore >= 50) keywordScores[keyword] = "warning";
      else keywordScores[keyword] = "critical";

      if (isPrimary) {
        if (inTitle) {
          issues.push({
            category: "basic",
            type: "kw_title",
            label: "Keyword in Title",
            message: "Focus Keyword is in the SEO title.",
            severity: "good",
          });
        } else {
          issues.push({
            category: "basic",
            type: "kw_title",
            label: "Keyword in Title",
            message: "Focus Keyword does not appear in the SEO title.",
            severity: "critical",
            impact: "High",
            effort: "Low",
          });
          score -= 10;
        }

        if (inSummary) {
          issues.push({
            category: "basic",
            type: "kw_summary",
            label: "Keyword in Meta",
            message: "Focus Keyword is in the SEO Meta Description.",
            severity: "good",
          });
        } else {
          issues.push({
            category: "basic",
            type: "kw_summary",
            label: "Keyword in Meta",
            message: "Focus Keyword not found in your SEO Meta Description.",
            severity: "warning",
            impact: "Medium",
            effort: "Low",
          });
          score -= 5;
        }

        if (inHandle) {
          issues.push({
            category: "basic",
            type: "kw_url",
            label: "Keyword in URL",
            message: "Focus Keyword is in the URL.",
            severity: "good",
          });
        } else {
          issues.push({
            category: "basic",
            type: "kw_url",
            label: "Keyword in URL",
            message: "Focus Keyword not found in the URL.",
            severity: "warning",
            impact: "Medium",
            effort: "Low",
          });
          score -= 5;
        }

        if (inFirst10) {
          issues.push({
            category: "basic",
            type: "kw_early",
            label: "Keyword at Start",
            message: "Focus Keyword appears in the first 10% of the content.",
            severity: "good",
          });
        } else {
          issues.push({
            category: "basic",
            type: "kw_early",
            label: "Keyword at Start",
            message: "Focus Keyword does not appear in the first 10% of the content.",
            severity: "warning",
            impact: "Medium",
            effort: "Low",
          });
          score -= 5;
        }

        if (occurrences > 0) {
          issues.push({
            category: "basic",
            type: "kw_content",
            label: "Keyword in Content",
            message: "Focus Keyword appears in the content.",
            severity: "good",
          });
        } else {
          issues.push({
            category: "basic",
            type: "kw_content",
            label: "Keyword in Content",
            message: "Focus Keyword does not appear in the content.",
            severity: "critical",
            impact: "High",
            effort: "Medium",
          });
          score -= 15;
        }

        if (inHeading) {
          issues.push({
            category: "additional",
            type: "kw_heading",
            label: "Keyword in Subheadings",
            message: "Focus Keyword found in subheading(s).",
            severity: "good",
          });
        } else {
          issues.push({
            category: "additional",
            type: "kw_heading",
            label: "Keyword in Subheadings",
            message: "Focus Keyword not found in subheading(s) like H2, H3, etc.",
            severity: "warning",
            impact: "Low",
            effort: "Medium",
          });
          score -= 2;
        }

        if (occurrences > 0) {
          if (density >= 0.5 && density <= 2.5) {
            issues.push({
              category: "additional",
              type: "kw_density",
              label: "Keyword Density",
              message: `Keyword density is ${density.toFixed(2)}%, which is great.`,
              severity: "good",
            });
          } else if (density < 0.5) {
            issues.push({
              category: "additional",
              type: "kw_density",
              label: "Keyword Density",
              message: `Keyword density is ${density.toFixed(2)}%, which is low. Aim for ~1%.`,
              severity: "warning",
              impact: "Low",
              effort: "Medium",
            });
            score -= 2;
          } else {
            issues.push({
              category: "additional",
              type: "kw_density",
              label: "Keyword Density",
              message: `Keyword density is ${density.toFixed(2)}%, which is high. Don't over-optimize.`,
              severity: "warning",
              impact: "Low",
              effort: "Medium",
            });
            score -= 2;
          }
        } else {
          issues.push({
            category: "additional",
            type: "kw_density",
            label: "Keyword Density",
            message: "Keyword Density is 0. Aim for around 1% Keyword Density.",
            severity: "warning",
            impact: "Low",
            effort: "Medium",
          });
        }

        if (inImageAlt) {
          issues.push({
            category: "additional",
            type: "kw_alt",
            label: "Keyword in Image Alt",
            message: "Focus Keyword found in image alt attributes.",
            severity: "good",
          });
        } else {
          issues.push({
            category: "additional",
            type: "kw_alt",
            label: "Keyword in Image Alt",
            message: "Add an image with your Focus Keyword as alt text.",
            severity: "warning",
            impact: "Low",
            effort: "Low",
          });
          score -= 2;
        }

        if (titleLower.indexOf(keyword) >= 0 && titleLower.indexOf(keyword) < 20) {
          issues.push({
            category: "title_readability",
            type: "kw_title_pos",
            label: "Keyword Position",
            message: "Focus Keyword used at the beginning of SEO title.",
            severity: "good",
          });
        } else {
          issues.push({
            category: "title_readability",
            type: "kw_title_pos",
            label: "Keyword Position",
            message: "Use the Focus Keyword near the beginning of SEO title.",
            severity: "warning",
            impact: "Low",
            effort: "Low",
          });
          if (inTitle) score -= 1;
        }
      } else if (occurrences === 0) {
        issues.push({
          category: "additional",
          type: `secondary_kw_content_${index}`,
          label: "Secondary Keyword in Content",
          message: `Secondary keyword "${keyword}" does not appear in the content.`,
          severity: "warning",
          impact: "Low",
          effort: "Low",
        });
        score -= 3;
      } else {
        issues.push({
          category: "additional",
          type: `secondary_kw_content_${index}`,
          label: "Secondary Keyword in Content",
          message: `Secondary keyword "${keyword}" appears in the content.`,
          severity: "good",
        });
      }
    });
  } else {
    issues.push({
      category: "basic",
      type: "kw_title",
      label: "Keyword in Title",
      message: "Add Focus Keyword to the SEO title.",
      severity: "critical",
      impact: "High",
      effort: "Low",
    });
    issues.push({
      category: "basic",
      type: "kw_summary",
      label: "Keyword in Meta",
      message: "Add Focus Keyword to your SEO Meta Description.",
      severity: "critical",
      impact: "Medium",
      effort: "Low",
    });
    issues.push({
      category: "basic",
      type: "kw_url",
      label: "Keyword in URL",
      message: "Use Focus Keyword in the URL.",
      severity: "critical",
      impact: "Medium",
      effort: "Low",
    });
    issues.push({
      category: "basic",
      type: "kw_early",
      label: "Keyword at Start",
      message: "Use Focus Keyword at the beginning of your content.",
      severity: "critical",
      impact: "Medium",
      effort: "Low",
    });
    issues.push({
      category: "basic",
      type: "kw_content",
      label: "Keyword in Content",
      message: "Use Focus Keyword in the content.",
      severity: "critical",
      impact: "High",
      effort: "Medium",
    });
    issues.push({
      category: "additional",
      type: "kw_missing",
      label: "Missing Focus Keyword",
      message: "Set a Focus Keyword for this content.",
      severity: "critical",
      impact: "High",
      effort: "Low",
    });
    issues.push({
      category: "title_readability",
      type: "kw_title_pos",
      label: "Keyword Position",
      message: "Use the Focus Keyword near the beginning of SEO title.",
      severity: "critical",
      impact: "Low",
      effort: "Low",
    });
    score -= 30;
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    issues,
    keywordScores,
  };
}

function analyzeLinks(body: string, shopDomain?: string, shopDomains: string[] = []) {
  const stats = { internal: 0, external: 0, dofollowExternal: 0 };
  const shopHosts = buildShopHosts(shopDomain, shopDomains);
  const anchorRegex = /<a\b([^>]*)>/gi;
  let match: RegExpExecArray | null;

  while ((match = anchorRegex.exec(body || "")) !== null) {
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
  return value
    .replace(/^https?:\/\//i, "")
    .split(/[/?#]/)[0]
    .replace(/^www\./i, "")
    .toLowerCase();
}

function getHeadingTexts(body: string) {
  const headings: string[] = [];
  const headingRegex = /<h[2-6][^>]*>(.*?)<\/h[2-6]>/gi;
  let match: RegExpExecArray | null;

  while ((match = headingRegex.exec(body || "")) !== null) {
    headings.push(stripHtml(match[1] || ""));
  }

  return headings;
}

function hasTableOfContents(body: string) {
  return /\[\[SBS_TOC(?::[^\]]+)?\]\]/i.test(body) || /data-bp-content-nav=["']toc["']|class=["'][^"']*\bbp-toc\b/i.test(body);
}

function getBodyImageAltText(body: string) {
  const alts: string[] = [];
  const imageRegex = /<img\b([^>]*)>/gi;
  let match: RegExpExecArray | null;

  while ((match = imageRegex.exec(body || "")) !== null) {
    const alt = getHtmlAttribute(match[1] || "", "alt");
    if (alt) alts.push(alt);
  }

  return alts.join(" ");
}

function stripHtml(value: string) {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function slugifyKeyword(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
