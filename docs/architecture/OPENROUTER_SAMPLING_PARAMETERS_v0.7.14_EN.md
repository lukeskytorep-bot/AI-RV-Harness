# OpenRouter Additional Sampling Parameters

**Development line:** v0.7.14 candidate  
**Schema:** 32  
**Scope:** OpenRouter Viewer profile/session generation only

## Contract

The Harness adds an optional **Additional Sampling Parameters** section for OpenRouter Viewer profiles. It controls `top_p`, `top_k`, and `seed`. Temperature remains the pre-existing independent Viewer setting.

The section is disabled by default. For each sampler, **Auto means omission from the wire request**. A numeric zero is not Auto. Stored values may be retained while the section is disabled, but they have no execution effect until the user explicitly enables the section again.

## Validation

- `top_p`: finite number in `0..=1`; UI step 0.01 does not reduce stored precision.
- `top_k`: non-negative safe integer; the slider is a convenience range, not a universal API maximum.
- `seed`: non-negative JavaScript-safe integer (`0..=9,007,199,254,740,991`) for lossless TypeScript/JSON/Rust/SQLite transport.
- `enabled` is a real boolean; string/number/null substitutes are rejected.

When the section is enabled, an active manual value cannot be saved against a selected model whose capability is `unsupported` or `unknown`. The value is preserved in UI state; the user can set that parameter to Auto, choose a compatible model, or disable the section.

## Ownership and snapshots

The settings belong to the Viewer configuration. They are not automatically copied to independently configured Monitor or Judge roles. Non-OpenRouter providers do not receive these fields.

Effective generation settings are frozen into the existing Session/Research snapshot contracts. Resume and Experiment Lock use the frozen values, not later profile edits. Legacy snapshots without these fields mean Auto/disabled.

## Routing and dispatch

Any manual additional sampling value forces OpenRouter endpoint capability preflight even for requests below the normal capacity-risk threshold. A candidate endpoint must satisfy both:

1. existing capacity/routing requirements (context, prompt, output, reasoning, availability, `only`/`ignore`/`order`/fallback policy); and
2. confirmed support for every active manual sampler.

Unknown sampler support is not accepted as proof of compatibility. A selector that could reopen a rejected endpoint variant cannot be declared verified. If the Harness cannot guarantee the qualifying route, it stops locally before dispatch.

For qualifying manual requests the OpenRouter provider object adds `require_parameters: true`. This is a wire safeguard only; it does not replace local capacity or endpoint-variant filtering. Auto/disabled requests preserve legacy payload semantics and do not add the flag.

## Training Continuity T5

Mandatory Viewer/Reveal/Review stages retain their normal interruption/checkpoint semantics when no safe route exists. Optional classic-Training Field Guide or Viewer Notes updates may use the existing `failed_preserved` path for a known, resolved preflight/execution failure, preserving prior memory and continuing the Training workflow. STOP, owner/lease, database, hash/identity, or unknown-dispatch states are never converted to `failed_preserved`.

The existing durable maximum of two physically dispatched requests per memory category remains unchanged. A local preflight rejection with zero dispatch does not count as a sent provider request.

## Reproducibility and cost caveats

A seed is not a cross-provider determinism guarantee. Results may still change with endpoint implementation, model revision, backend sampling implementation, provider routing, prompt state, continuation state or infrastructure changes.

Manual parameters can reduce the number of eligible routes. That may change route availability, latency and price compared with Auto. The Harness records requested/effective settings and routing diagnostics where reliable but does not claim the model actually honored an internal sampler merely because the API accepted a request.

## Runtime acceptance checklist

A release candidate should verify with an operator-approved OpenRouter credential:

1. legacy OpenRouter profile: no `top_p`, `top_k`, `seed`, or new `require_parameters`;
2. non-OpenRouter provider: unchanged payload;
3. enabled + all Auto: unchanged sampling payload;
4. `top_p=0.04`, `top_k=0`, `seed=42` survive save/restart and are frozen in a new Session snapshot;
5. small manual request performs endpoint capability qualification;
6. endpoint with unknown sampler capability is stopped before dispatch;
7. large Training Reveal chooses only an endpoint that fits both sampling and output/context requirements;
8. STOP/Resume continues with frozen sampling settings after the profile is edited;
9. Research Experiment Lock remains unchanged after profile/model edits;
10. optional Guide/Notes known failure follows Training Continuity T5 and does not create a third physical attempt;
11. exact endpoint/provider-variant enforcement is confirmed against real OpenRouter routing behavior;
12. diagnostics/export distinguish Auto/omitted from manual requested/wire values without secrets.

Paid runtime tests are evidence for the exact candidate and should not be inferred from unit tests alone.
