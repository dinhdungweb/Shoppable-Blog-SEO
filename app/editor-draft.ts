/**
 * Local recovery drafts for the post editor. While a post has unsaved changes,
 * its fields are written to the browser's localStorage, so a closed tab, crash
 * or accidental navigation does not lose work. Drafts never leave the browser.
 */

export const DRAFT_FIELDS = ["title", "handle", "excerpt", "body", "metaTitle", "metaDescription", "tags", "focusKeyword"] as const;
export type DraftField = (typeof DRAFT_FIELDS)[number];
export type DraftFields = Record<DraftField, string>;

export type EditorDraft = DraftFields & {
  savedAt: number;
  /** Shopify updatedAt of the version the draft started from. */
  baseUpdatedAt: string;
};

const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function draftKey(shop: string, articleId: string) {
  return `sbs-editor-draft:${shop}:${articleId || "new"}`;
}

export function readDraft(storage: StorageLike | undefined, key: string, now = Date.now()): EditorDraft | null {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.savedAt !== "number" || now - parsed.savedAt > MAX_AGE_MS) {
      storage?.removeItem(key);
      return null;
    }
    const draft = { savedAt: parsed.savedAt, baseUpdatedAt: String(parsed.baseUpdatedAt || "") } as EditorDraft;
    for (const field of DRAFT_FIELDS) draft[field] = typeof parsed[field] === "string" ? parsed[field] : "";
    return draft;
  } catch {
    return null;
  }
}

export function writeDraft(storage: StorageLike | undefined, key: string, fields: DraftFields, baseUpdatedAt: string, now = Date.now()) {
  try {
    storage?.setItem(key, JSON.stringify({ ...fields, baseUpdatedAt, savedAt: now }));
    return true;
  } catch {
    // Storage full or blocked: recovery is best effort.
    return false;
  }
}

export function clearDraft(storage: StorageLike | undefined, key: string) {
  try {
    storage?.removeItem(key);
  } catch {
    // Ignore blocked storage.
  }
}

/** A draft is worth offering when it differs from what the editor shows now. */
export function draftDiffers(draft: EditorDraft, current: DraftFields) {
  return DRAFT_FIELDS.some((field) => (draft[field] || "").trim() !== (current[field] || "").trim());
}
