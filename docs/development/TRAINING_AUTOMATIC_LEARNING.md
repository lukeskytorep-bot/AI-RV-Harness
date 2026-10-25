# Classic Training: automatic post-Reveal failures

Classic Training must continue without operator supervision when optional
post-Reveal learning fails. This policy is explicitly selected by
`trainingExecution.ts`; shared provider functions keep their default contracts
for other callers.

| Result | Training behavior |
| --- | --- |
| Valid Field Guide or Viewer Notes proposal | Apply the validated update or the model's explicit NO_CHANGE decision. |
| Two known invalid proposals | Record failed_preserved, retain the exact previous version or absence, continue. |
| Unconfirmed learning dispatch, including a saved reservation after restart | Record failed_preserved without another paid dispatch or a confirmation dialog, continue. |
| Historical pending learning operation without its attempt ledger | Preserve previous memory without resending the historical operation. |
| Provider failure, empty output, or an unresolved prior dispatch in optional Review | Record the unavailable Review in the Training checkpoint; preserve both learning objects without asking the model to learn from missing evidence; continue to Judge and the next target. |
| Stop, lost ownership, storage failure, corrupted snapshots or mismatched identities | Interrupt and retain completed work. Do not disguise these failures as model NO_CHANGE. |

The default `require_resolution` learning policy remains available for other
callers. Classic Training selects `preserve_and_continue` explicitly. It does
not authorize a duplicate request when the original request's outcome is unknown.
Known results retain the existing maximum of two requests per learning packet.
The output budgets are unchanged.

`prepareTrainingRunResume` does not prompt about post-Reveal operations.
Execution recovers their saved results or preserves memory automatically.
Blind-session resume still follows the blind evidence/retry contract.

The public Review entry point already acquires the native RV workflow. Under
this Training policy it uses that workflow's lifetime and fenced writes rather
than an additional JavaScript-renewed Review lease. The in-process guard still
rejects a second concurrent Review of the same session. Other Review callers
retain their existing lease behavior.

Field Guide update audits and Viewer Notes reflection runs remain durable and
visible through the existing AI Center histories. Training does not render
learning-warning lists or append failure counters to completed history cards.
Exports retain their existing evidence and learning records.

This behavior change does not fix or certify the separate native Windows
UD2/runtime crash under investigation. Desktop stability requires its own
matching-build validation.

## Why this contract must survive later hardening — 17 October 2026

This is a selective restoration of earlier working unattended Training, not a blanket rollback. Mandatory evidence and persistence remain protected; optional JSON/capacity rejection preserves memory and advances the run. A model may ignore shortening instructions or estimate tokens incorrectly. Do not turn that model limitation into an operator-resolution gate, increase document capacity automatically, or use Viewer Notes as an automatic overflow destination. Prompt refinements are a separate task.

Edward reported a completed approximately 20-minute Training after the repairs and a working Stop which did not exit the application. Native runtime stability and learning continuity are separate fixes. Future changes must exercise malformed/oversized proposals through allowed recovery, unavailable Review, unknown optional-learning results, valid independent updates, Stop and real persistence/ownership errors. Preserve bounded dispatch, saved evidence and no-dialog progression. See [Engineering Decision 26](../architecture/ENGINEERING_DESIGN_AND_INTEGRITY_SAFEGUARDS.md#decision-26--restore-unattended-training-without-accepting-invalid-learning).
