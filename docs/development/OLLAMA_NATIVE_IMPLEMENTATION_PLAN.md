# Ollama Native API — DIRECT-3A implementation plan

Date: 18 November 2026. Status: planning/contract candidate for independent review. **No Ollama provider is implemented by this delivery.**

Source reviewed: `ai-rv-2` at `3c061c80eb21d012cd22a091d61c4d7897120c2e` (RESEARCH-TARGET-CODE-1). Recheck the current branch before each implementation patch. The primary work queue requires this plan before DIRECT-3B. Mistral, Blackbox, Custom Generic/llama.cpp and Research Target Code are accepted preceding work, not tasks to redo.

## Current priority — direct Ollama Cloud (updated 20 November 2026)

Edward subsequently requested the normal Cloud provider workflow, removal of the diagnostic screen and Cloud-only automatic gate, plus ordinary runtime acceptance after delivery. [CLOUD-FINAL](OLLAMA_CLOUD_GENERATION.md) implements this direction including native NDJSON/STOP. Earlier context-conformance activation prerequisites below are historical and superseded for Cloud; unknown capabilities remain unknown. Local Ollama and optional explicit thinking/replay controls are deferred.

Edward clarified the target after 3C1: direct hosted Ollama Cloud API first; local/owned Ollama later. The local defaults and deployment assumptions below are historical design context, not requirements for setting up the hosted service. See [Cloud configuration](OLLAMA_CLOUD_CONFIGURATION.md) for the scoped 3C2-CLOUD-1 implementation and remaining controller/dispatch work. The next candidate is [Cloud profiles and interactive generation](OLLAMA_CLOUD_GENERATION.md); automatic context conformance remains open. Reuse the existing safety/identity foundation without converting saved local connections or fabricating Cloud daemon version, allocation or capabilities.

## 1. Deliverable and boundaries

Add a future, distinct `ollama_native` transport using native chat, discovery and NDJSON. Preserve existing OpenAI-compatible connections and session histories. A llama.cpp server, a Gemma capture server and an Ollama server are different services; do not convert an existing RunPod connection or send native Ollama requests to it automatically.

Implement one reviewed patch at a time, in the order below. This delivery contains the plan, a source inventory and synthetic contract fixtures under [ollama-native/](ollama-native/README.md). Those fixtures are specifications for future adapter tests, not captured successful server traffic.

No model installation/pull/delete, server management, cloud subscription changes, LoRA, tools, vision, voice or automatic fallback between API dialects. No changes to protocol text, budget tables, retry limits, Field Guide/Viewer Notes learning rules, Research blinding or license/release assets.

## 2. Facts confirmed in this source

| Area | Current evidence | Consequence for implementation |
| --- | --- | --- |
| Provider types | `src/providers/types.ts`: nine kinds, required credentialId; no Ollama kind | Introduce an explicit provider/auth contract; updating one dropdown is insufficient |
| Add/discovery | `src/providers/service.ts`: API key mandatory; model refresh checks secure storage | Keyless discovery needs its own authorized native route, not a dummy key |
| Native dispatch | `src-tauri/src/providers.rs`: credential binding is checked before request construction | Keep that check for keyed providers; validate keyless connection identity natively |
| URL/auth | `src-tauri/src/providers/adapters.rs`: HTTPS or restricted local HTTP; authenticated helper adds headers | Reuse security policy, separate None/Bearer auth; never forward credentials on redirects |
| Storage | migrations 002/019: provider enum CHECK and non-null credential FK | A new provider and real keyless records require an additive migration; do not edit old migrations |
| Viewer identity | `src/aiCenter/viewerIdentityRoute.ts`, migration 020: fingerprint required | Plan identity/storage before exposing a keyless connection |
| Profiles | profile route selection and defaults are credential-based | Add an explicit connection reference for the new provider without reinterpreting existing IDs |
| Sampling | TS capabilities, profile defaults, Research and Rust validation have provider gates | Carry intent through every gate; test the final options JSON |
| Stream | `streaming.rs` implements SSE; transport owns cancellation/timeouts | Reuse transport lifecycle, not SSE framing |
| Replay | continuation transport union contains OpenRouter/Google/Anthropic/Mistral only | Ollama thinking replay needs a separately verified contract |
| Research | frozen config, capabilities, policies, routes and four-prompt Target Code snapshots | Never rewrite old locks/snapshots to activate Ollama |
| Persistence/gates | latest migration is 034; native typed write registry and compatibility checks exist | Schema work must update native writes, repositories, backups and upgrade gates together |

