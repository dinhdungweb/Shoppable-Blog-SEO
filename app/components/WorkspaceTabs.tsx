import { useNavigate } from "@remix-run/react";
import { Card, Tabs } from "@shopify/polaris";

export type WorkspaceTab = {
  id: string;
  content: string;
  url: string;
};

export const CONTENT_WORKSPACE_TABS: WorkspaceTab[] = [
  { id: "posts", content: "Posts", url: "/app/blogs" },
  { id: "briefs", content: "Content briefs", url: "/app/content-briefs" },
  { id: "links", content: "Internal links", url: "/app/internal-links" },
  { id: "decay", content: "Content decay", url: "/app/content-decay" },
];

export const SEO_WORKSPACE_TABS: WorkspaceTab[] = [
  { id: "blogs", content: "Blog SEO", url: "/app/seo" },
  { id: "products", content: "Product SEO", url: "/app/catalog-seo?type=product" },
  { id: "collections", content: "Collection SEO", url: "/app/catalog-seo?type=collection" },
  { id: "images", content: "Image SEO", url: "/app/image-seo" },
];

export const INSIGHTS_WORKSPACE_TABS: WorkspaceTab[] = [
  { id: "analytics", content: "Analytics", url: "/app/analytics" },
  { id: "site-speed", content: "Site speed", url: "/app/performance" },
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
