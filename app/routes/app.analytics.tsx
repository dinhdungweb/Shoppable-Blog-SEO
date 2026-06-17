import { useCallback, useState } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page, Card, Text, BlockStack, InlineStack, Box, Badge, IndexTable,
  EmptyState, InlineGrid, Button, ButtonGroup, Icon, Select, Divider, Thumbnail, Layout
} from "@shopify/polaris";
import {
  ArrowUpIcon,
  ArrowDownIcon,
  CheckIcon,
  ImageIcon,
  CartIcon,
  CashDollarIcon,
  MagicIcon,
} from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, PieChart, Pie, Cell
} from "recharts";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return null;
}

const SPARK_UP = Array.from({length: 15}, (_, i) => ({ value: Math.random() * 50 + i * 2 }));
const SPARK_DOWN = Array.from({length: 15}, (_, i) => ({ value: Math.random() * 50 - i * 2 + 50 }));

const REVENUE_DATA = [
  { date: 'May 1', current: 250, previous: 150 },
  { date: 'May 6', current: 400, previous: 250 },
  { date: 'May 11', current: 300, previous: 200 },
  { date: 'May 16', current: 500, previous: 400 },
  { date: 'May 21', current: 800, previous: 500 },
  { date: 'May 26', current: 550, previous: 350 },
  { date: 'May 31', current: 750, previous: 400 },
];

const PIE_COLORS = ['#2C6ECB', '#00A0AC', '#8D51D5', '#E58A1F', '#A3A8B1'];
const PIE_DATA = [
  { name: 'Organic search', value: 56.2, color: PIE_COLORS[0] },
  { name: 'Direct', value: 21.1, color: PIE_COLORS[1] },
  { name: 'Social media', value: 10.4, color: PIE_COLORS[2] },
  { name: 'Email', value: 7.6, color: PIE_COLORS[3] },
  { name: 'Other', value: 4.7, color: PIE_COLORS[4] },
];

const TOP_POSTS = [
  { img: "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png", title: "Best engagement rings guide", sessions: "5,642", seo: 92, ctr: "14.9%", atc: "842", orders: 76, rev: "$3,210", action: "Update links" },
  { img: "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png", title: "How to buy diamonds online", sessions: "4,321", seo: 88, ctr: "12.4%", atc: "612", orders: 54, rev: "$2,480", action: "Add internal links" },
  { img: "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png", title: "Birthstone jewelry meaning", sessions: "3,210", seo: 64, ctr: "14.2%", atc: "456", orders: 41, rev: "$1,890", action: "Optimize SEO" },
  { img: "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png", title: "How to style silver rings", sessions: "2,987", seo: 58, ctr: "10.7%", atc: "321", orders: 32, rev: "$1,230", action: "Improve CTR" },
  { img: "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png", title: "Necklace length guide", sessions: "2,156", seo: 71, ctr: "9.7%", atc: "210", orders: 25, rev: "$860", action: "Add product links" },
];

const TOP_PRODUCTS = [
  { img: "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png", title: "Solitaire Ring", clicks: "2,430", rev: "$2,430" },
  { img: "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png", title: "Gold Hoop Earrings", clicks: "1,120", rev: "$1,120" },
  { img: "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png", title: "Tennis Bracelet", clicks: "1,020", rev: "$1,020" },
  { img: "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png", title: "Pendant Necklace", clicks: "950", rev: "$950" },
  { img: "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png", title: "Stacking Ring", clicks: "860", rev: "$860" },
];

