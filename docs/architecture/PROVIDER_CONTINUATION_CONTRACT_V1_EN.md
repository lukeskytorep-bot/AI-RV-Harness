# Provider Continuation Contract v1 — AI RV development reference

> **Documentation scope:** accepted `ai-rv-2` development source through Training History UX and DOM dependency fixes; reviewed 11 October 2026. SQLite schema **031**. This is not a claim that v0.7.14 binaries have been published or desktop smoke completed. Historical release evidence remains unchanged.
> **Current workflow reference:** [Recovery, presentation and Training history](CURRENT_WORKFLOWS_v0.7.14_EN.md).

**Base stage:** `CONTINUATION-CONTRACT-0-R1`  
**Current runtime stage:** `ANTHROPIC-CONTINUITY-1` (`C5`, released session-safe scope)  
**Status:** released in v0.7.13. OpenRouter and Google native operate within their contracted scopes; C5 activates Anthropic `anthropic-thinking-blocks` only on frozen, append-only Session/Resume routes. Ordinary Conversation and post-Reveal remain text-only for Anthropic because dynamic time/workspace context or post-Reveal clarifications may change the signed prefix.  
**Verified:** 2026-09-30

## Purpose

This document defines the data contract for provider-native continuation. C2 added durable persistence in schema 025, C3 connected OpenRouter continuation to RV Sessions, Training, Research, post-Reveal, and Resume, C4 activated equivalent Google replay, and C5 adds Anthropic `thinking` / `redacted_thinking` on routes where the Harness can guarantee an append-only prefix. State remains attached to the exact `assistant` message or `session_event_id`; it is not reconstructed from the transcript or visible reasoning.

## Data classes

1. **Semantic message** — role, visible text, images, message identifier.
2. **Provider continuation state** — the minimal provider-native state required for safe replay.
3. **Diagnostics** — usage, finish reason, request ID, actual model, retry metadata. Diagnostics are not automatically replayed.
4. **Display reasoning** — reasoning that may be shown in the UI. Continuation state must never be reconstructed from it.

## Contract v1

The canonical test contract lives in `src/providers/continuationContract.ts`. It is a closed union of three formats:

- `openrouter / openrouter-reasoning-details`;
- `google-native / google-thought-parts`;
- `anthropic-native / anthropic-thinking-blocks`.

There is no `opaque`, `payload: unknown`, or generic passthrough JSON format.

## Replay fingerprint

Each state contains:

- transport;
- normalized endpoint;
- `providerConfigId`;
- `credentialId`;
- requested model ID;
- optional actual model ID, diagnostic in generic v1;
- format and format version.

The generic v1 fingerprint **does not include reasoning effort/mode**. OpenRouter distinguishes `reasoning.effort` from `reasoning.mode`, and changing effort is not general proof that stored `reasoning_details` are incompatible. If a specific transport later proves such a requirement, it must receive a provider-specific rule or a new fingerprint version.

Automatic generic-v1 compatibility requires matching transport, endpoint, `providerConfigId`, `credentialId`, requested model ID, and state format/version. The endpoint must already be normalized by the existing credential-binding contract. Neither the secret nor a hash of the secret is part of the fingerprint.

`actualModelId` may be retained as response diagnostics, but **it is not a condition of `replayFingerprintsCompatible()` in v1**. For future OpenRouter C1 work, `actualModelId` should not be populated or compared as a replay gate unless a stable route/model identity is known before dispatch and a separate documented contract requires an exact actual-model match.

## v1 limits

These limits are **Harness guardrails**, not declared provider limits:

| Limit | Value |
|---|---:|
| state blocks / assistant message | 64 |
| single block | 512 KiB UTF-8 |
| state for one message | 2 MiB UTF-8 |
| total state for one request | 8 MiB UTF-8 |
| maximum input-inspection depth | 128 |
| maximum visited input nodes | 10,000 |

