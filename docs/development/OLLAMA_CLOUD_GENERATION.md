# Ollama Cloud — DIRECT-3C2-CLOUD-2

Candidate based on `ai-rv-2` `019241c4ea711bb72625cb48e033651cb313267b`, 19 November 2026. Direct hosted API first; local Ollama remains deferred. This patch implements selectable credential-backed profiles and real non-streaming native chat for **Conversation and Manual RV**. It does **not** complete all of DIRECT-3C2.

## Setup and identity

Create an Ollama Cloud connection in the ordinary provider dialog, or explicitly choose **Activate for profiles** on an existing saved hosted account. Both routes verify authenticated access through `/api/balance` and read exact models through `/api/tags`. Account balance metadata is discarded. There is no billed generation during setup. No daemon, `/version`, `/show`, `/ps`, local GPU or local cloud alias is required.

The public provider kind is `ollama_cloud`. It uses a genuine saved Bearer credential and the existing credential identity/profile/Viewer memory path. It is separate from pending `ollama_native`, whose None/Bearer connection identities and disabled local records remain intact. No dummy secret or fingerprint is introduced. No existing profile, session snapshot, model assignment or memory identity is silently converted.

Activation creates a fresh hosted credential inside native code, bound to the official origin and hosted provider kind; the existing saved native key never crosses IPC. The old account and its key remain intact. An immediate SQLite transaction checks the source revision, excludes recovery, writes metadata and the activation mapping, and settles the staged secret journal. Duplicate activation returns the same hosted connection. A failed/ambiguous commit must be reloaded/retried; it never deletes a potentially committed key. Existing 15-minute staging recovery deletes only unreferenced staged keys and verifies their native/hosted ownership. Pending generation drafts are retained as drafts; configure the new profile's defaults explicitly rather than silently importing a local context value.

Migration 036 adds the hosted provider to the provider CHECK. Historical migrations are unchanged. It preserves provider/model rows, favorites, pending native routes including stale revision snapshots, AI identities and append-only memory. It restores native route guards after copying historical rows and checks foreign keys. Upgrade/rollback tests use actual SQLite.

## Dispatch and result

The fixed destination is `https://ollama.com/api/chat`, Bearer auth, redirects disabled, JSON with `stream:false`. Native checks the saved enabled connection, bound credential and cached exact model before dispatch. Messages are preserved in order. Stage `maxOutputTokens` maps to `options.num_predict`; temperature/top_p/top_k/seed remain optional requested values, including explicit zero. The service's application of sampler values is unverified. No `num_ctx`, OpenAI max_tokens, tools, images, generic reasoning effort or thinking replay is sent. No local trimming or invented truncate flag is used.

Common request ownership, timeout, cancellation and attempt evidence remain in use. The Cloud response is bounded to 16 MiB while reading. A cut-off/oversized body does not claim response_finished. A complete rejected response retains the existing response evidence and final-candidate rules. Response model must exactly match the requested model. Known credential material in returned metadata is rejected without echoing it.

`message.content` is the final text; `message.thinking` is retained separately, never substituted for a missing final. Missing/false done, unsupported terminal reason and reasoning-only/empty output are rejected. `done_reason:length` with text remains length for the domain to assess. Literal think tags in native final text remain literal. Native input/output token counts and optional cached-input/duration metrics are retained; durations stay explicitly in nanoseconds. No total/reasoning token count or price is invented.

## Context gate and remaining work

`/tags` is not trusted evidence of context size, output maximum, effort levels, vision, or a no-truncation contract. These remain unknown. Conversation/Manual RV are interactive user-controlled calls; they have no certified full-input guarantee. The request diagnostics mark capacity as unknown. **Automatic RV, Training, Research, telepathy, monitor, judge and learning stages fail before dispatch** until hosted full-input/oversized-rejection evidence and multi-turn conformance can justify activation. This gate also applies when the provider is selected in an existing profile. It does not rewrite old experiment locks or route snapshots. A small response with `stop` cannot establish that all input was consumed.

Next 3C2 work: obtain a verified hosted full-input/rejection contract, complete model-specific conformance and controller/Research lock acceptance, then deliberately extend the gate. Do not label automatic modes supported because a descriptor or shared executor test passes. NDJSON streaming belongs to 3D after 3C acceptance; thinking controls/replay require separately verified 3E contracts. Local Ollama is a separate later scope.

Tests in this patch use synthetic fixtures and loopback HTTP. They are not a live Cloud account test, an operating-system keyring test, or a full desktop smoke. Full Tauri compilation/Clippy and Windows keyring/restart, real Cloud multi-turn, STOP during a real call and oversized rejection remain required.

Official references reviewed: [Cloud API](https://docs.ollama.com/cloud/api), [native chat](https://docs.ollama.com/api/chat), [exact Cloud model names](https://docs.ollama.com/cloud/models), [context](https://docs.ollama.com/context-length). Documentation specifies wire behavior, not the unverified conformance results above.
