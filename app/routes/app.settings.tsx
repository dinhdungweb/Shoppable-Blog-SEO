import { useCallback } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Divider,
  TextField,
  Select,
  Checkbox,
  Banner,
  Icon,
} from "@shopify/polaris";
import {
  PaintBrushFlatIcon,
  SettingsIcon,
  CodeIcon,
} from "@shopify/polaris-icons";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  let config = await prisma.shopConfig.findUnique({
    where: { shop },
  });

  if (!config) {
    config = await prisma.shopConfig.create({
      data: { shop },
    });
  }

  return { config };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();

  const widgetStyle = formData.get("widgetStyle") as string;
  const primaryColor = formData.get("primaryColor") as string;
  const showPrice = formData.get("showPrice") === "true";
  const showRating = formData.get("showRating") === "true";
  const showAddToCart = formData.get("showAddToCart") === "true";
  const seoAutoSchema = formData.get("seoAutoSchema") === "true";
  const maxProducts = parseInt(formData.get("maxProducts") as string) || 6;

  await prisma.shopConfig.upsert({
    where: { shop },
    update: {
      widgetStyle,
      primaryColor,
      showPrice,
      showRating,
      showAddToCart,
      seoAutoSchema,
      maxProducts,
    },
    create: {
      shop,
      widgetStyle,
      primaryColor,
      showPrice,
      showRating,
      showAddToCart,
      seoAutoSchema,
      maxProducts,
    },
  });

  return json({ success: true });
};

