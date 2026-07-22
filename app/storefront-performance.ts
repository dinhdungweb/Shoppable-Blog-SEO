export const PERFORMANCE_PAGE_TYPES = ["homepage", "product", "collection", "blog"] as const;
export type PerformancePageType = typeof PERFORMANCE_PAGE_TYPES[number];

export type PerformanceTarget = {
  type: PerformancePageType;
  title: string;
  url: string;
  available: boolean;
};

export type PerformanceAudit = {
  id: string;
  title: string;
  description: string;
  displayValue: string;
  score: number | null;
};

export type DeviceReport = {
  score: number;
  metrics: Record<string, string>;
  opportunities: PerformanceAudit[];
};

export type StorefrontPerformanceReport = {
  version: 1;
  url: string;
  fetchedUrl: string;
  seoScore: number;
  mobile: DeviceReport;
  desktop: DeviceReport;
  warnings: string[];
};
