# Store Full Weekly-Template Snapshots in Plan Revisions

Status: superseded by [ADR 0004](0004-store-date-canonical-planned-days.md).

Each confirmed Plan Revision stores one complete Monday-through-Sunday Weekly Template. The original decision treated that template as repeating until superseded. ADR 0004 retains the immutable full snapshot as prescription provenance but replaces repetition-at-read-time with finite dated Planned Day writes.