See [source_inventory.json](ollama-native/source_inventory.json) for exact paths and SHA-256 at the reviewed base. The inventory is evidence of inspection, not an exclusive allowlist of files a future compile may require.

## 3. Deployment and supported-version gate

The user's target Ollama server version, host, model/tag/digest, authentication and actual allocated context are **not known**. No local server or RunPod endpoint was probed. The native HTTP API is documented, but examples do not establish a minimum supported runtime version.

Before enabling generation in DIRECT-3C, record a real or controlled supported server version using `GET /api/version`, exact model identifier and model metadata. Pin that version in conformance tests. A version reported by an API response is provenance, not a security proof. Unknown versions/capabilities must remain unknown, not inherit llama.cpp compatibility.

Local operation and direct Ollama cloud inference are separate deployment profiles. Local keyless and HTTPS reverse-proxy Bearer contracts can share a native adapter; direct cloud discovery/model/limits need their own evidence before being marked supported. Do not replace or purchase anything on Edward's account.

## 4. Proposed auth, endpoint and identity contract — first production patch

These are design decisions for review, not fields already present in the app:

- Provider: `ollama_native`. Authentication discriminant: `none` or `bearer`. New Ollama records must declare it. Legacy records of existing providers continue to require their current credential semantics; a missing field must never enable no-auth.
- The canonical base is an origin or explicitly supported reverse-proxy prefix **before** `/api`; append `/api/version`, `/api/tags`, `/api/show` and `/api/chat` exactly once. Reject a pasted `/v1`, `/api/chat`, query, fragment, embedded user/password or unsupported trailing API path with an actionable message. No silent host/path guessing or fallback to `/v1/chat/completions`.
- Local default: `http://localhost:11434`. Preserve the existing local-HTTP security boundary. Test localhost, IPv4 and IPv6 normalization against the Rust URL library; the current source's `::1` comparison is not proof of IPv6 runtime acceptance. Do not broaden HTTP to arbitrary LAN addresses or arbitrary `127.*` values by accident. Remote access uses HTTPS/proxy under existing policy.
- `none` has no credential row, keychain entry, API key, hint or credential fingerprint. It has a genuine persistent connection identity, generated independently of model output. A connection ID is not an authenticated identity of the remote model/server.
- `bearer` uses the existing OS secret store and endpoint-bound credential contract. An API key never returns in IPC, diagnostics, exports or model messages. Never weaken `secrets.rs` globally to accept an empty secret.
- For native generation/discovery, resolve providerConfigId from trusted persistence, then validate provider, auth mode, normalized endpoint and connection revision. Do not accept a caller-supplied authMode=none as permission to bypass an existing key binding. Existing discovery IPC currently lacks providerConfigId: extend it deliberately for this provider.
- Freeze route/auth identity and connection revision in new run snapshots. Changing an endpoint/auth mode applies to new calls only after the usual validated change flow; it does not relabel a frozen run. Resume refuses incompatible routes. Delete/recreate at the same URL is a new connection identity.
- None-to-Bearer or Bearer-to-None is an explicit identity transition, not automatic recovery from 401. Never retry a failed authenticated request without auth. Retain old notes/Field Guides under their old identity; do not merge memory across the transition.

### 4.1. Schema and profile design to settle in DIRECT-3B1

Use a real, typed connection-identity branch rather than putting `local`, an empty string or a route hash into `credentialFingerprint`.

Recommended shape: provider config has explicit auth mode and connection identity/revision; credential FK is nullable **only** for Ollama none, with a CHECK requiring it for Bearer and all existing providers. Profiles gain an optional explicit provider-config reference for new Ollama routes; legacy credential-based selection retains its present ambiguity checks. New AI identity input is discriminated as credential identity or connection identity. Keyless AI identities carry no credential fingerprint/display and use a separate uniqueness rule based on profile, connection identity/revision, provider, endpoint, model route and role. Keyed identities retain the existing credential identity rule.

