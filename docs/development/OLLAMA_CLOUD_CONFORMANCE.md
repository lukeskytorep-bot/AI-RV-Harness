# Ollama Cloud — CLOUD-3 multi-turn diagnostic

20 November 2026. Candidate following the accepted CLOUD-2 audit fix. This is a remaining part of DIRECT-3C2; it does not start NDJSON/3D or enable automatic scientific workflows.

## User flow

An existing active `ollama_cloud` provider has a **Multi-turn test** action in Provider Settings. Select an exact cached model, read the fixed destination/cost notice, then explicitly run the test. Opening settings or the dialog sends no requests. The test sends only a fresh random marker, never session materials. It makes at most two non-streaming chat calls, each with an explicitly displayed 4096-token diagnostic response budget. It does not change any workflow budget or retry setting. Each run requires another user action; no automatic retry is used. STOP/unmount aborts the active request and prevents the next one. An already dispatched call may still have been billed.

The first synthetic user turn asks for READY while retaining a marker. The second request sends the original user message, the accepted assistant READY, and a marker-recall prompt. Only exact expected final text with finish reason stop advances the test. Reasoning-only, length, malformed/unexpected final text, refusal or request failure never earns a positive observation and never triggers a retry. Failure to recall is not proof the hosted model lacks multi-turn support.

## Bounded diagnostic exception

The common resource policy uses a distinct `cloud_conformance` kind. Its Cloud exception requires the exact diagnostic operation ID, the fixed 4096 budget, no other generation settings, and exactly the bounded synthetic one-message or three-message shapes. Arbitrary prompts, images, replay state, oversized message text, other IDs and output escalation fail before dispatch. The ordinary Conversation/Manual RV policy remains separate; `telepathic_exchange` and all other automatic kinds remain blocked. Tests use the real executor and IPC adapter, plus existing engine/gateway telepathy regressions.

## Provenance and export

Before each turn and after the last response the diagnostic reloads the saved route/model and compares connection ID, credential ID, exact model/route, canonical cached metadata hash and a genuine native credential fingerprint. The fingerprint is used only in memory; no key, credential hint or fingerprint is exported. A changed/disabled route, missing model or rotated credential observed at a check stops the test before a subsequent request. These frontend checks are observations, not an atomic remote identity attestation; a change detected after a response invalidates the overall observation. Cached metadata is not refreshed automatically, so its digest/hash proves only which cached metadata was used, not the identity of remote weights at generation time.

The user can save a JSON report through the existing native file dialog. It contains timestamps, model, fixed endpoint, cached metadata provenance, message hashes, expected/final reply hashes after trim (explicit `trim_exact_v1` comparison), optional raw native final-candidate hash, request IDs, completion evidence, usage and a thinking-present boolean. It contains no raw private thinking, raw error body, session data or arbitrary output text. Unknown request outcomes remain unknown; a provider cancellation alone is not attributed to a user STOP. Completed rejected bodies retain available completion evidence. The dialog retains the report until closed; exporting makes it durable. Closing/reloading without exporting does not create a saved diagnostic history.

## What the observation cannot certify

`two_turn_recall_observed` is a narrow observation for the selected model/account at that time. Every report still has `fullInputPreservation: unverified`, `oversizedRejection: unverified`, `serverVersion: null`, and `automaticGenerationEnabled: false`. Neither a small successful recall nor returned token counts proves all input would survive a large real session. No context limit, server version, tokenizer guarantee, anti-truncation flag or sampler capability is invented. This patch deliberately sends no oversized input and does not use local num_ctx, daemon/GPU checks, model aliases or undocumented flags.

Remaining 3C2 acceptance: real hosted results; trusted model-specific full-input/oversized-rejection contract; then explicit frozen-provenance and controller/Research Lock acceptance before widening the automatic gate. Local Ollama remains deferred. There is no live-account test in the production evidence for this patch, and no new claim of Windows/keyring or full native acceptance.

References reviewed 20 November 2026: [hosted API](https://docs.ollama.com/cloud/api), [native chat](https://docs.ollama.com/api/chat), [context length](https://docs.ollama.com/context-length). These describe documented API behavior, not successful real-account conformance in this delivery. Upstream main source exposing truncate/shift is not evidence that the hosted endpoint honors that contract.
