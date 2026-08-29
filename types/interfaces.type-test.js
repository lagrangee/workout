// @ts-check

import { WorkoutApiClient } from "../mcp/bridge.mjs";

/** @type {import("./interfaces.js").TodayResponse} */
const today = {
  date: "2026-08-29",
  timezone: "Asia/Shanghai",
  entry: null,
  session: null,
};

// @ts-expect-error UI code must not read fields outside the typed Today response.
void today.missing_response_field;

const client = new WorkoutApiClient({ origin: "https://workout.example", token: "x".repeat(40) });
// @ts-expect-error MCP schedule inputs require local-date strings.
void client.getSchedule({ from: 20260829, to: "2026-08-30" });