The current `ai_identities.credential_fingerprint NOT NULL` and children referencing `ai_identities` make this a migration, not an app_settings flag. Before writing that migration, enumerate **all** dependent FKs, unique constraints, triggers, purge/archive paths and snapshot shapes. Rebuild tables only with a transaction/backup strategy proven against real SQLite. Preserve every old row ID, memory source/provenance and frozen JSON/hash. Do not use placeholder fingerprints to avoid this work. Reserve the next migration number from the actual implementation HEAD; 035 is only the next number at this base.

Cover pre-migration backup, interrupted migration, rollback and reopening with the supported app version. Do not promise old binaries can read the upgraded schema. Browser mode keeps its current explicit native-credential restrictions; test equivalent route/snapshot behavior without enabling browser-side secret storage or direct local HTTP.

## 5. Native discovery and provenance

Use the documented endpoints [S1–S4]. Display discovery status separately from generation readiness.

1. `GET /api/version`: server provenance; do not interpret missing/invalid version as current.
2. `GET /api/tags`: list installed/available model identifiers and digest/details when supplied. Preserve exact tag/name; do not reduce it to a family name.
3. `POST /api/show` with exact selected model: capture capabilities, parameters, architecture context metadata, thinking controls, renderer/template provenance when available. No verbose tokenizer dump by default. Metadata can be incomplete; missing thinking metadata does not prove thinking is absent.
4. Optional `GET /api/ps`, on explicit diagnostic or readiness checks, observes running-model context. It is not a rapid poll, does not load a model and is not proof a later request uses the same allocation.
5. Store source/version/time/digest alongside capabilities. A model tag that resolves to a changed digest, template/renderer or capability contract invalidates a frozen Research/resume compatibility check until explicitly resolved. Do not silently remap old model IDs or change memory provenance.

404/405 on native discovery is a native-contract failure, not a signal to try OpenAI discovery or generate on an unconfirmed service. Preserve existing cached models on a failed refresh where the existing repository contract allows; show stale/error state. No automatic model pull. No generating health check in the keyless discovery-only patch.

## 6. Generation contract for DIRECT-3C

| Harness intent | Native wire rule |
| --- | --- |
| Ordered system/user/assistant history | `POST /api/chat` with model + messages; fresh session history remains fresh |
| Response limit | positive `options.num_predict` from the existing frozen stage budget |
| Context allocation | optional explicit `options.num_ctx`, independent of output policy |
| temperature / topP / topK / seed | `options.temperature`, `options.top_p`, `options.top_k`, `options.seed` when explicitly requested and supported |
| Auto sampler/think | omit that field; do not materialize a server default into requested settings |
| Thinking control | separate `think` value discovered for that exact model; see section 9 |
| Non-streaming | explicit `stream:false` |
| Streaming | explicit `stream:true`, native NDJSON; see section 8 |

Never send OpenAI token fields, OpenRouter routing, stream_options, random_seed or generic reasoning_effort to this endpoint. Preserve representable manual zeros; validate numeric types/ranges against the selected contract, not truthiness. The existing safe TypeScript integer range remains a transport boundary; do not add negative seed support casually. Unknown parameter support is not verified application of a value. Unknown output maximum is not a license to invent a server capability or lower established stage budgets.

The settings path must cover First Run/Create/Edit Profile → defaults → effective settings → Research conditions/Lock → session/training/telepathy/conversation snapshots → IPC → native validation → final JSON. Test Viewer, Monitor, Judge, learning and post-Reveal roles separately. Keep separate legacy behavior when the new transport metadata is absent.

## 7. Context safety is a generation readiness gate

Preserve the current budget and context policies of all other providers. Never set num_predict=-1, reuse num_ctx as max output, silently lower a frozen experiment budget or truncate message history in the client.

For Ollama record separately: declared model context, explicitly requested allocation, latest observed running allocation, generation budget and input-token estimate with its method/confidence. `/api/show` describes the model; `/api/ps` is a time-specific observation. Neither alone guarantees full-context processing of a later call [S4–S6]. Setting a larger context may require more memory; no universal 64K/128K default is introduced by this plan.

The reviewed chat schema does not advertise a `truncate:false` switch. Do not invent one or assume an embeddings option works for chat. Before DIRECT-3C becomes usable for automatic sessions/Research, establish a version-pinned fit check (prompt template + history + output reserve + safety margin) with a trusted tokenization/counting or server-side rejection contract, and prove oversized requests are rejected rather than silently accepted after dropping history. A character estimate is diagnostic, not proof. Counts returned after generation cannot establish that the full original input was processed.

