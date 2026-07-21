import { describe, expect, it } from "vitest";
import {
  clampSettingNumber,
  cleanSettingText,
  pickSettingChoice,
} from "./settings-validation";

describe("settings validation", () => {
  it("accepts known choices and rejects unsupported values", () => {
    const formData = new FormData();
    formData.set("layout", "grid");
    expect(pickSettingChoice(formData, "layout", ["grid", "carousel"], "carousel")).toBe("grid");
    formData.set("layout", "unsafe");
    expect(pickSettingChoice(formData, "layout", ["grid", "carousel"], "carousel")).toBe("carousel");
  });

  it("trims and bounds text values", () => {
    expect(cleanSettingText("  View products  ", 8, "Fallback")).toBe("View pro");
    expect(cleanSettingText("   ", 20, "Fallback")).toBe("Fallback");
  });

  it("rounds and clamps numeric values", () => {
    expect(clampSettingNumber("8.7", 1, 12, 6)).toBe(9);
    expect(clampSettingNumber("99", 1, 12, 6)).toBe(12);
    expect(clampSettingNumber("invalid", 1, 12, 6)).toBe(6);
  });
});
