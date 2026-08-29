import { describe, expect, it } from "vitest";
import { formatActivityDateTime, formatDistanceKm } from "./ui-formatters";

describe("formatDistanceKm", () => {
  it("rounds aerobic and route totals to whole kilometres", () => {
    expect(formatDistanceKm(24.38)).toBe("24 km");
    expect(formatDistanceKm(24.6)).toBe("25 km");
    expect(formatDistanceKm(0)).toBe("0 km");
  });

  it("accepts finite numeric strings from API or form boundaries", () => {
    expect(formatDistanceKm("12.6")).toBe("13 km");
  });

  it.each([null, undefined, "", "not-a-distance", Number.NaN, Number.POSITIVE_INFINITY])(
    "renders unavailable input %s as an em dash",
    (value) => {
      expect(formatDistanceKm(value)).toBe("—");
    },
  );
});

describe("formatActivityDateTime", () => {
  it("displays the started instant in Athlete local time without seconds or timezone", () => {
    expect(formatActivityDateTime("2026-08-15T15:19:32.448Z", "Asia/Shanghai")).toBe(
      "2026-08-15 23:19",
    );
  });

  it("uses the requested timezone even when it changes the calendar date", () => {
    expect(formatActivityDateTime("2026-08-15T02:19:32.448Z", "America/Los_Angeles")).toBe(
      "2026-08-14 19:19",
    );
  });

  it.each([
    [null, "Asia/Shanghai"],
    ["", "Asia/Shanghai"],
    ["not-an-instant", "Asia/Shanghai"],
    ["2026-08-15T15:19:32.448Z", null],
    ["2026-08-15T15:19:32.448Z", ""],
    ["2026-08-15T15:19:32.448Z", "Invalid/Timezone"],
  ])("renders invalid value/timezone pair %s / %s as an em dash", (value, timezone) => {
    expect(formatActivityDateTime(value, timezone)).toBe("—");
  });
});