If full-input safety cannot be demonstrated for the selected deployment, fail generation preflight with an explicit context-unverified/insufficient message. Keep discovery available. Do not present a guessed context value as a confirmed experiment setting. Resolving this gate is part of 3C, not permission to add a tokenizer package, hidden generation probe or unreviewed proxy now. A conservative estimator may remain a preliminary check, explicitly labelled as such.

## 8. Response, NDJSON and STOP contract for DIRECT-3D

Non-stream and stream share a provider-specific result normalizer and existing semantic completeness/recovery policy. Retain raw done_reason and original terminal evidence; map known stop/length outcomes deliberately. Unknown reasons stay unknown. done=true is a transport boundary, not proof of valid domain content. Empty or thinking-only results remain incomplete. Never replace final content with thinking [S1, S7–S9].

New decoder: `src-tauri/src/providers/ollama_streaming.rs` (proposed, not present here). Frame bytes by newline, retain partial UTF-8 until a full line, accept LF/CRLF and a valid final JSON line without trailing LF, and reject invalid UTF-8/JSON. Bound pending line, accumulated response and metadata bytes; start from existing shared limits (2 MiB pending/16 MiB accumulated) and test exact boundaries without changing other providers. Bound non-streaming bodies too. Do not feed NDJSON to the SSE parser or require data:/[DONE].

Process content/thinking present in the terminal done=true frame **before** finalization. Require done=true for completed stream framing; EOF first is incomplete. Reject or ignore any trailing extra frame according to an explicit tested rule; never add it to the accepted final answer after the boundary. Error objects, including HTTP 200 mid-stream errors, are failures with any prior semantic output recorded. Preserve available final candidate/evidence through existing response/checkpoint machinery; an in-flight call must not be duplicated.

Reuse transport request identity, native workflow ownership, cancellation registry and class-specific first-event/idle/emergency deadlines. Both thinking and content start semantic output; role-only/keepalive does not. A parse or connection failure after semantic output must not trigger an automatic fresh generating call. Let each existing controller decide an explicitly authorized missing-stage retry. Preserve separate Telepathic Training/Conversation rules.

Manual STOP takes precedence over terminal parsing, loop detection and retry. Abort the local call once, retain valid saved evidence and use existing STOP/Resume controls. Disconnect is not proof the server freed GPU; actual server behavior is a separate smoke. Do not add unload/keep_alive=0 requests as implicit STOP. Internal repetition guards receive every delta; buffered preview errors remain isolated as in PERF-STREAM-3.

Metrics: retain native input/output counts when present, including cached prompt count and native nanosecond timing fields [S9]. Mark unavailable counts/cost unknown, not zero. Do not invent a separate reasoning token count or billable cost. Convert units once, label native and measured wall time separately, and avoid summing partial-frame usage twice.

## 9. Thinking/replay for DIRECT-3E

Discover `thinking.values/default` per model. Use an explicit typed Ollama setting, e.g. `think: {mode:default}` or `{mode:value,value:boolean|string}`. Do not squeeze arbitrary supported strings into global ReasoningEffort. Metadata absence stays unknown; false in a request must not be displayed as guaranteed no-thinking for every model [S8].

The documentation separates output message.thinking from message.content, but the reviewed chat input schema does not settle all model-specific thinking-history requirements. Before enabling thinking controls, verify the selected server/model's multi-turn replay. Do not blindly resend reasoning, omit a required native assistant state, infer thinking from literal tags in final text or reuse another provider's continuation format.

If required, introduce an `ollama-native` continuation state with version, endpoint/auth/connection identity, model identifier/digest and exact provider-specific assistant state, checked by both TS and Rust. Preserve replay byte/size limits and existing persistence binding. No shared continuation union expansion without cross-language fixtures and bridge tests. If a reliable contract is unavailable, leave the unsupported control unavailable with a specific explanation; ordinary model-default output still requires a proven multi-turn contract before automatic sessions are enabled.

## 10. Delivery sequence and acceptance gates

