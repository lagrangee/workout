import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const migration = readFileSync(new URL("../migrations/0004_restore_session_date_guard.sql", import.meta.url), "utf8");
const initialMigration = readFileSync(new URL("../migrations/0001_initial.sql", import.meta.url), "utf8");
const agentTokenMigration = readFileSync(new URL("../migrations/0005_agent_token_lookup.sql", import.meta.url), "utf8");
const canonicalPlanMigration = readFileSync(new URL("../migrations/0006_canonical_plan_records.sql", import.meta.url), "utf8");
const routeRecordingMigration = readFileSync(new URL("../migrations/0010_plan_recording_intent.sql", import.meta.url), "utf8");

test("ticket 24 migration restores an idempotent per-Athlete date guard", () => {
  const db = new DatabaseSync(":memory:");

  try {
    db.exec(migration);
    db.exec(migration);

    const insert = db.prepare("INSERT INTO session_date_guard (athlete_key, scheduled_date, session_key) VALUES (?, ?, ?)");
    insert.run("athlete-a", "2026-08-03", "session-a");
    insert.run("athlete-b", "2026-08-03", "session-b");

    assert.throws(
      () => insert.run("athlete-a", "2026-08-03", "session-a-retry"),
      /constraint/i,
      "one Athlete cannot have two Sessions on the same scheduled date"
    );
    assert.throws(
      () => insert.run("athlete-c", "2026-08-04", "session-a"),
      /constraint/i,
      "one Session key cannot be reused across dates or Athletes"
    );

    const indexes = db.prepare("PRAGMA index_list('session_date_guard')").all();
    assert.ok(indexes.some((index) => index.name === "idx_session_guard_date"));
  } finally {
    db.close();
  }
});

test("ticket 01 migration adds an idempotent Agent Token lookup boundary", () => {
  const db = new DatabaseSync(":memory:");

  try {
    db.exec(initialMigration);
    db.exec(agentTokenMigration);
    db.exec(agentTokenMigration);
    db.prepare("INSERT INTO athlete_state (athlete_key, email, state_json, updated_at) VALUES (?, ?, ?, ?)").run("athlete-a", "a@example.invalid", "{}", "2026-08-07T00:00:00.000Z");
    const insert = db.prepare("INSERT INTO agent_token_lookup (token_digest, athlete_key, revoked_at, updated_at) VALUES (?, ?, ?, ?)");
    insert.run("digest-a", "athlete-a", null, "2026-08-07T00:00:00.000Z");
    assert.throws(() => insert.run("digest-a", "athlete-a", null, "2026-08-07T00:00:00.000Z"), /constraint/i);
    const row = db.prepare("SELECT revoked_at FROM agent_token_lookup WHERE token_digest = ?").get("digest-a");
    assert.ok(row);
    assert.equal(row.revoked_at, null);
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'agent_token_lookup'").get());
  } finally {
    db.close();
  }
});

test("plan recording intent migration adds nullable COROS route columns", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(initialMigration);
    db.exec(canonicalPlanMigration);
    db.exec(routeRecordingMigration);
    const columns = db.prepare("PRAGMA table_info('plan_slots')").all().map((column) => column.name);
    assert.ok(columns.includes("recording_source"));
    assert.ok(columns.includes("recording_sport_type"));
    assert.ok(columns.includes("recording_route_key"));
  } finally {
    db.close();
  }
});