function Sparkline({ data, color }: { data: any[], color: string }) {
  return (
    <div style={{ height: '40px', width: '100%', marginTop: '8px' }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function FunnelStep({ label, value, percentage, bgWidth, color }: any) {
  return (
    <InlineStack align="space-between" blockAlign="center" wrap={false}>
      <Box width="120px">
        <Text as="p" variant="bodySm" tone="subdued">{label}</Text>
        <Text as="p" variant="bodyMd" fontWeight="bold">{value}</Text>
      </Box>
      <Box style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
        <div style={{ width: bgWidth, backgroundColor: color, padding: '8px 0', textAlign: 'center', borderRadius: '4px' }}>
          <Text as="span" variant="bodySm" fontWeight="bold" tone="info">{percentage}</Text>
        </div>
      </Box>
    </InlineStack>
  );
}

function MetricCard({ title, value, trend, isUp, data }: any) {
  return (
    <Card padding="400">
      <BlockStack gap="100">
        <Text as="p" variant="bodySm" tone="subdued">{title}</Text>
        <InlineStack gap="200" blockAlign="baseline">
          <Text as="p" variant="headingLg" fontWeight="bold">{value}</Text>
          <InlineStack gap="025" blockAlign="center">
            <Icon source={isUp ? ArrowUpIcon : ArrowDownIcon} tone={isUp ? "success" : "critical"} />
            <Text as="span" variant="bodySm" tone={isUp ? "success" : "critical"}>{trend}</Text>
          </InlineStack>
        </InlineStack>
        <Sparkline data={data} color={isUp ? "#00A0AC" : "#D82C0D"} />
      </BlockStack>
    </Card>
  );
}

function InsightCard({ iconTone, icon, title, desc, buttonText }: any) {
  return (
    <Card padding="400">
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between' }}>
        <BlockStack gap="300">
          <InlineStack gap="200" blockAlign="center">
            <Box background={`bg-surface-${iconTone}`} padding="100" borderRadius="100">
              <Icon source={icon || CheckIcon} tone={iconTone} />
            </Box>
            <Text as="p" variant="headingSm" fontWeight="bold">{title}</Text>
          </InlineStack>
          <Text as="p" variant="bodySm" tone="subdued">{desc}</Text>
        </BlockStack>
        <Box paddingBlockStart="400">
          <InlineStack align="start">
             <Button size="micro">{buttonText}</Button>
          </InlineStack>
        </Box>
      </div>
    </Card>
  );
}

export default function Analytics() {
  return (
    <Page fullWidth>
      <TitleBar title="Analytics" />
      <BlockStack gap="500">
        
        {/* Header Section */}
        <InlineStack align="space-between" blockAlign="end">
          <BlockStack gap="100">
            <Text as="h1" variant="headingXl" fontWeight="bold">Analytics</Text>
            <Text as="p" variant="bodyMd" tone="subdued">Measure how blog content drives product discovery, clicks, and revenue.</Text>
          </BlockStack>
          <InlineStack gap="300" blockAlign="center">
            <Select label="" labelHidden options={[{label: "May 1 – May 31, 2024", value: "1"}]} value="1" onChange={()=>{}} />
            <Select label="" labelHidden options={[{label: "Compare: Apr 1 – Apr 30, 2024", value: "1"}]} value="1" onChange={()=>{}} />
            <Button variant="primary">View recommendations</Button>
          </InlineStack>
        </InlineStack>

        {/* 6 Metric Cards */}
        <InlineGrid columns={{ xs: 2, sm: 3, md: 6 }} gap="400">
          <MetricCard title="Blog sessions" value="25,842" trend="24%" isUp={true} data={SPARK_UP} />
          <MetricCard title="Product clicks" value="3,642" trend="26%" isUp={true} data={SPARK_UP} />
          <MetricCard title="Add to carts" value="1,125" trend="32%" isUp={true} data={SPARK_UP} />
          <MetricCard title="Orders" value="328" trend="27%" isUp={true} data={SPARK_UP} />
          <MetricCard title="Revenue" value="$12,846" trend="33%" isUp={true} data={SPARK_UP} />
          <MetricCard title="Conversion rate from blog" value="1.27%" trend="0.6 pp" isUp={true} data={SPARK_UP} />
        </InlineGrid>

        {/* Middle Row: Funnel, Line Chart, Donut Chart */}
        <InlineGrid columns={{ xs: 1, md: "1fr 2fr 1fr" }} gap="400">
          {/* Funnel */}
          <Card padding="400">
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd" fontWeight="bold">Blog to purchase funnel</Text>
              <BlockStack gap="300">
                <FunnelStep label="Blog views" value="25,842" percentage="100%" bgWidth="100%" color="#C4E0FE" />
                <FunnelStep label="Product clicks" value="3,642" percentage="14.1%" bgWidth="80%" color="#D3E8FE" />
                <FunnelStep label="Add to cart" value="1,125" percentage="4.4%" bgWidth="60%" color="#E1EFFE" />
                <FunnelStep label="Checkout" value="562" percentage="2.2%" bgWidth="40%" color="#F0F7FF" />
                <FunnelStep label="Purchase" value="328" percentage="1.27%" bgWidth="20%" color="#F6FAFF" />
              </BlockStack>
              <Divider />
              <InlineStack align="space-between" blockAlign="center">
                <Text as="p" variant="headingSm" fontWeight="bold">Overall conversion rate</Text>
                <InlineStack gap="200" blockAlign="center">
                  <Text as="span" variant="headingSm" fontWeight="bold">1.27%</Text>
                  <InlineStack gap="025" blockAlign="center">
                    <Icon source={ArrowUpIcon} tone="success" />
                    <Text as="span" variant="bodySm" tone="success">0.6 pp</Text>
                  </InlineStack>
                </InlineStack>
              </InlineStack>
            </BlockStack>
          </Card>

          {/* Revenue Line Chart */}
          <Card padding="400">
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd" fontWeight="bold">Revenue over time</Text>
                <InlineStack gap="200">
                  <ButtonGroup variant="segmented">
                    <Button pressed>All sources</Button>
                    <Button>Organic search</Button>
                    <Button>Direct</Button>
                    <Button>Social</Button>
                  </ButtonGroup>
                  <Select label="" labelHidden options={[{label: "Daily", value: "daily"}]} value="daily" onChange={()=>{}} />
                </InlineStack>
              </InlineStack>
              <div style={{ height: '250px', width: '100%', marginTop: '16px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={REVENUE_DATA} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6D7175' }} dy={10} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6D7175' }} tickFormatter={(val) => `$${val/1000}K`} />
                    <RechartsTooltip />
                    <Line type="monotone" dataKey="current" stroke="#2C6ECB" strokeWidth={2} dot={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="previous" stroke="#2C6ECB" strokeDasharray="5 5" strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <InlineStack align="center" gap="400">
                <InlineStack gap="100" blockAlign="center">
                  <div style={{ width: '20px', height: '2px', backgroundColor: '#2C6ECB' }} />
                  <Text as="span" variant="bodySm" tone="subdued">May 1 – May 31, 2024</Text>
                </InlineStack>
                <InlineStack gap="100" blockAlign="center">
                  <div style={{ width: '20px', height: '2px', borderBottom: '2px dashed #2C6ECB' }} />
                  <Text as="span" variant="bodySm" tone="subdued">Apr 1 – Apr 30, 2024</Text>
                </InlineStack>
              </InlineStack>
            </BlockStack>
          </Card>

          {/* Traffic Source Donut */}
          <Card padding="400">
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd" fontWeight="bold">Traffic source breakdown</Text>
              <InlineStack align="space-between" blockAlign="center" wrap={false}>
                <div style={{ width: '150px', height: '150px', position: 'relative' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={PIE_DATA} innerRadius={50} outerRadius={70} paddingAngle={2} dataKey="value" stroke="none">
                        {PIE_DATA.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                    <Text as="p" variant="headingMd" fontWeight="bold">25,842</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Sessions</Text>
                  </div>
                </div>
                <BlockStack gap="200">
                  {PIE_DATA.map((item) => (
                    <InlineStack key={item.name} align="space-between" blockAlign="center" gap="300">
                      <InlineStack gap="100" blockAlign="center">
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: item.color }} />
                        <Text as="span" variant="bodySm">{item.name}</Text>
                      </InlineStack>
                      <Text as="span" variant="bodySm" fontWeight="bold">{item.value}%</Text>
                    </InlineStack>
                  ))}
                </BlockStack>
              </InlineStack>
            </BlockStack>
          </Card>
        </InlineGrid>

        {/* 4 Insight Cards */}
        <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
          <InsightCard iconTone="success" icon={CheckIcon} title="High engagement posts" desc={<>Your top posts have an avg. <b>CTR of 14.9%</b>, higher than your site average of <b>6.2%</b>.</>} buttonText="See top posts" />
          <InsightCard iconTone="warning" icon={CartIcon} title="Conversion opportunity" desc={<><b>1,125</b> add to carts from blog had no subsequent purchase.</>} buttonText="View abandoned carts" />
          <InsightCard iconTone="success" icon={ArrowUpIcon} title="Revenue driver" desc={<>Blog traffic generated <b>$12,846</b> in revenue, up 33% from last period.</>} buttonText="View revenue impact" />
          <InsightCard iconTone="magic" icon={MagicIcon} title="SEO opportunity" desc={<>12 posts rank on page 2. Optimizing could drive <b>2.1K</b> more sessions.</>} buttonText="See SEO opportunities" />
        </InlineGrid>

        {/* Bottom Row: Tables */}
        <InlineGrid columns={{ xs: 1, lg: "2fr 1fr" }} gap="400">
          {/* Top performing posts */}
          <Card padding="0">
            <Box padding="400" paddingBlockEnd="200">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd" fontWeight="bold">Top performing posts</Text>
                <Button variant="plain">View all</Button>
              </InlineStack>
            </Box>
            <IndexTable
              resourceName={{ singular: "post", plural: "posts" }}
              itemCount={TOP_POSTS.length}
              headings={[
                { title: "Post" },
                { title: "Sessions" },
                { title: "SEO score" },
                { title: "Product CTR" },
                { title: "Add to cart" },
                { title: "Orders" },
                { title: "Revenue" },
                { title: "Suggested action" },
              ]}
              selectable={false}
            >
              {TOP_POSTS.map((post, index) => (
                <IndexTable.Row id={`post-${index}`} key={index} position={index}>
                  <IndexTable.Cell>
                    <InlineStack gap="300" blockAlign="center" wrap={false}>
                      <Thumbnail source={post.img} alt={post.title} size="small" />
                      <Text as="span" variant="bodyMd" fontWeight="semibold" truncate>{post.title}</Text>
                    </InlineStack>
                  </IndexTable.Cell>
                  <IndexTable.Cell><Text as="span" variant="bodyMd">{post.sessions}</Text></IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text as="span" variant="bodyMd" tone={post.seo >= 80 ? "success" : "caution"} fontWeight="bold">{post.seo}</Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell><Text as="span" variant="bodyMd">{post.ctr}</Text></IndexTable.Cell>
                  <IndexTable.Cell><Text as="span" variant="bodyMd">{post.atc}</Text></IndexTable.Cell>
                  <IndexTable.Cell><Text as="span" variant="bodyMd">{post.orders}</Text></IndexTable.Cell>
                  <IndexTable.Cell><Text as="span" variant="bodyMd">{post.rev}</Text></IndexTable.Cell>
                  <IndexTable.Cell>
                    <Badge tone={post.action.includes("SEO") ? "warning" : post.action.includes("CTR") ? "info" : "success"}>
                      {post.action}
                    </Badge>
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
            <Box padding="300">
            </Box>
          </Card>

          {/* Top products */}
          <Card padding="400">
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd" fontWeight="bold">Top products clicked from blog</Text>
                <Button variant="plain">View all</Button>
              </InlineStack>
              <BlockStack gap="300">
                {TOP_PRODUCTS.map((product, index) => (
                  <InlineStack key={index} align="space-between" blockAlign="center" wrap={false}>
                    <InlineStack gap="300" blockAlign="center" wrap={false}>
                      <Thumbnail source={product.img} alt={product.title} size="small" />
                      <BlockStack gap="100">
                        <Text as="p" variant="bodyMd" fontWeight="semibold" truncate>{product.title}</Text>
                        <Text as="p" variant="bodySm" tone="subdued">{product.clicks} clicks • {product.rev} revenue</Text>
                      </BlockStack>
                    </InlineStack>
                  </InlineStack>
                ))}
              </BlockStack>
            </BlockStack>
          </Card>
        </InlineGrid>

      </BlockStack>
    </Page>
  );
}
