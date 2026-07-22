export const PERFORMANCE_PAGE_TYPES = ["homepage", "other"] as const;
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
  category: string;
  group: string;
  details: string[];
};

export type CategoryScores = {
  performance: number;
  accessibility: number;
  bestPractices: number;
  seo: number;
};

export type FieldMetric = {
  label: string;
  value: string;
  rating: "good" | "needs-improvement" | "poor";
};

export type FieldData = {
  available: boolean;
  scope: "url" | "origin" | "none";
  assessment: "passed" | "failed" | "unknown";
  metrics: FieldMetric[];
};

export type DeviceReport = {
  score: number;
  categories: CategoryScores;
  metrics: Record<string, string>;
  opportunities: PerformanceAudit[];
  passedAudits: PerformanceAudit[];
  fieldData: FieldData;
  screenshot: string;
  lighthouseVersion: string;
  fetchTime: string;
};

export type StorefrontPerformanceReport = {
  version: 2;
  url: string;
  fetchedUrl: string;
  seoScore: number;
  mobile: DeviceReport;
  desktop: DeviceReport;
  warnings: string[];
};
