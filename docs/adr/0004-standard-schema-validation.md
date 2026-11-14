# ADR 0004: Standard Schema validation for inputs and options

|         |                                                                                    |
| ------- | ---------------------------------------------------------------------------------- |
| Status  | Accepted, 2026-11-14                                                               |
| Related | RFC 0001 sections 5.1, 6, 7 (Dependencies); audit findings 10, 11; ADRs 0001, 0006 |

## Context

0.x has no input validation: `seatIndex as number` is trusted straight off the socket
(finding 11), and inputs have no schemas (finding 10). Game authors already have a
favourite validator (zod, valibot, arktype), and forcing one on them would add a
dependency and a learning cost. The Standard Schema spec (`~standard` property, with
`validate()` and type-level `InferInput` / `InferOutput`) is implemented by all three,
so we can accept any of them without depending on any.

## Decision

1. **Where schemas appear.** `ActionDef.input` validates action input. `defineGame`'s
   `options` validates table options at `table.create` and `shoehive.tables.create`.
   Both accept any value with a valid `~standard` property, version 1.
2. **Zero dependencies.** We copy the Standard Schema v1 type definitions into
   `src/core/standard-schema.ts`, as the spec explicitly allows. `@standard-schema/spec`
   is not a dependency. No validator is a dependency, dev dependency of the published
   package, or peer.
3. **Validation runs before game code**, in this order for an `act` message:
   1. Message size cap and per-connection rate limit (RFC 0001 section 6).
   2. Protocol schema check of the envelope (`t`, `id`, `table`, `name`, `input`).
   3. Action lookup by name in the current phase (ADR 0001). Unknown or not in this phase: `ACTION_NOT_ALLOWED`.
   4. `input` schema `validate()`. Failure: `INVALID_INPUT` with the Standard Schema `issues`.
   5. Enqueue. Inside the queue: phase recheck, `once` and turn rules, then `run`.

   Steps 1 to 4 run outside the table's serial queue, so a flood of bad input cannot
   block a table. Step 3 runs again inside the queue because the phase may have changed.

4. **Output is what runs.** `run` receives the validator's output value, so transforms
   and defaults work (`z.coerce`, valibot `transform`). The log records the output, not
   the raw input (ADR 0006). Replay and recovery never re-run validators, so upgrading
   a validator cannot change a replay.
5. **Async schemas.** `validate()` may return a Promise. The engine awaits it with a
   1 second limit; exceeding it is `BAD_REQUEST` with `details.reason: 'timeout'`.
   Docs recommend synchronous schemas.
6. **No `input`** means the action takes no input. A message whose `input` is anything
   other than absent or `null` is `INVALID_INPUT`.
7. **Error shape.** Validation failures map to the closed enum code `INVALID_INPUT` with
   issues normalised from the spec:

```ts
interface ValidationErrorDetails {
  issues: Array<{ path: Array<string | number>; message: string }>;
}
// ack: { ok: false, error: { code: 'INVALID_INPUT', message: 'Invalid input for "place"', details } }
```

Path segments that are objects in the spec (`{ key }`) are flattened to their key.
At most 20 issues are sent.

8. **Types.** The client's `act(name, input)` uses `InferInput` of the schema. `run`
   uses `InferOutput`. Type tests (`expectTypeOf`) cover zod and valibot.
9. **No client-side validation in v1.** The client imports game definitions as types
   only (ADR 0002), so it has no schema objects at runtime. The server is the authority.
   An app that wants instant form feedback can import its schema separately.
10. **Internal actions** (`internal: true`, called by timers) are validated too when
    they declare `input`, and their schemas must be synchronous. A timer scheduled with invalid input throws at
    `ctx.timers.after` time, inside the scheduling entry, so the bug rolls back where it
    was introduced.

## Consequences

### Positive

- Authors keep their validator. Switching from zod to valibot changes imports only.
- Bad input never reaches `run`, which is where 0.x crashed or misbehaved.
- Recorded outputs make replay independent of validator versions.
- Structured issues give clients usable error messages.

### Negative

- We maintain a copy of the spec's types. It is small and versioned (v1); a v2 would
  need a new ADR.
- Validator error message quality varies by library, and we pass it through.
- Validation outside the queue means validators must be pure. A validator that reads
  table state is not supported (and could not get it anyway).

## Alternatives considered

### Bundle zod as the one validator

Simplest docs. Rejected: it forces a dependency and a bundle size cost on everyone (RFC 0001 section 7
keeps core free of dependencies besides Mutative) and excludes valibot users who chose it
for size.

### Our own mini schema DSL

Full control and zero deps. Rejected: every author would learn yet another validator,
and we would own a validator's bug surface forever.

### JSON Schema

Language-neutral and serializable. Rejected for v1: TypeScript inference from JSON
Schema is weak without codegen or heavy type gymnastics, contradicting "types inferred
from `defineGame`, no codegen". Standard Schema libraries that emit JSON Schema remain
usable for docs generation.

### Validate inside the queue only

One code path. Rejected because invalid floods would hold the table queue.
