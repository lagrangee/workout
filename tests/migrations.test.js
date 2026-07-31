import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const migration = readFileSync(new URL("../migrations/0004_restore_session_date_guard.sql", import.meta.url), "utf8");

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
