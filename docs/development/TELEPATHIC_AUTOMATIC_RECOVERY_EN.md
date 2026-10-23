# Telepathic automatic recovery — S2

Reviewed 23 October 2026 (S2 audit fix 2). Applies to Telepathic Training and Conversation after
Automatic Recovery S1 and its audit fix. Research recovery remains a separate
stage. Classic Training learning policies are unchanged.

## Saved policy and limits

New series created by either panel default to the user's requested automatic
recovery preference. The setup checkbox can select manual recovery instead.
The choice is saved in `config.recoveryPolicy`: version 1, mode `automatic` or
`manual`, and `maxTransportRetriesPerScope: 1`. Historical series without this
field retain manual transport resolution. The active-series checkbox can change
the policy while no operation owns the series; changing it never resets the
saved ledger or its limits.

A scope is the existing series/round/participant/stage key. At most one automatic
transport retry is granted for that scope. This allowance is separate from the
two existing semantic/output levels. A transport retry uses the same messages,
settings, fingerprint, output snapshot and technicalAttempt as its parent.
A failed level-2 transport request therefore retries at level 2, not a third
output level. `configuredRetries` in the provider executor remains zero.

The parent stays in the ledger as `failed` with `recovery.action=transport_retry`,
its original status and timestamp. The child has `retryOfCallId`. The grant is
saved before dispatch, so STOP or restart cannot renew it. A grant saved before
STOP may be consumed by a later explicit Resume. Standard transient transport
codes and retryable HTTP statuses are eligible; current typed unknown,
configuration and refusal failures do not authorize automatic transport spending.
An older unresolved record with no typed failure, body, terminal label or receipt
evidence may use the same one-retry allowance after opting into automatic mode;
this explicitly handles an opaque historical outcome rather than assuming success. Default backoff is 250 ms;
provider Retry-After metadata is bounded to 30 seconds. STOP aborts the wait.

An uncertain request may already have been processed remotely. A retry can incur
another charge with a paid provider. Local endpoints use the same consistency
rules; the interface does not assert that a fee is mandatory.

## Receipt recovery before dispatch

The engine first reuses durable accepted results. For an uncertain/dispatched
record, it can recover non-empty saved text only when there is a stored complete
output diagnostic or a validated `body_read`/`sse_done` evidence object, together
with a normal terminal reason. `stop` alone is insufficient. Repetition checks
and the current frozen lead-decision validator still run. The live frozen route
and request fingerprint must match before an uncertain result is accepted.

An invalid saved lead decision is marked rejected with its original text and
usage retained. It is not displayed as an accepted instruction. A later success
does not settle an earlier unresolved physical request; multiple unresolved
requests require review. Earlier/later-stage inconsistencies are not skipped.

After an eligible transport failure, the provider operation has settled. The
engine reads and verifies its checkpoint under the series lease before saving
a retry grant. Failed inspection or grant persistence propagates a typed
checkpoint error without an error-handler write or another provider dispatch.

A received answer whose final local save failed is retained in an in-memory
buffer scoped to the stable repository owner and series. Execution proxies expose
that owner, so creating a new adapter or reopening a panel does not lose the
receipt while the repository remains alive. A later explicit run reads the
durable checkpoint, matches the call ID/scope/fingerprint/attempt, saves the
buffered result locally, and validates it through the normal receipt path.
This is not a durable outbox: closing the application can lose a body that never
reached disk. An ambiguous commit is inspected before any later local replay.
Conflicting buffered/durable bodies stop without an overwrite. Already-saved
receipts and unchanged preparation checkpoints are not written again merely to
repeat the same preparation. No background loop reopens an exhausted S1 write budget.

## Engine/UI agreement

`recovery.ts` owns the shared availability decision. Conversation receives only
the safe projection of that decision, not raw provider records or hidden target
material. Both panels use it for Resume and manual-resolution controls.
Exhausted response/transport budgets and permanent preflight/frozen-route errors
stop clearly. Required participant responses are never represented as completed
or `no_submission` merely because automatic recovery failed.

Checkpoint failures block Resume/policy changes locally until the user reopens
the series from history (or explicitly refreshes the Conversation checkpoint).
Successful inspection enables the next explicit run; it does not itself send a
request. STOP never starts automatic recovery. Archived/ended series and an
active lease in another operation remain barriers.

A saved configuration block is inspected automatically by both panels using
an idle callback on the existing ownership timer. No configuration-check button
or additional polling timer is added. Inspections back off from 1 second to
30 seconds, and an unchanged failure does not rewrite the checkpoint.
Under the series lease the engine rereads the checkpoint, resolves the live
routes and checks frozen identity, credentials, model and route. Existing
fixed-lead requests must reproduce their saved settings/endpoint/budget
fingerprints. New blocks retain the packet validation messages/stage for a
context preflight without sending a prompt; these raw messages never enter
the Conversation projection. Older S2 blocks still support route/fingerprint
inspection; execution always reruns its own preflight.

Once inspection succeeds, a blocked series with saved automatic recovery enabled
continues automatically if the shared recovery decision permits it. Manual-mode
series only regain their existing Resume action. An explicitly paused series
(including STOP during inspection) never starts a provider request by itself;
it may passively regain Resume once its configuration is valid. End, archive,
active ownership, storage failure and exhausted limits remain barriers.
STOP during inspection durably marks the series paused under its lease.
Inspection itself does not dispatch, reconcile a RAM receipt, alter frozen
configuration or renew semantic/transport limits. A successful check therefore
cannot turn an exhausted allowance into a new request. Repeated unavailable
routes only cause backed-off local inspections, not provider retries.

## Persistence and verification

Policy lives in the existing config JSON. Receipt evidence, transport failure,
recovery action, retry parent and configuration block use the existing versioned
plan JSON extension. Relational call IDs/status/text remain authoritative.
There are no SQL migrations or Rust/dependency changes in S2.

Relevant tests:

```bash
npx vitest run src/telepathicExchange/automaticRecovery.test.ts src/telepathicExchange/providerCheckpointRecovery.test.ts src/components/TelepathicSetupScreens.dom.test.tsx src/storage/sqliteCheckpointRecovery.test.ts
```

The SQLite test reopens a real file to verify saved policy/evidence/parent links.
The mounted PL/EN tests exercise both panels with their real shared resolver;
engine transport tests use controlled provider attempts. None constitutes
Windows or live paid/local-endpoint runtime acceptance. Run the normal project
checks and retain the separate desktop acceptance requirement.
