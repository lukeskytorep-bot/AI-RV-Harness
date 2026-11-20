# Ollama Cloud thinking controls and continuation

20 November 2026. Follow-up to the accepted CLOUD FINAL, based on ai-rv-2 `8af476c`.

## Controls

The existing reasoning selector now resolves native Ollama `think`, not another API's `reasoning_effort`. Auto omits think. Boolean controls use JSON true/false; documented named levels use exact strings. Requested sampler values, zeroes and stage output budgets are unchanged. No separate reasoning-token budget is invented.

Thinking controls are model-specific. `ollamaThinkingCapability` consumes a model's `thinking.values` metadata when present; otherwise a deliberately limited documented contract list supplies GPT-OSS 20b/120b levels and the listed Qwen3/DeepSeek-R1 boolean contracts. Unknown models retain Auto. It does not infer support from a model merely returning a thinking string. The current Cloud catalog reads `/api/tags`; this delivery does not add a mandatory `/api/show`, local-daemon requirement or billed probe. If a model's exact name/contract is not covered and discovery supplies no thinking metadata, its manual controls remain unavailable. Model-defined named values outside the application's existing effort vocabulary also remain unavailable rather than being silently remapped.

## Continuation

Native JSON and aggregated NDJSON responses preserve thinking separately from final content. The adapter returns bounded typed thinking/text chunks for the common continuation infrastructure. The stored transport is exclusively `ollama-cloud`, format `ollama-thinking-content`, version 1. This internal chunk representation is not sent as Mistral JSON: native request construction restores the exact string into an assistant message's `thinking` field alongside `content`.

Conversation and the existing frozen Session continuation paths persist the state with its owning assistant message/event. Reopen/Resume hydrates that state. Provider, connection, credential ID, endpoint and requested model must match; the visible assistant text must match the stored chunks. Missing/invalid persisted state follows the existing controlled failure/text-only recovery policy. Legacy snapshots without a continuation route retain text-only replay; they are not silently reinterpreted. No private thinking is inserted into user/system messages or automatically moved between participants, independent requests or providers. Existing domain request boundaries remain authoritative.

Migration 037 widens only the two existing continuation-table transport constraints. It copies all columns/bytes and rebuilds indexes/FKs. It admits Cloud and the already implemented Mistral transport, which the historical table constraint omitted. Other provider behavior and historical migrations are unchanged. Current-version assertions move to 37; historical migration-range tests remain historical.

Native diagnostics redact thinking/reasoning-content fields. EOF, length, cancellation, response validation and STOP retain their existing rules; thinking is never substituted for a final answer. The shared per-state/request bounds and context estimator include the state.

## Verification boundaries

Tests use fixtures, Browser persistence and actual SQLite migration rollback/commit/FK behavior, plus the existing loopback streaming tests. The portable Rust harness compiles production modules with extracted DTOs and GUI stubs. Full Tauri/Windows keyring and a real Cloud account must be reported separately; fixture success is not a remote conformance measurement.

The next, separate scope is Custom OpenAI-compatible servers: Gemma Python/PyTorch and supported llama.cpp templates. This patch does not activate their thinking replay or alter server scripts.

Official contracts reviewed: https://docs.ollama.com/capabilities/thinking and https://docs.ollama.com/capabilities/tool-calling (assistant thinking field and accumulated streaming history). Availability of controls remains model-specific.
