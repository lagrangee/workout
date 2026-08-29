import test from "node:test";
import assert from "node:assert/strict";
// Supported Node releases strip erasable TypeScript syntax, so test:interfaces
// exercises the same source module as Vitest instead of a generated or legacy copy.
import { formatActivityDateTime, formatDistanceKm } from "../web/src/lib/ui-formatters.ts";

test("distance display rounds aerobic and route totals to whole kilometres", () => {
  assert.equal(formatDistanceKm(24.38), "24 km");
  assert.equal(formatDistanceKm(24.6), "25 km");
  assert.equal(formatDistanceKm(null), "—");
});

test("activity time displays the started instant in Athlete local time without seconds or timezone", () => {
  assert.equal(formatActivityDateTime("2026-08-15T15:19:32.448Z", "Asia/Shanghai"), "2026-08-15 23:19");
  assert.equal(formatActivityDateTime(null, "Asia/Shanghai"), "—");
});