Rationale: official fixtures are small, but signatures and encrypted blocks are opaque and may be much larger. The guardrails intentionally leave substantial headroom while still rejecting unbounded JSON. A block above the limit is rejected in full; it must not be truncated or summarized.

## Capability matrix

| ProviderKind / transport | Official state | Replay requirement | Current Harness state | C0 decision |
|---|---|---|---|---|
| OpenRouter | `message.reasoning_details[]`: `reasoning.summary`, `reasoning.encrypted`, `reasoning.text` | preserve the full array and order for special/encrypted/summarized reasoning | **ACTIVE C1–C3:** capture, persistence, exact-message/event replay, Resume, and post-Reveal | **ACTIVE** |
| Google native (`generateContent`) | `Part.thoughtSignature` on the exact part; thought parts may have `thought=true` | the signature must be returned on the exact corresponding part | **ACTIVE C4 for the verified text/thought subset:** parser preserves the complete supported Parts sequence, persistence binds it to the exact assistant turn/event, and the request builder replays `thoughtSignature` on the same Part | **ACTIVE C4; tools/function parts remain outside v1** |
| Anthropic native | `thinking { thinking, signature }`, `redacted_thinking { data }` | preserve blocks, order, opaque signature/data, and a compatible earlier prefix | **ACTIVE C5 on frozen Session routes:** exact block capture, schema 025 persistence, exact-event replay, and Resume; ordinary Conversation and post-Reveal remain text-only because of dynamic prefixes | **ACTIVE SESSION-SAFE; tools/function calls outside v1** |
| OpenAI direct | no separately approved Chat Completions continuation fixture in C0 | API/model-dependent | text-only continuation | **NOT CONTRACTED** |
| Z.AI direct | no approved provider-native fixture | unknown | text-only continuation | **NOT CONTRACTED** |
| DeepSeek direct | no approved provider-native fixture | unknown | text-only continuation | **NOT CONTRACTED** |
| Mistral direct | no approved native fixture; Mistral through OpenRouter uses the OpenRouter contract | transport-dependent | direct `ProviderKind::Mistral` is a separate endpoint | **NOT CONTRACTED for native** |
| Blackbox direct | no approved provider-native fixture | unknown | text-only continuation | **NOT CONTRACTED** |
| Custom OpenAI | contract depends on the real backend | must not be inferred from the model name | compatibility defaults to OpenAI-like without continuation state | **NOT CONTRACTED** |

## Fixtures

`src/providers/continuation-fixtures/` contains three response → next-request pairs. OpenRouter mirrors the approved wire shape, Anthropic is an anonymized fixture derived from the official preserved-thinking contract, and the Google C4 fixture is **an anonymized representation of a genuinely observed Google-native `gemini-3.8-flash` response from 2026-09-25**. The repository does not store private conversation content, the user's real signature, or an API key.

- OpenRouter: `reasoning_details` structure preserved 1:1 and in order;
- Google: C4 shows both the historical request without a signature and the expected replay in which `thoughtSignature` remains on the exact text `Part`;
- Anthropic: `thinking` and `redacted_thinking` preserved without modification.

## Privacy

The validator rejects, among other things, header fields, Authorization, API key/secret, raw/full response, and debug payload. Ordinary continuation state is not a place for diagnostics or the complete HTTP response. `credentialId` is an allowed opaque identity identifier and is not a secret.

## Fail-closed behavior

The validator is fail-closed for any `unknown`: cycles, excessive depth, non-serializable structures, and introspection errors return controlled `invalid_payload` instead of throwing.

The validator rejects:

- unknown schema version;
- unknown transport or format;
- additional unapproved fields;
- malformed fingerprint;
- oversized state;
- too many blocks;
- a provider-native block of an unknown type;
- fields that may contain credentials/headers/full response.

There is no heuristic repair, sorting, truncation, summarization, or reconstruction from `reasoningContent`.

## Official sources

Checked 2026-09-25:

