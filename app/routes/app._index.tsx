import { useCallback, useState } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import {
  Page, Layout, Card, Text, BlockStack, InlineStack, Box, Badge,
  IndexTable, InlineGrid, Button, Icon, Select, Divider, ProgressBar, Thumbnail, Link
} from "@shopify/polaris";
import {
  CheckIcon, AlertTriangleIcon, MagicIcon, ChevronRightIcon,
  SearchIcon, TargetIcon, ChartVerticalFilledIcon, NoteIcon, PlusIcon,
  CashDollarIcon, ArrowUpIcon, AlertCircleIcon, EditIcon
} from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, Legend
} from "recharts";

// -- MOCK DATA --
const CHART_DATA = [
  { date: "May 1", sessions: 2100, clicks: 1200, carts: 800, orders: 150, revenue: 11000 },
  { date: "May 6", sessions: 2200, clicks: 1250, carts: 900, orders: 180, revenue: 11500 },
  { date: "May 11", sessions: 2400, clicks: 1500, carts: 1000, orders: 200, revenue: 12100 },
  { date: "May 16", sessions: 2300, clicks: 1400, carts: 950, orders: 190, revenue: 11800 },
  { date: "May 21", sessions: 2600, clicks: 1600, carts: 1100, orders: 250, revenue: 12500 },
  { date: "May 26", sessions: 2800, clicks: 1700, carts: 1200, orders: 300, revenue: 12846 },
  { date: "May 31", sessions: 2900, clicks: 1800, carts: 1250, orders: 320, revenue: 13000 },
];

