import { describe, expect, it } from "vitest";
import { clearDraft, draftDiffers, draftKey, readDraft, writeDraft, type DraftFields } from "./editor-draft";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    data,
  };
}

const fields: DraftFields = { title: "Trail shoes", handle: "trail-shoes", excerpt: "", body: "<p>Draft</p>", metaTitle: "", metaDescription: "", tags: "", focusKeyword: "" };

describe("editor drafts", () => {
  it("round-trips a draft per shop and article", () => {
    const storage = memoryStorage();
    const key = draftKey("shop.myshopify.com", "gid://shopify/Article/1");
    expect(writeDraft(storage, key, fields, "2026-11-01T00:00:00Z", 1000)).toBe(true);
    expect(readDraft(storage, key, 2000)).toMatchObject({ ...fields, savedAt: 1000, baseUpdatedAt: "2026-11-01T00:00:00Z" });
    expect(draftKey("shop.myshopify.com", "")).toBe("sbs-editor-draft:shop.myshopify.com:new");
  });

  it("expires old drafts and survives corrupt or blocked storage", () => {
    const storage = memoryStorage();
    writeDraft(storage, "k", fields, "", 0);
    expect(readDraft(storage, "k", 15 * 24 * 60 * 60 * 1000)).toBeNull();
    expect(storage.data.has("k")).toBe(false);
    storage.setItem("bad", "{not json");
    expect(readDraft(storage, "bad")).toBeNull();
    const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
    expect(readDraft(blocked, "k")).toBeNull();
    expect(writeDraft(blocked, "k", fields, "")).toBe(false);
    expect(() => clearDraft(blocked, "k")).not.toThrow();
  });

  it("only offers drafts that differ from the editor", () => {
    const storage = memoryStorage();
    writeDraft(storage, "k", fields, "", 1);
    const draft = readDraft(storage, "k", 2)!;
    expect(draftDiffers(draft, fields)).toBe(false);
    expect(draftDiffers(draft, { ...fields, body: "<p>Saved</p>" })).toBe(true);
  });
});
