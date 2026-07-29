import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Divider,
  InlineGrid,
  InlineStack,
  Layout,
  Page,
  Text,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import {
  THEME_BLOCK_HANDLES,
  buildAppEmbedDeepLink,
  buildArticleBlockDeepLink,
} from "../theme-editor-links";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const apiKey = process.env.SHOPIFY_API_KEY || "";

  return json({
    shop: session.shop,
    appEmbedUrl: buildAppEmbedDeepLink(session.shop, apiKey),
    blockUrls: {
      carousel: buildArticleBlockDeepLink(
        session.shop,
        apiKey,
        THEME_BLOCK_HANDLES.carousel,
      ),
      grid: buildArticleBlockDeepLink(
        session.shop,
        apiKey,
        THEME_BLOCK_HANDLES.grid,
      ),
      seoSchema: buildArticleBlockDeepLink(
        session.shop,
        apiKey,
        THEME_BLOCK_HANDLES.seoSchema,
      ),
      breadcrumbs: buildArticleBlockDeepLink(
        session.shop,
        apiKey,
        THEME_BLOCK_HANDLES.breadcrumbs,
      ),
      tableOfContents: buildArticleBlockDeepLink(
        session.shop,
        apiKey,
        THEME_BLOCK_HANDLES.tableOfContents,
      ),
    },
  });
};

export default function ThemeSetupPage() {
  const { shop, appEmbedUrl, blockUrls } = useLoaderData<typeof loader>();

  return (
    <Page
      title="Theme setup"
      subtitle="Install and preview Rankmath SEO blocks on your published theme."
      backAction={{ content: "Overview", url: "/app" }}
    >
      <TitleBar title="Theme setup" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            <Banner title="Before you start" tone="info">
              <p>
                The buttons below open the published theme for {shop}. App blocks require an
                Online Store 2.0 theme with JSON templates. Add one block at a time and click
                <strong> Save</strong> in the theme editor after every change.
              </p>
            </Banner>

            <SetupStep number="1" title="Enable the Shoppable Blog Markers app embed" required>
              <BlockStack gap="300">
                <Text as="p" variant="bodyMd">
                  This embed loads product markers and app-managed content inside blog articles.
                  It is supported by every Shopify theme.
                </Text>
                <InstructionList
                  items={[
                    "Click Enable app embed. Shopify opens Theme settings > App embeds with Shoppable Blog Markers activated.",
                    "Keep the toggle on, review its settings, and click Save.",
                    "To disable it later, return to Theme settings > App embeds, turn it off, and save.",
                  ]}
                />
                <InlineStack>
                  <Button variant="primary" url={appEmbedUrl} target="_top">
                    Enable app embed
                  </Button>
                </InlineStack>
              </BlockStack>
            </SetupStep>

            <SetupStep number="2" title="Add a product display block to blog articles" required>
              <BlockStack gap="300">
                <Text as="p" variant="bodyMd">
                  Choose either a carousel or a grid for the Default blog post template. The block
                  automatically shows products linked to each article in Content Studio.
                </Text>
                <InstructionList
                  items={[
                    "Click one display option below. Shopify opens Blog posts > Default blog post and previews the new block.",
                    "Drag the block to the position where products should appear and adjust its settings.",
                    "Click Save, then preview a published article that has linked products.",
                    "To reorder or remove it later, select the block in the theme editor sidebar and drag it or choose Remove block.",
                  ]}
                />
                <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                  <BlockChoice
                    title="Product Carousel"
                    description="A horizontal, swipeable product row."
                    action="Add carousel"
                    url={blockUrls.carousel}
                    recommended
                  />
                  <BlockChoice
                    title="Product Grid"
                    description="A multi-column product grid."
                    action="Add grid"
                    url={blockUrls.grid}
                  />
                </InlineGrid>
              </BlockStack>
            </SetupStep>

            <SetupStep number="3" title="Add SEO and navigation blocks" optional>
              <BlockStack gap="300">
                <Text as="p" variant="bodyMd">
                  These blocks are optional. Add them one at a time to the Default blog post
                  template, configure their settings, move them into position, and click Save.
                </Text>
                <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                  <BlockChoice
                    title="SEO Schema (JSON-LD)"
                    description="Adds BlogPosting schema and optional breadcrumb schema. It has no visible storefront output."
                    action="Add SEO schema"
                    url={blockUrls.seoSchema}
                  />
                  <BlockChoice
                    title="Advanced Breadcrumbs"
                    description="Adds visible breadcrumb navigation. Pro or Growth plan required."
                    action="Add breadcrumbs"
                    url={blockUrls.breadcrumbs}
                  />
                  <BlockChoice
                    title="Table of Contents"
                    description="Builds navigation from article headings. Pro or Growth plan required."
                    action="Add table of contents"
                    url={blockUrls.tableOfContents}
                  />
                </InlineGrid>
              </BlockStack>
            </SetupStep>

            <SetupStep number="4" title="Verify the storefront" required>
              <InstructionList
                items={[
                  "In Content Studio, open a published blog post and link at least one available product.",
                  "Open that article on the live storefront and confirm the selected display block appears.",
                  "If it does not appear, confirm both theme changes were saved, the app embed is enabled, and the article has linked products.",
                  "Repeat the app-block steps on any custom blog post template that should use Rankmath SEO blocks.",
                ]}
              />
            </SetupStep>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Installing on an unpublished or custom theme
                </Text>
                <Text as="p" variant="bodyMd">
                  Go to <strong>Online Store &gt; Themes</strong>, customize the theme, open
                  <strong> Blog posts &gt; Default blog post</strong>, then choose
                  <strong> Add section &gt; Apps</strong>. Select a Rankmath SEO block, place it,
                  configure it, and save. Enable <strong>Shoppable Blog Markers</strong> separately
                  under <strong>Theme settings &gt; App embeds</strong>.
                </Text>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function SetupStep({
  number,
  title,
  required,
  optional,
  children,
}: {
  number: string;
  title: string;
  required?: boolean;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack gap="300" blockAlign="center">
          <Box
            background="bg-fill-info"
            borderRadius="200"
            minWidth="32px"
            minHeight="32px"
            padding="150"
          >
            <Text as="span" variant="bodyMd" fontWeight="bold" alignment="center">
              {number}
            </Text>
          </Box>
          <Text as="h2" variant="headingMd">
            {title}
          </Text>
          {required ? <Badge tone="attention">Required</Badge> : null}
          {optional ? <Badge>Optional</Badge> : null}
        </InlineStack>
        <Divider />
        {children}
      </BlockStack>
    </Card>
  );
}

function InstructionList({ items }: { items: string[] }) {
  return (
    <ol style={{ margin: 0, paddingLeft: "20px" }}>
      {items.map((item) => (
        <li key={item} style={{ marginBottom: "8px" }}>
          <Text as="span" variant="bodyMd">
            {item}
          </Text>
        </li>
      ))}
    </ol>
  );
}

function BlockChoice({
  title,
  description,
  action,
  url,
  recommended,
}: {
  title: string;
  description: string;
  action: string;
  url: string;
  recommended?: boolean;
}) {
  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack gap="200" blockAlign="center">
          <Text as="h3" variant="headingSm">
            {title}
          </Text>
          {recommended ? <Badge tone="success">Recommended</Badge> : null}
        </InlineStack>
        <Text as="p" variant="bodyMd" tone="subdued">
          {description}
        </Text>
        <Button url={url} target="_top">
          {action}
        </Button>
      </BlockStack>
    </Card>
  );
}
