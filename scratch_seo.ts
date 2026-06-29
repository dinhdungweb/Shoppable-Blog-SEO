function stripHtml(value: string) {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

type SeoIssue = {
  type: string;
  category: 'basic' | 'additional' | 'title_readability' | 'content_readability';
  label: string;
  message: string;
  severity: "good" | "info" | "warning" | "critical";
  impact?: "Low" | "Medium" | "High";
  effort?: "Low" | "Medium" | "High";
};

function slugifyKeyword(kw: string) {
  return kw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/\s+/g, '-');
}

function auditSeo({
  title,
  handle,
  summary,
  body,
  hasImage,
  imageAlt,
  productCount,
  focusKeyword,
}: {
  title: string;
  handle: string;
  summary: string;
  body: string;
  hasImage: boolean;
  imageAlt: string;
  productCount: number;
  focusKeyword?: string;
}): { score: number; issues: SeoIssue[]; keywordScores: Record<string, "success" | "warning" | "critical"> } {
  const issues: SeoIssue[] = [];
  let score = 100;
  const text = stripHtml(body);
  const wordCount = text ? text.split(/\s+/).length : 0;
  const linkCount = (body.match(/<a\s/gi) || []).length;
  const keywordScores: Record<string, "success" | "warning" | "critical"> = {};

  const titleLower = title.toLowerCase();
  const summaryLower = summary.toLowerCase();
  const handleLower = handle.toLowerCase();
  const bodyLower = text.toLowerCase();
  const first10Words = text.split(/\s+/).slice(0, Math.max(20, Math.floor(wordCount * 0.1))).join(' ').toLowerCase();

  // Keyword agnostic checks

  // Length
  if (wordCount < 250) {
    issues.push({ category: 'basic', type: "content_length", label: "Content length", message: `Your article is too short (${wordCount} words). Aim for at least 600 words.`, severity: "critical", impact: "High", effort: "Medium" });
    score -= 15;
  } else if (wordCount < 600) {
    issues.push({ category: 'basic', type: "content_length", label: "Content length", message: `Your article is ${wordCount} words. Aim for at least 600 words.`, severity: "warning", impact: "Medium", effort: "Medium" });
    score -= 5;
  } else {
    issues.push({ category: 'basic', type: "content_length", label: "Content length", message: `Great! Your article is ${wordCount} words long.`, severity: "good" });
  }

  // Links
  if (linkCount < 1) {
    issues.push({ category: 'additional', type: "links", label: "Links", message: "Add some internal or external links to your content.", severity: "warning", impact: "Medium", effort: "Low" });
    score -= 5;
  } else {
    issues.push({ category: 'additional', type: "links", label: "Links", message: "You are linking to other resources.", severity: "good" });
  }

  // URL length
  if (!handle || handle.length > 75) {
    issues.push({ category: 'additional', type: "url_length", label: "URL Length", message: "Your URL is too long. Keep it short and descriptive.", severity: "warning", impact: "Low", effort: "Low" });
    score -= 2;
  } else {
    issues.push({ category: 'additional', type: "url_length", label: "URL Length", message: "Your URL is short and descriptive.", severity: "good" });
  }

  // Media
  const hasVideoOrProduct = productCount > 0 || /<iframe/i.test(body);
  if (!hasImage && !hasVideoOrProduct) {
    issues.push({ category: 'content_readability', type: "media", label: "Media", message: "Add images, products, or videos to make your content more engaging.", severity: "warning", impact: "Medium", effort: "Medium" });
    score -= 5;
  } else {
    issues.push({ category: 'content_readability', type: "media", label: "Media", message: "Your content contains engaging media.", severity: "good" });
  }

  // Paragraph length
  const paragraphs = body.split(/<\/p>/i);
  const longParagraphs = paragraphs.filter(p => stripHtml(p).split(/\s+/).length > 120);
  if (longParagraphs.length > 0) {
    issues.push({ category: 'content_readability', type: "paragraph_length", label: "Paragraph Length", message: "Some of your paragraphs are too long. Keep them under 120 words for better readability.", severity: "warning", impact: "Low", effort: "Low" });
    score -= 3;
  } else {
    issues.push({ category: 'content_readability', type: "paragraph_length", label: "Paragraph Length", message: "Your paragraphs are nicely broken down.", severity: "good" });
  }

  // Title Readability
  if (/\d/.test(title)) {
    issues.push({ category: 'title_readability', type: "title_number", label: "Number in Title", message: "Your SEO title contains a number.", severity: "good" });
  } else {
    issues.push({ category: 'title_readability', type: "title_number", label: "Number in Title", message: "Consider adding a number to your SEO title to improve CTR.", severity: "warning", impact: "Low", effort: "Low" });
    score -= 2;
  }

  // Keyword checks
  if (focusKeyword) {
    const keywords = focusKeyword.split(',').map(k => k.trim().toLowerCase()).filter(k => k.length > 0);
    const primaryKeyword = keywords[0];

    keywords.forEach((kw, index) => {
      let kwScore = 100;
      const isPrimary = index === 0;

      const occurrences = bodyLower.split(kw).length - 1;
      const density = wordCount > 0 ? (occurrences * kw.split(' ').length / wordCount) * 100 : 0;

      const inTitle = titleLower.includes(kw);
      const inSummary = summaryLower.includes(kw);
      const inHandle = handleLower.includes(slugifyKeyword(kw));
      const inFirst10 = first10Words.includes(kw);

      if (!inTitle) kwScore -= isPrimary ? 10 : 5;
      if (!inSummary) kwScore -= isPrimary ? 5 : 2;
      if (!inHandle) kwScore -= isPrimary ? 5 : 2;

      if (occurrences === 0) kwScore -= 15;
      else if (density < 0.5) kwScore -= 5;
      else if (density > 2.5) kwScore -= 5;

      if (!inFirst10) kwScore -= 5;

      if (kwScore >= 80) keywordScores[kw] = "success";
      else if (kwScore >= 50) keywordScores[kw] = "warning";
      else keywordScores[kw] = "critical";

      if (isPrimary) {
        // Basic SEO
        if (inTitle) issues.push({ category: 'basic', type: "kw_title", label: "Keyword in Title", message: "Focus Keyword is in the SEO title.", severity: "good" });
        else { issues.push({ category: 'basic', type: "kw_title", label: "Keyword in Title", message: "Focus Keyword does not appear in the SEO title.", severity: "critical", impact: "High", effort: "Low" }); score -= 10; }

        if (inSummary) issues.push({ category: 'basic', type: "kw_summary", label: "Keyword in Meta", message: "Focus Keyword is in the SEO Meta Description.", severity: "good" });
        else { issues.push({ category: 'basic', type: "kw_summary", label: "Keyword in Meta", message: "Focus Keyword not found in your SEO Meta Description.", severity: "warning", impact: "Medium", effort: "Low" }); score -= 5; }

        if (inHandle) issues.push({ category: 'basic', type: "kw_url", label: "Keyword in URL", message: "Focus Keyword is in the URL.", severity: "good" });
        else { issues.push({ category: 'basic', type: "kw_url", label: "Keyword in URL", message: "Focus Keyword not found in the URL.", severity: "warning", impact: "Medium", effort: "Low" }); score -= 5; }

        if (inFirst10) issues.push({ category: 'basic', type: "kw_early", label: "Keyword at Start", message: "Focus Keyword appears in the first 10% of the content.", severity: "good" });
        else { issues.push({ category: 'basic', type: "kw_early", label: "Keyword at Start", message: "Focus Keyword does not appear in the first 10% of the content.", severity: "warning", impact: "Medium", effort: "Low" }); score -= 5; }

        if (occurrences > 0) issues.push({ category: 'basic', type: "kw_content", label: "Keyword in Content", message: `Focus Keyword appears in the content.`, severity: "good" });
        else { issues.push({ category: 'basic', type: "kw_content", label: "Keyword in Content", message: "Focus Keyword does not appear in the content.", severity: "critical", impact: "High", effort: "Medium" }); score -= 15; }

        // Additional SEO
        // Subheadings
        const headingRegex = /<h[2-6][^>]*>(.*?)<\/h[2-6]>/gi;
        let foundInHeading = false;
        let match;
        while ((match = headingRegex.exec(body)) !== null) {
          if (match[1].toLowerCase().includes(kw)) {
            foundInHeading = true;
            break;
          }
        }
        if (foundInHeading) issues.push({ category: 'additional', type: "kw_heading", label: "Keyword in Subheadings", message: "Focus Keyword found in subheading(s).", severity: "good" });
        else { issues.push({ category: 'additional', type: "kw_heading", label: "Keyword in Subheadings", message: "Focus Keyword not found in subheading(s) like H2, H3, etc.", severity: "warning", impact: "Low", effort: "Medium" }); score -= 2; }

        // Density
        if (occurrences > 0) {
          if (density >= 0.5 && density <= 2.5) {
            issues.push({ category: 'additional', type: "kw_density", label: "Keyword Density", message: `Keyword density is ${density.toFixed(2)}%, which is great.`, severity: "good" });
          } else if (density < 0.5) {
            issues.push({ category: 'additional', type: "kw_density", label: "Keyword Density", message: `Keyword density is ${density.toFixed(2)}%, which is low. Aim for ~1%.`, severity: "warning", impact: "Low", effort: "Medium" });
            score -= 2;
          } else {
            issues.push({ category: 'additional', type: "kw_density", label: "Keyword Density", message: `Keyword density is ${density.toFixed(2)}%, which is high. Don't over-optimize.`, severity: "warning", impact: "Low", effort: "Medium" });
            score -= 2;
          }
        }

        // Image Alt
        if (hasImage) {
          if (imageAlt.toLowerCase().includes(kw)) issues.push({ category: 'additional', type: "kw_alt", label: "Keyword in Image Alt", message: "Focus Keyword found in image alt attributes.", severity: "good" });
          else { issues.push({ category: 'additional', type: "kw_alt", label: "Keyword in Image Alt", message: "Focus Keyword not found in image alt attributes.", severity: "warning", impact: "Low", effort: "Low" }); score -= 2; }
        }

        // Title Readability - Keyword position
        if (titleLower.indexOf(kw) >= 0 && titleLower.indexOf(kw) < 20) {
          issues.push({ category: 'title_readability', type: "kw_title_pos", label: "Keyword Position", message: "Focus Keyword used at the beginning of SEO title.", severity: "good" });
        } else if (inTitle) {
          issues.push({ category: 'title_readability', type: "kw_title_pos", label: "Keyword Position", message: "Focus Keyword doesn't appear at the beginning of SEO title.", severity: "info", impact: "Low", effort: "Low" });
        }

      } else {
        // Secondary keyword
        if (occurrences === 0) {
          issues.push({ category: 'additional', type: `secondary_kw_content_${index}`, label: `Secondary Keyword in Content`, message: `Secondary keyword "${kw}" does not appear in the content.`, severity: "warning", impact: "Low", effort: "Low" });
          score -= 3;
        } else {
          issues.push({ category: 'additional', type: `secondary_kw_content_${index}`, label: `Secondary Keyword in Content`, message: `Secondary keyword "${kw}" appears in the content.`, severity: "good" });
        }
      }
    });
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    issues,
    keywordScores,
  };
}
