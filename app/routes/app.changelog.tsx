import type { LoaderFunctionArgs } from "@remix-run/node";
import { Badge, BlockStack, Box, Card, Divider, InlineStack, Layout, Page, Text } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { CHANGELOG_RELEASES } from "../changelog";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function ChangelogPage() {
  return (
    <Page title="What's new" subtitle="New features, improvements and fixes in Shoppable Blog & SEO">
      <TitleBar title="What's new" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            {CHANGELOG_RELEASES.map((release, index) => (
              <Card key={release.version} padding="0">
                <Box padding="500">
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="start" gap="300">
                      <BlockStack gap="100">
                        <InlineStack gap="200" blockAlign="center">
                          <Text as="h2" variant="headingLg">{release.title}</Text>
                          {index === 0 && <Badge tone="new">Latest</Badge>}
                        </InlineStack>
                        <Text as="p" variant="bodyMd" tone="subdued">{release.summary}</Text>
                      </BlockStack>
                      <BlockStack gap="100" inlineAlign="end">
                        <Text as="span" variant="bodySm" tone="subdued">{formatDate(release.date)}</Text>
                        <Text as="span" variant="bodySm" tone="subdued">v{release.version}</Text>
                      </BlockStack>
                    </InlineStack>
                    <InlineStack gap="150">{release.tags.map((tag) => <Badge key={tag} tone={tone(tag)}>{tag}</Badge>)}</InlineStack>
                    <Divider />
                    <BlockStack gap="200">
                      {release.changes.map((change, changeIndex) => (
                        <InlineStack key={`${release.version}-${changeIndex}`} gap="300" blockAlign="start" wrap={false}>
                          <div style={{ minWidth: 74 }}><Badge tone={tone(change.type)}>{change.type}</Badge></div>
                          <Text as="p" variant="bodyMd">{change.text}</Text>
                        </InlineStack>
                      ))}
                    </BlockStack>
                  </BlockStack>
                </Box>
              </Card>
            ))}
          </BlockStack>
        </Layout.Section>
        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">About updates</Text>
              <Text as="p" tone="subdued">Updates are listed newest first. Features that need additional setup, such as Google Search Console, remain optional.</Text>
              <Divider />
              <Text as="p" variant="bodySm" tone="subdued">Need help with an update? Use the support chat inside the app and include the version shown here.</Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function tone(type: "New" | "Improved" | "Fixed") {
  if (type === "New") return "new" as const;
  if (type === "Fixed") return "success" as const;
  return "info" as const;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}
