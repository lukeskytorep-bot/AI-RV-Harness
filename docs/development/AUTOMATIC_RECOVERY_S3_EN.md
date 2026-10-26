# Automatic Recovery S3 — Research and receipt persistence

Reviewed 23 October 2026. Base: S2 with AUDIT_FIX_2. Application version: 0.7.14.

The subsequent [Research Judge completion](RESEARCH_JUDGE_COMPLETION_EN.md) extends the validation-block and Resume behavior described below with local alias recovery, independent slots and explicit bounded completion.

## Research Judge

Research uses a lease-owned request journal in existing session events:
`RESEARCH_JUDGE_REQUEST_V1`. Each Judge index and ordinal identifies an actual request in the
unchanged analytical flow, including output escalation, JSON formatting and
language correction. Its fingerprint covers messages, effective settings,
model/route, provider endpoint and credential identity. Selected Judges on the
same model route retain separate journals and independent evaluations. Responses are replayed
through the normal validators; the journal never accepts or manufactures scores.

The saved policy is version 1, `maxTransportRetries: 1`. A recognized transient
transport/HTTP failure may receive one durable retry grant per request. The
executor's extra retries are zero on this path. The operation must settle and
its failed checkpoint must be reread before granting the retry. Default delay
is 250 ms; Retry-After is clamped to 250–30000 ms and abortable. Changing requests,
corrupt journals, permanent errors and exhausted allowances stop before dispatch.
STOP does not trigger a retry. A previously saved unused grant may be consumed
only by a later explicit run. Neither restart nor an old manual status override
renews the journal's allowance.

Historical received `RESEARCH_JUDGE_RESPONSE` text is reused through the same
completeness, score/schema and language validators. Historical unknown attempts
without a request journal consume the single saved grant before another request;
known pending/not-sent work does not. This automatic policy replaces repetitive
operator resolution. No new buttons, dialogs or polling were added to Research.
The existing judging action resumes local work and only missing requests.

Receipt persistence is outside the transport catch. An unsaved response remains
in RAM under a stable repository owner, including across execution adapters.
On the next run, durable state is inspected before local receipt replay. An
already committed receipt is not appended again; a conflicting receipt stops
without overwrite. This buffer is not a durable outbox and may be lost when
the process or root repository is discarded.

Validation/freeze/bookkeeping errors never become a blanket `uncertain`
transport event. A durable receipt allows parsing/freezing to resume without
another paid evaluation. Frozen scores remain authoritative after an ambiguous
freeze commit. Terminal schema/language/output failures record a validation
block, preserve responses and disable misleading Resume. JSON formatting and
language correction retain their existing prompts, budgets and score invariants.

The Judge path still does not read Research conditions or the Blinding Key.
Locked experiment bytes, score immutability and workflow termination/ownership
barriers are unchanged. A replay of an unknown remote result may incur another
provider charge; local endpoints use the same consistency policy.

## Post-Reveal and other reviewed paths

Accepted Viewer/Monitor analytical responses have a receipt before their terminal
transcript append. Failed transcript/checkpoint writes propagate a distinct
checkpoint error, including through executor error wrappers; they are not
reclassified as uncertain provider delivery. Existing receipt text or the RAM
buffer can finish the local append without repurchasing the response. A stored
complete transcript still takes precedence and prevents duplicate turns.

Provider continuation secrets are kept in RAM or the existing encrypted state
store, not copied into the plain receipt event. If a required continuation state
never reached that store and RAM is lost, recovery stops without silently
repurchasing the request. Manual Post-Reveal turns use their full request
fingerprint, so separate user turns are not conflated.

Post-Reveal fenced writes now use the shared SQLite write coordinator, including
the workflow-owned route. BUSY retries remain bounded and recheck ownership in
the native transaction. Unchanged storage/ownership failure budgets are not
reopened by an outer error handler.

Review of Full RCP, RV Lite, Custom and manual Telepathic Viewer controllers found
their accepted transcript persistence separated from the provider transport call;
their existing sealed replay/ownership policies were retained. Field Guide and
Viewer Notes already use `executeLearningProposal` with durable settlement.
Classic Training continues to pass `failurePolicy: preserve_and_continue`; failed
learning proposals preserve active memory and remain audited. No learning-policy,
protocol, sampling, routing or output-budget table changes are made here.

## Version and validation boundary

`src/version.ts`, npm manifests/lock root, Cargo package/lock root and Tauri now
agree on 0.7.14. Startup branding and PL/EN compatibility copy use APP_VERSION.
The footer already reads that constant. Native PL/EN confirmation dialog labels
use `CARGO_PKG_VERSION` as well; native compatibility logic is unchanged. Tauri uses its configured version for
installer naming. The internal v0.7.13 database epoch/initialization marker is
intentionally unchanged: it is a data compatibility contract, not the UI version.
Historical release evidence and dependency versions are not relabelled.

Controlled provider, mounted controller and real file-backed SQLite tests are
source verification. They do not certify a Windows binary, real paid provider
or local model server. Complete the desktop acceptance checklist separately;
record model/endpoint, application version, request counts and checkpoint results.
