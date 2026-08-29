# Interface type boundary

`tsconfig.interfaces.json` checks the maintained Agent API, MCP bridge, and
browser application with strict JavaScript checking. Shared Athlete, Plan,
Session, and Exercise values come from `src/types.js`; `types/interfaces.d.ts`
adds only interface-specific protocol, Archive, and browser response shapes.

The browser transport still returns unvalidated JSON because the private HTTP
routes do not yet publish runtime response validators. The stable `today`,
`plan`, and `session` values are typed as soon as they enter application state,
while the remaining `AppState` index signature and legacy/canonical
presentation helpers retain a deliberately broad dynamic boundary. Strict
checking therefore covers the interface surface but does not yet prove every UI
state field. The next type deepening should replace the open state root with
named UI slices, validate HTTP ingress, and isolate mixed-version rendering in a
`PresentationSession` adapter. Do not widen the boundary further or add a
file-level type-check suppression.

`types/interfaces.type-test.js` intentionally uses `@ts-expect-error` for one
invalid MCP input and one invalid UI response field. The type command therefore
fails if either boundary stops detecting its representative drift.
