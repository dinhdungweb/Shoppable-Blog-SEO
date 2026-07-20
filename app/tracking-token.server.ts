import { createHmac, timingSafeEqual } from "node:crypto";

export type TrackingTokenPayload = {
  shop: string;
  articleId: string;
  productId: string;
  blockId: string;
  exp: number;
};

const TOKEN_LIFETIME_SECONDS = 60 * 60 * 24;

function secret() {
  const value = process.env.SHOPIFY_API_SECRET;
  if (!value) throw new Error("SHOPIFY_API_SECRET is required for tracking tokens");
  return value;
}

function encode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function signature(encodedPayload: string) {
  return createHmac("sha256", secret()).update(encodedPayload).digest("base64url");
}

export function createTrackingToken(payload: Omit<TrackingTokenPayload, "exp">) {
  const encodedPayload = encode(JSON.stringify({
    ...payload,
    exp: Math.floor(Date.now() / 1000) + TOKEN_LIFETIME_SECONDS,
  }));
  return `${encodedPayload}.${signature(encodedPayload)}`;
}

export function verifyTrackingToken(token: unknown): TrackingTokenPayload | null {
  if (typeof token !== "string" || token.length > 2048) return null;
  const [encodedPayload, receivedSignature, extra] = token.split(".");
  if (!encodedPayload || !receivedSignature || extra) return null;

  const expectedSignature = signature(encodedPayload);
  const received = Buffer.from(receivedSignature);
  const expected = Buffer.from(expectedSignature);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    if (
      typeof payload.shop !== "string" ||
      typeof payload.articleId !== "string" ||
      typeof payload.productId !== "string" ||
      typeof payload.blockId !== "string" ||
      typeof payload.exp !== "number" ||
      payload.exp < Math.floor(Date.now() / 1000)
    ) return null;
    return payload;
  } catch {
    return null;
  }
}
