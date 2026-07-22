import { afterEach, describe, expect, it } from "vitest";
import { getNineRouterGenerationOptions, isReasoningModel } from "./nine-router.server";

afterEach(() => {
  delete process.env.NINE_ROUTER_REASONING_EFFORT;
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
});
