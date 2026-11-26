import { useEffect } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import {
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  IndexTable,
  InlineStack,
  Text,
} from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { SEO_WORKSPACE_TABS } from "../components/WorkspaceTabs";
import { AppPage } from "../components/AppPage";

const PER_TOOL = 30;
const EMPTY_IMAGE = "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png";

/**
 * Each Bulk Optimize tool keeps its own history table and its own undo action
 * (intent=undo, changeId=<row id>). This page merges them into one timeline and
 * reuses those actions, so undo behaviour stays identical to the tool pages.
 */
type ChangeKind = "meta" | "catalog" | "images" | "links";

const TOOL_META: Record<ChangeKind, { label: string; action: string; url: string }> = {
  meta: { label: "Meta tags", action: "/app/blogs/bulk_edit", url: "/app/optimize" },
  catalog: { label: "Products & collections", action: "/app/optimize/catalog/review", url: "/app/optimize/catalog" },
  images: { label: "Image alt text", action: "/app/image-seo", url: "/app/image-seo" },
  links: { label: "Internal links", action: "/app/internal-links", url: "/app/internal-links" },
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const [meta, catalog, images, links] = await Promise.all([
    prisma.seoBulkChange.findMany({
      where: { shop },
      orderBy: { appliedAt: "desc" },
      take: PER_TOOL,
      select: { id: true, articleTitle: true, status: true, appliedAt: true, undoneAt: true, beforeMetaTitle: true, afterMetaTitle: true, beforeMetaDescription: true, afterMetaDescription: true, beforeImageAlt: true, afterImageAlt: true },
    }),
    prisma.catalogBulkChange.findMany({
      where: { shop },
      orderBy: { appliedAt: "desc" },
      take: PER_TOOL,
      select: { id: true, title: true, resourceType: true, status: true, appliedAt: true, undoneAt: true, beforeSeoTitle: true, afterSeoTitle: true, beforeSeoDescription: true, afterSeoDescription: true, beforeImageAlt: true, afterImageAlt: true },
    }),
    prisma.imageSeoChange.findMany({
      where: { shop },
      orderBy: { appliedAt: "desc" },
      take: PER_TOOL,
      select: { id: true, imageCount: true, articleCount: true, status: true, appliedAt: true, undoneAt: true },
    }),
    prisma.internalLinkChange.findMany({
      where: { shop },
      orderBy: { appliedAt: "desc" },
      take: PER_TOOL,
      select: { id: true, articleTitle: true, suggestions: true, status: true, appliedAt: true, undoneAt: true },
    }),
  ]);

  const changes = [
    ...meta.map((row) => ({
      id: row.id,
      kind: "meta" as ChangeKind,
      subject: row.articleTitle,
      summary: describeMetaChange(row),
      status: row.status,
      appliedAt: row.appliedAt.toISOString(),
      undoneAt: row.undoneAt?.toISOString() || null,
    })),
    ...catalog.map((row) => ({
      id: row.id,
      kind: "catalog" as ChangeKind,
      subject: `${row.title} (${row.resourceType})`,
      summary: describeMetaChange({
        beforeMetaTitle: row.beforeSeoTitle, afterMetaTitle: row.afterSeoTitle,
        beforeMetaDescription: row.beforeSeoDescription, afterMetaDescription: row.afterSeoDescription,
        beforeImageAlt: row.beforeImageAlt, afterImageAlt: row.afterImageAlt,
      }, "image alt"),
      status: row.status,
      appliedAt: row.appliedAt.toISOString(),
      undoneAt: row.undoneAt?.toISOString() || null,
    })),
    ...images.map((row) => ({
      id: row.id,
      kind: "images" as ChangeKind,
      subject: `${row.articleCount} post${row.articleCount === 1 ? "" : "s"}`,
      summary: `${row.imageCount} image alt text${row.imageCount === 1 ? "" : "s"} updated`,
      status: row.status,
      appliedAt: row.appliedAt.toISOString(),
      undoneAt: row.undoneAt?.toISOString() || null,
    })),
    ...links.map((row) => {
      const count = Array.isArray(row.suggestions) ? row.suggestions.length : 0;
      return {
        id: row.id,
        kind: "links" as ChangeKind,
        subject: row.articleTitle,
        summary: count ? `${count} internal link${count === 1 ? "" : "s"} inserted` : "Internal links inserted",
        status: row.status,
        appliedAt: row.appliedAt.toISOString(),
        undoneAt: row.undoneAt?.toISOString() || null,
      };
    }),
  ].sort((a, b) => b.appliedAt.localeCompare(a.appliedAt));

  return json({ changes });
};

