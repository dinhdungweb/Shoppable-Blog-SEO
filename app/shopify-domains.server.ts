export async function fetchShopDomains(admin: any, fallbackShop: string): Promise<string[]> {
  const domains = new Set<string>([fallbackShop]);

  try {
    const response = await admin.graphql(
      `#graphql
      query ShopDomains {
        shop {
          primaryDomain {
            host
            url
          }
        }
      }`,
    );
    const result: any = await response.json();
    const shop = result.data?.shop;

    addDomain(domains, shop?.primaryDomain?.host);
    addDomain(domains, shop?.primaryDomain?.url);
  } catch (error) {
    console.warn("Could not load Shopify shop domains for SEO audit:", error);
  }

  return Array.from(domains);
}

function addDomain(domains: Set<string>, value: unknown) {
  if (typeof value !== "string") return;
  const trimmed = value.trim();
  if (trimmed) domains.add(trimmed);
}
