import { describe, expect, test } from "vitest";

import {
  canonicalDurationSeconds,
  displayCompletionItems,
  displayItemDone,
  focusTarget,
  formatElapsed,
  recordWithCompletedItem,
  sessionRecordFromDetail,
} from "./session-model";
import type {
  CompletionItem,
  SessionCompletionResult,
  SessionDetail,
} from "./session-types";

const startedAt = "2026-08-29T04:00:00.000Z";

function detailWith(
  items: CompletionItem[],
  options: {
    schemaVersion?: number;
    results?: SessionCompletionResult[];
    executionMode?: "none" | "alternating";
  } = {},
): SessionDetail {
  const sets = items.map((item, index) => ({
    set_key: item.set_key,
    ordinal: index + 1,
    target: item.target,
    resistance_mode: item.resistance_mode,
    resistance_kg: item.resistance_kg,
    resistance: item.resistance,
    rest_after_sec: item.rest_after_sec ?? 60,
  }));
  return {
    session_key: "session-1",
    status: "in_progress",
    snapshot: {
      schema_version: options.schemaVersion,
      title: "Session model fixture",
      blocks: [{
        block_key: "block-1",
        title: "主训练",
        exercises: [{
          exercise_occurrence_key: "exercise-1",
          exercise_key: "exercise",
          name: "测试动作",
          execution_mode: options.executionMode ?? "none",
          sets,
        }],
      }],
      completion_items: items,
      exercise_occurrence_keys: ["exercise-1"],
    },
    completion_results: options.results ?? [],
    training_intervals: [{ interval_key: "interval-1", started_at: startedAt, ended_at: null }],
    session_rpe: null,
    note: null,
    skip_reason: null,
    exercise_feedback: [],
  };
}

