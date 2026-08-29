-- A unique owner is written by the Athlete state compare-and-swap. Every
-- derived write in the same D1 batch checks this value, so a stale save cannot
-- update canonical projections or capability lookup indexes.
ALTER TABLE athlete_state ADD COLUMN mutation_owner TEXT;
