import { THEME_BLOCK_HANDLES } from "./theme-editor-links";

/**
 * Reads the published theme's JSON files to tell which app blocks are
 * installed. Pure functions; the theme files are fetched by setup-status.server.
 */

export type ThemeFile = { filename: string; content: string };

export type ThemeBlockStatus = {
  appEmbed: boolean;
  carousel: boolean;
  grid: boolean;
  seoSchema: boolean;
  breadcrumbs: boolean;
  tableOfContents: boolean;
};

/** Shopify prefixes generated JSON files with a comment block, which JSON.parse rejects. */
export function parseThemeJson(content: string): unknown {
  const withoutComments = String(content || "").replace(/^﻿?\s*\/\*[\s\S]*?\*\/\s*/, "");
  try {
    return JSON.parse(withoutComments);
  } catch {
    return null;
  }
}

/** Enabled blocks of this app with the given handle (type ".../blocks/<handle>/<uuid>"). */
export function countEnabledAppBlocks(json: unknown, handle: string): number {
  let count = 0;
  const pattern = new RegExp(`/blocks/${handle}/`);
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (typeof record.type === "string" && pattern.test(record.type) && record.disabled !== true && String(record.disabled) !== "true") count += 1;
    for (const value of Object.values(record)) {
      if (value && typeof value === "object") visit(value);
    }
  };
  visit(json);
  return count;
}

/** Status of each app block on the published theme: the app embed, and blocks on any article template. */
export function summarizeThemeBlocks(files: ThemeFile[]): ThemeBlockStatus {
  const settings = files.find((file) => file.filename === "config/settings_data.json");
  const settingsJson = settings ? parseThemeJson(settings.content) : null;
  const root = settingsJson && typeof settingsJson === "object" ? (settingsJson as any) : null;
  // "current" is either the settings object or the name of a preset.
  const current = typeof root?.current === "string" ? root?.presets?.[root.current] : root?.current;
  const articleTemplates = files
    .filter((file) => /^templates\/article(\.[^/]+)?\.json$/.test(file.filename))
    .map((file) => parseThemeJson(file.content));
  const onArticles = (handle: string) => articleTemplates.some((json) => countEnabledAppBlocks(json, handle) > 0);
  return {
    appEmbed: countEnabledAppBlocks(current?.blocks || {}, THEME_BLOCK_HANDLES.appEmbed) > 0,
    carousel: onArticles(THEME_BLOCK_HANDLES.carousel),
    grid: onArticles(THEME_BLOCK_HANDLES.grid),
    seoSchema: onArticles(THEME_BLOCK_HANDLES.seoSchema),
    breadcrumbs: onArticles(THEME_BLOCK_HANDLES.breadcrumbs),
    tableOfContents: onArticles(THEME_BLOCK_HANDLES.tableOfContents),
  };
}
