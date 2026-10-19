# Providers, Models and AI Monitor

The source supports native adapters for OpenRouter, OpenAI, Google, Anthropic, Z.AI, DeepSeek, Mistral, Blackbox and Custom OpenAI-compatible endpoints. A deployment must actually support the required chat/model/capability contract; an HTTP URL alone is not proof of compatibility. Custom connections normally use max_tokens and may explicitly choose max_completion_tokens for that connection.

Credentials bind to provider/endpoint identity. Reasoning controls are exact-model/advertised capability contracts, not invented settings. An output allowance can be limited by the chosen endpoint/model and available input context. Reasoning may consume that allowance.

## Current preferred allowances

| Operation | First / recovery |
| --- | --- |
| Conversation | 16,384 default; one-time legacy 8,000/8,192 upgrade, later deliberate reductions preserved |
| Manual RV | 32,768 → 49,152 |
| Automatic blind RV / classic Training Viewer | 16,384 → 32,768 |
| Judge / post-Reveal / classic Training Review | 32,768 → 49,152 |
| Field Guide / Viewer Notes | C+32,768 → C+49,152; C fixed |
| Live Monitor | 16,384 → 32,768 |
| New fixed-lead Telepathy Reveal/comments/final reflection | 32,768 → 49,152 |
| Other new fixed-lead stages / sharing consent | 16,384 → 32,768 / 8,192 → 16,384 |

Frozen Research/telepathic policies keep their saved version, including older pairs. [Current Workflows](../architecture/CURRENT_WORKFLOWS_v0.7.14_EN.md) owns the detailed compatibility table.

## Transport and continuation

Rust performs one physical attempt; TS classifies retry. Partial streamed text is not accepted evidence. Full rejected output can be known finished without being usable; unknown physical outcomes are not erased by a later response. Native cancellation and actual abort diagnoses remain separate from provider failures.

Continuation is stored outside visible transcripts, bounded/validated and tied to exact messages/events and compatible fingerprints. OpenRouter text fragments may be conservatively canonicalized; opaque signature/encrypted state remains exact. Contracted Anthropic replay is limited to append-only frozen Session/Resume prefixes; it is not universally enabled for dynamic Conversation/post-Reveal contexts.

Private reasoning is not a final answer. Literal think tags inside JSON remain data. A bounded final-channel learning candidate can be retained/exported for offline review without exposing private reasoning.

AI Monitor operates only on supported monitored flows. It cannot rewrite sealed Viewer evidence, and classic Training/Research do not gain an extra live Monitor role from the budget table.


## OpenRouter additional sampling parameters

OpenRouter Viewer profiles can optionally enable additional sampling controls for `top_p`, `top_k`, and `seed`. They are disabled by default. Auto is represented by omission of the field, not by a numeric substitute; therefore manual zero remains distinct from Auto where the API contract permits zero.

The existing Viewer temperature control remains separate and is never enabled/disabled by the additional-sampling section. Sampling controls are not automatically inherited by separately configured AI Monitor or AI Judge roles and are not automatically shared across provider configurations. Direct Mistral and Blackbox, as well as Custom OpenAI-compatible connections, have their own supported additional-sampling paths described below.

The UI preserves manual values when the selected model changes. If the selected model reports a parameter as unsupported or unknown while the section is enabled, profile save is blocked for that active manual value until the user explicitly returns that parameter to Auto, selects a compatible model, or disables the section. Disabled values may remain stored but are inactive.

At execution time, manual sampling requires confirmed capability at the concrete OpenRouter endpoint level and the normal context/prompt/output/reasoning constraints must still fit. Small requests also run the capability preflight when any additional sampler is manual. Unknown sampling capability fails closed before dispatch. `provider.require_parameters=true` is added only for active manual additional sampling.

A fixed seed can improve within-route repeatability but does not promise identical outputs across different providers, endpoint variants, model revisions, routing decisions or backend implementations. Manual sampling may narrow eligible endpoints and therefore can change availability, latency or price.

## Application identification in provider requests

Provider requests do not add `HTTP-Referer`, `X-OpenRouter-Title` or `X-Title` application-attribution headers. The shared native HTTP client does not set an application-specific `User-Agent`. This applies to new requests after installing a build containing this change; it does not alter historical OpenRouter activity.

The API key still authenticates your account. The label displayed for unattributed requests is controlled by OpenRouter; the application does not send a literal `Anonymous` title. Model routing, sampling settings and session behavior are unchanged.

## Direct Mistral and Blackbox — implemented 19 October 2026

Mistral supports optional top_p, top_k and seed (sent as random_seed), plus direct SSE. Thinking and final text stay separate; compatible replay is preserved outside the visible transcript.

Blackbox supports optional top_p, top_k and seed plus direct SSE. The legacy api.blackbox.ai address is unchanged. For Enterprise or Dedicated, enter the matching HTTPS origin and use First Run/Create Profile to enter the exact model ID. Non-legacy discovery is intentionally unavailable; this does not prove a bad API key. Provider Settings refresh is not the manual-model registration path. Manual IDs and capabilities remain unverified until tested on the real server.

Auto omits sampler fields. A successful request does not prove that the selected backend applies every sampler; a seed is not a guarantee of repeatability. No OpenRouter routing object is added. Existing budgets, Training behavior and STOP/Resume remain unchanged.

See the [direct provider guide](../development/DIRECT_MISTRAL_BLACKBOX.md) for details. Ollama Native is planned as the next separate adapter; it is not available through these changes. Copying these wiki source files to the application branch does not publish the separate GitHub Wiki.
