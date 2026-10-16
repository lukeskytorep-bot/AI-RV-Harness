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
