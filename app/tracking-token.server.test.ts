import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTrackingToken, verifyTrackingToken } from "./tracking-token.server";

describe("tracking tokens", () => {
  const previousSecret = process.env.SHOPIFY_API_SECRET;

  beforeEach(() => {
    process.env.SHOPIFY_API_SECRET = "test-secret";
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env.SHOPIFY_API_SECRET = previousSecret;
  });

  it("round-trips a tenant-scoped payload", () => {
    const payload = {
      shop: "demo.myshopify.com",
      articleId: "gid://shopify/Article/1",
      productId: "gid://shopify/Product/2",
      blockId: "default",
    };
    expect(verifyTrackingToken(createTrackingToken(payload))).toMatchObject(payload);
  });

  it("rejects a tampered payload or signature", () => {
    const token = createTrackingToken({
      shop: "demo.myshopify.com",
      articleId: "gid://shopify/Article/1",
      productId: "gid://shopify/Product/2",
      blockId: "default",
    });
    expect(verifyTrackingToken(`${token.slice(0, -1)}x`)).toBeNull();
    expect(verifyTrackingToken("not-a-token")).toBeNull();
  });

  it("matches the Web Pixel seven-day attribution window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-22T00:00:00.000Z"));
    const token = createTrackingToken({
      shop: "demo.myshopify.com",
      articleId: "gid://shopify/Article/1",
      productId: "gid://shopify/Product/2",
      blockId: "default",
    });

    vi.setSystemTime(new Date("2026-07-28T23:59:59.000Z"));
    expect(verifyTrackingToken(token)).not.toBeNull();

    vi.setSystemTime(new Date("2026-07-29T00:00:01.000Z"));
    expect(verifyTrackingToken(token)).toBeNull();
  });
});
