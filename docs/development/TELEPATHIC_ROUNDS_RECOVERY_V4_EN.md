# Telepathic rounds, explicit retries and output policy v4

Source: AI-RV-Harness-main(1).zip, package version 0.7.14, schema 34.

## Round readiness

`humanBlindReady` is the shared UI-step/save predicate: a transmission-ready target must exist and Reveal must not have happened. The save guard remains enforced. The Conversation controller keeps its existing run lock and durable checkpoints while moving into the next round, preparing its target and transmission before pausing for human input. It also preserves a human sender's prepare/confirm checkpoints. STOP or a preparation failure still leaves a resumable checkpoint rather than a falsely enabled receiver form.

Human text drafts use a local, versioned key containing Workspace, series, round and stage; guidance also includes its cycle. Checkpoint refresh and remount retain a current draft, while a new round/stage gets a separate draft. Successfully submitted receiver text is cleared only after the submission is saved. Image File objects are cleared on a round change; users must select an unsaved image again after reopening. These UI drafts are local to this application installation and are not protocol evidence or part of the database backup. Submitted text remains in the normal durable records.

## Bounded automatic recovery and one extra explicit call

Automatic output levels and the existing one-transport-retry limit are unchanged. A fully received body rejected during response validation is a failed output attempt. This uses structured response-finished evidence, not an error-message substring or a finish label. Reasoning is never substituted for a final answer. A later End action does not establish the cause of an earlier cancellation.

When automatic recovery is unavailable, a candidate failed/uncertain step can expose **Retry step**. The action explains the possible additional paid call and acquires the normal series lock and lease. The engine reads the checkpoint first, checks eligibility and records `manualRetryAuthorization` with timestamp and original status on that attempt, together with a transcript notice. An unresolved complete saved result follows ordinary recovery before another request can be dispatched.

A new prepared call durably carries `manualRetryOfCallId`. Its parent, request fingerprint, scope and output level must match; one parent can authorize only one child. The parent authorization, previous recovery records, counters, responses, target and human submissions remain present. A pending authorization survives reopening, but an unsuccessful manual child cannot replenish automatic recovery. Each additional manual call needs a new action. Request executor retries remain zero; no parallel request is dispatched while the series lock/lease is held. Configuration/storage/ownership barriers and End remain binding.

The optional call fields round-trip inside the existing plan runtime extension, so no migration is needed. No native command or schema change is introduced.

## Output policy

New runs in both Telepathic modes default to policy **4**. Every stage has a requested per-call pair **32768 / 49152**. Effective output remains capped at the frozen model maximum; both requested and effective values are saved in diagnostics. Manual retries keep their parent's output level and snapshot and never introduce a third/escalating level.

The independent historical v1, v2 and v3 tables remain unchanged. Existing scope snapshots take precedence, and unmarked restored fixed-lead runs retain the existing v2 fallback for untouched scopes. Loading never calls the constructor to upgrade a run. Older snapshot validation and request fingerprints remain covered by regression tests. Context limits, generation sampling and protocol prompts are unchanged.

## Metrics

Only the Telepathic metric wrapper overrides the shared grid: tiles and controls wrap according to the available panel width. Labels and numeric values keep their words/digits together. Existing theme variables and control styles remain in use. DOM checks cannot establish pixel-level layout; Windows WebView2 acceptance must check both themes and a narrow panel with a long recovery message.

## Acceptance boundaries

The accompanying report and logs identify executed TypeScript, DOM, SQLite, full-suite, build and structural checks. They do not establish native Windows layout or real-provider cancellation causes. Windows acceptance should run both Telepathic modes, two human-receiver rounds, STOP/Resume, a failed manual retry followed by a new explicit retry, reopen, and a narrow metrics panel in light/dark themes. Native cargo/Clippy and the Windows release action remain CI checks.
