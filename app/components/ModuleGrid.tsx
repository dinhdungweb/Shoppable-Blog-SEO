import { Badge, BlockStack, Button, Card, Checkbox, InlineGrid, InlineStack, Text } from "@shopify/polaris";

export type ModuleStatus = "active" | "off" | "setup" | "locked" | "checking";

export type AppModule = {
  id: string;
  title: string;
  description: string;
  status: ModuleStatus;
  /** Plan needed when locked, e.g. "Pro". */
  requiredPlan?: string;
  /** Detail under the description, e.g. "12 of 25 AI generations used". */
  detail?: string;
  url: string;
  /** Present when the module can be switched on/off from the dashboard. */
  toggle?: { checked: boolean; pending?: boolean; onChange: (checked: boolean) => void };
};

const STATUS: Record<ModuleStatus, { label: string; tone?: "success" | "attention" | "info" }> = {
  active: { label: "Active", tone: "success" },
  off: { label: "Off" },
  setup: { label: "Needs setup", tone: "attention" },
  locked: { label: "Upgrade", tone: "info" },
  checking: { label: "Checking…" },
};

/** Dashboard › Modules: every feature in one place, with its status and a way in. */
export function ModuleGrid({ modules, planKey }: { modules: AppModule[]; planKey: string }) {
  return (
    <InlineGrid columns={{ xs: 1, sm: 2, lg: 3 }} gap="300">
      {modules.map((module) => {
        const status = STATUS[module.status];
        const locked = module.status === "locked";
        return (
          <Card key={module.id}>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center" wrap={false} gap="200">
                <Text as="h3" variant="headingSm">{module.title}</Text>
                <Badge tone={status.tone}>{locked && module.requiredPlan ? module.requiredPlan : status.label}</Badge>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">{module.description}</Text>
              {module.detail && <Text as="p" variant="bodySm">{module.detail}</Text>}
              <InlineStack align="space-between" blockAlign="center" gap="200">
                {module.toggle && !locked ? (
                  <Checkbox
                    label="Enabled"
                    checked={module.toggle.checked}
                    disabled={module.toggle.pending}
                    onChange={module.toggle.onChange}
                  />
                ) : <span />}
                {locked ? (
                  <Button url={`/app/pricing?reason=${encodeURIComponent(module.id)}&plan=${planKey}`}>See plans</Button>
                ) : (
                  <Button url={module.url} variant={module.status === "setup" ? "primary" : undefined}>
                    {module.status === "setup" ? "Set up" : "Open"}
                  </Button>
                )}
              </InlineStack>
            </BlockStack>
          </Card>
        );
      })}
    </InlineGrid>
  );
}
