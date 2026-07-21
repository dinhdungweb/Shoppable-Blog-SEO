import { describe, expect, it } from "vitest";
import { resolveSeoWorkerUrl } from "./seo-worker-url";

describe("SEO worker URL", () => {
  it("adds the Remix data route to a configured endpoint", () => {
    expect(resolveSeoWorkerUrl({ SEO_WORKER_URL: "http://127.0.0.1:3004/app/seo" }))
      .toBe("http://127.0.0.1:3004/app/seo?_data=routes%2Fapp.seo");
  });

  it("uses the public app URL when no worker endpoint is configured", () => {
    expect(resolveSeoWorkerUrl({ SHOPIFY_APP_URL: "https://shop.example" }))
      .toBe("https://shop.example/app/seo?_data=routes%2Fapp.seo");
  });
});
