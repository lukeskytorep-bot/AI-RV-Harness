# Custom OpenAI compatibility: Generic and llama.cpp

Existing Custom OpenAI-compatible connections can select a compatibility variant
in Settings → Providers → connection settings. Generic is the default for new
and legacy connections. The variant does not change the endpoint, credentials,
model assignments, SSE choice or output-token field.

The llama.cpp variant changes explicit Custom Reasoning On/Off requests to:

```json
{"chat_template_kwargs":{"enable_thinking":false}}
```

On sends `true`; Off sends `false`; Auto adds no thinking field. Generic retains
its existing `reasoning.enabled` / `reasoning_effort` contract. llama.cpp does
not translate effort levels or a reasoning-token budget into a boolean: an
explicit unsupported setting fails before dispatch. Sampling, context/output
budgets, retries, response parsing, STOP and protocol prompts are unchanged.
The server version and model chat template determine whether `enable_thinking`
has an effect; accepted JSON is not proof of model behavior.

## Persistence and freezing

The connection setting is `provider.customCompatibilityProfile.<id>` in the
existing SQLite `app_settings` table. No schema migration is needed. Browser
preview persists the equivalent field with the provider record. Missing means
Generic; invalid values fail validation. Provider deletion removes its setting.

`newRunGenerationSettings()` is a new-run boundary helper. It copies the current
connection choice to `GenerationSettings.customCompatibilityProfile`, which
`resolveGenerationSettings()` explicitly validates and copies to `effective`.
Never use this helper to fill missing fields in a legacy Resume snapshot.

- Conversation/Manual RV capture the setting with the new pending turn; retry
  uses the saved turn settings.
- New automatic RV and Training capture it before their execution snapshot.
  Training captures separate Judge settings; old Training snapshots without
  these fields retain Generic.
- New telepathic participants freeze wire settings in the AI route snapshot.
  Route resolution combines the frozen wire setting with the existing profile
  defaults. A legacy AI snapshot without the setting retains Generic.
- New Research captures Viewer and Judge settings before preflight, hashing and
  Experiment Lock. Locked execution never refreshes the variant from the live
  provider configuration.
- Monitor settings are captured with the RV session; later Monitor calls and
  post-Reveal use that snapshot. Standalone Monitor/Judge calls capture once for
  that operation. Their recovery/repair calls reuse the captured settings.
- Field Guide/Viewer Notes use the existing frozen Viewer settings. A legacy
  request without the field is not upgraded from today's connection.

The native bridge reads only the effective frozen setting, using Generic for a
legacy absence. Rust validates the discriminator and unsupported combinations
before building the network dispatch. The common builder supplies both SSE and
non-SSE requests. Other provider branches retain their existing behavior.

## Acceptance

Relevant regressions include `customCompatibility.test.ts`,
`customCompatibility.sqlite.test.ts`, `customCompatibilityFreeze.test.ts`,
`customCompatibilityLock.test.ts`, and
`ProviderSettingsCompatibility.dom.test.tsx`. Native cases are in
`providers/tests.rs` with names beginning `custom_llama_`.

Historical Monitor/prompt execution hash tests normalize only the new frozen
setting plumbing; their accepted hashes remain unchanged. Do not normalize
prompt content, decision parsing or retry policy to accommodate this feature.

Desktop/endpoint acceptance remains separate from controlled tests:

1. On Windows, save Generic → llama.cpp → Generic and reopen the connection
   settings; check that endpoint/key/model/SSE/output-field choices are retained.
2. With the exact llama-server build and model template recorded, inspect
   requests for Auto/On/Off in SSE and non-SSE mode. Record whether thinking
   actually changes. Do not infer success from `finish_reason=stop` alone.
3. Start/STOP a run, change the connection variant, and Resume. Confirm the
   saved variant remains, including a legacy snapshot without the field.
4. Repeat with Training/Research and independently configured Monitor/Judge
   routes. Preserve uncertain-dispatch and endpoint compatibility rules.

This feature does not add `/slots` polling or an Ollama Native API adapter.
