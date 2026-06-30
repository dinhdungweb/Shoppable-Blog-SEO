import { authenticate } from "./app/shopify.server";

// We can't easily run a script with authenticate.admin outside of a Remix request.
// But we can query the GraphQL API using the access token from the DB.

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function run() {
  const shop = "test-data.myshopify.com"; // I need the actual shop domain. I will get it from the DB.
  const sessions = await prisma.session.findMany();
  let validSession = null;
  for (const session of sessions) {
    if (session.accessToken) {
      const test = await fetch(`https://${session.shop}/admin/api/2024-07/shop.json`, {
        headers: { "X-Shopify-Access-Token": session.accessToken }
      });
      if (test.ok) {
        validSession = session;
        break;
      }
    }
  }
  
  if (!validSession) {
    console.log("No valid session");
    return;
  }
  
  const session = validSession;

  const response = await fetch(`https://${session.shop}/admin/api/2024-07/themes.json`, {
    headers: {
      "X-Shopify-Access-Token": session.accessToken,
    }
  });
  const data = await response.json();
  console.log("Themes data:", data);
  const mainTheme = data.themes?.find((t: any) => t.role === "main");
  if (!mainTheme) {
    console.log("No main theme");
    return;
  }

  const assetResponse = await fetch(`https://${session.shop}/admin/api/2024-07/themes/${mainTheme.id}/assets.json?asset[key]=config/settings_data.json`, {
    headers: {
      "X-Shopify-Access-Token": session.accessToken,
    }
  });
  const assetData = await assetResponse.json();
  const settingsData = JSON.parse(assetData.asset.value);
  
  const blocks = settingsData?.current?.blocks || {};
  for (const blockId in blocks) {
    const block = blocks[blockId];
    if (block.type && block.type.includes("sbs-article-embed")) {
      console.log("Found block:", blockId, block);
    }
  }
}

run();
