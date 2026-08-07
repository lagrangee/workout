---
name: workout-agent
description: Workout data and plan changes: use when the user asks to read training data, inspect a plan or completed sessions, analyze progress, review exercise history, or propose, validate, or apply a future plan change through the Workout MCP tools.
---

# Workout Agent

Use the typed Workout MCP tools as the data boundary. Keep the read path
bounded and evidence-led; let the Agent choose the analysis structure, tone,
and recommendation style for the question.

## Process

1. **Scope the request.** Choose the smallest resource that answers the
   question. Use `workout_get_overview` for a bounded orientation,
   `workout_get_plan` for prescribed templates, `workout_get_schedule` for an
   explicit date window, `workout_list_sessions` for history indexes,
   `workout_get_session` for one complete record, `workout_get_progress` for
   metric evidence, and `workout_get_exercise_history` for movement-level
   trends. Use the bounded defaults for overview, progress, and exercise
   history; use `all` only when the user asks for full history. Completion:
   the request has one selected typed read tool and every required date or
   identity argument is known.

2. **Read a bounded slice.** Give `workout_get_schedule` an explicit
   inclusive date range in the Athlete's local timezone. Give
   `workout_list_sessions` a bounded `limit`; carry an opaque cursor forward
   only with the same filters. Request another page when the evidence needs
   it, and restart from page one when the response reports a
   `training_version` change. Completion: the returned records cover the
   requested slice, or the API has returned a structured boundary error.

3. **Keep evidence attached.** Preserve `data_as_of`, Athlete-local period or
   date context, `training_version` when present, `source_ref`, metric
   numerator/denominator/exclusions, and contributing Session references.
   Treat the returned values as the source for domain metrics and state the
   freshness or coverage limit when it affects the answer. Completion: every
   material claim can be traced to returned data and its safe provenance.

4. **Choose the analysis.** Present the evidence in the form that best fits
   the user's question. The integration supplies structured data and
   provenance; the Agent owns the analysis structure, tone, and
   recommendation style. Completion: the response format serves the question
   without turning a hypothesis into a recorded fact or hiding a coverage
   limit.

5. **Build a future change from the Current Plan.** When the user asks to
   change a future plan, read `workout_get_plan` first. Preserve existing
   values deliberately for unspecified slots and ask a clarifying question
   for any value required by a new or changed prescription. Construct a
   complete seven-day Plan Update Package using the canonical contract.
   Completion: a complete package exists, or the missing user decision is
   explicit and the flow remains at clarification.

6. **Validate before showing a proposal.** Call
   `workout_validate_plan_update` with the complete package. For a valid
   result, show the effective date, changed-slot summary, complete resulting
   week, and the returned package/base evidence. Treat validation as
   non-mutating. Completion: a valid preview and its digests are ready for
   user review, or the structured validation errors identify what must be
   repaired.

7. **Separate confirmation from application.** Show the validated preview
   before asking for confirmation. A separate, explicit confirmation that
   refers to that preview is the gate; then call `workout_apply_plan_update`
   with the exact validated package and base evidence, plus a fresh idempotency
   key.
   Completion: the user has either confirmed the exact preview or declined or
   changed it, in which case the package returns to validation.

8. **Verify the write.** After an application response, inspect its readback.
   Treat the change as verified only when the readback status is verified and
   the returned Current Plan and inclusive seven-day Schedule correspond to
   the applied effective date and package. A stale-plan response starts a new
   read-first cycle; a readback failure is reported as a readback failure and
   is never converted into an unverified success. Completion: the final
   report distinguishes applied, verified, and failed-readback states.

## Credential and error boundary

Use the local MCP configuration as the sole source of connection credentials.
Keep credentials out of chat, prompts, examples, logs, source references, and
analysis. When authentication or transport setup fails, report the local
configuration action required and continue without requesting the credential
value in conversation.

Route structured API errors by their meaning: ask for missing information on
invalid input, restart the read-first flow on stale state or a training
version change, and surface rate-limit or server failures with their stable
code. Read tools remain side-effect-free; plan application is the only write
branch in this skill.

## Canonical references

Load the canonical domain vocabulary when a term is unclear:
[`CONTEXT.md`](../../CONTEXT.md).

Load [`agent-api-v1.md`](../../docs/contracts/agent-api-v1.md) when a resource,
error, freshness, pagination, confirmation, or readback rule is unclear. Load
[`agent-api-wire-catalog-v1.md`](../../docs/contracts/agent-api-wire-catalog-v1.md)
when a response shape or provenance field is unclear. Load
[`plan-update-package-v1.md`](../../docs/contracts/plan-update-package-v1.md)
before constructing a package or interpreting a validation error. These
references are the single source of truth for wire and domain details; this
Skill routes the Agent to them without copying their schemas.