- OpenRouter, Reasoning Tokens / Preserving Reasoning / Reasoning Details API Shape: https://openrouter.ai/docs/guides/best-practices/reasoning-tokens
- Google Gemini, Thought signatures: https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures
- Google Gemini, Generate Content `Part` (`thought`, `thoughtSignature`): https://ai.google.dev/api/generate-content
- Anthropic, Extended thinking / preserving thinking blocks: https://platform.claude.com/docs/en/build-with-claude/preserved-thinking
- Anthropic, Messages API types: https://platform.claude.com/docs/en/api/messages/create

## C1 activation — OpenRouter in-memory

C1 activates only the following chain in ordinary Conversation:

1. complete `reasoning_details` from the OpenRouter response are validated against contract v1;
2. validated state is attached in memory to the exact `ChatMessage.id` of the assistant message;
3. the next compatible request receives that state on the same assistant message;
4. compatibility requires the same `providerConfigId`, `credentialId`, requested model ID, normalized endpoint, and format/version;
5. the normalized endpoint comes from the native credential-binding normalizer, not from a second TypeScript implementation;
6. on provider/model/credential/endpoint mismatch, the request stops before provider call; the Conversation user may explicitly choose `Continue text-only`, which removes the in-memory state for that thread;
7. `actualModelId` remains diagnostic and is not a replay gate; the generic fingerprint does not contain reasoning effort/mode;
8. `reasoning_details`, Google `thoughtSignature`, and the text of hidden `thought:true` parts are redacted from detailed debug payloads; visible semantic text remains diagnostically readable.

C2 preserves the C1 contract above and adds only persistence:

- schema 025 creates `chat_message_provider_state` and `session_event_provider_state`;
- payload does not enter `chat_messages.content`, `session_events.metadata_json`, ordinary exports, or logs;
- Conversation atomically saves assistant message + state and, after restart, hydrates validated state before the next compatible request;
- SHA-256 hash, UTF-8 size, format, version, and fingerprint are checked again on read;
- Browser storage preserves logical parity with SQLite, including write rollback and controlled purge;
- Session storage has an atomic event + state API bound to the exact `session_event_id`; C3 uses it in RV Sessions, Training, Research, post-Reveal, and Resume for OpenRouter;
- historical records without state continue to work text-only;
- C4 uses the same schema 025 for Google native, without migration 026;
- C5 uses the same schema 025 for Anthropic Session routes, without migration 026; ordinary Conversation remains Anthropic text-only.

C2 does not reconstruct state from visible reasoning or from the transcript. Persistence stores only validated provider-native state required for replay.

## C1-R1 hardening — context budget

C1-R1 closes the context preflight after provider-native state activation. `continuationState` is attached to the historical assistant message **before** `estimateContextBudget()`, and its validated UTF-8 size is included before `executeProviderChat()`. State is not truncated.

The continuation payload estimate is intentionally more conservative than ordinary text because signed/encrypted/base64-like data has different tokenization characteristics:

- baseline: `2 UTF-8 bytes / estimated token`;
- additional safety factor: `1.25`;
- this is a local safety preflight, not the provider's billing tokenizer.

If visible input + images + continuation estimate + reserved output exceed the model context window, Conversation stops the request before provider dispatch. The UI context meter uses the same `estimateContextBudget()` and includes the thread's current in-memory continuation state so it does not under-report context.

C1-R1 does not change the 64 / 512 KiB / 2 MiB / 8 MiB contract limits. Those remain structure/payload guardrails; context budget is a separate model limit.

## C4 activation — Google native text/thought parts

C4 activates only the confirmed Google-native `generateContent` contract for text/thought `Part` values:

