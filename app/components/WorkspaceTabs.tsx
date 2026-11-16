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
 *   Home · Content · SEO Audit · Catalog · Bulk Optimize · Insights · Settings
 *
 * Each top-level area owns one tab set. A page must only render the tab set of
 * the area it belongs to, so merchants always know where they are.
 */

/** Content: writing and planning articles. */
export const CONTENT_WORKSPACE_TABS: WorkspaceTab[] = [
  { id: "posts", content: "Posts", url: "/app/blogs" },
  { id: "briefs", content: "Content briefs", url: "/app/content-briefs" },
];

/** SEO Audit: finding problems across the whole store. */
export const SEO_WORKSPACE_TABS: WorkspaceTab[] = [
  { id: "issues", content: "Issues", url: "/app/seo" },
  { id: "keywords", content: "Keywords & decay", url: "/app/content-decay" },
  { id: "site-speed", content: "Site speed", url: "/app/performance" },
];

/** Bulk Optimize: reviewable AI fixes applied to many resources at once. */
export const OPTIMIZE_WORKSPACE_TABS: WorkspaceTab[] = [
  { id: "meta", content: "Meta tags", url: "/app/optimize" },
  { id: "images", content: "Image alt text", url: "/app/image-seo" },
  { id: "links", content: "Internal links", url: "/app/internal-links" },
  { id: "history", content: "Change history", url: "/app/optimize/history" },
];

/** Settings: configuration, theme install and billing. */
export const SETTINGS_WORKSPACE_TABS: WorkspaceTab[] = [
  { id: "settings", content: "Settings", url: "/app/settings" },
  { id: "theme", content: "Theme setup", url: "/app/theme-setup" },
  { id: "billing", content: "Plan & billing", url: "/app/pricing" },
  { id: "changelog", content: "What's new", url: "/app/changelog" },
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
