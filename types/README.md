# Interface type boundary

`tsconfig.interfaces.json` checks the maintained Agent API, MCP bridge, and
browser application with strict JavaScript checking. Shared Athlete, Plan,
Session, and Exercise values come from `src/types.js`; `types/interfaces.d.ts`
adds only interface-specific protocol, Archive, and browser response shapes.

The browser transport still returns unvalidated JSON because the private HTTP
routes do not yet publish runtime response validators. The stable `today`,
`plan`, and `session` values are typed as soon as they enter application state,
while legacy/canonical presentation helpers retain explicit dynamic values for
their mixed-version rendering logic. Replace that narrow transport boundary
when private response schemas become executable validators; do not widen it or
add a file-level type-check suppression.

`types/interfaces.type-test.js` intentionally uses `@ts-expect-error` for one
invalid MCP input and one invalid UI response field. The type command therefore
fails if either boundary stops detecting its representative drift.
