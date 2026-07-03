export const BREADCRUMB_STYLE_OPTIONS = ["minimal", "slash", "pills", "boxed"] as const;
export const TOC_STYLE_OPTIONS = ["simple", "boxed", "collapsible"] as const;
export const TOC_LEVEL_OPTIONS = ["h2", "h2,h3", "h2,h3,h4"] as const;
export const TOC_LAYOUT_OPTIONS = ["vertical", "horizontal", "multicolumn", "left-rail", "right-rail"] as const;
export const TOC_AUTO_INSERT_POSITION_OPTIONS = [
  "after-title",
  "after-paragraph-1",
  "after-paragraph-2",
  "after-paragraph-3",
] as const;

export type ContentNavConfig = {
  appStatus: boolean;
  breadcrumbsEnabled: boolean;
  breadcrumbsStyle: (typeof BREADCRUMB_STYLE_OPTIONS)[number];
  breadcrumbsShowHome: boolean;
  breadcrumbsHomeLabel: string;
  breadcrumbsShowBlog: boolean;
  breadcrumbsCurrentClickable: boolean;
  breadcrumbsSeparator: string;
  tocEnabled: boolean;
  tocAutoInsertEnabled: boolean;
  tocAutoInsertPosition: (typeof TOC_AUTO_INSERT_POSITION_OPTIONS)[number];
  tocTitle: string;
  tocLevels: (typeof TOC_LEVEL_OPTIONS)[number];
  tocStyle: (typeof TOC_STYLE_OPTIONS)[number];
  tocLayout: (typeof TOC_LAYOUT_OPTIONS)[number];
  tocNumbering: boolean;
  tocSmoothScroll: boolean;
  tocMobileCollapsed: boolean;
  tocStickyOffset: number;
  contentNavPrimaryColor: string;
  contentNavCustomCss: string;
  [key: string]: any;
};

export const CONTENT_NAV_DEFAULTS: ContentNavConfig = {
  appStatus: true,
  breadcrumbsEnabled: true,
  breadcrumbsStyle: "minimal",
  breadcrumbsShowHome: true,
  breadcrumbsHomeLabel: "Home",
  breadcrumbsShowBlog: true,
  breadcrumbsCurrentClickable: false,
  breadcrumbsSeparator: "/",
  tocEnabled: true,
  tocAutoInsertEnabled: true,
  tocAutoInsertPosition: "after-title",
  tocTitle: "Table of contents",
  tocLevels: "h2,h3",
  tocStyle: "boxed",
  tocLayout: "vertical",
  tocNumbering: false,
  tocSmoothScroll: true,
  tocMobileCollapsed: true,
  tocStickyOffset: 96,
  contentNavPrimaryColor: "#6366f1",
  contentNavCustomCss: "",
};

export function normalizeContentNavConfig(
  config?: Record<string, any> | null,
): ContentNavConfig {
  return {
    ...CONTENT_NAV_DEFAULTS,
    ...(config || {}),
    breadcrumbsStyle: pickValue(
      config?.breadcrumbsStyle,
      BREADCRUMB_STYLE_OPTIONS,
      CONTENT_NAV_DEFAULTS.breadcrumbsStyle,
    ),
    tocLevels: pickValue(config?.tocLevels, TOC_LEVEL_OPTIONS, CONTENT_NAV_DEFAULTS.tocLevels),
    tocStyle: pickValue(config?.tocStyle, TOC_STYLE_OPTIONS, CONTENT_NAV_DEFAULTS.tocStyle),
    tocLayout: pickValue(config?.tocLayout, TOC_LAYOUT_OPTIONS, CONTENT_NAV_DEFAULTS.tocLayout),
    tocAutoInsertPosition: pickValue(
      config?.tocAutoInsertPosition,
      TOC_AUTO_INSERT_POSITION_OPTIONS,
      CONTENT_NAV_DEFAULTS.tocAutoInsertPosition,
    ),
    tocStickyOffset: clampNumber(config?.tocStickyOffset, 0, 240, CONTENT_NAV_DEFAULTS.tocStickyOffset),
    contentNavPrimaryColor: normalizeHexColor(
      config?.contentNavPrimaryColor || CONTENT_NAV_DEFAULTS.contentNavPrimaryColor,
    ),
    contentNavCustomCss: config?.contentNavCustomCss || "",
  };
}

export function pickValue<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  fallback: T[number],
): T[number] {
  return allowed.includes(String(value)) ? (String(value) as T[number]) : fallback;
}

export function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numericValue)));
}

export function normalizeHexColor(value: unknown) {
  const text = String(value || "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(text)) return text;
  if (/^[0-9a-fA-F]{6}$/.test(text)) return `#${text}`;
  return CONTENT_NAV_DEFAULTS.contentNavPrimaryColor;
}