const RECENT_POSTS = [
  { id: 1, title: "How to style silver rings", image: "https://burst.shopifycdn.com/photos/silver-rings.jpg?width=100", status: "Published", score: 82, linked: 6, clicks: 124, revenue: 430, updated: "May 20, 2024" },
  { id: 2, title: "Best engagement rings guide", image: "https://burst.shopifycdn.com/photos/engagement-ring.jpg?width=100", status: "Published", score: 76, linked: 8, clicks: 289, revenue: 1250, updated: "May 18, 2024" },
  { id: 3, title: "How to clean gold jewelry", image: "https://burst.shopifycdn.com/photos/gold-jewelry.jpg?width=100", status: "Draft", score: 64, linked: 0, clicks: 0, revenue: 0, updated: "May 17, 2024" },
  { id: 4, title: "Birthstone jewelry meaning", image: "https://burst.shopifycdn.com/photos/birthstone-necklace.jpg?width=100", status: "Published", score: 88, linked: 5, clicks: 312, revenue: 1680, updated: "May 16, 2024" },
  { id: 5, title: "Minimal jewelry for everyday", image: "https://burst.shopifycdn.com/photos/minimal-necklace.jpg?width=100", status: "Published", score: 71, linked: 4, clicks: 98, revenue: 210, updated: "May 15, 2024" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return {};
};

export default function Dashboard() {
  const navigate = useNavigate();

  return (
    <Page fullWidth>
      <TitleBar title="Overview" />
      <BlockStack gap="600">
        
        {/* HEADER SECTION */}
        <InlineStack align="space-between" blockAlign="end">
          <BlockStack gap="100">
            <Text as="h1" variant="headingLg" fontWeight="bold">Overview</Text>
            <Text as="p" variant="bodyMd" tone="subdued">Turn blog content into product discovery and organic sales.</Text>
          </BlockStack>
          <InlineStack gap="300">
            <Button size="large">Run SEO scan</Button>
            <Button variant="primary" size="large">Create shoppable post</Button>
          </InlineStack>
        </InlineStack>

        {/* ROW 1: Progress, Priority, Quick actions */}
        <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
          
          {/* Setup progress */}
          <Card padding="400">
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd" fontWeight="bold">Setup progress</Text>
                <Text as="span" variant="bodySm" tone="subdued">4 of 5 completed</Text>
              </InlineStack>
              <ProgressBar progress={80} tone="success" size="small" />
              <BlockStack gap="300">
                <ProgressItem label="Blog connected" status="done" />
                <ProgressItem label="Product card enabled" status="done" />
                <ProgressItem label="SEO rules configured" status="done" />
                <ProgressItem label="Tracking active" status="action" badgeText="Needs action" />
                <ProgressItem label="First shoppable post published" status="pending" badgeText="Not started" />
              </BlockStack>
            </BlockStack>
          </Card>

          {/* Today's priority */}
          <Card padding="400">
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', flexDirection: 'column', width: '100%', gap: '12px' }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-start', gap: '8px', width: 'fit-content' }}>
                  <Icon source={AlertTriangleIcon} tone="critical" />
                  <Text as="h2" variant="headingMd" fontWeight="bold">Today's priority</Text>
                </div>
                
                <div style={{ paddingTop: '8px', display: 'flex', flexDirection: 'column', width: '100%', gap: '12px' }}>
                    <PriorityItem number="12" label="posts missing meta descriptions" tone="critical" />
                    <Divider />
                    <PriorityItem number="8" label="high-traffic posts have no linked products" tone="warning" />
                    <Divider />
                    <PriorityItem number="3" label="posts have low product click rate" tone="warning" />
                </div>
              </div>

              <div style={{ marginTop: 'auto', paddingTop: '16px' }}>
                <InlineStack gap="300">
                  <Button variant="primary">Fix SEO issues</Button>
                  <Button>Review posts</Button>
                </InlineStack>
              </div>
            </div>
          </Card>

          {/* Quick actions */}
          <Card padding="400">
            <div style={{ display: 'flex', flexDirection: 'column', width: '100%', gap: '16px' }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-start', gap: '8px', width: 'fit-content' }}>
                <Icon source={MagicIcon} tone="info" />
                <Text as="h2" variant="headingMd" fontWeight="bold">Quick actions</Text>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', width: '100%', gap: '4px' }}>
                <ActionItem icon={EditIcon} title="Create shoppable post" desc="Write and publish a new blog post" />
                <ActionItem icon={SearchIcon} title="Run SEO scan" desc="Scan all posts for SEO issues" />
                <ActionItem icon={PlusIcon} title="Add products to existing posts" desc="Link products to your blog posts" />
                <ActionItem icon={ChartVerticalFilledIcon} title="Review high-traffic posts" desc="Find posts with high traffic and low clicks" />
                <ActionItem icon={TargetIcon} title="Configure tracking" desc="Setup analytics and conversion tracking" />
              </div>
            </div>
          </Card>

        </InlineGrid>

        {/* ROW 2: 4 METRICS */}
        <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
          <MetricCard 
            title="Published shoppable posts" 
            value="128" 
            trend="18%" 
            iconTone="success" 
            icon={NoteIcon} 
          />
          <MetricCard 
            title="Average SEO score" 
            value="78 / 100" 
            trend="6 pts" 
            iconTone="info" 
            icon={ChartVerticalFilledIcon} 
          />
          <MetricCard 
            title="Product clicks from blog" 
            value="3,642" 
            trend="24%" 
            iconTone="magic" 
            icon={MagicIcon} 
          />
          <MetricCard 
            title="Revenue attributed to blog" 
            value="$12,846" 
            trend="32%" 
            iconTone="success" 
            icon={CashDollarIcon} 
          />
        </InlineGrid>

        {/* ROW 3: Recommended actions (1/3) & Performance (2/3) */}
        <InlineGrid columns={{ xs: 1, lg: "1fr 2fr" }} gap="400">
          
          {/* Recommended next actions */}
          <Card padding="400">
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd" fontWeight="bold">Recommended next actions</Text>
              <BlockStack gap="400">
                
                <RecommendedAction 
                  icon={AlertCircleIcon} iconTone="critical" 
                  title="Fix 12 posts missing meta descriptions" 
                  badge="High impact" badgeTone="critical"
                  button="Fix now" 
                />
                <Divider />
                <RecommendedAction 
                  icon={PlusIcon} iconTone="warning" 
                  title="Add products to 8 high-traffic posts" 
                  badge="High impact" badgeTone="warning"
                  button="Review posts" 
                />
                <Divider />
                <RecommendedAction 
                  icon={ChartVerticalFilledIcon} iconTone="warning" 
                  title="Improve 3 posts with low product click rate" 
                  badge="Medium impact" badgeTone="warning"
                  button="View details" 
                />
                <Divider />
                <RecommendedAction 
                  icon={TargetIcon} iconTone="info" 
                  title="Enable tracking to unlock full analytics" 
                  button="Set up tracking" 
                />

              </BlockStack>
            </BlockStack>
          </Card>

          {/* Performance overview */}
          <Card padding="400">
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd" fontWeight="bold">Performance overview</Text>
                <InlineStack gap="200">
                  <Select label="" labelHidden options={["Last 30 days"]} value="Last 30 days" onChange={() => {}} />
                  <Select label="" labelHidden options={["Compare: Apr 1 - Apr 30"]} value="Compare: Apr 1 - Apr 30" onChange={() => {}} />
                </InlineStack>
              </InlineStack>

              <InlineGrid columns={{ xs: 2, sm: 5 }} gap="200">
                <PerformanceStat label="Blog sessions" value="25,842" trend="24%" color="#2C6ECB" />
                <PerformanceStat label="Product clicks" value="3,642" trend="24%" color="#8F72F6" />
                <PerformanceStat label="Add to carts" value="1,125" trend="32%" color="#00A0AC" />
                <PerformanceStat label="Orders" value="328" trend="27%" color="#50B83C" />
                <PerformanceStat label="Revenue" value="$12,846" trend="32%" color="#50B83C" />
              </InlineGrid>

              <Box minHeight="250px" paddingBlockStart="200">
                <style>{`.recharts-legend-item { margin-right: 24px !important; } .recharts-legend-wrapper { padding-top: 16px !important; }`}</style>
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={CHART_DATA} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" stroke="#8c9196" fontSize={12} tickMargin={10} />
                    <YAxis stroke="#8c9196" fontSize={12} tickFormatter={(val) => val >= 1000 ? `${(val/1000).toFixed(0)}K` : val} />
                    <RechartsTooltip />
                    <Legend verticalAlign="bottom" height={36} iconType="plainline" />
                    <Line type="monotone" dataKey="sessions" name="Blog sessions" stroke="#2C6ECB" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="clicks" name="Product clicks" stroke="#8F72F6" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="carts" name="Add to carts" stroke="#00A0AC" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="orders" name="Orders" stroke="#50B83C" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="revenue" name="Revenue" stroke="#008060" strokeDasharray="5 5" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </Box>
            </BlockStack>
          </Card>

        </InlineGrid>

        {/* ROW 4: Recent shoppable posts */}
        <Card padding="0">
          <Box padding="400" paddingBlockEnd="200">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd" fontWeight="bold">Recent shoppable posts</Text>
              <Button variant="plain">View all posts</Button>
            </InlineStack>
          </Box>
          <IndexTable
            resourceName={{ singular: "post", plural: "posts" }}
            itemCount={RECENT_POSTS.length}
            headings={[
              { title: "Post" },
              { title: "Status" },
              { title: "SEO score" },
              { title: "Products linked" },
              { title: "Product clicks" },
              { title: "Revenue" },
              { title: "Updated" },
              { title: "Actions", alignment: "end" },
            ]}
            selectable={false}
          >
            {RECENT_POSTS.map((post, index) => (
              <IndexTable.Row id={post.id.toString()} key={post.id} position={index}>
                <IndexTable.Cell>
                  <InlineStack gap="300" blockAlign="center" wrap={false}>
                    <Thumbnail source={post.image} alt={post.title} size="small" />
                    <Text as="span" variant="bodyMd" fontWeight="semibold">{post.title}</Text>
                  </InlineStack>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Badge tone={post.status === "Published" ? "success" : "info"}>{post.status}</Badge>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <InlineStack gap="100" blockAlign="center">
                    <Text as="span" variant="bodyMd">{post.score}</Text>
                    <div style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: post.score > 80 ? 'var(--p-color-bg-success-strong)' : post.score > 70 ? 'var(--p-color-bg-warning-strong)' : 'var(--p-color-bg-critical-strong)' }} />
                  </InlineStack>
                </IndexTable.Cell>
                <IndexTable.Cell><Text as="span" variant="bodyMd" fontWeight="semibold">{post.linked}</Text></IndexTable.Cell>
                <IndexTable.Cell><Text as="span" variant="bodyMd">{post.clicks}</Text></IndexTable.Cell>
                <IndexTable.Cell><Text as="span" variant="bodyMd">${post.revenue}</Text></IndexTable.Cell>
                <IndexTable.Cell><Text as="span" variant="bodyMd" tone="subdued">{post.updated}</Text></IndexTable.Cell>
                <IndexTable.Cell>
                   <InlineStack align="end" gap="200">
                     <Button variant="plain" icon={EditIcon} />
                   </InlineStack>
                </IndexTable.Cell>
              </IndexTable.Row>
            ))}
          </IndexTable>
        </Card>

      </BlockStack>
    </Page>
  );
}

