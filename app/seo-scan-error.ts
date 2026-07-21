const DEFAULT_SCAN_ERROR = "We couldn't complete this SEO scan. Please try again. If the problem continues, contact support.";

export function getPublicSeoScanError(error?: string | null) {
  if (!error) return null;
  if (/offline session|unauthenticated|access token|unauthorized/i.test(error)) {
    return "Shopify authorization needs to be refreshed before scanning. Please reopen the app and try again.";
  }
  if (/rate limit|throttl/i.test(error)) {
    return "Shopify is temporarily limiting requests. Please wait a few minutes and run the scan again.";
  }
  return DEFAULT_SCAN_ERROR;
}
