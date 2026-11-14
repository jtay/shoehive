# Architecture Decision Records

An ADR records one architectural decision for Shoehive: the context, the decision,
and what it costs us. New ADRs are proposed through a pull request that copies
[`template.md`](./template.md) to the next free number (`NNNN-short-title.md`) with
status **Proposed**. The ADR becomes **Accepted** when that PR is approved and merged.
Once an ADR is Accepted, its Decision section is never edited. Typos, broken links
and clarifying notes are fine; changing what was decided is not. To change a decision,
write a new ADR that supersedes the old one, then mark the old one **Superseded** with
a link to its replacement. That way the history of why Shoehive works the way it does
stays readable. RFC 0001 is the source of truth these ADRs were written against; where
an ADR settles a detail the RFC left open, it says so.

| #                                                     | Title                                                | Status   |
| ----------------------------------------------------- | ---------------------------------------------------- | -------- |
| [0001](./0001-game-model-state-machine.md)            | Games as typed deterministic state machines          | Accepted |
| [0002](./0002-single-package-subpath-exports.md)      | One `shoehive` package with subpath exports          | Accepted |
| [0003](./0003-per-viewer-views-json-patch-sync.md)    | Per-viewer views and JSON Patch sync                 | Accepted |
| [0004](./0004-standard-schema-validation.md)          | Standard Schema validation for inputs and options    | Accepted |
| [0005](./0005-mutative-drafts.md)                     | Mutative drafts with atomic commit                   | Accepted |
| [0006](./0006-seeded-rng-recorded-clock-replay.md)    | Seeded RNG, recorded clock and exact replay          | Accepted |
| [0007](./0007-wallet-ledger-semantics.md)             | Wallet ledger semantics                              | Proposed |
| [0008](./0008-turns-and-rounds.md)                    | Turns and rounds                                     | Accepted |
| [0009](./0009-store-snapshot-log-restart-recovery.md) | Store interface, snapshot plus log, restart recovery | Accepted |
| [0010](./0010-guest-identity-resume-tokens.md)        | Guest identity and resume tokens                     | Accepted |
| [0011](./0011-devtools-security-model.md)             | Devtools security model                              | Accepted |

Statuses:

- **Proposed**: under review, or waiting on a stakeholder decision named in its Open questions.
- **Accepted**: in force. Code must follow it.
- **Superseded**: replaced by a later ADR, which it links to. Kept for history.
