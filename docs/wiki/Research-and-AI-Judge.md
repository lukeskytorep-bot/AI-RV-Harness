# Research and AI Judge

Research freezes comparisons: configuration, target/condition assignments, Viewer inputs, learning snapshots, policies and blinding. Resume uses those exact inputs and the linked Session, not today's defaults or a replacement paid Session. Research never writes Field Guide or Viewer Notes.

Viewer Notes and Field Guide have independent OFF/CURRENT controls. Viewer Notes Impact holds one common Field Guide setting across conditions. Prompt Research can compare manual prompts or 2–4 selections from the six recent exact-identity/language Guide versions. Lock captures full content, version and hash.
Existing Research templates now inherit the base Viewer Profile's enabled manual OpenRouter `top_p`, `top_k`, and `seed` as one common controlled configuration. Auto/disabled values remain omitted and explicit zero remains manual. Profile/model comparisons use the base Profile's sampling configuration across every compared Viewer route; Preflight fails if any required route reports the manual parameter as unsupported or unknown. Dry Run and Experiment Lock show the frozen values. Resume uses the locked condition/snapshot and never reloads later Profile sampling edits. Research sampling applies only to the tested Viewer role, not to AI Judge or Monitor roles.

Judge receives an allowlisted sealed-evidence/Reveal packet, uses fixed **3+3+2+2** scoring and separates confirmed correspondence from unverified plausible context. General plausibility is not a confirmed hit. Scores freeze before unblinding; later software/rubric changes do not silently recalculate accepted scores.

New Research normally freezes Viewer 16,384 → 32,768 and current Judge analytical policy v2 32,768 → 49,152, within model/context capacity. A frozen Judge v1 remains 16,384 → 32,768. Legacy lock without a Judge policy keeps 8,192 → 16,384 for missing work. Saved Viewer/telepathic policies keep their recorded values.

Stop retains completed work and requires explicit continuation. End records a protected terminal marker outside frozen Research config; it refuses later execution without rewriting the study. Uncertain paid dispatch requires resolution, not automatic resend. Export retains configuration, provenance, hashes and frozen inputs/results.

## Sampling configurations Research

The `Sampling configurations` template compares OpenRouter Viewer sampling settings without introducing a second execution engine. `top_p`, `top_k`, and `seed` can each be fixed or varied; at least one axis must be varied. The design expands deterministically to the full Cartesian product, so 3 top-p values × 2 top-k values × 2 seeds creates 12 ordinary Research conditions. The existing planner then creates condition × target × repetition assignments and preserves the same matched `pairKey` semantics.

Fixed Auto is represented by omission, not zero. Manual zero remains a real value. The locked `samplingDesign`, generated conditions, structural `samplingValues`, Viewer control and requested/effective settings must agree; Planner and Preflight reject tampered or incomplete payloads. Sampling Research requires an explicit `viewerControl.sampling` record and cannot use the legacy missing-viewer-control exception. A condition instruction must be absent everywhere or be the same frozen snapshot in every condition, so the sampler is not confounded by a hidden prompt change.

The current plan limits a grid to 125 configurations and 10,000 planned sessions. Counts are computed before Lock and never silently truncated. Pairwise statistics use an indexed condition/pair representation and the UI renders only the first 100 pairwise rows while the full set remains available in results/export.

After Unblind, results expose structural `top_p`, `top_k`, `seed`, temperature, reasoning, model/route and available execution provenance. Viewer response events retain provider-reported actual provider/model, request/generation identifiers, usage, cost and duration when available. Missing provider evidence is shown as `unknown`; the configured OpenRouter route is never relabeled as a confirmed actual provider.

For `save_only`, configuration tables are retained under `private_master/configuration/condition_parameters.json/.csv`. The shareable `external_evaluation` folder remains blind and contains no sampling values, condition mapping, profile/model identity or configured route. Normal post-Unblind exports include structural condition/session tables and the complete pairwise result set.
