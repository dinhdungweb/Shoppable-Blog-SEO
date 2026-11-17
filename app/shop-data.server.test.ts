import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("purgeShopData", () => {
  it("erases every table that stores shop data (GDPR shop/redact)", () => {
    const schema = fs.readFileSync(path.join(__dirname, "../prisma/schema.prisma"), "utf8");
    const source = fs.readFileSync(path.join(__dirname, "shop-data.server.ts"), "utf8");
    const purge = source.slice(source.indexOf("export async function purgeShopData"), source.indexOf("export async function deactivateShop"));
    const shopModels = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)]
      .filter(([, , body]) => /^\s+shop\s+String/m.test(body))
      .map(([, name]) => name.charAt(0).toLowerCase() + name.slice(1));
    expect(shopModels.length).toBeGreaterThan(10);
    const missing = shopModels.filter((model) => !purge.includes(`prisma.${model}.deleteMany`));
    expect(missing).toEqual([]);
  });
});
