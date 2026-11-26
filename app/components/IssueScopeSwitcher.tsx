import { Chips } from "./rm";

export type IssueScope = "articles" | "products" | "collections" | "pages";

const SCOPES: { id: IssueScope; label: string; to: string }[] = [
  { id: "articles", label: "Blog posts", to: "/app/seo" },
  { id: "products", label: "Products", to: "/app/catalog-seo?view=issues&type=product" },
  { id: "collections", label: "Collections", to: "/app/catalog-seo?view=issues&type=collection" },
  { id: "pages", label: "Store pages", to: "/app/catalog-seo?view=issues&type=page" },
];

/** SEO Analyzer › Checks: switches between blog, product, collection and store page findings. */
export function IssueScopeSwitcher({ active }: { active: IssueScope }) {
  return <Chips label="Show checks for" active={active} items={SCOPES} />;
}
