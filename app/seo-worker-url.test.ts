import { describe, expect, it } from "vitest";
import { resolveSeoWorkerUrl } from "./seo-worker-url";

describe("SEO worker URL", () => {
  it("posts to the worker route on the configured origin", () => {
    expect(resolveSeoWorkerUrl({ SEO_WORKER_URL: "http://127.0.0.1:3004" })).toBe("http://127.0.0.1:3004/api/seo-worker");
  });

  it("still works with the old Remix data URL in SEO_WORKER_URL", () => {
    expect(resolveSeoWorkerUrl({ SEO_WORKER_URL: "http://127.0.0.1:3004/app/seo?_data=routes%2Fapp.seo" })).toBe("http://127.0.0.1:3004/api/seo-worker");
  });

  it("uses the public app URL when no worker endpoint is configured", () => {
    expect(resolveSeoWorkerUrl({ SHOPIFY_APP_URL: "shop.example" })).toBe("https://shop.example/api/seo-worker");
    expect(resolveSeoWorkerUrl({})).toBe("http://127.0.0.1:3004/api/seo-worker");
  });
});