describe("Session model", () => {
  test("alternating left/right items form one display item and require both results", () => {
    const left: CompletionItem = {
      completion_item_key: "left",
      exercise_occurrence_key: "exercise-1",
      set_key: "set-1",
      side: "left",
      target: { metric: "reps", value: 8 },
    };
    const right: CompletionItem = { ...left, completion_item_key: "right", side: "right" };
    const detail = detailWith([left, right], { executionMode: "alternating" });

    const display = displayCompletionItems(detail);
    expect(display).toHaveLength(1);
    expect(display[0]).toMatchObject({
      side: "alternating",
      alternating: true,
      completion_item_keys: ["left", "right"],
    });
    expect(displayItemDone(detail, display[0])).toBe(false);

    detail.completion_results = [
      { completion_item_key: "left", status: "completed" },
    ];
    expect(displayItemDone(detail, display[0])).toBe(false);

    detail.completion_results = [
      { completion_item_key: "left", status: "completed" },
      { completion_item_key: "right", status: "completed" },
    ];
    expect(displayItemDone(detail, display[0])).toBe(true);
  });

  test("canonical alternating completion writes both set results with nullable external load", () => {
    const left: CompletionItem = {
      completion_item_key: "left",
      exercise_occurrence_key: "exercise-1",
      set_key: "set-1",
      set_id: "set-1",
      side: "left",
      target: { metric: "reps", value: 8 },
      resistance_mode: "external_load",
      resistance_kg: null,
    };
    const right: CompletionItem = { ...left, completion_item_key: "right", side: "right" };
    const detail = detailWith([left, right], { schemaVersion: 2, executionMode: "alternating" });
    const display = displayCompletionItems(detail)[0];

    const record = recordWithCompletedItem(detail, display, {
      actualValue: 8,
      completedAt: "2026-08-29T04:00:08.000Z",
    });

    expect(record.record_schema_version).toBe(2);
    if (record.record_schema_version !== 2) throw new Error("expected canonical record");
    expect(record.set_results).toEqual([
      {
        completion_item_key: "left",
        status: "completed",
        actual: { metric: "reps", value: 8 },
        resistance: null,
        rir: null,
        note: null,
        completed_at: "2026-08-29T04:00:08.000Z",
      },
      {
        completion_item_key: "right",
        status: "completed",
        actual: { metric: "reps", value: 8 },
        resistance: null,
        rir: null,
        note: null,
        completed_at: "2026-08-29T04:00:08.000Z",
      },
    ]);
  });

  test("legacy completion preserves its legacy record and resistance shape", () => {
    const item: CompletionItem = {
      completion_item_key: "legacy-item",
      exercise_occurrence_key: "exercise-1",
      set_key: "legacy-set",
      side: "none",
      target: { metric: "reps", min: 6, max: 8 },
      resistance: { mode: "external_weight", load_kg: 12, quantity: 1 },
    };
    const detail = detailWith([item], { schemaVersion: 1 });

    const record = recordWithCompletedItem(detail, item, {
      actualValue: "7",
      resistanceLoad: "15",
      rir: "2",
      completedAt: "2026-08-29T04:00:07.000Z",
    });

    expect(record).toEqual({
      record_schema_version: 1,
      completion_results: [{
        completion_item_key: "legacy-item",
        completed: true,
        actual: { metric: "reps", value: 7 },
        resistance: { mode: "external_weight", load_kg: 15, quantity: 1 },
        rir: 2,
        completed_at: "2026-08-29T04:00:07.000Z",
      }],
      training_intervals: [{ interval_key: "interval-1", started_at: startedAt, ended_at: null }],
      session_rpe: null,
      note: null,
      exercise_feedback: [],
      skip_reason: null,
    });
    expect("set_results" in record).toBe(false);
  });

  test("canonical stored results keep the exact v2 write shape", () => {
    const item: CompletionItem = {
      completion_item_key: "canonical-item",
      exercise_occurrence_key: "exercise-1",
      set_key: "set-1",
      set_id: "set-1",
      side: "none",
      target: { metric: "reps", value: 6 },
      resistance_mode: "external_load",
      resistance_kg: 10,
    };
    const detail = detailWith([item], {
      schemaVersion: 2,
      results: [{
        completion_item_key: "canonical-item",
        status: "completed",
        actual: { metric: "reps", value: 6 },
        resistance: { mode: "external_load", value: 12, unit: "kg" },
        rir: 1,
        note: "稳定",
        completed_at: "2026-08-29T04:00:06.000Z",
      }],
    });

    const record = sessionRecordFromDetail(detail);

    expect(record).toEqual({
      record_schema_version: 2,
      set_results: [{
        completion_item_key: "canonical-item",
        status: "completed",
        actual: { metric: "reps", value: 6 },
        resistance: { mode: "external_load", value: 12, unit: "kg" },
        rir: 1,
        note: "稳定",
        completed_at: "2026-08-29T04:00:06.000Z",
      }],
      training_intervals: [{ interval_key: "interval-1", started_at: startedAt, ended_at: null }],
      session_rpe: null,
      note: null,
      exercise_feedback: [],
      skip_reason: null,
    });
    expect("completion_results" in record).toBe(false);
  });

  test("fixed duration uses the canonical value or legacy range maximum", () => {
    expect(canonicalDurationSeconds({ metric: "duration_sec", value: 40, min: 30, max: 60 })).toBe(40);
    expect(canonicalDurationSeconds({ metric: "duration_sec", min: 3, max: 5 })).toBe(5);
    expect(canonicalDurationSeconds({ metric: "duration_sec", min: 3 })).toBeNull();
    expect(canonicalDurationSeconds({ metric: "reps", value: 5 })).toBeNull();
    expect(focusTarget({ metric: "duration_sec", min: 3, max: 5 })).toBe("5 秒");
  });

  test("elapsed time sums closed intervals and freezes an open interval at the pause boundary", () => {
    const detail = {
      training_intervals: [
        {
          interval_key: "closed",
          started_at: "2026-08-29T04:00:00.000Z",
          ended_at: "2026-08-29T04:00:10.000Z",
        },
        {
          interval_key: "open",
          started_at: "2026-08-29T04:01:00.000Z",
          ended_at: null,
        },
      ],
    };

    expect(formatElapsed(detail, Date.parse("2026-08-29T04:01:25.000Z"))).toBe("00:35");
    expect(formatElapsed(detail, null, Date.parse("2026-08-29T04:02:05.000Z"))).toBe("01:15");
  });
});
