import { useNavigate } from "@remix-run/react";
import { Button, ButtonGroup, InlineStack, Text } from "@shopify/polaris";

export type IssueScope = "articles" | "products" | "collections";

const SCOPES: { id: IssueScope; label: string; url: string }[] = [
  { id: "articles", label: "Blog posts", url: "/app/seo" },
  { id: "products", label: "Products", url: "/app/catalog-seo?view=issues&type=product" },
  { id: "collections", label: "Collections", url: "/app/catalog-seo?view=issues&type=collection" },
];

/**
 * Switches the SEO Audit → Issues tab between resource types so blog, product
 * and collection findings live in one place instead of separate menu entries.
 */
export function IssueScopeSwitcher({ active }: { active: IssueScope }) {
  const navigate = useNavigate();
  return (
    <InlineStack gap="300" blockAlign="center" wrap>
      <Text as="span" variant="bodySm" tone="subdued">Show issues for</Text>
      <ButtonGroup variant="segmented">
        {SCOPES.map((scope) => (
          <Button
            key={scope.id}
            pressed={scope.id === active}
            onClick={() => { if (scope.id !== active) navigate(scope.url); }}
          >
            {scope.label}
          </Button>
        ))}
      </ButtonGroup>
    </InlineStack>
  );
}