| Patch | Implement | Required evidence before next patch |
| --- | --- | --- |
| **DIRECT-3A (this delivery)** | Source audit, API contract, fixtures, schema/identity/context decisions and test matrix | Docs/fixture validation; independent plan review; no runtime support claim |
| **DIRECT-3B1 — identity/storage foundation** | Discriminated auth/identity, new route reference, additive migration, native trusted connection resolution and legacy compatibility; feature not exposed | Real SQLite upgrade/FK/rollback/backup/reconnect; Browser parity; no fake key/fingerprint; old snapshot/hash and all existing provider gates unchanged |
| **DIRECT-3B2 — settings/discovery** | Create/edit local None or HTTPS Bearer connection, native version/tags/show, provenance and model selection | Restart/settings/identity isolation; endpoint/auth failures preserve prior record; keyed OS-store smoke separately; generation remains unavailable until 3C |
| **DIRECT-3C — non-stream generation/settings** | Final request options, JSON parser, frozen settings/Research, context-fit safety gate and multi-turn default-model behavior | Exact request/response fixtures and oversized-context rejection; all modes/roles; no silent history loss; full automated gates; no NDJSON claim yet |
| **DIRECT-3D — NDJSON/STOP** | Decoder and stream normalization integrated with existing ownership/timeouts/preview/guards | Byte-split UTF-8, terminal content, HTTP200 errors, EOF/limits, STOP races, receipt/reconnect; no duplicate after semantic output |
| **DIRECT-3E — model thinking/replay + runtime acceptance** | Verified typed controls and continuation if needed; final cross-mode acceptance | Cross-language replay, thinking-only rejection, native CI/Clippy and Windows + actual Ollama server smoke |

This splits the original 3B into reviewable foundations and UI/discovery. Do not fold B–E into one overlay. The next **production** patch after accepted 3A is B1. If its migration or identity design cannot preserve existing invariants, resolve that concrete design before exposing keyless configuration. No changes to other providers to work around an Ollama limitation.

## 11. Behavioral test matrix for implementation

| ID | Scenario | Expected acceptance evidence |
| --- | --- | --- |
| AUTH-1 | Local None, no OS key entry | True keyless row, no Authorization header, no credential fingerprint/read/store |
| AUTH-2 | Caller forges None for saved Bearer route | Native rejects before network; old key binding remains enforced |
| AUTH-3 | Missing key / 401 / auth-mode or endpoint mismatch | No unauthenticated retry, no guessing another URL |
| DB-1 | Upgrade existing DB at 019/031/034 and fresh install | integrity_check/FK check; exact old IDs, note provenance, configs and snapshot hashes retained |
| DB-2 | Inject failure halfway through migration/save | Atomic rollback or documented recoverable journal; reconnect consistent |
| ID-1 | Delete/recreate, endpoint change, two local routes | No accidental identity or memory merging; old resume fails closed on route drift |
| DISC-1 | version + tags + show exact model | Correct paths/methods, auth and bounded payload; no generation or model pull |
| DISC-2 | 404/405, malformed metadata, unavailable show | Error/unknown state, no OpenAI fallback; preserve exact selected model |
| SET-1 | Auto vs explicit 0 values | Only explicit compatible fields on final options JSON |
| SET-2 | Profile edit after run started | New calls respect frozen snapshot; old runs not silently changed |
| CTX-1 | Model context differs from running allocation | Separate provenance; no fiction that model maximum is allocated |
| CTX-2 | Prompt + output will not fit, or cannot be established | Preflight stops; no truncated session or silent budget reduction |
| JSON-1 | final + thinking + done + counters | Separate fields; native final evidence and metrics preserved |
| JSON-2 | length, empty, thinking-only, unknown reason | Existing completeness policy; no reasoning-as-final |
| ND-1 | Every split position of multibyte UTF-8/LF/CRLF | Identical assembled final; no replacement characters |
| ND-2 | Terminal frame includes content, no trailing LF | Terminal content retained once, counters retained once |
| ND-3 | EOF before done or invalid JSON/UTF-8/oversized line | Incomplete/failure; no accepted completion or automatic duplicate |
| ND-4 | Error object before/after content or thinking, HTTP200 | Correct semantic-output marker; prior evidence retained |
| STOP-1 | STOP before output, during thinking/content, at done | User cancellation wins; no parallel call or hidden unload |
| TIME-1 | Role-only heartbeat, stalled stream, long cold load | Existing operation-class timeouts; no global timeout change |
| GUARD-1 | Text/ASCII loop, preview throws | Guard receives every delta; valid result not rejected by visible preview |
| REPLAY-1 | Two turns, refresh, repository reconnect | Validated native state/route retained; no cross-provider replay |
| RESUME-1 | Saved response vs unknown dispatch vs active call | Reuse persisted result; explicit manual retry where allowed; never duplicate active generation |
| MODE-1 | Conversation + Manual RV + post-Reveal | Frozen settings, history, STOP semantics and context safety |
| MODE-2 | RV Lite/Full RCP/Monitor + classical Training/learning | Existing stage budgets/order/recovery; failed learning does not block the series |
| MODE-3 | Both Telepathy modes | Existing separate policy and retry settlement preserved |
| MODE-4 | Research + target_code PL/EN | Lock, A/B routing isolation, no code in B, blind packets and complete-pair statistics unchanged |
| OLD-1 | Existing nine provider kinds + legacy snapshots | No changed request JSON/identity/budget/discovery behavior |
| DESKTOP-1 | Windows restart + OS store for Bearer | Native SQLite/key store/route behavior observed, not inferred from browser fixtures |
| LIVE-1 | Actual pinned local Ollama, then chosen remote auth route | Exact server/model/digest, allocated context, requests, usage, STOP/replay evidence; redact secrets |

