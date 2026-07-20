import { describe, expect, it } from "vitest";
import { CHANGELOG_RELEASES } from "./changelog";

describe("merchant changelog", () => {
  it("keeps releases newest first with unique versions", () => {
    const dates = CHANGELOG_RELEASES.map((release) => release.date);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(new Set(CHANGELOG_RELEASES.map((release) => release.version)).size).toBe(CHANGELOG_RELEASES.length);
  });

  it("publishes meaningful changes for every release", () => {
    expect(CHANGELOG_RELEASES.every((release) => release.title && release.summary && release.changes.length > 0)).toBe(true);
  });
});
