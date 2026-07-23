import { afterEach, describe, expect, it, vi } from "vitest";
import { isAiSelectionTask, rewriteAiSelection } from "./ai-selection.server";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.NINE_ROUTER_BASE_URL;
  delete process.env.NINE_ROUTER_API_KEY;
  delete process.env.NINE_ROUTER_MODEL;
});

describe("selected-text AI editor", () => {
  it("recognizes supported tasks", () => {
    expect(isAiSelectionTask("improve")).toBe(true);
    expect(isAiSelectionTask("custom")).toBe(true);
    expect(isAiSelectionTask("translate")).toBe(false);
  });

  it("returns a safe rewrite and preserves selected links", async () => {
    configure();
    const fetchMock = vi.fn(async () => response({
      replacementHtml: '<p>Read the clearer <a href="/pages/guide">buying guide</a>.</p>',
      explanation: "Improves clarity.",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await rewriteAiSelection({
      task: "improve",
      selectionHtml: '<p>Read the <a href="/pages/guide">guide</a>.</p>',
      selectionText: "Read the guide.",
      articleContext: "<p>Article context.</p>",
      keywordContext: "buying guide",
      instruction: "",
    });

    expect(result.replacementHtml).toContain('href="/pages/guide"');
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(request.response_format.type).toBe("json_schema");
    expect(request.messages[1].content).toContain("buying guide");
  });

  it("rejects unsafe replacement markup", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn(async () => response({
      replacementHtml: "<p>Text</p><script>alert(1)</script>",
      explanation: "Changed text.",
    })));

    await expect(rewriteAiSelection(input("<p>Text</p>"))).rejects.toThrow("unsafe replacement markup");
  });

  it("rejects a rewrite that changes an existing link", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn(async () => response({
      replacementHtml: '<p>Read the <a href="https://other.example">guide</a>.</p>',
      explanation: "Changed text.",
    })));

    await expect(rewriteAiSelection(input('<p>Read the <a href="/pages/guide">guide</a>.</p>')))
      .rejects.toThrow("preserve the selected links");
  });
});

function configure() {
  process.env.NINE_ROUTER_BASE_URL = "http://127.0.0.1:20127/v1";
  process.env.NINE_ROUTER_API_KEY = "test-key";
  process.env.NINE_ROUTER_MODEL = "cx/test-model";
}

function response(content: Record<string, string>) {
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(content) } }],
  }), { status: 200 });
}

function input(selectionHtml: string) {
  return {
    task: "improve" as const,
    selectionHtml,
    selectionText: "Read the guide.",
    articleContext: "<p>Article context.</p>",
    keywordContext: "buying guide",
    instruction: "",
  };
}