The [fixture catalog](ollama-native/fixtures/contract_cases.json) seeds a subset of these scenarios. Generating more cases, every-byte splits and race/failure injection belongs to the relevant implementation patch, not a claim made by these sample files.

## 12. Files and checks to use

Confirmed TS owners: provider types/service/native/capabilities/requestExecutor/streamingPolicy/continuationContract, profile defaults and dialogs, ProviderSettings/FirstRunSetup in App.tsx, repositories and native write registry, AI identity selection/routes, Research preflight/sampling/Lock and all run constructors. Confirmed Rust owners: providers.rs, adapters/validation/request_builders/response_parsers/transport/streaming/response_evidence, secrets, database write registry, migrations/storage/compatibility gates. Proposed new provider modules should stay behind existing public entry points and architecture rules.

Use the current Developer Guide [checks](README.md#required-automated-checks), package scripts and CI recipes. Behavior patches require targeted final-wire tests, full Vitest/typecheck/build/source/architecture/UX/release gates, native tests and Clippy; continuation changes also require the cross-language bridge. A Rust-only fixture harness is not full Tauri/Windows acceptance. Keep the shared error-size constraint and source-protected protocol hashes unchanged.

For this documentation-only delivery, validate JSON/NDJSON fixtures, source inventory hashes and relative links; run source, architecture, UX-DATA and release-structure checks. No application code, migration, configuration default or lockfile is changed. Report app/native tests not rerun rather than reusing the preceding Research test count as evidence for Ollama.

Each implementation overlay: exact base commit, changed-files ZIP with repository-relative paths, before/after SHA-256 manifest, behavior/test report and honest unperformed runtime checks. Save project documentation below docs; do not recreate root wiki or duplicate notices folders. Do not release or update package versions as part of these patches.

## 13. Primary sources checked on 18 November 2026

These establish public API shape, not live acceptance of a particular server. Recheck on implementation. Samples in this patch are independently authored synthetic fixtures.

- S1 [Chat API](https://docs.ollama.com/api/chat) and [published schema](https://docs.ollama.com/api/chat.md): native request, options and result fields.
- S2 [List models](https://docs.ollama.com/api/tags).
- S3 [Version](https://docs.ollama.com/api-reference/get-version.md). The public schema's own version is not the server version.
- S4 [Show details](https://docs.ollama.com/api-reference/show-model-details). The documentation page is not `/api/show`; the HTTP endpoint is still `/api/show`.
- S5 [Running models](https://docs.ollama.com/api/ps).
- S6 [Context length](https://docs.ollama.com/context-length) and [Modelfile options](https://docs.ollama.com/modelfile). No documented default is adopted as a global Harness setting.
- S7 [Streaming](https://docs.ollama.com/api/streaming) and [Errors](https://docs.ollama.com/api/errors).
- S8 [Thinking](https://docs.ollama.com/capabilities/thinking): model-defined values; absence and false require careful interpretation.
- S9 [Usage](https://docs.ollama.com/api/usage).
- S10 [Authentication](https://docs.ollama.com/api/authentication): local API and direct cloud access differ.

Unknowns remaining for implementation: deployed server version and trust profile; model/tag/digest; exact full-input context-fit proof; target-specific thinking replay; optional cloud capability differences; actual server GPU release after cancellation. None is represented as a passed runtime test here.
