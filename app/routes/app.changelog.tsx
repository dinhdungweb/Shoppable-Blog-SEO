import type { LoaderFunctionArgs } from "@remix-run/node";
import { useState } from "react";
import { Badge, BlockStack, Box, Button, Card, Icon, InlineStack, Page, Text } from "@shopify/polaris";
import {
  CalendarIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ListBulletedIcon,
  MagicIcon,
  NoteIcon,
  ArrowUpIcon,
} from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { CHANGELOG_RELEASES, type ChangelogRelease } from "../changelog";

const INITIAL_CHANGE_COUNT = 5;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function ChangelogPage() {
  const [openVersions, setOpenVersions] = useState(() => new Set([CHANGELOG_RELEASES[0]?.version]));
  const [expandedVersions, setExpandedVersions] = useState<Set<string>>(() => new Set());
  const changeCount = CHANGELOG_RELEASES.reduce((total, release) => total + release.changes.length, 0);

  const toggleRelease = (version: string) => {
    setOpenVersions((current) => {
      const next = new Set(current);
      if (next.has(version)) next.delete(version);
      else next.add(version);
      return next;
    });
  };

  const toggleChanges = (version: string) => {
    setExpandedVersions((current) => {
      const next = new Set(current);
      if (next.has(version)) next.delete(version);
      else next.add(version);
      return next;
    });
  };

  return (
    <Page title="What's new" subtitle="A concise history of new features, improvements and fixes">
      <TitleBar title="What's new" />
      <BlockStack gap="500">
        <Card>
          <div className="bp-changelog-hero">
            <BlockStack gap="200">
              <InlineStack gap="200" blockAlign="center">
                <span className="bp-changelog-heading-icon"><Icon source={NoteIcon} tone="info" /></span>
                <Text as="h2" variant="headingLg">Product updates</Text>
                <Badge tone="new">{`Latest v${CHANGELOG_RELEASES[0]?.version}`}</Badge>
              </InlineStack>
              <Text as="p" tone="subdued">
                Scan the highlights first, then expand a release only when you need its full details.
              </Text>
            </BlockStack>
            <div className="bp-changelog-stats" aria-label="Changelog summary">
              <SummaryStat icon={NoteIcon} value={CHANGELOG_RELEASES.length} label="Releases" />
              <SummaryStat icon={ListBulletedIcon} value={changeCount} label="Updates" />
              <SummaryStat icon={CalendarIcon} value={formatShortDate(CHANGELOG_RELEASES[0]?.date)} label="Latest release" />
            </div>
          </div>
        </Card>

        <div className="bp-changelog-layout">
          <div className="bp-changelog-list">
            {CHANGELOG_RELEASES.map((release, index) => {
              const isOpen = openVersions.has(release.version);
              const showAll = expandedVersions.has(release.version);
              const visibleChanges = showAll ? release.changes : release.changes.slice(0, INITIAL_CHANGE_COUNT);
              const hiddenCount = release.changes.length - visibleChanges.length;

              return (
                <section className={`bp-release ${isOpen ? "bp-release--open" : ""}`} key={release.version}>
                  <button
                    type="button"
                    className="bp-release-header"
                    onClick={() => toggleRelease(release.version)}
                    aria-expanded={isOpen}
                    aria-controls={`release-${release.version}`}
                  >
                    <span className="bp-release-marker" aria-hidden="true" />
                    <span className="bp-release-heading">
                      <span className="bp-release-title-row">
                        <Text as="span" variant="headingMd">{release.title}</Text>
                        {index === 0 && <Badge tone="new">Latest</Badge>}
                      </span>
                      <span className="bp-release-meta">
                        {formatDate(release.date)} · v{release.version} · {release.changes.length} changes
                      </span>
                    </span>
                    <span className="bp-release-tags">
                      {release.tags.map((tag) => <Badge key={tag} tone={tone(tag)}>{tag}</Badge>)}
                    </span>
                    <span className="bp-release-chevron" aria-hidden="true">
                      <Icon source={ChevronDownIcon} tone="subdued" />
                    </span>
                  </button>

                  {isOpen && (
                    <div className="bp-release-body" id={`release-${release.version}`}>
                      <Text as="p" tone="subdued">{release.summary}</Text>
                      <div className="bp-change-list">
                        {visibleChanges.map((change, changeIndex) => (
                          <div className="bp-change-row" key={`${release.version}-${changeIndex}`}>
                            <Badge tone={tone(change.type)}>{change.type}</Badge>
                            <Text as="p" variant="bodyMd">{change.text}</Text>
                          </div>
                        ))}
                      </div>
                      {release.changes.length > INITIAL_CHANGE_COUNT && (
                        <div className="bp-release-more">
                          <Button variant="plain" onClick={() => toggleChanges(release.version)}>
                            {showAll ? "Show fewer changes" : `Show ${hiddenCount} more changes`}
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </section>
              );
            })}
          </div>

          <aside className="bp-changelog-aside">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">How to read updates</Text>
                <Legend icon={MagicIcon} badge="New" text="New capabilities available in the app." />
                <Legend icon={ArrowUpIcon} badge="Improved" text="Existing workflows made faster or clearer." />
                <Legend icon={CheckCircleIcon} badge="Fixed" text="Bugs and reliability issues resolved." />
                <Box borderBlockStartWidth="025" borderColor="border" paddingBlockStart="300">
                  <Text as="p" variant="bodySm" tone="subdued">
                    Need help? Include the release version when contacting support.
                  </Text>
                </Box>
              </BlockStack>
            </Card>
          </aside>
        </div>
      </BlockStack>
    </Page>
  );
}

function SummaryStat({ icon, value, label }: { icon: typeof NoteIcon; value: string | number; label: string }) {
  return (
    <div className="bp-changelog-stat">
      <span className="bp-changelog-stat-icon"><Icon source={icon} tone="info" /></span>
      <span className="bp-changelog-stat-copy">
        <Text as="strong" variant="headingMd">{value}</Text>
        <Text as="span" variant="bodySm" tone="subdued">{label}</Text>
      </span>
    </div>
  );
}

function Legend({ icon, badge, text }: { icon: typeof NoteIcon; badge: ChangelogRelease["tags"][number]; text: string }) {
  return (
    <div className="bp-changelog-legend">
      <span className="bp-changelog-legend-icon"><Icon source={icon} tone={iconTone(badge)} /></span>
      <span>
        <Badge tone={tone(badge)}>{badge}</Badge>
        <span className="bp-changelog-legend-text"><Text as="span" variant="bodySm" tone="subdued">{text}</Text></span>
      </span>
    </div>
  );
}

function iconTone(type: "New" | "Improved" | "Fixed") {
  if (type === "Fixed") return "success" as const;
  return "info" as const;
}

function tone(type: "New" | "Improved" | "Fixed") {
  if (type === "New") return "new" as const;
  if (type === "Fixed") return "success" as const;
  return "info" as const;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

function formatShortDate(value?: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

export function links() {
  return [{
    rel: "stylesheet",
    href: `data:text/css,${encodeURIComponent(`
      .bp-changelog-hero { display: flex; align-items: center; justify-content: space-between; gap: 32px; }
      .bp-changelog-heading-icon { display: flex; width: 28px; height: 28px; align-items: center; justify-content: center; border-radius: 8px; background: var(--p-color-bg-surface-info); }
      .bp-changelog-stats { display: grid; grid-template-columns: repeat(3, minmax(100px, 1fr)); }
      .bp-changelog-stat { display: grid; grid-template-columns: 24px minmax(0, 1fr); align-items: center; gap: 8px; min-width: 120px; padding: 4px 24px; border-left: 1px solid var(--p-color-border-secondary); }
      .bp-changelog-stat-icon { display: flex; }
      .bp-changelog-stat-copy { display: flex; flex-direction: column; gap: 2px; }
      .bp-changelog-layout { display: grid; grid-template-columns: minmax(0, 1fr) 280px; align-items: start; gap: 20px; }
      .bp-changelog-list { position: relative; display: flex; flex-direction: column; gap: 12px; }
      .bp-changelog-list::before { content: ''; position: absolute; top: 26px; bottom: 26px; left: 23px; width: 2px; background: var(--p-color-border-secondary); }
      .bp-release { position: relative; overflow: hidden; border: 1px solid var(--p-color-border-secondary); border-radius: 12px; background: var(--p-color-bg-surface); box-shadow: var(--p-shadow-100); }
      .bp-release--open { border-color: var(--p-color-border); }
      .bp-release-header { position: relative; z-index: 1; display: grid; grid-template-columns: 18px minmax(0, 1fr) auto 20px; align-items: center; gap: 14px; width: 100%; padding: 18px 20px 18px 15px; border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; }
      .bp-release-header:hover { background: var(--p-color-bg-surface-hover); }
      .bp-release-marker { width: 12px; height: 12px; border: 3px solid var(--p-color-bg-surface); border-radius: 50%; background: var(--p-color-icon-info); box-shadow: 0 0 0 2px var(--p-color-border-info); }
      .bp-release--open .bp-release-marker { background: var(--p-color-bg-fill-info); }
      .bp-release-heading { display: flex; min-width: 0; flex-direction: column; gap: 3px; }
      .bp-release-title-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
      .bp-release-meta { color: var(--p-color-text-secondary); font-size: 12px; }
      .bp-release-tags { display: flex; justify-content: flex-end; gap: 6px; }
      .bp-release-chevron { display: flex; transition: transform 150ms ease; }
      .bp-release--open .bp-release-chevron { transform: rotate(180deg); }
      .bp-release-body { padding: 0 20px 18px 47px; }
      .bp-change-list { display: flex; flex-direction: column; margin-top: 14px; border-top: 1px solid var(--p-color-border-secondary); }
      .bp-change-row { display: grid; grid-template-columns: 78px minmax(0, 1fr); align-items: start; gap: 12px; padding: 11px 0; border-bottom: 1px solid var(--p-color-border-secondary); }
      .bp-release-more { padding-top: 10px; text-align: center; }
      .bp-changelog-aside { position: sticky; top: 16px; }
      .bp-changelog-legend { display: grid; grid-template-columns: 24px minmax(0, 1fr); align-items: start; gap: 8px; }
      .bp-changelog-legend-icon { display: flex; padding-top: 1px; }
      .bp-changelog-legend-text { display: block; margin-top: 5px; }
      @media (max-width: 900px) {
        .bp-changelog-hero { align-items: flex-start; flex-direction: column; }
        .bp-changelog-stats { width: 100%; }
        .bp-changelog-stat:first-child { border-left: 0; padding-left: 0; }
        .bp-changelog-layout { grid-template-columns: 1fr; }
        .bp-changelog-aside { position: static; }
      }
      @media (max-width: 600px) {
        .bp-changelog-stats { grid-template-columns: 1fr 1fr; gap: 12px; }
        .bp-changelog-stat { min-width: 0; padding: 0; border-left: 0; }
        .bp-release-header { grid-template-columns: 18px minmax(0, 1fr) 20px; }
        .bp-release-tags { display: none; }
        .bp-release-body { padding-left: 20px; }
        .bp-change-row { grid-template-columns: 1fr; gap: 6px; }
      }
    `)}`,
  }];
}
