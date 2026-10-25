# Research Judge completion — first implementation

Version 0.7.14, 25 October 2026. This change extends Automatic Recovery S3 for
unfinished judging with the same locked panel. It does not regenerate RV sessions.

## Response validation

Research explicitly opts into `research-judge-aliases/v1`. Ordinary RV Sessions
retain their existing parser policy. The normalizer recognizes only:

| Alias | Canonical property |
| --- | --- |
| strong_matches | strongestMatches |
| major_misses_contradictions | majorMissesContradictions |
| confabulation_observations | confabulationObservations |
| concise_rationale | conciseRationale |

The normalizer changes property names, never scores or narrative values. A
canonical property together with its alias is rejected, including equal values.
Unknown names are not guessed. Missing or invalid scores and narrative values
remain failures. The complete score and session-language validators still run.
The existing bounded formatter handles invalid JSON syntax; this implementation
does not ask a formatter to invent missing fields or repair substantive scores.

Raw responses remain in the receipt journal and response events. A successful
local parse records `RESEARCH_JUDGE_NORMALIZED`, the normalizer version, aliases,
slot identity and SHA-256 hashes of the source and normalized text. The audit event
is not itself a frozen score. A later language correction or freeze can still fail.

## Independent queue slots

Research validates frozen results by their original Judge index and locked route,
rather than by a contiguous prefix. An invalid response or exhausted classified
transport retry leaves that slot missing; independent slots continue, including
a second Judge using the same model route. Only complete assignments become
Judged. The project remains Judging while any required score is missing. All
scores must be frozen before ScoresFrozen, unblinding and final statistics.

STOP, ownership loss, persistence failures, malformed journals, changed request
fingerprints and configuration errors interrupt the entire operation. Such
failures are never converted to per-slot success or silently skipped.

## Completing missing scores

The existing Resume judging action is now labelled Complete missing scores
(PL: Dokończ brakujące). It processes retained responses before requesting
anything. In particular a historical alias-only validation block can now be
resolved without an API call. Freezing that slot supersedes its old block without
deleting the historical event.

When an existing bounded attempt is exhausted and local reprocessing still fails,
this explicit action may grant one new bounded attempt for that missing slot.
`RESEARCH_JUDGE_COMPLETION_AUTH_V1` records a unique completion ID, previous ID,
prior failure event ID, locked route and Judge index before dispatch. New receipts
carry that completion ID; original receipts and counters remain unchanged.
Authorization references must form a valid chain and point to a preceding failure
in the previous attempt. Each request ordinal keeps the existing single transport
retry limit. Formatter, output escalation and language correction keep their own
existing bounded ordinals. A restart uses the saved authorization, never grants
another automatically. Frozen slots are always skipped and never overwritten.

No configuration-recheck button or automatic model substitution is added.

## Partial results and export

The project displays anonymous sessions, received/expected scores, fully judged
and partially judged session counts, preserved narratives and missing-slot reasons.
It does not show conditions, a condition ranking or incomplete final statistics.
The partial export includes `partial_results/scores.json` and `scores.csv`, marked
as partial. The full records, raw events and blinding key remain under
`private_master`; `external_evaluation` contains the anonymous Judge packets.
Do not share the private folder with Judges. Export does not unblind or finalize
the project.

## Boundaries and follow-up

No migration, Rust change, sampling change, token budget change or protocol change
is required. Telepathy, ordinary RV and classic Training keep their policies.
The existing End marker remains authoritative. This implementation cannot reopen
an ended execution. The subsequent [separate evaluation panels](RESEARCH_EVALUATION_PANELS_EN.md)
provide a new operation for saved sessions, with the same or different Judges,
while preserving the original End marker and score-panel identities.

The regression fixtures reproduce the documented alias pattern. They do not
contain the user's complete original export. Synthetic 48-session/two-Judge tests,
mounted PL/EN screens and real file-backed SQLite reconnect tests cover queue
continuation and bounded completion. Windows installers, Cargo/Clippy and live
provider acceptance must be verified separately.
