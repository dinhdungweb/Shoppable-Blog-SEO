import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useRevalidator } from "@remix-run/react";
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
import { checkThemeSetup } from "../setup-status.server";
import {
  THEME_BLOCK_HANDLES,
  buildAppEmbedDeepLink,
  buildArticleBlockDeepLink,
} from "../theme-editor-links";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const apiKey = process.env.SHOPIFY_API_KEY || "";
  const status = await checkThemeSetup(admin);

  return json({
    shop: session.shop,
    themeName: "themeName" in status ? status.themeName : "",
    blocks: "blocks" in status ? status.blocks : null,
    appEmbedUrl: buildAppEmbedDeepLink(session.shop, apiKey),
    articleEditorUrl: `https://${session.shop}/admin/themes/current/editor?template=article`,
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
  const { shop, themeName, blocks, appEmbedUrl, articleEditorUrl, blockUrls } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const required = blocks ? [blocks.appEmbed, blocks.carousel || blocks.grid] : [];
  const requiredDone = required.filter(Boolean).length;

  return (
    <Page
      title="Theme setup"
      subtitle="Install and preview Rankmath SEO blocks on your published theme."
      backAction={{ content: "Settings", url: "/app/settings" }}
    >
      <TitleBar title="Theme setup" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            {blocks ? (
              <Banner
                tone={requiredDone === required.length ? "success" : "warning"}
                title={requiredDone === required.length ? `Setup complete on ${themeName}` : `${requiredDone} of ${required.length} required steps done on ${themeName}`}
                action={{ content: "Check again", onAction: () => revalidator.revalidate(), loading: revalidator.state !== "idle" }}
              >
                <p>Status is read from your published theme. After saving in the theme editor, click Check again.</p>
              </Banner>
            ) : (
              <Banner tone="warning" title="Setup status unavailable" action={{ content: "Check again", onAction: () => revalidator.revalidate(), loading: revalidator.state !== "idle" }}>
                <p>The published theme could not be read, so each step shows its instructions only.</p>
              </Banner>
            )}
            <Banner title="Before you start" tone="info">
              <p>
                The buttons below open the published theme for {shop}. App blocks require an
                Online Store 2.0 theme with JSON templates. Add one block at a time and click
                <strong> Save</strong> in the theme editor after every change.
              </p>
            </Banner>

            <SetupStep number="1" title="Enable the Shoppable Blog Markers app embed" required done={blocks?.appEmbed}>
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

            <SetupStep number="2" title="Add a product display block to blog articles" required done={blocks ? blocks.carousel || blocks.grid : undefined}>
              <BlockStack gap="300">
                <Text as="p" variant="bodyMd">
                  Choose either a carousel or a grid for the Default blog post template. The block
                  automatically shows products linked to each article in Content.
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
                    editorUrl={articleEditorUrl}
                    installed={blocks?.carousel}
                  />
                  <BlockChoice
                    title="Product Grid"
                    description="A multi-column product grid."
                    action="Add grid"
                    url={blockUrls.grid}
                    editorUrl={articleEditorUrl}
                    installed={blocks?.grid}
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
                <Text as="p" variant="bodySm" tone="subdued">
                  Settings on a block in the theme editor apply to that block. Settings in the app apply to
                  products and navigation placed inside post content, and to options a block does not have.
                </Text>
                <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                  <BlockChoice
                    title="SEO Schema (JSON-LD)"
                    description="Adds BlogPosting schema and optional breadcrumb schema. It has no visible storefront output."
                    action="Add SEO schema"
                    url={blockUrls.seoSchema}
                    editorUrl={articleEditorUrl}
                    installed={blocks?.seoSchema}
                  />
                  <BlockChoice
                    title="Advanced Breadcrumbs"
                    description="Adds visible breadcrumb navigation. Pro or Growth plan required."
                    action="Add breadcrumbs"
                    url={blockUrls.breadcrumbs}
                    editorUrl={articleEditorUrl}
                    installed={blocks?.breadcrumbs}
                  />
                  <BlockChoice
                    title="Table of Contents"
                    description="Builds navigation from article headings. Pro or Growth plan required."
                    action="Add table of contents"
                    url={blockUrls.tableOfContents}
                    editorUrl={articleEditorUrl}
                    installed={blocks?.tableOfContents}
                  />
                </InlineGrid>
              </BlockStack>
            </SetupStep>

            <SetupStep number="4" title="Verify the storefront" required>
              <InstructionList
                items={[
                  "In Content, open a published blog post and link at least one available product.",
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
  done,
  children,
}: {
  number: string;
  title: string;
  required?: boolean;
  optional?: boolean;
  /** undefined when the theme could not be read. */
  done?: boolean;
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
          {done ? <Badge tone="success">Done</Badge> : required ? <Badge tone="attention">{done === false ? "Required · not detected" : "Required"}</Badge> : null}
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
  installed,
  editorUrl,
}: {
  title: string;
  description: string;
  action: string;
  url: string;
  recommended?: boolean;
  installed?: boolean;
  editorUrl: string;
}) {
  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack gap="200" blockAlign="center">
          <Text as="h3" variant="headingSm">
            {title}
          </Text>
          {installed ? <Badge tone="success">Installed</Badge> : recommended ? <Badge tone="info">Recommended</Badge> : null}
        </InlineStack>
        <Text as="p" variant="bodyMd" tone="subdued">
          {description}
        </Text>
        <Button url={installed ? editorUrl : url} target="_top" variant={installed ? "plain" : undefined}>
          {installed ? "Open in theme editor" : action}
        </Button>
      </BlockStack>
    </Card>
  );
}