// -- SUB COMPONENTS --

function ProgressItem({ label, status, badgeText }: { label: string, status: "done" | "action" | "pending", badgeText?: string }) {
  return (
    <InlineStack align="space-between" blockAlign="center">
      <InlineStack gap="200" blockAlign="center">
        {status === "done" ? (
          <div style={{ color: 'var(--p-color-icon-success)' }}><Icon source={CheckIcon} /></div>
        ) : (
          <div style={{ width: 18, height: 18, borderRadius: 9, border: '2px solid var(--p-color-border)', marginLeft: 2 }} />
        )}
        <Text as="span" variant="bodyMd" tone={status === "pending" ? "subdued" : "base"}>{label}</Text>
      </InlineStack>
      {badgeText && (
        <Badge tone={status === "action" ? "warning" : "new"}>{badgeText}</Badge>
      )}
    </InlineStack>
  );
}

function PriorityItem({ number, label, tone }: { number: string, label: string, tone: string }) {
  return (
    <div style={{ width: '100%', boxSizing: 'border-box', display: 'flex', alignItems: 'center' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <InlineStack gap="300" blockAlign="center" wrap={false}>
          <Text as="span" variant="headingLg" fontWeight="bold" tone={tone as any}>{number}</Text>
          <Text as="span" variant="bodyMd">{label}</Text>
        </InlineStack>
      </div>
      <Icon source={ChevronRightIcon} tone="subdued" />
    </div>
  );
}

function ActionItem({ icon, title, desc }: { icon: any, title: string, desc: string }) {
  return (
    <div style={{ width: '100%', boxSizing: 'border-box', padding: '8px', cursor: 'pointer', borderRadius: '8px', transition: 'background 0.2s', display: 'flex', alignItems: 'center' }} 
         onMouseOver={(e) => e.currentTarget.style.background = 'var(--p-color-bg-surface-secondary)'}
         onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <InlineStack gap="300" blockAlign="center" wrap={false}>
          <Box padding="100" background="bg-surface-secondary" borderRadius="100">
            <Icon source={icon} tone="subdued" />
          </Box>
          <BlockStack gap="0">
            <Text as="span" variant="bodyMd" fontWeight="semibold">{title}</Text>
            <Text as="span" variant="bodySm" tone="subdued">{desc}</Text>
          </BlockStack>
        </InlineStack>
      </div>
      <Icon source={ChevronRightIcon} tone="subdued" />
    </div>
  );
}

function MetricCard({ title, value, trend, iconTone, icon }: any) {
  return (
    <Card padding="400">
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between' }}>
        <Text as="p" variant="bodyMd" fontWeight="semibold">{title}</Text>
        <div style={{ marginTop: '16px' }}>
          <InlineStack align="space-between" blockAlign="end">
            <BlockStack gap="100">
              <Text as="p" variant="heading2xl" fontWeight="bold">{value}</Text>
              <InlineStack gap="100" blockAlign="center">
                <Icon source={ArrowUpIcon} tone="success" />
                <Text as="span" variant="bodySm" tone="success" fontWeight="semibold">{trend}</Text>
                <Text as="span" variant="bodySm" tone="subdued">vs last month</Text>
              </InlineStack>
            </BlockStack>
            <Box background={`bg-surface-${iconTone}` as any} padding="200" borderRadius="200">
               <Icon source={icon} tone={iconTone} />
            </Box>
          </InlineStack>
        </div>
      </div>
    </Card>
  );
}

function RecommendedAction({ icon, iconTone, title, badge, badgeTone, button }: any) {
  return (
    <InlineStack align="space-between" blockAlign="center" wrap={false}>
      <InlineStack gap="300" blockAlign="center" wrap={false}>
        <Icon source={icon} tone={iconTone} />
        <Text as="span" variant="bodyMd">{title}</Text>
        {badge && <Badge tone={badgeTone}>{badge}</Badge>}
      </InlineStack>
      <Button size="micro">{button}</Button>
    </InlineStack>
  );
}

function PerformanceStat({ label, value, trend, color }: any) {
  return (
    <BlockStack gap="100">
      <InlineStack gap="100" blockAlign="center">
        <div style={{ width: 8, height: 2, backgroundColor: color }} />
        <Text as="span" variant="bodySm" tone="subdued">{label}</Text>
      </InlineStack>
      <InlineStack gap="200" blockAlign="baseline">
        <Text as="span" variant="headingMd" fontWeight="bold">{value}</Text>
        <InlineStack gap="0" blockAlign="center">
          <div style={{ transform: 'scale(0.7)' }}>
             <Icon source={ArrowUpIcon} tone="success" />
          </div>
          <Text as="span" variant="bodySm" tone="success" fontWeight="semibold">{trend}</Text>
        </InlineStack>
      </InlineStack>
    </BlockStack>
  );
}
