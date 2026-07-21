export function pickSettingChoice(
  formData: FormData,
  key: string,
  allowed: readonly string[],
  fallback: string,
) {
  const value = String(formData.get(key) || "");
  return allowed.includes(value) ? value : fallback;
}

export function cleanSettingText(
  value: FormDataEntryValue | null,
  maxLength: number,
  fallback: string,
) {
  const normalized = String(value || "").trim().slice(0, maxLength);
  return normalized || fallback;
}

export function clampSettingNumber(
  value: FormDataEntryValue | null,
  min: number,
  max: number,
  fallback: number,
) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}
