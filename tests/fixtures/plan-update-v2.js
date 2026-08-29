/**
 * A portable Plan Update Package v2 fixture shared by Server and MCP seam tests.
 * It intentionally exercises nullable resistance and decimal four-phase tempo.
 *
 * @param {string} effectiveFrom
 * @returns {any}
 */
export function portablePlanUpdateV2(effectiveFrom) {
  return {
    schema_version: 2,
    effective_from: effectiveFrom,
    week: {
      monday: {
        kind: "workout",
        title: "核心训练",
        start_time: "21:00",
        estimated_duration_min: 25,
        blocks: [{
          title: "主训练",
          exercises: [{
            occurrence_key: "dead_bug_main",
            exercise_id: "dead_bug",
            execution_mode: "alternating",
            sets: [{
              set_id: "dead_bug_set_1",
              ordinal: 1,
              target: { metric: "reps", value: 5 },
              resistance: null,
              tempo: "3.5-1-1.25-0",
              rest_after_sec: 45,
            }],
          }],
        }],
      },
      tuesday: null,
      wednesday: null,
      thursday: null,
      friday: null,
      saturday: null,
      sunday: null,
    },
  };
}