function describeMetaChange(row: {
  beforeMetaTitle: string; afterMetaTitle: string;
  beforeMetaDescription: string; afterMetaDescription: string;
  beforeImageAlt: string; afterImageAlt: string;
}, imageLabel = "featured image alt") {
  const fields = [
    row.beforeMetaTitle !== row.afterMetaTitle && "SEO title",
    row.beforeMetaDescription !== row.afterMetaDescription && "meta description",
    row.beforeImageAlt !== row.afterImageAlt && imageLabel,
  ].filter(Boolean) as string[];
  if (!fields.length) return "No field changes";
  const text = fields.join(", ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)} updated`;
}

export default function ChangeHistory() {
  const { changes } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ success?: boolean; undone?: boolean; error?: string }>();
  const shopify = useAppBridge();
  const pendingId = fetcher.state !== "idle" ? String(fetcher.formData?.get("changeId") || "") : "";

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    // Remix revalidates this loader automatically after the undo action completes.
    if (fetcher.data.undone) shopify.toast.show("Change undone");
  }, [fetcher.state, fetcher.data, shopify]);

  const undo = (kind: ChangeKind, changeId: string) => {
    fetcher.submit({ intent: "undo", changeId }, { method: "post", action: TOOL_META[kind].action });
  };

  return (
    <AppPage
      title="Change history"
      subtitle="Every bulk change applied to Shopify, newest first. Undo restores the exact previous values."
      fullWidth
      tabs={{ items: SEO_WORKSPACE_TABS, activeId: "history" }}
    >

        {fetcher.data?.error && <Banner tone="critical" title="Could not undo this change"><p>{fetcher.data.error}</p></Banner>}

        {!changes.length ? (
          <Card>
            <EmptyState heading="No bulk changes yet" action={{ content: "Optimize meta tags", url: "/app/optimize" }} image={EMPTY_IMAGE}>
              <p>Changes applied with Meta tags, Products &amp; collections, Image alt text and Internal links appear here, each with an Undo button.</p>
            </EmptyState>
          </Card>
        ) : (
          <Card padding="0">
            <IndexTable
              resourceName={{ singular: "change", plural: "changes" }}
              itemCount={changes.length}
              selectable={false}
              headings={[{ title: "Applied" }, { title: "Tool" }, { title: "Item" }, { title: "Change" }, { title: "Status" }, { title: "" }]}
            >
              {changes.map((change, index) => (
                <IndexTable.Row id={`${change.kind}-${change.id}`} key={`${change.kind}-${change.id}`} position={index}>
                  <IndexTable.Cell><Text as="span" variant="bodySm">{new Date(change.appliedAt).toLocaleString()}</Text></IndexTable.Cell>
                  <IndexTable.Cell><Badge>{TOOL_META[change.kind].label}</Badge></IndexTable.Cell>
                  <IndexTable.Cell><Text as="span" fontWeight="semibold">{change.subject}</Text></IndexTable.Cell>
                  <IndexTable.Cell><Text as="span" variant="bodySm">{change.summary}</Text></IndexTable.Cell>
                  <IndexTable.Cell>
                    {change.status === "applied"
                      ? <Badge tone="success">Applied</Badge>
                      : <Badge>{change.undoneAt ? `Undone ${new Date(change.undoneAt).toLocaleDateString()}` : "Undone"}</Badge>}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <InlineStack align="end">
                      <Button
                        size="micro"
                        disabled={change.status !== "applied" || (fetcher.state !== "idle" && pendingId !== change.id)}
                        loading={pendingId === change.id}
                        onClick={() => undo(change.kind, change.id)}
                      >
                        Undo
                      </Button>
                    </InlineStack>
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          </Card>
        )}
    </AppPage>
  );
}
