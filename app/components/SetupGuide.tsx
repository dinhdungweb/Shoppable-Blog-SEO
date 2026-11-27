import { useEffect, useState } from "react";
import {
  BlockStack,
  Box,
  Button,
  Collapsible,
  Icon,
  InlineStack,
  ProgressBar,
  Text,
} from "@shopify/polaris";
import { CheckCircleIcon, ChevronDownIcon, ChevronUpIcon } from "@shopify/polaris-icons";

export type SetupStep = {
  id: string;
  title: string;
  description: string;
  done: boolean;
  /** Shown instead of the action while the status is being checked. */
  checking?: boolean;
  error?: string;
  action?: { content: string; url?: string; onAction?: () => void; loading?: boolean; external?: boolean };
};

const DISMISS_KEY = "rm-setup-guide-dismissed";

/**
 * Shopify-style setup guide: a progress bar and a list of steps where the
 * first unfinished step is expanded with its explanation and action.
 */
export function SetupGuide({ steps }: { steps: SetupStep[] }) {
  const done = steps.filter((step) => step.done).length;
  const firstOpen = steps.find((step) => !step.done)?.id || "";
  const [expanded, setExpanded] = useState(firstOpen);
  const [collapsed, setCollapsed] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      // Storage blocked: always show the guide.
    }
  }, []);
  useEffect(() => setExpanded(firstOpen), [firstOpen]);

  if (dismissed || !steps.length) return null;
  const complete = done === steps.length;
  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Ignore blocked storage.
    }
  };

  return (
    <s-section>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="start" wrap={false}>
          <BlockStack gap="100">
            <Text as="h2" variant="headingMd">{complete ? "Setup complete" : "Setup guide"}</Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {complete ? "Everything is connected. You can hide this guide." : "Finish these steps to show products in posts, track revenue and keep SEO checks up to date."}
            </Text>
          </BlockStack>
          <InlineStack gap="100" wrap={false}>
            {complete && <Button variant="plain" onClick={dismiss}>Dismiss</Button>}
            <Button
              variant="tertiary"
              icon={collapsed ? ChevronDownIcon : ChevronUpIcon}
              accessibilityLabel={collapsed ? "Show setup steps" : "Hide setup steps"}
              onClick={() => setCollapsed((value) => !value)}
            />
          </InlineStack>
        </InlineStack>
        <InlineStack gap="200" blockAlign="center" wrap={false}>
          <Text as="span" variant="bodySm" tone="subdued">{`${done} of ${steps.length} tasks complete`}</Text>
          <div style={{ flex: 1 }}><ProgressBar progress={Math.round((done / steps.length) * 100)} size="small" tone={complete ? "success" : "primary"} /></div>
        </InlineStack>
        <Collapsible id="setup-guide-steps" open={!collapsed}>
          <BlockStack gap="100">
            {steps.map((step) => {
              const open = expanded === step.id;
              return (
                <Box key={step.id} padding="200" borderRadius="200" background={open ? "bg-surface-secondary" : undefined}>
                  <BlockStack gap="200">
                    <InlineStack gap="200" blockAlign="center" wrap={false}>
                      <div style={{ flexShrink: 0 }}>
                        {step.done
                          ? <Icon source={CheckCircleIcon} tone="success" />
                          : <span aria-hidden style={{ display: "block", width: 20, height: 20, borderRadius: 10, border: "1.5px dashed var(--p-color-border-secondary)" }} />}
                      </div>
                      <Button variant="plain" removeUnderline textAlign="left" onClick={() => setExpanded(open ? "" : step.id)} accessibilityLabel={`${step.title}${step.done ? " (done)" : ""}`}>
                        {step.title}
                      </Button>
                    </InlineStack>
                    {open && (
                      <Box paddingInlineStart="800">
                        <BlockStack gap="200" inlineAlign="start">
                          <Text as="p" variant="bodySm" tone="subdued">{step.description}</Text>
                          {step.error && <Text as="p" variant="bodySm" tone="critical">{step.error}</Text>}
                          {!step.done && step.checking && <Text as="p" variant="bodySm" tone="subdued">Checking…</Text>}
                          {!step.done && !step.checking && step.action && (
                            <Button
                              variant="primary"
                              url={step.action.url}
                              onClick={step.action.onAction}
                              loading={step.action.loading}
                              target={step.action.external ? "_top" : undefined}
                            >
                              {step.action.content}
                            </Button>
                          )}
                        </BlockStack>
                      </Box>
                    )}
                  </BlockStack>
                </Box>
              );
            })}
          </BlockStack>
        </Collapsible>
      </BlockStack>
    </s-section>
  );
}
