/**
 * Local recovery drafts for editors (posts, products, collections). While a
 * resource has unsaved changes, its fields are written to the browser's
 * localStorage, so a closed tab, crash or accidental navigation does not lose
 * work. Drafts never leave the browser.
 */

export const DRAFT_FIELDS = ["title", "handle", "excerpt", "body", "metaTitle", "metaDescription", "tags", "focusKeyword"] as const;
export type DraftField = (typeof DRAFT_FIELDS)[number];
/** Post editor fields. Other editors use their own string fields. */
export type DraftFields = Record<DraftField, string>;

export type EditorDraft<T extends Record<string, string> = DraftFields> = T & {
  savedAt: number;
  /** Shopify updatedAt of the version the draft started from. */
  baseUpdatedAt: string;
};

const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function draftKey(shop: string, resourceId: string) {
  return `sbs-editor-draft:${shop}:${resourceId || "new"}`;
}

export function readDraft<T extends Record<string, string> = DraftFields>(
  storage: StorageLike | undefined,
  key: string,
  now = Date.now(),
  fields: readonly string[] = DRAFT_FIELDS,
): EditorDraft<T> | null {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.savedAt !== "number" || now - parsed.savedAt > MAX_AGE_MS) {
      storage?.removeItem(key);
      return null;
    }
    const draft: Record<string, unknown> = { savedAt: parsed.savedAt, baseUpdatedAt: String(parsed.baseUpdatedAt || "") };
    for (const field of fields) draft[field] = typeof parsed[field] === "string" ? parsed[field] : "";
    return draft as EditorDraft<T>;
  } catch {
    return null;
  }
}

export function writeDraft(storage: StorageLike | undefined, key: string, fields: Record<string, string>, baseUpdatedAt: string, now = Date.now()) {
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
export function draftDiffers(draft: Record<string, unknown>, current: Record<string, string>) {
  return Object.keys(current).some((field) => String(draft[field] ?? "").trim() !== (current[field] || "").trim());
}
