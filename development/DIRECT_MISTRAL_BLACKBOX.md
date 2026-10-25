# Direct Mistral and Blackbox providers

Updated 19 October 2026 against the supplied ai-rv-2 source. DIRECT-1 (Mistral) and DIRECT-2 (Blackbox, including the 2E nested-choice-error correction) are implemented. This is an as-built source record, not a claim that every account/model or Windows release has passed live acceptance.

## Configuration and supported scope

| Item | Mistral direct | Blackbox direct |
| --- | --- | --- |
| Default base | https://api.mistral.ai/v1 | https://api.blackbox.ai (legacy, preserved) |
| Explicit base override | No new override | Optional HTTPS blackbox.ai origin or subdomain, without API path, query or fragment |
| Chat path appended by Harness | /chat/completions | /chat/completions |
| Model discovery | /models | Legacy /models retained; non-legacy routes do not guess discovery |
| Manual model ID | Not introduced by this work | First Run / Create Profile shared setup for non-legacy routes |
| Additional Viewer samplers | top_p, top_k, random_seed | top_p, top_k, seed |
| Output wire field | max_tokens | max_tokens |
| Transport | Chat Completions SSE | Chat Completions SSE |

Mistral: add a Mistral connection and key, load models, select a Viewer, and optionally enable additional sampling. Harness maps its seed setting to random_seed, not seed.

Blackbox: choose the product and endpoint that match your account. Enterprise examples use https://enterprise.blackbox.ai; Dedicated deployments use an organizational origin. Enter the origin only, not the full chat URL. No automatic migration from api.blackbox.ai occurs. Keys stay bound to provider/endpoint identity; rebind or create the matching connection rather than bypassing binding checks.

For a non-legacy Blackbox connection, use First Run or Create Profile and enter the exact model ID from your account/deployment. The shared setup registers it without calling /models and selects it as Viewer. Provider Settings exposes the endpoint, but its ordinary refresh action still cannot discover a non-legacy model list; manual registration is provided by profile setup. A discovery limitation is not proof of a bad key or a broken chat route. Entering api.blackbox.ai explicitly has the same legacy discovery policy as leaving the default unchanged.

Manual records are marked manual_model_id, discoveryVerified=false and capabilitiesVerified=false. They preserve other models of that connection and do not invent vision, reasoning, temperature or streaming capabilities from the model name. Blackbox streaming and additional-sampling dispatch are service adapter decisions; conservative model metadata is not server verification. A typo or unavailable model ID can still fail on actual dispatch.

## Samplers, Research and limits

Additional Viewer sampling is opt-in and separate from temperature. Auto omits a field. Disabled settings may remain stored but are inactive. Manual zero remains distinct from Auto where the API contract allows it. Profile values are not automatically applied to independent Judge or Monitor configurations.

Profile defaults, settings resolution, existing Research sampling policy/locked settings and IPC preserve the enabled values. Editing a profile must not rewrite a running experiment's frozen settings. Research records requested/sent values; it must not represent them as measured server-effective values. Blackbox manual model metadata can have no advertised supportedParameters while the documented service adapter allows these request fields.

The Blackbox documentation contains inconsistent top_k bounds across pages; the Parameters page permits zero. A successful request is not proof that a routed model applies a given value. Seed does not guarantee identical answers across providers, versions, quantizations or runtime configurations. Harness does not add an OpenRouter provider object or require_parameters to these direct requests.

This work changes neither accepted context/output budgets nor learning capacities, retry limits, Training continuity, checkpoint semantics or STOP/Resume. Keep the existing finite budgets; do not lower them to an example/default from provider documentation.

## Streaming and completion

Both adapters send stream=true and use the existing bounded SSE transport, incremental UTF-8 decoding, timeouts and cancellation. They do not send stream_options.include_usage. Usage-only frames with empty choices preserve earlier content. Missing usage does not invalidate an otherwise complete response. Missing counters/costs must remain unknown, not fabricated.

A stream requires its complete boundary ([DONE] in the implemented Chat Completions contract). EOF before that boundary is a transport failure, even after partial text. done/stop finish reasons do not mean the user clicked STOP and do not prove domain JSON or learning-capacity validity. HTTP 200 alone is not completion. Verify actual framing on the target account during live smoke.

Mistral content can alternate thinking arrays, mixed thinking/text arrays and strings. The accumulator reconstructs the assistant message, the parser separates private reasoning from visible final content, and compatible continuation state preserves replayable chunks outside the transcript. Replay is route/model/credential bound and used only by existing wired workflows; it is not a promise of universal replay across every mode.

Blackbox preserves content, reasoning, reasoning_details, returned model/provider and usage when supplied. Its stream detects both top-level errors and non-null choices[0].error, normalizes the latter through the existing provider-error path, redacts the key from messages and preserves request identity plus semantic_output_started. error:null is neutral. Partial output is not turned into a successful final or permission for a blind automatic retry.

STOP uses the shared native cancellation path. Do not add a second cancellation system, tighter retry policy or per-token IPC polling for these adapters.

## Code map and regression checks

- UI/defaults: src/features/profiles/, src/profileViewerDefaults.ts, src/providers/openRouterSamplingSettings.ts.
- Research: src/research/samplingPolicy.ts and existing lock/snapshot flow.
- Native bridge: src/providers/native.ts.
- Rust: src-tauri/src/providers.rs and providers/{adapters,validation,request_builders,response_parsers,reasoning,streaming}.rs.
- Mistral continuation: src/providers/mistralContinuation.ts and existing session continuation integration.
- Regression evidence: providers/tests.rs, direct1cMistralSampling.test.ts, direct2cBlackboxManualModel.test.ts, direct2dBlackboxSampling.test.ts and sampling/profile/Research tests.

Run tsc -b, relevant Vitest, architecture checks and native Cargo tests/Clippy. Static verify-direct-providers scripts supplement behavior tests; substring matches do not prove API compatibility. Native simulator tests do not prove server behavior. Test ordinary chat, multiple turns, content/thinking separation, usage-only/no usage, errors before/after output, EOF, STOP and existing resume contracts. Windows acceptance and a target-account smoke are separate records. Do not mark unavailable checks as passed.

## Planned: Ollama Native

Ollama Native is not implemented by DIRECT-1/2. It is the next planned provider stage (DIRECT-3); Z.AI, DeepSeek and OpenAI follow later. A future AI must first inspect the current source and prepare an implementation plan. Native /api/chat, /api/tags and /api/show require their own adapter and model discovery. Streaming is NDJSON with done:true, not SSE/[DONE]; samplers belong in options, and the output limit maps to options.num_predict. Preserve existing budgets and explicitly address num_ctx without silently reducing context. Local unauthenticated connections need a deliberate identity design, not fake API keys. Do not replace or alter Custom OpenAI-compatible integration as a shortcut. No Ollama code is delivered in this documentation overlay.

## External references

- https://docs.mistral.ai/api/endpoint/chat
- https://docs.mistral.ai/studio/conversations/reasoning
- https://docs.blackbox.ai/api-reference/introduction
- https://docs.blackbox.ai/api-reference/parameters
- https://docs.blackbox.ai/api-reference/responses
- https://docs.blackbox.ai/api-reference/dedicated/introduction
- https://docs.ollama.com/api/chat
- https://docs.ollama.com/api/streaming

Recheck documentation and the selected model/server before future implementation; these references are not live acceptance evidence.
