import { DEFAULT_CONTENT_STRUCTURE, DEFAULT_META_DESCRIPTION_TEMPLATE, DEFAULT_META_TITLE_TEMPLATE } from "./ai-writing-rules";
import { CONTENT_NAV_DEFAULTS } from "./content-navigation";

/**
 * "Reset to defaults" values per Settings tab. Custom CSS and the content
 * language are deliberately left out: they are the merchant's own content.
 */
export const SETTINGS_TAB_DEFAULTS = {
  display: {
    widgetStyle: "carousel",
    primaryColor: "#6366f1",
    productCardLayout: "Standard",
    buttonText: "View product",
    showPrice: true,
    showAddToCart: true,
    openInNewTab: true,
    maxProducts: 6,
    imageAspectRatio: "Square",
    imageFit: "Cover",
    cardDensity: "Comfortable",
    gridColumns: 3,
    textAlignment: "Left",
    buttonStyle: "Solid",
    shadowStyle: "Soft",
    showCarouselArrows: true,
    showCarouselDots: true,
    carouselItemsVisible: 4,
    borderRadius: "8px",
  },
  "content-navigation": (() => {
    const { appStatus: _appStatus, contentNavCustomCss: _css, ...rest } = CONTENT_NAV_DEFAULTS;
    return rest;
  })(),
  tracking: {
    utmRules: "Auto-append to product links",
    attributionWindow: "7 days",
    enableConversionTracking: true,
  },
  rules: {
    brandTone: "Professional",
    forbiddenWords: "",
    defaultContentStructure: DEFAULT_CONTENT_STRUCTURE,
    metaTitleTemplate: DEFAULT_META_TITLE_TEMPLATE,
    metaDescriptionTemplate: DEFAULT_META_DESCRIPTION_TEMPLATE,
  },
} as const;

export type ResettableSettingsTab = keyof typeof SETTINGS_TAB_DEFAULTS;

export function isResettableSettingsTab(value: string): value is ResettableSettingsTab {
  return Object.prototype.hasOwnProperty.call(SETTINGS_TAB_DEFAULTS, value);
}