export default function Settings() {
  const { config } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const isSubmitting = fetcher.state !== "idle";
  const isSaved = fetcher.data?.success;

  const handleSubmit = useCallback(() => {
    const form = document.getElementById("settings-form") as HTMLFormElement;
    if (form) {
      const formData = new FormData(form);
      fetcher.submit(formData, { method: "POST" });
      shopify.toast.show("Settings saved");
    }
  }, [fetcher, shopify]);

  return (
    <Page>
      <TitleBar title="Settings">
        <button variant="primary" onClick={handleSubmit} disabled={isSubmitting}>
          {isSubmitting ? "Saving..." : "Save Settings"}
        </button>
      </TitleBar>
      <BlockStack gap="500">
        {isSaved && (
          <Banner
            title="Settings saved successfully"
            tone="success"
            onDismiss={() => {}}
          />
        )}

        <fetcher.Form id="settings-form" method="POST">
          <Layout>
            <Layout.Section>
              <BlockStack gap="500">
                {/* Widget Display Settings */}
                <Card>
                  <BlockStack gap="400">
                    <InlineStack gap="200" blockAlign="center">
                      <Icon source={PaintBrushFlatIcon} tone="base" />
                      <Text as="h2" variant="headingMd">
                        Widget Display
                      </Text>
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Configure how product widgets appear on your blog articles.
                    </Text>
                    <Divider />
                    <Select
                      label="Default Widget Style"
                      name="widgetStyle"
                      options={[
                        {
                          label: "Carousel — Swipeable product slider",
                          value: "carousel",
                        },
                        {
                          label: "Grid — Responsive product grid",
                          value: "grid",
                        },
                        {
                          label: "Inline — Compact inline cards",
                          value: "inline",
                        },
                      ]}
                      value={config.widgetStyle}
                      helpText="This sets the default style for new product embeds. You can override per-article."
                    />

                    <TextField
                      label="Primary Color"
                      name="primaryColor"
                      type="text"
                      value={config.primaryColor}
                      helpText='Hex color for CTA buttons (e.g. #6366f1). Leave blank to inherit from theme.'
                      autoComplete="off"
                    />

                    <TextField
                      label="Max Products per Article"
                      name="maxProducts"
                      type="number"
                      value={config.maxProducts.toString()}
                      helpText="Maximum number of products displayed per widget."
                      autoComplete="off"
                    />
                  </BlockStack>
                </Card>

                {/* Visibility Settings */}
                <Card>
                  <BlockStack gap="400">
                    <InlineStack gap="200" blockAlign="center">
                      <Icon source={SettingsIcon} tone="base" />
                      <Text as="h2" variant="headingMd">
                        Visibility Options
                      </Text>
                    </InlineStack>
                    <Divider />
                    <Checkbox
                      label="Show Product Price"
                      name="showPrice"
                      checked={config.showPrice}
                      helpText="Display product prices in the widget."
                      value="true"
                    />
                    <Checkbox
                      label="Show Product Rating"
                      name="showRating"
                      checked={config.showRating}
                      helpText="Display star ratings if available."
                      value="true"
                    />
                    <Checkbox
                      label='Show "Add to Cart" Button'
                      name="showAddToCart"
                      checked={config.showAddToCart}
                      helpText="Display the add to cart button for quick checkout."
                      value="true"
                    />
                  </BlockStack>
                </Card>

                {/* SEO Settings */}
                <Card>
                  <BlockStack gap="400">
                    <InlineStack gap="200" blockAlign="center">
                      <Icon source={CodeIcon} tone="base" />
                      <Text as="h2" variant="headingMd">
                        SEO & Schema
                      </Text>
                    </InlineStack>
                    <Divider />
                    <Checkbox
                      label="Auto-generate JSON-LD Schema"
                      name="seoAutoSchema"
                      checked={config.seoAutoSchema}
                      helpText="Automatically inject BlogPosting and Product structured data (JSON-LD) for better search engine visibility and rich snippets."
                      value="true"
                    />
                    <Banner tone="info">
                      <p>
                        JSON-LD schemas help search engines understand your
                        content. When enabled, product schema will be
                        automatically added to articles with embedded products.
                      </p>
                    </Banner>
                  </BlockStack>
                </Card>
              </BlockStack>
            </Layout.Section>

            <Layout.Section variant="oneThird">
              <BlockStack gap="400">
                {/* Theme Extension Setup */}
                <Card>
                  <BlockStack gap="300">
                    <Text as="h2" variant="headingMd">
                      Theme Setup
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      To display product widgets on your blog, you need to add
                      our App Blocks to your theme.
                    </Text>
                    <Divider />
                    <BlockStack gap="200">
                      <InlineStack gap="200" blockAlign="start">
                        <Badge tone="info">1</Badge>
                        <Text as="span" variant="bodySm">
                          Go to <strong>Online Store → Themes</strong>
                        </Text>
                      </InlineStack>
                      <InlineStack gap="200" blockAlign="start">
                        <Badge tone="info">2</Badge>
                        <Text as="span" variant="bodySm">
                          Click <strong>Customize</strong>
                        </Text>
                      </InlineStack>
                      <InlineStack gap="200" blockAlign="start">
                        <Badge tone="info">3</Badge>
                        <Text as="span" variant="bodySm">
                          Select <strong>Blog Posts</strong> template
                        </Text>
                      </InlineStack>
                      <InlineStack gap="200" blockAlign="start">
                        <Badge tone="info">4</Badge>
                        <Text as="span" variant="bodySm">
                          Add our <strong>Product Widget</strong> block
                        </Text>
                      </InlineStack>
                    </BlockStack>
                  </BlockStack>
                </Card>

                {/* About */}
                <Card>
                  <BlockStack gap="300">
                    <Text as="h2" variant="headingMd">
                      About
                    </Text>
                    <BlockStack gap="200">
                      <InlineStack align="space-between">
                        <Text as="span" variant="bodySm" tone="subdued">
                          Version
                        </Text>
                        <Badge>1.0.0</Badge>
                      </InlineStack>
                      <InlineStack align="space-between">
                        <Text as="span" variant="bodySm" tone="subdued">
                          Framework
                        </Text>
                        <Text as="span" variant="bodySm">
                          Remix + Polaris
                        </Text>
                      </InlineStack>
                      <InlineStack align="space-between">
                        <Text as="span" variant="bodySm" tone="subdued">
                          Database
                        </Text>
                        <Text as="span" variant="bodySm">
                          SQLite + Prisma
                        </Text>
                      </InlineStack>
                    </BlockStack>
                  </BlockStack>
                </Card>
              </BlockStack>
            </Layout.Section>
          </Layout>
        </fetcher.Form>
      </BlockStack>
    </Page>
  );
}
