import { useNavigate } from "@remix-run/react";
import { Card, Tabs } from "@shopify/polaris";

export type WorkspaceTab = {
  id: string;
  content: string;
  url: string;
};

/**
 * Navigation model (keep in sync with the NavMenu in routes/app.tsx):
 *
 *   Dashboard · Posts · Products & collections · SEO Analyzer · Analytics · Settings
 *
 * Each area owns at most one tab set, rendered by AppPage under the page
 * header. Settings has no tabs: it is an index page of setting sections.
 */

/** Posts: writing and planning articles. */
export const CONTENT_WORKSPACE_TABS: WorkspaceTab[] = [
  { id: "posts", content: "Posts", url: "/app/blogs" },
  { id: "briefs", content: "Content briefs", url: "/app/content-briefs" },
];

/** Products & collections: catalog SEO, one item at a time or in bulk. */
export const CATALOG_WORKSPACE_TABS: WorkspaceTab[] = [
  { id: "manage", content: "Products & collections", url: "/app/catalog-seo?view=manager&type=product" },
  { id: "bulk", content: "Bulk optimize", url: "/app/optimize/catalog" },
];

/** SEO Analyzer: find problems across the store and fix them in bulk. */
export const SEO_WORKSPACE_TABS: WorkspaceTab[] = [
  { id: "issues", content: "Issues", url: "/app/seo" },
  { id: "meta", content: "Meta tags", url: "/app/optimize" },
  { id: "images", content: "Image alt text", url: "/app/image-seo" },
  { id: "links", content: "Internal links", url: "/app/internal-links" },
  { id: "site-speed", content: "Site speed", url: "/app/performance" },
  { id: "history", content: "Change history", url: "/app/optimize/history" },
];

/** Analytics: revenue from content and search performance. */
export const ANALYTICS_WORKSPACE_TABS: WorkspaceTab[] = [
  { id: "overview", content: "Overview", url: "/app/analytics" },
  { id: "keywords", content: "Keywords & decay", url: "/app/content-decay" },
];

export function WorkspaceTabs({
  tabs,
  activeId,
}: {
  tabs: WorkspaceTab[];
  activeId: string;
}) {
  const navigate = useNavigate();
  const selected = Math.max(0, tabs.findIndex((tab) => tab.id === activeId));

  return (
    <Card padding="0">
      <Tabs
        tabs={tabs.map(({ id, content }) => ({ id, content }))}
        selected={selected}
        onSelect={(index) => {
          const destination = tabs[index]?.url;
          if (destination) navigate(destination);
        }}
      />
    </Card>
  );
}
