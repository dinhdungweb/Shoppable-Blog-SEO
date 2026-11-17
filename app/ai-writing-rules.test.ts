import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONTENT_STRUCTURE,
  injectAiWritingRules,
  normalizeAiWritingRules,
  parseForbiddenWords,
  renderMetaTemplate,
} from "./ai-writing-rules";

describe("parseForbiddenWords", () => {
  it("splits on commas, semicolons and new lines, trims and de-duplicates case-insensitively", () => {
    expect(parseForbiddenWords("cheap, Cheap;\n best ever ,,  guaranteed\n")).toEqual(["cheap", "best ever", "guaranteed"]);
  });

  it("caps the list length", () => {
    expect(parseForbiddenWords(Array.from({ length: 80 }, (_, index) => `w${index}`).join(","))).toHaveLength(50);
  });
});

describe("normalizeAiWritingRules", () => {
  it("falls back to safe defaults", () => {
    expect(normalizeAiWritingRules({ language: "Klingon", brandTone: "Shouty", forbiddenWords: "", defaultContentStructure: " " })).toEqual({
      language: "English",
      brandTone: "Professional",
      forbiddenWords: [],
      contentStructure: DEFAULT_CONTENT_STRUCTURE,
    });
  });
});

describe("injectAiWritingRules", () => {
  const rules = { language: "Vietnamese", brandTone: "Friendly", forbiddenWords: ["cheap"], contentStructure: "Intro, Steps, FAQ" };

  it("appends rules to the existing system message", () => {
    const body = JSON.stringify({ model: "m", messages: [{ role: "system", content: "Return JSON." }, { role: "user", content: "Hi" }] });
    const result = JSON.parse(injectAiWritingRules(body, rules) as string);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].content).toMatch(/^Return JSON\.\n\nMerchant writing rules/);
    expect(result.messages[0].content).toContain('Never use these words or phrases: "cheap".');
    expect(result.messages[0].content).toContain("Brand tone: Friendly.");
    expect(result.messages[0].content).toContain("write new content in Vietnamese");
    expect(result.messages[1]).toEqual({ role: "user", content: "Hi" });
  });

  it("prepends a system message when none exists", () => {
    const body = JSON.stringify({ messages: [{ role: "user", content: "Hi" }] });
    const result = JSON.parse(injectAiWritingRules(body, rules) as string);
    expect(result.messages[0].role).toBe("system");
    expect(result.messages[1].content).toBe("Hi");
  });

  it("leaves non-chat bodies and missing rules untouched", () => {
    expect(injectAiWritingRules("not json", rules)).toBe("not json");
    expect(injectAiWritingRules(JSON.stringify({ a: 1 }), rules)).toBe('{"a":1}');
    const body = JSON.stringify({ messages: [] });
    expect(injectAiWritingRules(body, undefined)).toBe(body);
  });
});

describe("renderMetaTemplate", () => {
  it("fills every token", () => {
    expect(renderMetaTemplate("{{title}} - {{blog}} | {{store}}", { title: "Trail shoes", blog: "Guides", store: "Peak" })).toBe("Trail shoes - Guides | Peak");
  });

  it("drops empty tokens together with their separator", () => {
    expect(renderMetaTemplate("{{title}} - {{blog}} | {{store}}", { title: "Trail shoes", store: "Peak" })).toBe("Trail shoes | Peak");
    expect(renderMetaTemplate("{{blog}}: {{title}}", { title: "Trail shoes" })).toBe("Trail shoes");
  });

  it("keeps literal text", () => {
    expect(renderMetaTemplate("Read: {{excerpt}}", { excerpt: "  How to   pick shoes. " })).toBe("Read: How to pick shoes.");
  });
});