1. the Rust parser detects continuation when a response contains `thought=true` or a non-empty `thoughtSignature`;
2. if continuation exists, the complete **supported** sequence of text/thought Parts is preserved because Gemini 3 may attach `thoughtSignature` directly to a visible text Part;
3. TypeScript validates the closed `google-native / google-thought-parts` format, canonical base64 signature, limits, and exact visible-content binding;
4. Conversation, Session, Resume, and post-Reveal use the existing schema 025 persistence and exact-message/event ownership;
5. the Google request builder replays stored Parts together with unchanged `thoughtSignature` instead of reconstructing only `{ text }`;
6. changing provider config, credential, endpoint, or requested model ID invalidates automatic replay;
7. historical records without Google state remain text-only;
8. function/tool parts, a full universal `parts[]` AST, and Google function calling remain outside ProviderMessage v1 and require a separate stage/fixtures;
9. C5 does not alter this Google contract.

## C5 activation — Anthropic preserved thinking on append-only Session routes

C5 is based on Anthropic's current **Preserved thinking** contract. A signed thinking block is bound not only to its own signature but, on newer models/accounts, also to the preceding request prefix: top-level `system`, tools, and all messages before the block. Replay is therefore safe only when the prefix stays identical and the history grows append-only.

C5 scope released in v0.7.13:

1. the Rust parser preserves exact supported `thinking` and `redacted_thinking` blocks in order; `redacted_thinking.data` is not replaced with a placeholder;
2. the supported v1 layout is zero or more thinking/redacted blocks followed by exactly one visible `text` block. An unknown/mixed layout containing continuation state is rejected fail-closed. Tool/function blocks remain outside v1;
3. the request builder replays preserved blocks before visible text without modifying signature/data;
4. the Session route stores `anthropic-native / anthropic-thinking-blocks` plus `prefixPolicy: append-only`; changing provider config, credential, endpoint, or requested model ID blocks replay;
5. RV Sessions, RV Lite, Full RCP, Custom/Telepathic, Training, and Research use the shared Session layer. Resume hydrates state from the exact `session_event_id` before a live call;
6. **post-Reveal remains Anthropic text-only in C5** because its prefix may legally change when supplementary target clarifications are appended. Blind-session thinking is not replayed after Reveal;
7. **ordinary Conversation does not activate Anthropic replay in C5** because `src/chat/engine.ts` builds dynamic local time context and may inject dynamic workspace context. Replaying signed thinking across a changed prefix could be rejected by Anthropic. Rather than risking HTTP 400 or heuristically stripping blocks, the Harness stays fail-closed/text-only there until a separate prefix-stability stage;
8. C5 does not set or infer thinking mode from the model name. Extended/adaptive/default thinking remains governed by the existing provider request contract; continuation preserves blocks only if the provider actually returns them;
9. C5 reuses provider-state tables introduced in schema 025 without its own additional migration; C2 already allowed `anthropic-native` in provider-state storage.

### Model capability boundary

The Harness does not activate replay through a model-name allowlist or infer a vendor's current thinking mode from a historical catalog. The current request/capability contract controls generation settings. Capture requires actually returned, validated blocks; replay requires the compatible frozen append-only route. Model-specific API availability must be checked separately before changing the request builder. Historical fixtures and source-check dates below are provenance, not a claim that every future model has been verified.

**Data scope:**

- `thinking`: `{ type, thinking, signature }`;
- `redacted_thinking`: `{ type, data }`;
- both types are validated as closed shapes and preserved 1:1;
- C5 does not interpret `signature` or `data`, reconstruct them, or create placeholders;
- full tool-use/interleaved-thinking turns remain outside ProviderMessage v1 because they also require `tool_use` / `tool_result` blocks.

Sources: https://platform.claude.com/docs/en/build-with-claude/preserved-thinking , https://platform.claude.com/docs/en/build-with-claude/extended-thinking , https://platform.claude.com/docs/en/api/messages/create

## Current application boundary

Provider-state tables were introduced in schema 025; the overall application now uses schema 031. Later workflow checkpoints and Viewer attempt ledgers do not replace exact-message/event continuation ownership. Continuation compatibility is distinct from the Viewer request fingerprint and budget-exhaustion decision. Supported provider layouts are preserved according to the checked-in validator; diagnostics and visible reasoning are never used to reconstruct signed state.
