import { afterEach, describe, expect, it, vi } from "vitest";
import { createNineRouterResponseError, getNineRouterGenerationOptions, getPublicNineRouterErrorMessage, isReasoningModel, readNineRouterJson } from "./nine-router.server";

afterEach(() => {
  delete process.env.NINE_ROUTER_REASONING_EFFORT;
  vi.restoreAllMocks();
});

describe("9Router model options", () => {
  it("uses a supported reasoning effort for GPT-5 and Codex models", () => {
    expect(isReasoningModel("codex/gpt-5.5")).toBe(true);
    expect(isReasoningModel("cx/gpt-5.3-codex")).toBe(true);
    expect(getNineRouterGenerationOptions("codex/gpt-5.5", 0.2)).toEqual({ reasoning_effort: "low" });
  });

  it("uses a configured supported reasoning effort", () => {
    process.env.NINE_ROUTER_REASONING_EFFORT = "high";
    expect(getNineRouterGenerationOptions("codex/gpt-5.5", 0.2)).toEqual({ reasoning_effort: "high" });
  });

  it("replaces an unsupported reasoning effort instead of sending it upstream", () => {
    process.env.NINE_ROUTER_REASONING_EFFORT = "minimal";
    expect(getNineRouterGenerationOptions("codex/gpt-5.5", 0.2)).toEqual({ reasoning_effort: "low" });
  });

  it("keeps temperature for non-reasoning models", () => {
    expect(isReasoningModel("kr/claude-sonnet-4.5")).toBe(false);
    expect(getNineRouterGenerationOptions("kr/claude-sonnet-4.5", 0.25)).toEqual({ temperature: 0.25 });
  });

  it("hides a 402 provider response from the public error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const upstreamBody = JSON.stringify({ error: { message: "private provider membership details" } });
    const error = await createNineRouterResponseError(new Response(upstreamBody, { status: 402 }), "SEO fixes");

    const message = getPublicNineRouterErrorMessage(error, "Fallback");

    expect(message).toBe("The selected AI model is temporarily unavailable. Please try again shortly.");
    expect(message).not.toContain("membership");
    expect(message).not.toContain("402");
  });

  it("uses a safe fallback for unexpected internal errors", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(getPublicNineRouterErrorMessage(new Error("sensitive parser detail"), "AI request failed."))
      .toBe("AI request failed.");
  });

  it("parses a JSON response with 9Router's trailing SSE done marker", async () => {
    const payload = { choices: [{ message: { content: "{\"ok\":true}" } }] };
    const response = new Response(`${JSON.stringify(payload)}data: [DONE]\n`, { status: 200 });

    await expect(readNineRouterJson(response)).resolves.toEqual(payload);
  });

  it("does not silently accept arbitrary trailing response data", async () => {
    const response = new Response('{"ok":true}unexpected', { status: 200 });

    await expect(readNineRouterJson(response)).rejects.toThrow();
  });
});
