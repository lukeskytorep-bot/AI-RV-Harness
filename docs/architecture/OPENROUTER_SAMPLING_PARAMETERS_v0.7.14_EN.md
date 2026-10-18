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

Classic Training explicitly selects `preserve_and_continue` for optional Viewer Review and learning. Unavailable optional Review is recorded in the checkpoint, dependent learning is skipped while previous memory is preserved, and Training continues to eligible later stages and targets. Invalid proposals use only the existing bounded recovery. Unknown optional-learning results are handled by preserving previous memory without another paid dispatch or operator resolution; this does not assert transport success. STOP, actual ownership loss, database/hash/identity errors, and mandatory evidence failures retain their interruption semantics. Other workflows retain their own uncertainty contracts.

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

## Research inheritance

Existing Research templates inherit enabled manual `top_p`, `top_k`, and `seed` from the selected base Viewer Profile as one common controlled setting. The Research builder reads the stored user intent directly rather than relying only on capability-resolved defaults, so an unsupported or unknown manual value cannot disappear silently. Profile/model comparisons keep that one base-Profile sampling configuration constant and require every compared Viewer route to confirm support before Experiment Lock. Auto/disabled values remain omitted, explicit zero remains manual, and later Profile edits do not change locked or resumed Research. The Dry Run and locked project summary expose the frozen values. Judge/Monitor routes do not inherit them.

## Research sampling-grid contract

Research supports a dedicated `Sampling configurations` template on top of the same OpenRouter sampling, endpoint qualification and Session snapshot contracts described above. Each of `top_p`, `top_k` and `seed` is fixed or varied. Varied axes contain at least two unique valid numeric values; fixed Auto omits the field. The grid is the full deterministic Cartesian product and is materialized as ordinary `ResearchConditionDefinition` records before Experiment Lock. No separate sampling execution engine exists.

The frozen design metadata and generated conditions are cross-validated in both Planner and Preflight. Sampling Research requires explicit Research-owned Viewer sampling control, and all non-sampling inputs (including any condition instruction) must remain identical across conditions. The configured grid is capped centrally before Lock rather than truncated.

Results and private exports preserve structural sampler values and requested/effective generation settings. Session-result provenance aggregates provider-reported Viewer call metadata already captured by the Session event ledger, including actual provider/model when supplied, generation/request identifiers, usage, cost and request duration. Missing metadata remains unknown and is never inferred from the configured route.

Blinding remains strict: sampling values, condition mappings, Profile/model identity and route/provider provenance are not added to live Judge input or the `external_evaluation` package. In save-only exports these details remain under `private_master`; after normal Unblind they are available in the results/configuration export for analysis.
