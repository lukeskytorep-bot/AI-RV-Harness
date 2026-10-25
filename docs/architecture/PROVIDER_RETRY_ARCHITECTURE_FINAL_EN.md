# Provider retry architecture — current implementation

**Reviewed:** 16 October 2026. **Scope:** accepted AI RV development line through Training Continuity T5; schema 031. Historical September closure reports document the implementation at that date. This page now describes the checked-in code rather than a future implementation plan.

## Ownership

Rust performs one physical provider request. TypeScript `src/providers/requestExecutor.ts` owns transport retry through `executeProviderRequest()` / `executeProviderChat()`. Domain controllers use this boundary, not independent transport loops. The executor brands composed callbacks to reject nested executors, freezes the request payload and records logical ID, physical attempts, elapsed time and ambiguous billing attempts. Rust errors are normalized through `src/providers/providerError.ts`.

A changed prompt or output allowance is a new semantic request. Output recovery and domain JSON/capacity repair do not belong to transport classification. Model changes are never an automatic recovery strategy.

## Policy as implemented in retry.ts

`configuredRetries` is the number of additional attempts after the first, clamped to 0–5; default is 2 when omitted. Zero disables transport retry, not every independently defined semantic recovery.

| Failure | Transport policy |
| --- | --- |
| Any typed failure with `semanticOutputStarted` | no automatic transport retry |
| HTTP 408, 425, 429, 500, 502, 503, 504, 524, 529 | configured allowance |
| typed connect, timeout, request_send | configured allowance |
| supported transient provider error types: rate_limit_exceeded, provider_overloaded, provider_unavailable, timeout, server | configured allowance, subject to the earlier semantic-start guard |
| response_body_read, response_body_decode, invalid_provider_json, empty_assistant_response | at most one recovery when enabled, subject to earlier classification guards |
| cancelled, configuration, response_body_too_large; AbortError | none |
| other permanent/unclassified errors; authentication, safety, context or route problems without a recognized transient classification | none |
| finish reason length / incomplete semantic output | separate output recovery; not transport retry |

Classification order matters: retry.ts checks semantic-start and terminal typed guards before transient provider error types, then single-recovery codes and HTTP statuses. The table must not be used to invent an independent classifier that reorders these checks. Legacy string parsing is a compatibility fallback. A completed ProviderExecutionError is never retried by an outer caller.

Valid Retry-After is capped at 30 seconds. Without it, delay uses jitter between zero and a ceiling of `min(8000, 500 * 2**failedAttempt)` milliseconds. Cancellation stops both the active request and backoff. Timeout/presentation/envelope policies are resolved separately in `effectiveRequestEnvelope.ts` and `streamingPolicy.ts`.

## Streaming, uncertainty and persistence

A response-body failure can occur after generation and billing. Physical-attempt diagnostics preserve that ambiguity. Once semantic output has started, blindly resending the request is unsafe, so the typed guard stops automatic transport retry. Controller recovery must inspect durable attempt/checkpoint state; partial streamed text is not accepted evidence.

The Viewer semantic recovery ledger preserves exact step and fingerprint plus dispatch-start identity across restart. Unknown post-dispatch outcome must not be converted into a confirmed failure merely to enable retry. Post-Reveal recovery has its own operator decision and lease fencing. See [current workflows](CURRENT_WORKFLOWS_v0.7.14_EN.md).

Only complete accepted responses advance evidence/state. Transport retries do not append duplicate user prompts, repeat completed Monitor work or reset semantic recovery. Viewer, Training and Research Resume replay accepted work locally before crossing to live execution at the missing call.

## Output budgets and costs

Automatic blind Viewer prefers 16,384 → 32,768; Manual RV uses 32,768 → 49,152. Current Judge/post-Reveal/Training Review analytical policy v2 prefers 32,768 → 49,152. Live Monitor retains the immutable 16,384 → 32,768 pair. Learning requires explicit training_reveal and uses capacity + 32,768 → capacity + 49,152. Frozen Research/telepathic policy versions retain their own older pairs; absent legacy Research Judge policy remains 8,192 → 16,384 for missing work.

For classic Training learning, transport retry and output/JSON/capacity repair share one durable **two-dispatch limit per learning kind/session/packet**. They are not independently additive allowances. For other operations, apply the relevant transport and semantic contracts instead of assuming a universal two-HTTP-call rule.

`response_finished` records complete transport, even when validation rejects the final channel. It is not proof of usable output or commit. Preserve unknown earlier physical attempts, exact request identity, received evidence and the real abort reason. Native ownership cancels bound requests without waiting for JS, and stale writes remain fenced. The shared Resume resolver can authorize a deliberate additional essential Viewer attempt without resetting learning history.

The reviewed source does not contain the former SessionCostGuard / CostAuthorization spend blocker. Do not reintroduce it from a historical architecture plan. Usage, pricing estimates and ambiguity warnings remain diagnostic; removing a cost cap does not remove uncertainty protection.

## Regression references

- `src/providers/retry.test.ts` and `requestExecutor.test.ts`: classifications, exact attempts, cancellation and executor boundary.
- `src/sessions/viewerOutputRecovery.test.ts` and `viewerResumeLedger.test.ts`: completeness, semantic budget and durable replay decisions.
- Training blind Resume and Research Resume integration tests: same-session ownership and frozen recovery.
- Post-Reveal recovery tests: stage-local persistence and uncertain dispatch.

For actual desktop/provider validation, use [the release smoke checklist](FINAL_RUNTIME_SMOKE_v0.7.14_EN.md). Historical reports are evidence for their recorded baseline, not a declaration that this candidate has completed runtime verification.
