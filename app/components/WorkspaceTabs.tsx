import { useNavigate } from "@remix-run/react";
import { Tabs } from "@shopify/polaris";

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
  { id: "issues", content: "Checks", url: "/app/seo" },
  { id: "bulk", content: "Bulk fixes", url: "/app/optimize" },
  { id: "site-speed", content: "Site speed", url: "/app/performance" },
  { id: "history", content: "Change history", url: "/app/optimize/history" },
];

/** SEO Analyzer › Bulk fixes: one chip row switches between the three bulk tools. */
export const BULK_FIX_CHIPS = [
  { id: "meta", label: "Meta tags", to: "/app/optimize" },
  { id: "images", label: "Image alt text", to: "/app/image-seo" },
  { id: "links", label: "Internal links", to: "/app/internal-links" },
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
    <Tabs
        tabs={tabs.map(({ id, content }) => ({ id, content }))}
        selected={selected}
        onSelect={(index) => {
          const destination = tabs[index]?.url;
          if (destination) navigate(destination);
        }}
      />
  );
}
